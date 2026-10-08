-- Campos utilizados pela busca, pelo cadastro manual e pelo painel administrativo.
ALTER TABLE public.hidrometros
  ADD COLUMN IF NOT EXISTS numero_serie_norm TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS observacoes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS chave_composta TEXT NOT NULL DEFAULT '';

-- Para registros que já existirem, gera uma chave estável antes de importações futuras.
UPDATE public.hidrometros
SET
  numero_serie_norm = upper(trim(coalesce(numero_serie_hidrometro, ''))),
  chave_composta = upper(trim(coalesce(numero_serie_hidrometro, ''))) || '|' ||
                   upper(trim(coalesce(id_devolucao, ''))) || '|' ||
                   upper(trim(coalesce(ordem_servico, '')))
WHERE numero_serie_norm = '' OR chave_composta = '';
