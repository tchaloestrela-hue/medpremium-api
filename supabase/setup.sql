-- MedPremium · Setup da base de dados
-- Executa este script no Supabase: SQL Editor → New Query → colar → Run

create table if not exists inscricoes (
  id                       text primary key,
  "dataRecebida"           timestamptz,
  status                   text default 'pendente',
  origem                   text,
  nome                     text not null,
  telefone                 text,
  sexo                     text,
  "numeroBilhete"          text,
  morada                   text,
  "cursoAlvo"              text,
  "cursoEnsinoMedio"       text,
  "instituicaoEnsinoMedio" text,
  "mediaEnsinoMedio"       text,
  "cursosSuperiores"       text,
  "numTentativas"          integer default 0,
  modalidade               text,
  notas                    text
);
