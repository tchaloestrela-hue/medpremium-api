import { getStore } from '@netlify/blobs';

// Cabeçalhos CORS — a app de gestão corre noutra origem e precisa de ler
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });

  const store = getStore('inscricoes');
  const url = new URL(req.url);

  // ---- Receber inscrição do site (POST) ----
  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { b = {}; }
    const nome = b.nome;
    const telefone = b.telefone || b.tel || '';
    if (!nome || !telefone) {
      return json({ erro: 'Nome e telefone são obrigatórios' }, 400);
    }
    const id = String(Date.now());
    const registo = {
      id,
      nome,
      email: b.email || '',
      telefone,
      curso: b.cursoAlvo || b.curso || '',
      modalidade: b.modalidade || '',
      morada: b.morada || '',
      sexo: b.sexo || '',
      media: b.mediaEnsinoMedio || '',
      notas: b.notas || '',
      origem: b.origem || 'website',
      estado: 'pendente',
      data_inscricao: new Date().toISOString()
    };
    await store.setJSON(id, registo);
    return json({ ok: true, id, message: 'Inscrição recebida com sucesso' });
  }

  // ---- Atualizar estado (validar/rejeitar) — PUT /api/inscricoes/:id ----
  if (req.method === 'PUT') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    let b;
    try { b = await req.json(); } catch { b = {}; }
    const item = await store.get(id, { type: 'json' });
    if (!item) return json({ ok: false, erro: 'Inscrição não encontrada' }, 404);
    item.estado = b.estado || item.estado;
    await store.setJSON(id, item);
    return json({ ok: true });
  }

  // ---- Eliminar inscrição — DELETE /api/inscricoes/:id ----
  if (req.method === 'DELETE') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    await store.delete(id);
    return json({ ok: true });
  }

  // ---- Listar inscrições (a app lê daqui) — GET ----
  if (req.method === 'GET') {
    const { blobs } = await store.list();
    const inscricoes = [];
    for (const blob of blobs) {
      const item = await store.get(blob.key, { type: 'json' });
      if (item) inscricoes.push(item);
    }
    const estado = url.searchParams.get('estado');
    const lista = estado ? inscricoes.filter(i => i.estado === estado) : inscricoes;
    lista.sort((a, b) => (b.data_inscricao || '').localeCompare(a.data_inscricao || ''));
    return json({ ok: true, inscricoes: lista });
  }

  return json({ erro: 'Método não suportado' }, 405);
};
