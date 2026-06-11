require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'medpremium-secret-key-2024';

// Twilio Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155552671';

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✓ Twilio inicializado com sucesso');
} else {
  console.log('⚠️  Twilio não configurado - usando modo demo');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// Inicializar BD (DB_PATH aponta para o disco persistente no Render)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'medpremium.db');
const db = new sqlite3.Database(DB_PATH);
console.log(`✓ Base de dados: ${DB_PATH}`);

// Criar tabelas
db.serialize(() => {
  // Tabela de usuários
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    senha TEXT,
    nome TEXT,
    role TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de estudantes
  db.run(`CREATE TABLE IF NOT EXISTS estudantes (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    tel TEXT,
    email TEXT,
    curso TEXT,
    turma_id INTEGER,
    destino TEXT,
    insc_paga BOOLEAN,
    dt_insc DATETIME,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de pagamentos
  db.run(`CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY,
    est_id INTEGER,
    est_nome TEXT,
    tipo TEXT,
    ref TEXT,
    valor REAL,
    data DATE,
    metodo TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (est_id) REFERENCES estudantes(id)
  )`);

  // Tabela de propinas mensais
  db.run(`CREATE TABLE IF NOT EXISTS propinas (
    id INTEGER PRIMARY KEY,
    est_id INTEGER,
    mes TEXT,
    valor REAL,
    paga BOOLEAN,
    data_pag DATE,
    metodo TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (est_id) REFERENCES estudantes(id)
  )`);

  // Tabela de despesas
  db.run(`CREATE TABLE IF NOT EXISTS despesas (
    id INTEGER PRIMARY KEY,
    descricao TEXT,
    tipo TEXT,
    valor REAL,
    data DATE,
    beneficiario TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de turmas
  db.run(`CREATE TABLE IF NOT EXISTS turmas (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    turno TEXT,
    capacidade INTEGER,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de pré-inscrições (recebidas do site)
  db.run(`CREATE TABLE IF NOT EXISTS preinscricoes (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    email TEXT,
    telefone TEXT,
    curso TEXT,
    modalidade TEXT,
    morada TEXT,
    sexo TEXT,
    media TEXT,
    notas TEXT,
    origem TEXT,
    estado TEXT DEFAULT 'pendente',
    data_inscricao DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('✓ Tabelas iniciadas');
});

// ==================== AUTH ====================

// Registrar
app.post('/api/auth/register', (req, res) => {
  const { email, senha, nome } = req.body;

  if (!email || !senha || !nome) {
    return res.status(400).json({ error: 'Campos obrigatórios' });
  }

  db.run(
    'INSERT INTO usuarios (email, senha, nome, role) VALUES (?, ?, ?, ?)',
    [email, senha, nome, 'admin'],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Email já existe' });
      }
      res.json({ success: true, message: 'Utilizador criado com sucesso' });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;

  db.get('SELECT * FROM usuarios WHERE email = ? AND senha = ?', [email, senha], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, nome: user.nome } });
  });
});

// Middleware de autenticação
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// ==================== PROPINAS ====================

app.get('/api/propinas', authenticateToken, (req, res) => {
  db.all(`
    SELECT p.*, e.nome as est_nome
    FROM propinas p
    JOIN estudantes e ON p.est_id = e.id
    ORDER BY p.criado_em DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/propinas', authenticateToken, (req, res) => {
  const { est_id, mes, valor, paga, data_pag, metodo } = req.body;

  db.run(
    'INSERT INTO propinas (est_id, mes, valor, paga, data_pag, metodo) VALUES (?, ?, ?, ?, ?, ?)',
    [est_id, mes, valor, paga || false, data_pag, metodo],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    }
  );
});

// ==================== RELATÓRIOS ====================

app.get('/api/relatorios/financeiro', authenticateToken, (req, res) => {
  db.all(`
    SELECT
      SUM(CASE WHEN tipo = 'propina' THEN valor ELSE 0 END) as propinas,
      SUM(CASE WHEN tipo = 'inscricao' THEN valor ELSE 0 END) as inscricoes,
      (SELECT SUM(valor) FROM despesas) as despesas
    FROM pagamentos
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const dados = rows[0] || {};
    res.json({
      receitas: (dados.propinas || 0) + (dados.inscricoes || 0),
      propinas: dados.propinas || 0,
      inscricoes: dados.inscricoes || 0,
      despesas: dados.despesas || 0,
      lucro: ((dados.propinas || 0) + (dados.inscricoes || 0)) - (dados.despesas || 0)
    });
  });
});

