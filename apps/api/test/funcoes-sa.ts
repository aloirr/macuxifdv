/**
 * T-0091 (condição da ADR 0029): as `plataforma.sa_*` por classe, na assinatura `schema.nome(tipos)` de
 * `oidvectortypes` (independe do search_path). Toda sa_* do catálogo está em UMA das duas listas:
 *  - SA_PORTAL: as 20 com grant da 0035 §10, movidas para o `macuxi_portal` pela 0038;
 *  - SA_INTERNAS: SECURITY INVOKER, sem EXECUTE para ninguém além do dono (chamadas de dentro das sa_* DEFINER).
 * Nenhuma das duas executa como macuxi_app, macuxi_worker ou PUBLIC.
 * Espelho em scripts/deploy/producao/banco-dbaas.sh (passo 6); o funcoes-sa.test.ts confere que as listas batem com as
 * migrações e com o script, e o portal.banco.test.ts confere o catálogo do Postgres no CI. Função sa_* nova: entra aqui,
 * no script e na migração que a cria (revoke from public + grant só ao macuxi_portal, ou interna).
 */
export const SA_PORTAL: readonly string[] = [
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
];

export const SA_INTERNAS: readonly string[] = ['plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb)'];
