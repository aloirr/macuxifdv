/**
 * T-0002 — conformidade do banco que sustenta o isolamento (cenários S0-023 e S0-028 do plano).
 *
 * - Regra 5 do CLAUDE.md: toda tabela tem id uuid, tenant_id, created_at, updated_at, deleted_at,
 *   external_id e RLS ligado e FORÇADO, com política por tenant para o papel da aplicação; exceções só
 *   as declaradas pelo banco-dados (TABELAS_SEM_TENANT_ID). As de TABELAS_SO_POR_FUNCAO (super-admin, 0035,
 *   ADR 0029) não têm política nem grant para o app e o worker: só as SECURITY DEFINER plataforma.sa_* chegam a elas.
 * - S0-028: o papel da API (macuxi_app) não é superusuário, não ignora RLS, não é dono de nada, não
 *   herda papel privilegiado e não tem atalho que dispense a política (TRUNCATE, SET ROLE,
 *   row_security = off, ALTER TABLE, função SECURITY DEFINER fora da lista, view sem security_invoker).
 *   O worker (macuxi_worker) também só executa as SECURITY DEFINER revisadas para ele.
 * - T-0091 (0038, condição da ADR 0029): as plataforma.sa_* têm EXECUTE só para o dono e o macuxi_portal (conferido pelo
 *   catálogo, não por lista fixa); o macuxi_portal não tem grant de tabela, não herda papel, não é dono de nada e só tem
 *   USAGE no schema plataforma.
 * - T-0094 (0042): mais 2 sa_* do portal (sa_admins_da_empresa e sa_redefinir_senha_admin), 14 no total.
 * - T-0093 (0039, ADR 0031): as 12 sa_* do portal só com e-mail e senha substituem as 20 da 0035 (as 14 do convite/TOTP/
 *   desafio não existem mais); criar_super_admin e provisionar_tenant (deploy) são SECURITY INVOKER sem EXECUTE para app,
 *   worker ou portal; as 3 tabelas novas do portal entram na varredura "nenhum privilégio efetivo em tabela" do portal.
 * - Perfis: o CHECK do banco aceita exatamente os PERFIS do @macuxi/platform-sdk ("gerente", nunca
 *   "manager" da Fase M) — provado com INSERT real, não lendo o SQL.
 */