app.get('/api/relatorios/estudantes', authenticateToken, (req, res) => {
  db.all(`
    SELECT destino, COUNT(*) as total
    FROM estudantes
    GROUP BY destino
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ==================== PDF ====================

app.get('/api/pdf/relatorio/:tipo', authenticateToken, (req, res) => {
  const { tipo } = req.params;
  const doc = new PDFDocument();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${tipo}.pdf"`);

  doc.pipe(res);

  // Cabeçalho
  doc.fontSize(20).text('MEDPREMIUM', { align: 'center' });
  doc.fontSize(14).text(`Relatório de ${tipo}`, { align: 'center' });
  doc.moveDown();

  // Data
  doc.fontSize(10).text(`Gerado em: ${new Date().toLocaleDateString('pt-AO')}`, { align: 'right' });
  doc.moveDown();

  // Conteúdo
  if (tipo === 'Financeiro') {
    db.get(`
      SELECT
        SUM(CASE WHEN tipo = 'propina' THEN valor ELSE 0 END) as propinas,
        SUM(CASE WHEN tipo = 'inscricao' THEN valor ELSE 0 END) as inscricoes,
        (SELECT SUM(valor) FROM despesas) as despesas
      FROM pagamentos
    `, [], (err, dados) => {
      if (dados) {
        doc.fontSize(12).text('Receitas:', { underline: true });
        doc.fontSize(10).text(`Propinas: ${fmt(dados.propinas || 0)}`);
        doc.text(`Inscrições: ${fmt(dados.inscricoes || 0)}`);
        doc.moveDown();

        doc.fontSize(12).text('Despesas:', { underline: true });
        doc.fontSize(10).text(`Total: ${fmt(dados.despesas || 0)}`);
        doc.moveDown();

        const lucro = ((dados.propinas || 0) + (dados.inscricoes || 0)) - (dados.despesas || 0);
        doc.fontSize(12).text(`Balanço: ${fmt(lucro)}`, { color: lucro >= 0 ? '008000' : 'FF0000' });
      }
      doc.end();
    });
  } else {
    doc.fontSize(12).text('Dados ainda não disponíveis');
    doc.end();
  }
});

// ==================== WHATSAPP ====================

