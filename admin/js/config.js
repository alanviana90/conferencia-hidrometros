// Configuração pública usada pelo app e pelo painel administrativo.
// A chave publishable pode ficar no frontend; nunca coloque uma chave secret aqui.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://sbadortyfkhllpwdmmje.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_WXqOK6MylU-aOeo-ibb4aA_AfRBS0ZE';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