import { DOIS_TENANTS, PAPEL_PORTAL, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '@macuxi/db/teste';
import { diagnosticarPapelApp } from '@macuxi/db';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { PERFIS } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, schemasDeDominio, tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const PAPEL = 'macuxi_app';
const PAPEL_WORKER = 'macuxi_worker';
/** Função interna (0035; 7 argumentos desde a 0039): só o dono executa (as sa_* públicas a chamam por dentro). */
const SA_INTERNAS: ReadonlySet<string> = new Set(['sa_registrar_auditoria']);
/** Tabelas sem política nem grant para o app e o worker (0035): exceção SÓ para estas, lida do @macuxi/db/teste. */
const SO_POR_FUNCAO: ReadonlySet<string> = new Set(TABELAS_SO_POR_FUNCAO);
const SA = 'portal config. (ADR 0029/0031): confere a sessão; tabelas só por função';

/**
 * Funções SECURITY DEFINER que o papel da aplicação pode chamar, revisadas pelo agente testes, pela
 * assinatura exata de pg_get_function_arguments. Revisão da 0010/0011: R-20261101-172531-engenheiro-software.
 */
const DEFINER_REVISADAS: Record<string, string> = {
  'plataforma.tenant_por_codigo(p_codigo text)': 'login: resolve o tenant pelo código antes do contexto; devolve só id, nome, fuso, status',
  'integracao.autenticar_chave(p_hash text)':
    'Hub: única leitura sem tenant (ADR 0013); resolve a credencial pelo HMAC da chave; no máximo 1 linha, sem o hash; apagados = 0 linhas',
  // T-0078 (0024; R-20261105-001055-banco-dados): /v1/saude
  'plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)':
    'saúde: só agregados da outbox de todos os tenants (pendentes, parados, segundos do mais antigo); sem id, tenant, payload ou erro',
  // 0073 (rodapé legal; R-20261114-221000-alexandre): rota pública GET /v1/publico/dados-legais, sem sessão nem tenant
  'plataforma.dados_legais_publicos()':
    'rodapé da tela Entrar: só razao_social, cnpj e site da Macuxi (dado de pessoa jurídica); sem a linha = padrão; STABLE; nem worker nem portal',
};

/**
 * Funções SECURITY DEFINER que o papel do portal (macuxi_portal, 0038, T-0091) pode chamar: as 14 plataforma.sa_* — as 12 da 0039
 * (T-0093, ADR 0031: portal só com e-mail e senha; contrato R-20261107-150432-banco-dados) e as 2 da 0042 (T-0094: o super-admin
 * redefine a senha do admin do cliente; R-20261108-001804-banco-dados) — e NADA mais. As 14 do convite,
 * do TOTP e do desafio (0035) saíram na 0039. Igualdade exata: se o macuxi_app ou o macuxi_worker voltar a executar alguma,
 * o caso do papel deles reprova; se sair ou entrar uma sa_* sem revisão, este reprova.
 */
const DEFINER_REVISADAS_PORTAL: Record<string, string> = {
  'plataforma.sa_tentativa_estado(p_chave text)': `${SA}; bloqueio por chave HMAC do e-mail (nunca o e-mail); 1 linha (falhas, bloqueado_ate)`,
  'plataforma.sa_tentativa_falha(p_chave text)': `${SA}; a 5ª falha seguida bloqueia 15 min; bloqueio vivo não conta nem estende`,
  'plataforma.sa_tentativa_sucesso(p_chave text)': `${SA}; apaga a chave sem bloqueio vivo`,
  'plataforma.sa_contas_para_login(p_email text)':
    `${SA}; até 20 contas (super-admin e admins ativos de empresa ativa) com o hash; grava sa.login.consulta só com a contagem`,
  'plataforma.sa_abrir_sessao_portal(p jsonb)': `${SA}; reconfere cada conta antes de abrir; 1 empresa = já escolhida; teto 8 h`,
  'plataforma.sa_escolher_empresa(p_sid uuid, p_tenant uuid)': `${SA}; só admin_cliente, só tenant da lista, reconferindo admin e empresa`,
  'plataforma.sa_sessao_valida(p_sid uuid)': `${SA}; (tipo, super_admin_id, tenant_id, usuario_id, expira_em); cliente rebaixado cai na hora`,
  'plataforma.sa_revogar(p_sid uuid)': `${SA}; revoga a sessão`,
  'plataforma.sa_auditar(p jsonb)': `${SA}; 1 linha append-only na auditoria_plataforma, com ator_tipo e usuario_id`,
  'plataforma.sa_listar_tenants(p_sid uuid)': `${SA}; super-admin todas; cliente só as da sessão`,
  'plataforma.sa_tenant_ativo(p_sid uuid, p_tenant uuid)': `${SA}; cliente só a empresa atual da sessão`,
  'plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)': `${SA}; só super-admin; aceita admin (RN-CORE-34), recusa redefinir_senha e sem_admin`,
  // T-0094 (0042; padrão de fábrica da T-0111; R-20261108-001804-banco-dados): o super-admin redefine a senha do admin do cliente
  'plataforma.sa_admins_da_empresa(p_sid uuid, p_tenant uuid)':
    `${SA}; só super-admin (28000); admins vivos da empresa (0047: algum perfil vivo e ativo de base admin, plataforma.usuario_tem_perfil_admin), ` +
    'até 50, sem hash, com entra_no_portal; grava sa.admin.listar só com a contagem',
  'plataforma.sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text, p_email_id uuid, p_carga bytea)':
    `${SA}; só super-admin (28000); alvo ativo com algum perfil vivo de base admin (0047; P0002) e o e-mail atual (55000); temporária 72 h + trocar_senha + ` +
    'sessao_versao+1 + refresh revogados; e-mail cifrado na email_saida na mesma transação; auditoria sem dado pessoal; idempotente por p_email_id',
  // T-0158 (0058, ADR 0043; R-20261110-154349-banco-dados): diagnóstico do aparelho no portal, só super-admin
  'plataforma.sa_listar_diagnosticos(p_sid uuid, p_filtro jsonb)':
    `${SA}; só super-admin (admin do cliente 42501, sessão inválida 28000); diagnósticos de todos os tenants com filtros e keyset, 50 por página; ` +
    'só dado técnico; audita só a contagem',
  'plataforma.sa_diagnostico(p_sid uuid, p_id uuid)':
    `${SA}; só super-admin; detalhe + chave do print recebido (a API lê os bytes); P0002 se não achar; audita o id`,
  // ADR 0052 (0072; Inativar, Backup e Excluir a empresa; RN-PLA-07..11): só super-admin (admin do cliente 42501, sessão inválida 28000)
  'plataforma.sa_inativar_tenant(p_sid uuid, p_tenant uuid, p_motivo text)':
    `${SA}; só super-admin; suspenso + inativada_em, motivo opcional da lista (sem texto livre); já suspenso = sem_mudanca; audita e grava tenant.inativado@1`,
  'plataforma.sa_reativar_tenant(p_sid uuid, p_tenant uuid)':
    `${SA}; só super-admin; volta a ativo (data e motivo limpos pelo gatilho); backup em andamento deixa de ser consistente; audita`,
  'plataforma.sa_pedir_backup(p_sid uuid, p_tenant uuid, p_id uuid)':
    `${SA}; só super-admin; um backup em andamento por empresa (55000); idempotente por p_id; consistente = empresa inativa no pedido (RN-PLA-08)`,
  'plataforma.sa_listar_backups(p_sid uuid, p_tenant uuid, p_backup uuid)':
    `${SA}; só super-admin; até 20 backups da empresa (também da excluída), do mais novo; p_backup = só aquele`,
  'plataforma.sa_pedir_exclusao(p_sid uuid, p_tenant uuid, p_id uuid, p_backup uuid, p_codigo text)':
    `${SA}; só super-admin; exclusao_bloqueada (RN-PLA-09, código no hint) + código da licença digitado; idempotente por p_id; audita`,
  'plataforma.sa_ler_exclusao(p_sid uuid, p_tenant uuid)': `${SA}; só super-admin; a exclusão mais recente da empresa (null = nenhuma)`,
  'plataforma.sa_reautenticar(p_sid uuid)':
    `${SA}; só super-admin; (super_admin_id, email, senha_hash) só da conta ativa DA SESSÃO, para a API conferir a senha; audita sem dado pessoal`,
  'plataforma.sa_acoes_das_empresas(p_sid uuid)':
    `${SA}; só super-admin; o bloco acoes de cada empresa viva (inativação, último backup, exclusão e exclusao_bloqueada)`,
  // ADR 0047 (0070; planos e licenças, passo "Empresa com plano"): só super-admin (admin do cliente 42501, sessão inválida 28000)
  'plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb)':
    `${SA}; só super-admin; uma assinatura viva por tenant (trava consultiva; já existe = existente, nada muda); plano/adicional inválido 22023 ` +
    'com o código no hint; tenant inexistente P0002; audita sem dado pessoal',
  // 0073 (rodapé legal; R-20261114-221000-alexandre): "Dados da Macuxi" no portal, só super-admin (42501 / 28000)
  'plataforma.sa_dados_legais(p_sid uuid)': `${SA}; só super-admin; o mesmo jsonb da dados_legais_publicos (razao_social, cnpj, site)`,
  'plataforma.sa_gravar_dados_legais(p_sid uuid, p jsonb)':
    `${SA}; só super-admin; exatamente razao_social, cnpj e site (22023), CHECKs (23514); idempotente (igual não muda nem audita); for update; audita antes e depois`,
  // T-0182 (0081; logo do cliente e nome fantasia em plataforma.tenant; RN-CORE-33): leitura super-admin ou admin da própria empresa;
  // escrita só super-admin (admin do cliente 42501, sessão inválida 28000, tenant inexistente P0002)
  'plataforma.sa_marca_da_empresa(p_sid uuid, p_tenant uuid)':
    `${SA}; super-admin em qualquer empresa, admin do cliente só na da sessão (42501); MarcaEmpresa + logo.chave (a API tira); sem auditoria`,
  'plataforma.sa_gravar_nome_fantasia(p_sid uuid, p_tenant uuid, p_nome text)':
    `${SA}; só super-admin; null apaga; CHECK 23514; idempotente (igual não muda nem audita); for update; audita antes e depois (pessoa jurídica)`,
  'plataforma.sa_gravar_logo(p_sid uuid, p_tenant uuid, p jsonb)':
    `${SA}; só super-admin; exatamente id, tipo, sha256, tamanho_bytes, largura_px, altura_px e chave (22023); CHECKs (23514, chave do próprio tenant); ` +
    'idempotente pelo sha256; audita só os sha256 (sem bytes); devolve chave_anterior',
  'plataforma.sa_remover_logo(p_sid uuid, p_tenant uuid)':
    `${SA}; só super-admin; zera as 8 logo_*; idempotente (sem logo não muda nem audita); audita o sha256 antes; devolve chave_anterior`,
};

/** Funções de deploy (T-0093, ADR 0031 §5): SECURITY INVOKER, chamadas pela conexão de administração; ninguém mais executa. */
const SO_ADMINISTRACAO: readonly string[] = ['plataforma.criar_super_admin(jsonb)', 'plataforma.provisionar_tenant(jsonb)'];

/**
 * Funções SECURITY DEFINER que o worker (macuxi_worker) pode chamar. Os expurgos NÃO entram em
 * DEFINER_REVISADAS: se o macuxi_app puder executá-los, é grant errado e o caso do papel reprova.
 * Revisão: R-20261101-172531-engenheiro-software (T-0032).
 */
const DEFINER_REVISADAS_WORKER: Record<string, string> = {
  'integracao.expurgar_retencao(p_agora timestamp with time zone DEFAULT now(), p_limite integer DEFAULT 5000)':
    'retenção do Hub entre tenants; lote cascateia em lote_staging/lote_linha_erro; o expurgo não aborta por FK',
  'plataforma.expurgar_outbox(p_agora timestamp with time zone DEFAULT now(), p_limite integer DEFAULT 10000)':
    'retenção da outbox; evento pendente nunca sai; consumo e evento apagados na mesma transação; parâmetro limitado a 7..365',
  // T-0039 §2.3 passo 3 (0027; ADR 0022; R-20261105-040202-banco-dados): NÃO entra em DEFINER_REVISADAS (o app não executa)
  'plataforma.tenants_ativos()':
    'agendador das tarefas periódicas (ADR 0022): só ids dos tenants ativos (status ativo, deleted_at nulo), ordenados; nenhuma outra coluna',
  // T-0158 (0058, ADR 0043; R-20261110-154349-banco-dados): NÃO entra em DEFINER_REVISADAS (o app não executa)
  'plataforma.expurgar_diagnosticos(p_agora timestamp with time zone DEFAULT now(), p_limite integer DEFAULT 500)':
    'retenção LGPD de 90 dias (prints aguardando, 7 dias): apaga de fato o diagnóstico e o arquivo do print na mesma transação; devolve as chaves; p_limite 1..5000',
  // ADR 0052 (0072; Inativar, Backup e Excluir a empresa; RN-PLA-07..11): NÃO entram em DEFINER_REVISADAS (o app não executa);
  // o tenant sai sempre da linha do job, nunca de argumento (a tenant_esta_ativo só responde sim ou não)
  'plataforma.tenant_esta_ativo(p_tenant uuid)':
    'políticas despacho_outbox e despacho_email pulam a empresa inativa (RN-PLA-07): só o booleano (ativo e não apagado), nenhuma coluna',
  'plataforma.pegar_backup()': 'próximo backup em andamento sem concessão viva (skip locked; concessão de 10 min); devolve o job e as partes já confirmadas',
  'plataforma.tabelas_do_backup(p_backup uuid)':
    'ordem_do_backup (tabelas com tenant_id em ordem de FK, chave primária e colunas adiadas) só para backup em andamento',
  'plataforma.exportar_backup_pagina(p_backup uuid, p_tabela text, p_depois jsonb, p_limite integer)':
    'uma página keyset da tabela, só do tenant da linha do backup; tabela fora da ordem_do_backup 22023; p_limite 1..5000; renova a concessão',
  'plataforma.registrar_parte_backup(p_backup uuid, p_tabela text, p_linhas bigint, p_bytes bigint, p_sha256 text)':
    'confirma a parte (linhas, bytes, sha256 hex), idempotente por (backup, tabela); progresso até 90%; renova a concessão',
  'plataforma.fechar_backup(p_backup uuid, p_resultado jsonb)':
    'pronto (todas as partes, senão BACKUP_INCOMPLETO) ou falhou; consistente só se a empresa seguiu inativa (RN-PLA-08); expira em 30 dias; evento e auditoria; idempotente',
  'plataforma.backups_vencidos(p_limite integer)':
    'retenção (RN-PLA-11): só (backup_id, tenant_id) vencidos a apagar do bucket; nunca o da exclusão em andamento; p_limite 1..500',
  'plataforma.marcar_backup_apagado(p_backup uuid)': 'situação apagado (o registro fica) só se vencido pela mesma regra da backups_vencidos (55000); idempotente',
  'plataforma.pegar_exclusao()': 'próxima exclusão em andamento sem concessão viva (skip locked; concessão de 10 min)',
  'plataforma.executar_exclusao(p_exclusao uuid)':
    'etapa banco: reconfere a exclusao_bloqueada (RN-PLA-09), excluir_tenant, empresa_excluida (código nunca reaproveitado, RN-PLA-10), backup guardado 90 dias; idempotente',
  'plataforma.fechar_exclusao(p_exclusao uuid, p_resultado jsonb)':
    'concluida só na etapa arquivos (backup guardado 90 dias a contar daqui); falhou só na etapa banco (empresa intacta); idempotente',
  // 0079 (T-0174, ADR 0054; fotos em lote): laço de trabalhos sob demanda; NÃO entram em DEFINER_REVISADAS (o app só lê e insere)
  'plataforma.trabalho_reservar(p_processo text, p_trava_s integer)':
    'reserva o próximo trabalho pendente de tenant ativo (skip locked) com trava de p_trava_s; devolve só id, tenant, módulo, nome, alvo, tentativas e fatias',
  'plataforma.trabalho_devolver(p_id uuid, p_processo text, p_resultado text, p_erro text, p_espera_s integer)':
    'devolve o trabalho do próprio processo (concluído, falhou ou de novo após p_espera_s); erro só como código; false se a trava não é mais dele',
  'plataforma.trabalho_renovar(p_id uuid, p_processo text, p_trava_s integer)':
    'estende a trava entre os itens só se o trabalho ainda é do processo; false = não é mais dele',
};

/**
 * Índices únicos SEM tenant_id em tabela de tenant, pelo nome (schema.indice), cada um com o motivo.
 * Exceção nominal, sem regex: índice novo sem tenant_id reprova até ser revisado e listado aqui.
 */
const INDICES_UNICOS_GLOBAIS: Record<string, string> = {
  // Global de propósito: autenticar_chave procura a chave ANTES de se saber o tenant (com
  // (tenant_id, hash_chave) seria seq scan entre tenants). O hash é HMAC-SHA256 com o pepper do
  // servidor sobre chave gerada pelo servidor: nenhum tenant escolhe o valor, colisão impraticável
  // e o 23505 nunca chega ao cliente. CONDIÇÃO: a exceção cai se o Hub aceitar chave escolhida pelo
  // cliente ("traga sua chave"). Revisão: R-20261101-172531-engenheiro-software (T-0032).
  'integracao.credencial_hash_uk':
    'HMAC-SHA256 (pepper do servidor) de chave gerada pelo servidor; cai se o Hub aceitar chave escolhida pelo cliente',
  // T-0158 (0058, ADR 0043; R-20261110-154349-banco-dados): protocolo legível global ("nº 0042") só da sequência
  // plataforma.diagnostico_protocolo_seq; o macuxi_app não tem INSERT na coluna. CONDIÇÃO: cai se o protocolo vier do aparelho/tenant.
  'plataforma.diagnostico_protocolo_uk':
    'protocolo só da plataforma.diagnostico_protocolo_seq (sem INSERT do app na coluna); nenhum tenant escolhe o valor, colisão impossível, nada a descobrir de outro tenant',
};

type Definer = { assinatura: string; config: string[] | null; publico: boolean };

/** Funções SECURITY DEFINER dos schemas de domínio que o papel executa (direto ou via PUBLIC). */
async function definerExecutaveis(admin: pg.Client, papel: string, schemas: string[]): Promise<Definer[]> {
  const r = await admin.query<Definer>(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')' as assinatura,
            p.proconfig as config,
            coalesce(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as publico
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = any($2) and has_function_privilege($1, p.oid, 'EXECUTE')`,
    [papel, schemas],
  );
  return r.rows;
}

/**
 * 0079: depois do merge da cadeia de migrações (#352), tirar daqui.
 * Única tolerância nominal da lista do worker: estas 3 só deixam de ser exigidas enquanto NÃO existirem no banco.
 * Qualquer outra função da lista continua exigida (apagada ou renomeada reprova).
 */
const DEFINER_WORKER_TOLERADAS_0079 = [
  'plataforma.trabalho_reservar(p_processo text, p_trava_s integer)',
  'plataforma.trabalho_devolver(p_id uuid, p_processo text, p_resultado text, p_erro text, p_espera_s integer)',
  'plataforma.trabalho_renovar(p_id uuid, p_processo text, p_trava_s integer)',
];

/** Das toleradas da 0079, as que ainda não existem no banco (mesmo formato de assinatura de definerExecutaveis). */
async function toleradas0079Ausentes(admin: pg.Client, schemas: string[]): Promise<Set<string>> {
  const r = await admin.query<{ assinatura: string }>(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')' as assinatura
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)`,
    [schemas],
  );
  const existentes = new Set(r.rows.map((x) => x.assinatura));
  return new Set(DEFINER_WORKER_TOLERADAS_0079.filter((a) => !existentes.has(a)));
}

/** Só as revisadas, todas com search_path fixo e nenhuma executável por PUBLIC; `ausentes` tira da lista esperada só as nomeadas acima. */
function conferirDefiner(funcoes: Definer[], revisadas: Record<string, string>, ausentes?: Set<string>): void {
  const esperadas = Object.keys(revisadas).filter((a) => !ausentes?.has(a));
  expect(funcoes.map((x) => x.assinatura).sort()).toEqual(esperadas.sort());
  for (const f of funcoes) {
    expect(f.config?.some((c) => c.startsWith('search_path=')), `${f.assinatura} sem search_path fixo`).toBe(true);
    expect(f.publico, `${f.assinatura} executável por PUBLIC`).toBe(false);
  }
}

const COLUNAS_COMUNS: Record<string, string> = {
  id: 'uuid',
  tenant_id: 'uuid',
  created_at: 'timestamp with time zone',
  updated_at: 'timestamp with time zone',
  deleted_at: 'timestamp with time zone',
  external_id: 'text',
};

describe.skipIf(semBanco())('S0-023/S0-028 conformidade do banco para o isolamento multi-tenant', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tabelas: Tabela[] = [];
  let schemas: string[] = [];

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
    app = await conectar(banco().urlApp);
    tabelas = await tabelasDoCatalogo(admin);
    schemas = await schemasDeDominio(admin);
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  describe('S0-023 regra 5: campos comuns, RLS forçado e política por tenant', () => {
    it('schemas plataforma e core existem', () => {
      expect(schemas).toEqual(expect.arrayContaining(['plataforma', 'core']));
    });

    it('tabela sem tenant_id só se declarada em TABELAS_SEM_TENANT_ID', () => {
      const sem = tabelas.filter((t) => !t.temTenant).map((t) => t.nome);
      expect(sem.filter((n) => !(n in TABELAS_SEM_TENANT_ID))).toEqual([]);
    });

    it('TABELAS_SO_POR_FUNCAO: só tabelas que existem, sem tenant_id e declaradas em TABELAS_SEM_TENANT_ID (tabela de tenant não se esconde na lista)', () => {
      const porNome = new Map(tabelas.map((t) => [t.nome, t]));
      const problemas: string[] = [];
      for (const n of SO_POR_FUNCAO) {
        const t = porNome.get(n);
        if (!t) problemas.push(`${n}: não existe (lista velha)`);
        else if (t.temTenant) problemas.push(`${n}: tem tenant_id, precisa de política por tenant`);
        if (!(n in TABELAS_SEM_TENANT_ID)) problemas.push(`${n}: fora de TABELAS_SEM_TENANT_ID`);
      }
      expect(problemas).toEqual([]);
    });

    it('T-0094 plataforma.email_saida (0040, ADR 0032): RLS forçado; app só SELECT e INSERT; worker SELECT e UPDATE só nas colunas do despacho; portal e PUBLIC nada; ninguém apaga', async () => {
      const t = 'plataforma.email_saida';
      const rls = await admin.query<{ ligado: boolean; forcado: boolean }>('select relrowsecurity as ligado, relforcerowsecurity as forcado from pg_class where oid = $1::regclass', [t]);
      expect(rls.rows[0]).toEqual({ ligado: true, forcado: true });
      const privs = async (papel: string) => {
        const tem: string[] = [];
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          if ((await admin.query<{ tem: boolean }>('select has_table_privilege($1, $2::regclass, $3) as tem', [papel, t, priv])).rows[0]!.tem) tem.push(priv);
        }
        return tem;
      };
      expect(await privs(PAPEL)).toEqual(['SELECT', 'INSERT']);
      expect(await privs(PAPEL_WORKER)).toEqual(['SELECT']);
      expect(await privs(PAPEL_PORTAL)).toEqual([]);
      const colunasWorker = await admin.query<{ coluna: string }>(
        `select a.attname as coluna from pg_attribute a
          where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege($2, a.attrelid, a.attnum, 'UPDATE')
          order by 1`,
        [t, PAPEL_WORKER],
      );
      expect(colunasWorker.rows.map((x) => x.coluna)).toEqual(['carga', 'enviado_em', 'falhou_em', 'proxima_tentativa_em', 'tentativas', 'ultimo_erro']);
      const publico = await admin.query<{ n: number }>("select count(*)::int as n from information_schema.role_table_grants where table_schema = 'plataforma' and table_name = 'email_saida' and grantee = 'PUBLIC'");
      expect(publico.rows[0]!.n).toBe(0);
    });

    it('TABELAS_SO_POR_FUNCAO: nenhuma política nem privilégio de tabela para o app, o worker ou PUBLIC', async () => {
      const problemas: string[] = [];
      for (const n of SO_POR_FUNCAO) {
        const pols = await admin.query<{ nome: string; roles: string[] }>(
          `select policyname as nome, roles::text[] as roles from pg_policies where schemaname || '.' || tablename = $1`,
          [n],
        );
        for (const p of pols.rows) {
          const abertos = p.roles.filter((r) => r === PAPEL || r === PAPEL_WORKER || r === 'public');
          if (abertos.length) problemas.push(`${n}: política ${p.nome} para ${abertos.join(', ')}`);
        }
        for (const papel of [PAPEL, PAPEL_WORKER]) {
          for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            const r = await admin.query<{ tem: boolean }>('select has_table_privilege($1, $2::regclass, $3) as tem', [papel, n, priv]);
            if (r.rows[0]!.tem) problemas.push(`${n}: ${priv} para ${papel}`);
          }
        }
      }
      expect(problemas).toEqual([]);
      // e o app, de fato, não lê (42501 direto, sem grant)
      const ler = await tentar(app, A, () => app.query('select count(*) from plataforma.super_admin'));
      expect(ler.ok ? 'leu plataforma.super_admin!' : ler.codigo).toBe('42501');
    });

    it('toda tabela tem os campos comuns com o tipo certo (tenant_id e id NOT NULL)', async () => {
      const faltas: string[] = [];
      for (const t of tabelas) {
        const r = await admin.query<{ attname: string; tipo: string; nn: boolean }>(
          `select a.attname, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as nn
             from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`,
          [t.sql],
        );
        const cols = new Map(r.rows.map((x) => [x.attname, x]));
        for (const [col, tipo] of Object.entries(COLUNAS_COMUNS)) {
          if (col === 'tenant_id' && !t.temTenant) continue;
          const c = cols.get(col);
          if (!c) faltas.push(`${t.nome}.${col} ausente`);
          else if (c.tipo !== tipo) faltas.push(`${t.nome}.${col} é ${c.tipo}, esperado ${tipo}`);
          else if ((col === 'id' || col === 'tenant_id') && !c.nn) faltas.push(`${t.nome}.${col} aceita NULL`);
        }
      }
      expect(faltas).toEqual([]);
    });

    it('toda tabela tem RLS ligado E forçado (o dono também obedece)', async () => {
      const r = await admin.query<{ nome: string; rls: boolean; force: boolean }>(
        `select n.nspname || '.' || c.relname as nome, c.relrowsecurity as rls, c.relforcerowsecurity as force
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and n.nspname = any($1)`,
        [schemas],
      );
      expect(r.rows.filter((x) => !x.rls || !x.force).map((x) => x.nome)).toEqual([]);
      expect(r.rows.length).toBe(tabelas.length);
    });

    it('toda tabela (exceto as de TABELAS_SO_POR_FUNCAO) tem política para o papel da aplicação, comparando tenant_id (ou id, no tenant) com plataforma.tenant_atual(), no USING e no WITH CHECK', async () => {
      const r = await admin.query<{ nome: string; roles: string[]; cmd: string; qual: string | null; wc: string | null; permissiva: string }>(
        `select schemaname || '.' || tablename as nome, roles::text[] as roles, cmd, qual, with_check as wc, permissive as permissiva
           from pg_policies where schemaname = any($1)`,
        [schemas],
      );
      const problemas: string[] = [];
      for (const t of tabelas) {
        // só as de TABELAS_SO_POR_FUNCAO ficam sem política para o app (provado no caso acima); nenhuma outra
        if (SO_POR_FUNCAO.has(t.nome) && !t.temTenant) continue;
        const pols = r.rows.filter((p) => p.nome === t.nome && (p.roles.includes(PAPEL) || p.roles.includes('public')));
        const coluna = t.temTenant ? 'tenant_id' : 'id';
        const boa = (txt: string | null) => !!txt && txt.includes(coluna) && txt.includes('tenant_atual()');
        if (pols.length === 0) problemas.push(`${t.nome}: sem política para ${PAPEL}`);
        for (const p of pols) {
          if (p.permissiva !== 'PERMISSIVE' && p.permissiva !== 'RESTRICTIVE') problemas.push(`${t.nome}: tipo de política ${p.permissiva}`);
          if (!boa(p.qual)) problemas.push(`${t.nome}: USING não filtra por ${coluna} = tenant_atual(): ${p.qual}`);
          if (p.cmd !== 'SELECT' && p.cmd !== 'DELETE' && !boa(p.wc ?? p.qual)) problemas.push(`${t.nome}: WITH CHECK sem tenant: ${p.wc}`);
          if (/\btrue\b|\bor\b/i.test(`${p.qual ?? ''} ${p.wc ?? ''}`)) problemas.push(`${t.nome}: política com "true"/"or" pode abrir a tabela: ${p.qual}`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('índices únicos das tabelas de tenant incluem tenant_id (exceto a chave primária id e os de INDICES_UNICOS_GLOBAIS)', async () => {
      const r = await admin.query<{ nome: string; indice: string; def: string; pk: boolean }>(
        `select n.nspname || '.' || c.relname as nome, n.nspname || '.' || i.relname as indice, pg_get_indexdef(x.indexrelid) as def, x.indisprimary as pk
           from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
           join pg_namespace n on n.oid = c.relnamespace
          where x.indisunique and n.nspname = any($1)`,
        [schemas],
      );
      const comTenant = new Set(tabelas.filter((t) => t.temTenant).map((t) => t.nome));
      const semTenant = r.rows.filter((x) => comTenant.has(x.nome) && !x.pk && !/\(tenant_id[,)]/.test(x.def));
      const globais = semTenant.filter((x) => !(x.indice in INDICES_UNICOS_GLOBAIS)).map((x) => x.def);
      // um único global entre tenants deixa A descobrir dado de B por colisão (e impede A de cadastrar)
      expect(globais).toEqual([]);
      // exceção que não casa mais com um único global é lista velha: sai da lista
      const usadas = new Set(semTenant.map((x) => x.indice));
      expect(Object.keys(INDICES_UNICOS_GLOBAIS).filter((n) => !usadas.has(n))).toEqual([]);
    });
  });

  describe('S0-028 o papel da aplicação não tem como contornar o RLS', () => {
    it('atributos: sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION', async () => {
      const r = await admin.query('select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit from pg_roles where rolname = $1', [PAPEL]);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
    });

    it('não herda papel privilegiado (pertença a papéis, recursiva)', async () => {
      const r = await admin.query<{ rolname: string }>(
        `with recursive acima(oid) as (
           select roleid from pg_auth_members where member = (select oid from pg_roles where rolname = $1)
           union select m.roleid from pg_auth_members m join acima on m.member = acima.oid)
         select r.rolname from acima join pg_roles r on r.oid = acima.oid
          where r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolname in ('pg_read_all_data', 'pg_write_all_data', 'pg_database_owner')`,
        [PAPEL],
      );
      expect(r.rows.map((x) => x.rolname)).toEqual([]);
    });

    it('não é dono de schema, tabela, view, sequência ou função dos schemas de domínio', async () => {
      const r = await admin.query<{ objeto: string }>(
        `select 'schema ' || nspname as objeto from pg_namespace where nspowner = (select oid from pg_roles where rolname = $1) and nspname = any($2)
         union all
         select 'rel ' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relowner = (select oid from pg_roles where rolname = $1) and n.nspname = any($2)
         union all
         select 'fn ' || n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.proowner = (select oid from pg_roles where rolname = $1) and n.nspname = any($2)`,
        [PAPEL, schemas],
      );
      expect(r.rows.map((x) => x.objeto)).toEqual([]);
    });

    it('sem TRUNCATE (ignora RLS), REFERENCES nem TRIGGER em nenhuma tabela; sem CREATE nos schemas', async () => {
      const problemas: string[] = [];
      for (const t of tabelas) {
        for (const priv of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const r = await admin.query<{ tem: boolean }>('select has_table_privilege($1, $2, $3) as tem', [PAPEL, t.sql, priv]);
          if (r.rows[0]!.tem) problemas.push(`${priv} em ${t.nome}`);
        }
      }
      for (const s of [...schemas, 'public']) {
        const r = await admin.query<{ tem: boolean }>('select has_schema_privilege($1, $2, $3) as tem', [PAPEL, s, 'CREATE']);
        if (r.rows[0]!.tem) problemas.push(`CREATE no schema ${s}`);
      }
      expect(problemas).toEqual([]);
      const truncar = await tentar(app, A, () => app.query('truncate core.carteira'));
      expect(truncar.ok ? 'TRUNCATE passou!' : truncar.codigo).toBe('42501');
    });

    it.each([
      ['SET ROLE para o admin', 'set local role postgres'],
      ['SET SESSION AUTHORIZATION', 'set session authorization postgres'],
      ['desligar RLS da tabela', 'alter table core.usuario disable row level security'],
      ['tirar o FORCE', 'alter table core.usuario no force row level security'],
      ['trocar a política', 'alter policy isolamento_tenant on core.usuario using (true)'],
      ['criar política aberta', 'create policy aberta on core.usuario for select to macuxi_app using (true)'],
      ['redefinir tenant_atual()', "create or replace function plataforma.tenant_atual() returns uuid language sql as $$ select null::uuid $$"],
      ['criar view no schema', 'create view core.todos as select * from core.usuario'],
    ])('atalho negado: %s', async (_r, sql) => {
      const r = await tentar(app, A, () => app.query(sql));
      expect(r.ok ? `passou: ${sql}` : r.codigo).toBe('42501');
    });

    it('row_security = off não devolve tudo: a consulta afetada por política dá erro', async () => {
      const r = await tentar(app, A, async () => {
        await app.query('set local row_security = off');
        return (await app.query<{ n: number }>('select count(*)::int as n from core.usuario')).rows[0]!.n;
      });
      expect(r.ok ? `devolveu ${r.valor} linhas` : r.codigo).toBe('42501');
    });

    it('funções SECURITY DEFINER executáveis pelo papel: só as revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      conferirDefiner(await definerExecutaveis(admin, PAPEL, schemas), DEFINER_REVISADAS);
    });

    it('funções SECURITY DEFINER executáveis pelo worker (macuxi_worker): só as revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      // 0079: depois do merge da cadeia de migrações (#352), tirar daqui (só as 3 trabalho_* toleradas enquanto não existirem)
      conferirDefiner(await definerExecutaveis(admin, PAPEL_WORKER, schemas), DEFINER_REVISADAS_WORKER, await toleradas0079Ausentes(admin, schemas));
    });

    it('T-0091 funções SECURITY DEFINER executáveis pelo portal (macuxi_portal): só as sa_* revisadas, com search_path fixo e sem EXECUTE para PUBLIC', async () => {
      conferirDefiner(await definerExecutaveis(admin, PAPEL_PORTAL, schemas), DEFINER_REVISADAS_PORTAL);
    });

    it('T-0091 pelo catálogo: toda plataforma.sa_* tem EXECUTE só para o dono e o macuxi_portal (nem PUBLIC, nem app, nem worker); a interna, só o dono', async () => {
      const r = await admin.query<{ nome: string; assinatura: string; dono: string; grantees: string[] }>(
        `select p.proname as nome, p.oid::regprocedure::text as assinatura, pg_get_userbyid(p.proowner) as dono,
                coalesce((select array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '{}')::text[] as grantees
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'plataforma' and starts_with(p.proname, 'sa_')
          order by 2`,
      );
      // o catálogo e a lista revisada têm o mesmo tamanho (sa_* nova sem revisão reprova aqui e no caso acima)
      expect(r.rows.filter((f) => !SA_INTERNAS.has(f.nome)).length).toBe(Object.keys(DEFINER_REVISADAS_PORTAL).length);
      const problemas: string[] = [];
      for (const f of r.rows) {
        const interna = SA_INTERNAS.has(f.nome);
        const esperados = interna ? [f.dono] : [f.dono, PAPEL_PORTAL].sort();
        if (JSON.stringify([...f.grantees].sort()) !== JSON.stringify(esperados)) problemas.push(`${f.assinatura}: EXECUTE para ${f.grantees.join(', ')}`);
        for (const papel of [PAPEL, PAPEL_WORKER, PAPEL_PORTAL]) {
          const t = await admin.query<{ tem: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as tem`, [papel, f.assinatura]);
          const deve = papel === PAPEL_PORTAL && !interna;
          if (t.rows[0]!.tem !== deve) problemas.push(`${f.assinatura}: ${papel} ${deve ? 'não executa' : 'executa'}`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('T-0093 funções de deploy (criar_super_admin, provisionar_tenant): existem, SECURITY INVOKER, EXECUTE só para o dono (nem PUBLIC, app, worker ou portal)', async () => {
      const problemas: string[] = [];
      for (const assinatura of SO_ADMINISTRACAO) {
        const r = await admin.query<{ definer: boolean; dono: string; grantees: string[] }>(
          `select p.prosecdef as definer, pg_get_userbyid(p.proowner) as dono,
                  coalesce((select array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
                              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '{}')::text[] as grantees
             from pg_proc p where p.oid = to_regprocedure($1)`,
          [assinatura],
        );
        if (r.rows.length !== 1) {
          problemas.push(`${assinatura}: não existe`);
          continue;
        }
        const f = r.rows[0]!;
        if (f.definer) problemas.push(`${assinatura}: SECURITY DEFINER`);
        if (JSON.stringify(f.grantees) !== JSON.stringify([f.dono])) problemas.push(`${assinatura}: EXECUTE para ${f.grantees.join(', ')}`);
        for (const papel of [PAPEL, PAPEL_WORKER, PAPEL_PORTAL]) {
          const t = await admin.query<{ tem: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as tem`, [papel, assinatura]);
          if (t.rows[0]!.tem) problemas.push(`${assinatura}: ${papel} executa`);
        }
      }
      expect(problemas).toEqual([]);
    });

    it('T-0093 as 14 sa_* do convite, do TOTP e do desafio (0035) e a sa_registrar_auditoria de 5 argumentos não existem mais (0039)', async () => {
      const r = await admin.query<{ nome: string }>(
        `select p.oid::regprocedure::text as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'plataforma' and (p.proname = any($1) or (p.proname = 'sa_registrar_auditoria' and p.pronargs = 5))`,
        [['sa_existe', 'sa_criar_primeiro', 'sa_para_login', 'sa_por_id', 'sa_registrar_falha', 'sa_registrar_sucesso', 'sa_gravar_totp_pendente', 'sa_confirmar_totp', 'sa_marcar_passo', 'sa_usar_recuperacao', 'sa_regerar_recuperacao', 'sa_abrir_desafio', 'sa_ver_desafio', 'sa_abrir_sessao']],
      );
      expect(r.rows.map((x) => x.nome)).toEqual([]);
    });

    it('views legíveis pelo papel usam security_invoker (senão rodam como o dono e ignoram RLS); matviews não são legíveis', async () => {
      const r = await admin.query<{ nome: string; tipo: string; opcoes: string[] | null }>(
        `select n.nspname || '.' || c.relname as nome, c.relkind::text as tipo, c.reloptions as opcoes
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('v', 'm') and n.nspname = any($2) and has_table_privilege($1, c.oid, 'SELECT')`,
        [PAPEL, schemas],
      );
      const inseguras = r.rows.filter((v) => v.tipo === 'm' || !(v.opcoes ?? []).some((o) => /^security_invoker=(true|on|1)$/i.test(o)));
      expect(inseguras.map((v) => v.nome)).toEqual([]);
    });
  });

  describe('T-0091 o papel do portal (macuxi_portal) só chega às sa_*', () => {
    it('atributos: sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION', async () => {
      const r = await admin.query('select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication from pg_roles where rolname = $1', [PAPEL_PORTAL]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
    });

    it('não é membro de papel nenhum (nem do macuxi_manutencao, nem do macuxi_app)', async () => {
      const r = await admin.query<{ rolname: string }>(
        `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid where m.member = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(r.rows.map((x) => x.rolname)).toEqual([]);
    });

    it('não é dono de schema, tabela, view, sequência, função ou tipo', async () => {
      const r = await admin.query<{ objeto: string }>(
        `select 'schema ' || nspname as objeto from pg_namespace where nspowner = (select oid from pg_roles where rolname = $1)
         union all select 'rel ' || c.oid::regclass::text from pg_class c where c.relowner = (select oid from pg_roles where rolname = $1)
         union all select 'fn ' || p.oid::regprocedure::text from pg_proc p where p.proowner = (select oid from pg_roles where rolname = $1)
         union all select 'tipo ' || t.oid::regtype::text from pg_type t where t.typowner = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(r.rows.map((x) => x.objeto)).toEqual([]);
    });

    it('nenhum grant de tabela, view, sequência ou coluna (catálogo e information_schema); nenhum privilégio efetivo em tabela', async () => {
      const acl = await admin.query<{ objeto: string }>(
        `select c.oid::regclass::text || ' ' || a.privilege_type as objeto
           from pg_class c cross join lateral aclexplode(c.relacl) a
          where a.grantee = (select oid from pg_roles where rolname = $1)
         union all
         select c.oid::regclass::text || '.' || t.attname || ' ' || a.privilege_type
           from pg_attribute t join pg_class c on c.oid = t.attrelid cross join lateral aclexplode(t.attacl) a
          where a.grantee = (select oid from pg_roles where rolname = $1)`,
        [PAPEL_PORTAL],
      );
      expect(acl.rows.map((x) => x.objeto)).toEqual([]);
      const rtg = await admin.query<{ n: number }>('select count(*)::int as n from information_schema.role_table_grants where grantee = $1', [PAPEL_PORTAL]);
      expect(rtg.rows[0]!.n).toBe(0);
      const efetivos: string[] = [];
      for (const t of tabelas) {
        const r = await admin.query<{ tem: boolean }>(
          `select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as tem`,
          [PAPEL_PORTAL, t.sql],
        );
        if (r.rows[0]!.tem) efetivos.push(t.nome);
      }
      expect(efetivos).toEqual([]);
    });

    it('schemas: só USAGE no plataforma; nenhum CREATE (nem no public)', async () => {
      const problemas: string[] = [];
      for (const s of [...schemas, 'public']) {
        const r = await admin.query<{ uso: boolean; criar: boolean }>(
          `select has_schema_privilege($1, $2, 'USAGE') as uso, has_schema_privilege($1, $2, 'CREATE') as criar`,
          [PAPEL_PORTAL, s],
        );
        if (r.rows[0]!.criar) problemas.push(`CREATE no schema ${s}`);
        if (s !== 'public' && r.rows[0]!.uso !== (s === 'plataforma')) problemas.push(`USAGE no schema ${s}: ${r.rows[0]!.uso}`);
      }
      expect(problemas).toEqual([]);
    });

    it('diagnóstico S0-028 do @macuxi/db também aprova o papel (sem superusuário, sem ignorar RLS, sem tabela própria)', async () => {
      expect(await diagnosticarPapelApp(admin, PAPEL_PORTAL)).toEqual({ superusuario: false, ignoraRls: false, tabelasDeQueEDono: [] });
    });
  });

  describe('perfis do banco = PERFIS do @macuxi/platform-sdk', () => {
    it('platform-sdk tem os 7 perfis do doc 03 e não tem os nomes da Fase M', () => {
      expect([...PERFIS].sort()).toEqual(['admin', 'analista', 'assistente', 'gerente', 'promotor', 'supervisor', 'vendedor']);
      for (const faseM of ['manager', 'seller', 'analyst', 'bko_assistant']) expect(PERFIS as readonly string[]).not.toContain(faseM);
    });

    // 0041 (ADR 0033, RN-CORE-35) §5/§11: plataforma.perfil_modulo.perfil virou o CÓDIGO do perfil do tenant — sai o CHECK
    // perfil_modulo_perfil_valido, entra a FK perfil_modulo_perfil_fk; nome da Fase M (ou fora do formato) não existe em
    // plataforma.perfil e cai na FK (23503). core.usuario.perfil segue com o CHECK dos 7 (23514).
    it.each([
      ['core.usuario', '23514', (perfil: string, i: number) => [`insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Perfil', $2, $3)`, [A, `perfil-${i}@exemplo.com.br`, perfil]] as const],
      ['plataforma.perfil_modulo', '23503', (perfil: string, i: number) => [`insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, $2, $3)`, [A, perfil, `modulo-perfil-${i}`]] as const],
    ])('%s aceita cada perfil do platform-sdk e recusa os da Fase M (%s)', async (_t, codigo, montar) => {
      for (const [i, perfil] of PERFIS.entries()) {
        const [sql, params] = montar(perfil, i);
        const r = await tentar(app, A, () => app.query(sql, [...params]));
        expect(r.ok, `${perfil}: ${r.ok ? '' : r.mensagem}`).toBe(true);
      }
      for (const [i, perfil] of ['manager', 'seller', 'analyst', 'bko_assistant', 'Gerente', ''].entries()) {
        const [sql, params] = montar(perfil, 100 + i);
        const r = await tentar(app, A, () => app.query(sql, [...params]));
        expect(r.ok ? `aceitou ${perfil}` : r.codigo, perfil).toBe(codigo);
      }
    });
  });
});
