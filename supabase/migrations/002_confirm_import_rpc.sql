-- RPC transacional para confirmar importação (chamada pelo painel admin autenticado)

CREATE OR REPLACE FUNCTION confirmar_importacao(
  p_nome_arquivo           TEXT,
  p_total_linhas           INT,
  p_registros              JSONB,
  p_chaves_remover         TEXT[] DEFAULT '{}',
  p_quantidade_erros       INT DEFAULT 0,
  p_detalhes_erros         JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_importacao_id UUID;
  v_novos         INT := 0;
  v_atualizados   INT := 0;
  v_inalterados   INT := 0;
  v_removidos     INT := 0;
  r               RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_registros IS NULL OR jsonb_typeof(p_registros) <> 'array' THEN
    RAISE EXCEPTION 'p_registros deve ser um array JSON';
  END IF;

  INSERT INTO importacoes (
    nome_arquivo,
    quantidade_registros,
    quantidade_erros,
    detalhes_erros,
    status
  ) VALUES (
    p_nome_arquivo,
    p_total_linhas,
    p_quantidade_erros,
    p_detalhes_erros,
    'preview'
  )
  RETURNING id INTO v_importacao_id;

  -- Upsert de todos os registros válidos do arquivo (novos + alterados + inalterados)
  FOR r IN
    SELECT *
    FROM jsonb_to_recordset(p_registros) AS x(
      concessionaria          TEXT,
      data_recebimento        TEXT,
      ordem_servico           TEXT,
      codigo_hidrometro       TEXT,
      numero_serie_hidrometro TEXT,
      numero_serie_norm       TEXT,
      id_devolucao            TEXT,
      observacoes             TEXT,
      chave_composta          TEXT,
      acao                    TEXT
    )
  LOOP
    IF r.acao = 'novo' THEN
      v_novos := v_novos + 1;
    ELSIF r.acao = 'atualizado' THEN
      v_atualizados := v_atualizados + 1;
    ELSIF r.acao = 'inalterado' THEN
      v_inalterados := v_inalterados + 1;
    END IF;

    INSERT INTO hidrometros (
      concessionaria,
      data_recebimento,
      ordem_servico,
      codigo_hidrometro,
      numero_serie_hidrometro,
      numero_serie_norm,
      id_devolucao,
      observacoes,
      chave_composta,
      ativo
    ) VALUES (
      COALESCE(r.concessionaria, ''),
      r.data_recebimento::DATE,
      r.ordem_servico,
      COALESCE(r.codigo_hidrometro, ''),
      r.numero_serie_hidrometro,
      r.numero_serie_norm,
      r.id_devolucao,
      COALESCE(r.observacoes, ''),
      r.chave_composta,
      true
    )
    ON CONFLICT (chave_composta) DO UPDATE SET
      concessionaria          = EXCLUDED.concessionaria,
      data_recebimento        = EXCLUDED.data_recebimento,
      ordem_servico           = EXCLUDED.ordem_servico,
      codigo_hidrometro       = EXCLUDED.codigo_hidrometro,
      numero_serie_hidrometro = EXCLUDED.numero_serie_hidrometro,
      numero_serie_norm       = EXCLUDED.numero_serie_norm,
      id_devolucao            = EXCLUDED.id_devolucao,
      observacoes             = EXCLUDED.observacoes,
      ativo                   = true,
      updated_at              = now()
    WHERE
      hidrometros.concessionaria          IS DISTINCT FROM EXCLUDED.concessionaria OR
      hidrometros.data_recebimento        IS DISTINCT FROM EXCLUDED.data_recebimento OR
      hidrometros.ordem_servico           IS DISTINCT FROM EXCLUDED.ordem_servico OR
      hidrometros.codigo_hidrometro       IS DISTINCT FROM EXCLUDED.codigo_hidrometro OR
      hidrometros.numero_serie_hidrometro IS DISTINCT FROM EXCLUDED.numero_serie_hidrometro OR
      hidrometros.id_devolucao            IS DISTINCT FROM EXCLUDED.id_devolucao OR
      hidrometros.observacoes             IS DISTINCT FROM EXCLUDED.observacoes OR
      hidrometros.ativo                   = false;
  END LOOP;

  -- Soft delete: registros ativos ausentes no Excel confirmado
  UPDATE hidrometros
  SET ativo = false, updated_at = now()
  WHERE ativo = true
    AND chave_composta = ANY (p_chaves_remover);

  GET DIAGNOSTICS v_removidos = ROW_COUNT;

  PERFORM recalcular_series_duplicadas();

  UPDATE importacoes
  SET
    quantidade_novos       = v_novos,
    quantidade_atualizados = v_atualizados,
    quantidade_inalterados = v_inalterados,
    quantidade_removidos   = v_removidos,
    status                 = 'confirmado',
    data_importacao        = now()
  WHERE id = v_importacao_id;

  RETURN v_importacao_id;
END;
$$;

REVOKE ALL ON FUNCTION confirmar_importacao FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirmar_importacao TO authenticated;
