/**
 * Funções SECURITY DEFINER do super-admin de plataforma (0035, T-0087, ADR 0029), na forma do regprocedure. Na 0035, EXECUTE só
 * ao macuxi_app; desde a 0038 (T-0091), só ao macuxi_portal (nunca PUBLIC, o macuxi_app nem o macuxi_worker). Usadas por
 * estatico.test.ts, super-admin.test.ts e papel-portal.test.ts (que confere também pelo catálogo: nenhuma sa_* fora da lista).
 */
export const FUNCOES_SA = [
  'plataforma.sa_existe()',
  'plataforma.sa_criar_primeiro(text, text, text)',
  'plataforma.sa_para_login(text)',
  'plataforma.sa_por_id(uuid)',
  'plataforma.sa_registrar_falha(uuid)',
  'plataforma.sa_registrar_sucesso(uuid)',
  'plataforma.sa_gravar_totp_pendente(uuid, text)',
  'plataforma.sa_confirmar_totp(uuid, bigint, text[])',
  'plataforma.sa_marcar_passo(uuid, bigint)',
  'plataforma.sa_usar_recuperacao(uuid, text)',
  'plataforma.sa_regerar_recuperacao(uuid, text[])',
  'plataforma.sa_abrir_desafio(uuid, text)',
  'plataforma.sa_ver_desafio(text)',
  'plataforma.sa_abrir_sessao(text)',
  'plataforma.sa_sessao_valida(uuid)',
  'plataforma.sa_revogar(uuid)',
  'plataforma.sa_auditar(jsonb)',
  'plataforma.sa_listar_tenants(uuid)',
  'plataforma.sa_tenant_ativo(uuid, uuid)',
  'plataforma.sa_provisionar_tenant(uuid, jsonb)',
] as const;
