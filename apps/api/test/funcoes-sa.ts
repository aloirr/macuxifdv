/**
 * T-0091 (condição da ADR 0029): as `plataforma.sa_*` por classe, na assinatura `schema.nome(tipos)` de
 * `oidvectortypes` (independe do search_path). Toda sa_* do catálogo está em UMA das duas listas:
 *  - SA_PORTAL: as com grant ao `macuxi_portal` (0038; desde a 0039/T-0093, ADR 0031, as 12 do login só com e-mail e senha;
 *    desde a 0042/T-0094, mais 2: o super-admin lista os admins e redefine a senha de um deles = 14; desde a 0058/T-0158, mais 2:
 *    a lista e o detalhe dos diagnósticos = 16; desde a 0070/ADR 0047, mais 1: o super-admin grava a assinatura da empresa = 17);
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
  // 0070 (ADR 0047): planos e licenças, só super-admin
  'plataforma.sa_gravar_assinatura(uuid, uuid, jsonb)',
];

export const SA_INTERNAS: readonly string[] = ['plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb)'];
