let config;
try {
  config = await import('./config.js');
} catch {
  throw new Error('Arquivo admin/js/config.js não encontrado. Copie config.example.js para config.js e preencha as credenciais.');
}

export const supabase = config.supabase;

export async function requireAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    location.href = './index.html';
    return null;
  }
  return session;
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function fetchAllHidrometros() {
  const pageSize = 1000;
  const cols =
    'id, concessionaria, data_recebimento, ordem_servico, codigo_hidrometro, numero_serie_hidrometro, numero_serie_norm, id_devolucao, observacoes, chave_composta, ativo';
  /** @type {object[]} */
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase.from('hidrometros').select(cols).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function fetchDashboard() {
  const [totalRes, inativosRes, ultimaRes] = await Promise.all([
    supabase.from('hidrometros').select('*', { count: 'exact', head: true }).eq('ativo', true),
    supabase.from('hidrometros').select('*', { count: 'exact', head: true }).eq('ativo', false),
    supabase
      .from('importacoes')
      .select('*')
      .eq('status', 'confirmado')
      .order('data_importacao', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (totalRes.error) throw totalRes.error;
  if (inativosRes.error) throw inativosRes.error;
  if (ultimaRes.error) throw ultimaRes.error;

  return {
    total_hidrometros: totalRes.count || 0,
    total_inativos: inativosRes.count || 0,
    ultima_importacao: ultimaRes.data,
  };
}

export async function fetchImportHistory(limit = 10) {
  const { data, error } = await supabase
    .from('importacoes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function confirmImportacao(payload) {
  const { data, error } = await supabase.rpc('confirmar_importacao', payload);
  if (error) throw error;
  return data;
}
