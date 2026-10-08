-- Campo usado pela conferência física para identificar o lote atual.
ALTER TABLE public.hidrometros
  ADD COLUMN IF NOT EXISTS lote TEXT NOT NULL DEFAULT '';
