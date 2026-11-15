/**
 * T-0091 (condição da ADR 0029): as `plataforma.sa_*` por classe, na assinatura `schema.nome(tipos)` de
 * `oidvectortypes` (independe do search_path). Toda sa_* do catálogo está em UMA das duas listas:
 *  - SA_PORTAL: as com grant só ao `macuxi_portal`;
 *  - SA_INTERNAS: SECURITY INVOKER, sem EXECUTE para ninguém além do dono (chamadas de dentro das sa_* DEFINER).
 * Nenhuma das duas executa como macuxi_app, macuxi_worker ou PUBLIC. A `plataforma.criar_super_admin` (0039, deploy) não tem o
 * prefixo `sa_`: sem EXECUTE para ninguém além do dono (conexão de administração).
 * Espelho em scripts/deploy/producao/banco-dbaas.sh (passo 6); o funcoes-sa.test.ts confere que as listas batem com as
 * migrações (aplicadas em ordem, com os drops) e com o script, e o portal.banco.test.ts confere o catálogo do Postgres no CI.
 * Função sa_* nova: entra aqui, no script e na migração que a cria (revoke from public + grant só ao macuxi_portal, ou interna).
 * Contrato das assinaturas: R-20261107-150432-banco-dados.
 */
export const SA_PORTAL: readonly string[] = [
  'plataforma.sa_tentativa_estado(text)',
  'plataforma.sa_tentativa_falha(text)',
  'plataforma.sa_tentativa_sucesso(text)',
  'plataforma.sa_contas_para_login(text)',
  'plataforma.sa_abrir_sessao_portal(jsonb)',
  'plataforma.sa_escolher_empresa(uuid, uuid)',
  'plataforma.sa_sessao_valida(uuid)',
  'plataforma.sa_revogar(uuid)',
  'plataforma.sa_auditar(jsonb)',
  'plataforma.sa_listar_tenants(uuid)',
  'plataforma.sa_tenant_ativo(uuid, uuid)',
  'plataforma.sa_provisionar_tenant(uuid, jsonb)',
  'plataforma.sa_admins_da_empresa(uuid, uuid)',
  'plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea)',
  // 0058 (T-0158, ADR 0043): Portal › Diagnósticos, só super-admin
  'plataforma.sa_listar_diagnosticos(uuid, jsonb)',
  'plataforma.sa_diagnostico(uuid, uuid)',
  // 0070 (ADR 0047): planos e licenças, a assinatura da empresa criada no passo "Empresa com plano", só super-admin
  'plataforma.sa_gravar_assinatura(uuid, uuid, jsonb)',
  // 0072 (ADR 0052): inativar, reativar, backup e excluir a empresa no portal, só super-admin
  'plataforma.sa_inativar_tenant(uuid, uuid, text)',
  'plataforma.sa_reativar_tenant(uuid, uuid)',
  'plataforma.sa_pedir_backup(uuid, uuid, uuid)',
  'plataforma.sa_listar_backups(uuid, uuid, uuid)',
  'plataforma.sa_pedir_exclusao(uuid, uuid, uuid, uuid, text)',
  'plataforma.sa_ler_exclusao(uuid, uuid)',
  'plataforma.sa_reautenticar(uuid)',
  'plataforma.sa_acoes_das_empresas(uuid)',
  // 0073: os dados legais do rodapé (razão social, CNPJ e site), lidos e gravados só pelo super-admin
  'plataforma.sa_dados_legais(uuid)',
  'plataforma.sa_gravar_dados_legais(uuid, jsonb)',
  // 0082 (T-0181): Portal › Frases da carga, só super-admin
  'plataforma.sa_listar_frases_carga(uuid)',
  'plataforma.sa_incluir_frase_carga(uuid, uuid, text)',
  'plataforma.sa_editar_frase_carga(uuid, uuid, text, boolean)',
];

export const SA_INTERNAS: readonly string[] = ['plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb)'];