// Enviar mensagem WhatsApp
app.post('/api/whatsapp/enviar', authenticateToken, async (req, res) => {
  const { telefone, mensagem, tipo = 'texto' } = req.body;

  try {
    console.log(`📱 WhatsApp [${tipo}] para +244${telefone}`);

    if (twilioClient) {
      // Enviar via Twilio
      const message = await twilioClient.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+244${telefone}`,
        body: mensagem
      });

      console.log(`✓ Enviado via Twilio - SID: ${message.sid}`);

      res.json({
        ok: true,
        message: 'Mensagem enviada com sucesso',
        telefone,
        tipo,
        messageSid: message.sid,
        timestamp: new Date().toISOString()
      });
    } else {
      // Modo demo
      console.log(`⚠️  Modo demo - Twilio não configurado`);
      console.log(`   Mensagem seria enviada para: +244${telefone}`);

      res.json({
        ok: true,
        message: 'Mensagem agendada (modo demo)',
        telefone,
        tipo,
        demo: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Erro ao enviar WhatsApp: ${error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Enviar fatura via WhatsApp com logo
app.post('/api/whatsapp/enviar-fatura', authenticateToken, async (req, res) => {
  const { telefone, estNome, valor, ref, data, email } = req.body;

  try {
    const mensagem = `
🏥 *MED PREMIUM PREPARATÓRIO*

Olá *${estNome}*! 👋

Sua fatura foi gerada com sucesso:

📄 *Referência:* ${ref}
💰 *Valor:* ${(valor || 0).toLocaleString('pt-AO')} Kz
📅 *Data:* ${data}
📧 *Email:* ${email}

Para pagar ou visualizar a fatura completa, acesse:
https://medpremium.netlify.app/fatura/${ref}

Dúvidas? Responda este mensagem! 💬

Obrigado por confiar no MedPremium! 🎓
    `.trim();

    console.log(`📱 WhatsApp [FATURA] para +244${telefone}`);
    console.log(`   Fatura: ${ref} - ${valor} Kz`);
    console.log(`   Cliente: ${estNome}`);

    if (twilioClient) {
      const message = await twilioClient.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+244${telefone}`,
        body: mensagem
      });

      console.log(`✓ Fatura enviada via Twilio - SID: ${message.sid}`);

      res.json({
        ok: true,
        message: 'Fatura enviada com sucesso via WhatsApp',
        telefone,
        fatura: ref,
        valor,
        messageSid: message.sid,
        timestamp: new Date().toISOString()
      });
    } else {
      // Modo demo
      console.log(`⚠️  Modo demo - Fatura seria enviada para +244${telefone}`);

      res.json({
        ok: true,
        message: 'Fatura agendada (modo demo)',
        telefone,
        fatura: ref,
        valor,
        demo: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Erro ao enviar fatura: ${error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Enviar notificação de inscrição validada
app.post('/api/whatsapp/notificar-inscricao', authenticateToken, async (req, res) => {
  const { telefone, nome, curso } = req.body;

  try {
    const mensagem = `
🎉 *Parabéns ${nome}!*

Sua inscrição no curso de *${curso}* foi *VALIDADA* ✅

Dados de acesso:
🔗 Link: https://medpremium.netlify.app
📧 Email: ${nome.toLowerCase().replace(/\s/g, '.')}@preparatorio.ao

Bem-vindo ao MedPremium! 🏥

Dúvidas? Entre em contato conosco! 💬
    `.trim();

    console.log(`📱 WhatsApp [VALIDAÇÃO] para +244${telefone}`);
    console.log(`   Inscrição validada: ${nome} - ${curso}`);

    if (twilioClient) {
      const message = await twilioClient.messages.create({
        from: TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+244${telefone}`,
        body: mensagem
      });

      console.log(`✓ Notificação enviada via Twilio - SID: ${message.sid}`);

      res.json({
        ok: true,
        message: 'Notificação de validação enviada com sucesso',
        telefone,
        messageSid: message.sid,
        timestamp: new Date().toISOString()
      });
    } else {
      // Modo demo
      console.log(`⚠️  Modo demo - Notificação seria enviada para +244${telefone}`);

      res.json({
        ok: true,
        message: 'Notificação agendada (modo demo)',
        telefone,
        demo: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Erro ao notificar inscrição: ${error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Envio em lote
app.post('/api/whatsapp/blast', authenticateToken, async (req, res) => {
  const { lista, mensagem, tipo = 'texto' } = req.body;

  try {
    let enviados = 0;
    let erros = 0;
    const messageSids = [];

    for (const contato of lista) {
      try {
        const msg = mensagem.replace('{nome}', contato.nome);
        console.log(`📱 WhatsApp [${tipo}] para +244${contato.telefone}: ${contato.nome}`);

        if (twilioClient) {
          const message = await twilioClient.messages.create({
            from: TWILIO_WHATSAPP_FROM,
            to: `whatsapp:+244${contato.telefone}`,
            body: msg
          });
          messageSids.push(message.sid);
          console.log(`   ✓ SID: ${message.sid}`);
        } else {
          console.log(`   ⚠️  Modo demo`);
        }
        enviados++;
      } catch (error) {
        console.error(`   ❌ Erro: ${error.message}`);
        erros++;
      }
    }

    res.json({
      ok: true,
      message: `${enviados} mensagens enviadas, ${erros} erros`,
      enviados,
      erros,
      tipo,
      messageSids: twilioClient ? messageSids : [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Erro no blast: ${error.message}`);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ==================== SYNC ====================

app.post('/api/sync', (req, res) => {
  const { timestamp, data, app, version } = req.body;

  try {
    const { estudantes, pagamentos, propinas, despesas, turmas } = data || {};
    let syncCount = 0;

    // Sincronizar estudantes
    if (estudantes && estudantes.length > 0) {
      estudantes.forEach(e => {
        db.run(`
          INSERT OR REPLACE INTO estudantes
          (id, nome, tel, email, curso, destino, insc_paga, dt_insc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [e.id, e.nome, e.tel, e.email, e.curso, e.dest, e.inscpaga, e.dtpag]);
        syncCount++;
      });
    }

    // Sincronizar pagamentos
    if (pagamentos && pagamentos.length > 0) {
      pagamentos.forEach(p => {
        db.run(`
          INSERT OR IGNORE INTO pagamentos
          (id, est_id, est_nome, tipo, ref, valor, data, metodo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [p.id, p.estId, p.estNome, p.tipo, p.ref, p.valor, p.data, p.met]);
        syncCount++;
      });
    }

    // Log de sincronização
    console.log(`✓ SYNC [${new Date().toISOString()}] ${app} v${version} - ${syncCount} registros sincronizados`);

    res.json({
      ok: true,
      message: 'Sincronizado com sucesso',
      synced: syncCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro na sincronização:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ==================== API ESTUDANTES ====================

app.get('/api/estudantes', authenticateToken, (req, res) => {
  db.all('SELECT * FROM estudantes', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/estudantes', authenticateToken, (req, res) => {
  const { nome, tel, email, curso, destino, insc_paga, dt_insc } = req.body;

  db.run(
    'INSERT INTO estudantes (nome, tel, email, curso, destino, insc_paga, dt_insc) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [nome, tel, email, curso, destino, insc_paga || false, dt_insc],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    }
  );
});

// ==================== INSCRIÇÕES (SITE <-> APP) ====================
//
// Fluxo: o formulário do site faz POST /api/inscricoes  ->  guarda em preinscricoes
//        a app de gestão faz GET /api/inscricoes        ->  recebe as novas
//        a app valida/rejeita via PUT /api/inscricoes/:id

// Receber inscrição do site (público — sem token)
app.post('/api/inscricoes', (req, res) => {
  const b = req.body || {};
  const nome = b.nome;
  const telefone = b.telefone || b.tel || '';
  if (!nome || !telefone) {
    return res.status(400).json({ erro: 'Nome e telefone são obrigatórios' });
  }

  const id = Date.now();
  db.run(`
    INSERT INTO preinscricoes
    (id, nome, email, telefone, curso, modalidade, morada, sexo, media, notas, origem, estado, data_inscricao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)
  `, [
    id,
    nome,
    b.email || '',
    telefone,
    b.cursoAlvo || b.curso || '',
    b.modalidade || '',
    b.morada || '',
    b.sexo || '',
    b.mediaEnsinoMedio || '',
    b.notas || '',
    b.origem || 'website',
    new Date().toISOString()
  ], function (err) {
    if (err) {
      console.error('❌ Erro ao guardar inscrição:', err.message);
      return res.status(500).json({ erro: 'Erro ao guardar inscrição' });
    }
    console.log(`✓ Nova inscrição do site: ${nome} (${telefone})`);
    res.json({ ok: true, id, message: 'Inscrição recebida com sucesso' });
  });
});

// Listar inscrições (a app lê daqui)
app.get('/api/inscricoes', (req, res) => {
  const estado = req.query.estado;
  const sql = estado
    ? 'SELECT * FROM preinscricoes WHERE estado = ? ORDER BY data_inscricao DESC'
    : 'SELECT * FROM preinscricoes ORDER BY data_inscricao DESC';
  db.all(sql, estado ? [estado] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, inscricoes: rows || [] });
  });
});

// Alias compatível com versões anteriores da app
app.get('/api/inscricoes/site', (req, res) => {
  db.all('SELECT * FROM preinscricoes ORDER BY data_inscricao DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, inscricoes: rows || [] });
  });
});

// Atualizar estado de uma inscrição (validar / rejeitar)
app.put('/api/inscricoes/:id', (req, res) => {
  const { estado } = req.body;
  db.run('UPDATE preinscricoes SET estado = ? WHERE id = ?', [estado || 'pendente', req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, atualizado: this.changes });
  });
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
  console.log(`\n🚀 MedPremium Backend rodando em http://localhost:${PORT}`);
  console.log('✓ BD SQLite iniciada');
  console.log('✓ Autenticação JWT ativa');
  console.log('✓ Inscrições do site: POST/GET /api/inscricoes');
  console.log('✓ APIs disponíveis\n');
});

function fmt(v) {
  return (v || 0).toLocaleString('pt-AO') + ' Kz';
}
