const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3002
const DATA_FILE = path.join(__dirname, 'data', 'inscricoes.json')

// Garantir que a pasta data existe
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })
}

// Inicializar ficheiro se nao existe
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8')
}

// CORS — permitir o site Netlify e localhost
app.use(cors({
  origin: [
    'https://medpremium.netlify.app',
    'http://localhost:3002',
    'http://localhost:3001',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// --- Helpers ---
function lerInscricoes() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch { return [] }
}

function salvarInscricoes(lista) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(lista, null, 2), 'utf8')
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// --- API Endpoints ---

// Health check
app.get('/', (req, res) => {
  res.json({
    nome: 'Preparatório MedPremium — API',
    status: 'online',
    versao: '1.0.0',
    endpoints: {
      inscricoes: '/api/inscricoes',
      pendentes: '/api/inscricoes/pendentes',
      novas: '/api/inscricoes/novas?desde=ISO_DATE',
      stats: '/api/stats'
    }
  })
})

// GET /api/inscricoes - Listar todas
app.get('/api/inscricoes', (req, res) => {
  const lista = lerInscricoes()
  const status = req.query.status
  if (status) {
    res.json(lista.filter(i => i.status === status))
  } else {
    res.json(lista)
  }
})

// GET /api/inscricoes/pendentes
app.get('/api/inscricoes/pendentes', (req, res) => {
  const lista = lerInscricoes().filter(i => i.status === 'pendente')
  res.json(lista)
})

// GET /api/inscricoes/novas?desde=timestamp
app.get('/api/inscricoes/novas', (req, res) => {
  const desde = req.query.desde ? new Date(req.query.desde) : new Date(0)
  const lista = lerInscricoes().filter(i => new Date(i.dataRecebida) > desde)
  res.json(lista)
})

// POST /api/inscricoes - Nova inscricao
app.post('/api/inscricoes', (req, res) => {
  const dados = req.body
  if (!dados.nome || !dados.nome.trim()) {
    return res.status(400).json({ erro: 'O campo "nome" e obrigatorio.' })
  }

  const lista = lerInscricoes()

  // Verificar duplicado por telefone
  const telNorm = (dados.telefone || '').replace(/\D/g, '')
  if (telNorm) {
    const duplicado = lista.find(i => (i.telefone || '').replace(/\D/g, '') === telNorm && i.status === 'pendente')
    if (duplicado) {
      return res.status(409).json({ erro: 'Ja existe uma inscricao pendente com este telefone.', inscricao: duplicado })
    }
  }

  const nova = {
    id: uid(),
    dataRecebida: new Date().toISOString(),
    status: 'pendente',
    origem: dados.origem || 'website',
    nome: dados.nome.trim(),
    telefone: dados.telefone || '',
    sexo: dados.sexo || '',
    numeroBilhete: dados.numeroBilhete || dados.bi || '',
    morada: dados.morada || '',
    cursoAlvo: dados.cursoAlvo || dados.curso || 'Medicina',
    cursoEnsinoMedio: dados.cursoEnsinoMedio || '',
    instituicaoEnsinoMedio: dados.instituicaoEnsinoMedio || '',
    mediaEnsinoMedio: dados.mediaEnsinoMedio || '',
    cursosSuperiores: dados.cursosSuperiores || '',
    numTentativas: dados.numTentativas ?? 0,
    modalidade: dados.modalidade || '',
    notas: dados.notas || dados.mensagem || '',
  }

  lista.push(nova)
  salvarInscricoes(lista)

  console.log(`[NOVA INSCRICAO] ${nova.nome} via ${nova.origem} (${nova.telefone || 'sem tel'})`)
  res.status(201).json({ sucesso: true, inscricao: nova })
})

// PUT /api/inscricoes/:id - Actualizar
app.put('/api/inscricoes/:id', (req, res) => {
  const lista = lerInscricoes()
  const idx = lista.findIndex(i => i.id === req.params.id)
  if (idx === -1) return res.status(404).json({ erro: 'Inscricao nao encontrada.' })
  lista[idx] = { ...lista[idx], ...req.body }
  salvarInscricoes(lista)
  res.json(lista[idx])
})

// DELETE /api/inscricoes/:id
app.delete('/api/inscricoes/:id', (req, res) => {
  let lista = lerInscricoes()
  lista = lista.filter(i => i.id !== req.params.id)
  salvarInscricoes(lista)
  res.json({ sucesso: true })
})

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const inscricoes = lerInscricoes()
  res.json({
    totalInscricoes: inscricoes.length,
    pendentes: inscricoes.filter(i => i.status === 'pendente').length,
    aprovadas: inscricoes.filter(i => i.status === 'aprovada').length,
  })
})

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('==============================================')
  console.log('  PREPARATORIO MEDPREMIUM — API ONLINE')
  console.log('==============================================')
  console.log(`  Porta: ${PORT}`)
  console.log(`  API:   /api/inscricoes`)
  console.log('==============================================')
  console.log('')
})

module.exports = app
