const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const PORT = process.env.PORT || 3002

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

app.use(cors({
  origin: ['https://medpremium.netlify.app','http://localhost:3002','http://localhost:3001','http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

function uid() { return 'mp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

app.get('/', (req, res) => res.json({ nome: 'MedPremium API', status: 'online', versao: '2.0.0', storage: 'Supabase' }))

app.get('/api/inscricoes', async (req, res) => {
  let query = supabase.from('inscricoes').select('*').order('dataRecebida', { ascending: false })
  if (req.query.status) query = query.eq('status', req.query.status)
  const { data, error } = await query
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data || [])
})

app.get('/api/inscricoes/pendentes', async (req, res) => {
  const { data, error } = await supabase.from('inscricoes').select('*').eq('status', 'pendente').order('dataRecebida', { ascending: false })
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data || [])
})

app.get('/api/inscricoes/novas', async (req, res) => {
  const desde = req.query.desde || new Date(0).toISOString()
  const { data, error } = await supabase.from('inscricoes').select('*').gt('dataRecebida', desde).order('dataRecebida', { ascending: false })
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data || [])
})

app.post('/api/inscricoes', async (req, res) => {
  const dados = req.body
  if (!dados.nome || !dados.nome.trim()) return res.status(400).json({ erro: 'O campo nome e obrigatorio.' })
  const nova = {
    id: uid(), dataRecebida: new Date().toISOString(), status: 'pendente',
    origem: dados.origem || 'website', nome: dados.nome.trim(),
    telefone: dados.telefone || '', sexo: dados.sexo || '',
    numeroBilhete: dados.numeroBilhete || dados.bi || '', morada: dados.morada || '',
    cursoAlvo: dados.cursoAlvo || dados.curso || 'Medicina',
    cursoEnsinoMedio: dados.cursoEnsinoMedio || '', instituicaoEnsinoMedio: dados.instituicaoEnsinoMedio || '',
    mediaEnsinoMedio: dados.mediaEnsinoMedio || '', cursosSuperiores: dados.cursosSuperiores || '',
    numTentativas: Number(dados.numTentativas) || 0, modalidade: dados.modalidade || '',
    notas: dados.notas || dados.mensagem || '',
  }
  const { data, error } = await supabase.from('inscricoes').insert([nova]).select().single()
  if (error) return res.status(500).json({ erro: error.message })
  console.log('[NOVA] ' + nova.nome + ' via ' + nova.origem)
  res.status(201).json({ sucesso: true, inscricao: data })
})

app.put('/api/inscricoes/:id', async (req, res) => {
  const { data, error } = await supabase.from('inscricoes').update(req.body).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ erro: error.message })
  if (!data) return res.status(404).json({ erro: 'Nao encontrada.' })
  res.json(data)
})

app.delete('/api/inscricoes/:id', async (req, res) => {
  const { error } = await supabase.from('inscricoes').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ sucesso: true })
})

app.get('/api/stats', async (req, res) => {
  const { data, error } = await supabase.from('inscricoes').select('status')
  if (error) return res.status(500).json({ erro: error.message })
  const lista = data || []
  res.json({ totalInscricoes: lista.length, pendentes: lista.filter(i => i.status === 'pendente').length, aprovadas: lista.filter(i => i.status === 'aprovada').length })
})

app.listen(PORT, '0.0.0.0', () => console.log('MedPremium API (Supabase) na porta ' + PORT))
module.exports = app
