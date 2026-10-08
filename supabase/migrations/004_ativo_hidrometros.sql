-- Compatibilidade com o fluxo de conferência e com a importação administrativa.
ALTER TABLE public.hidrometros
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
