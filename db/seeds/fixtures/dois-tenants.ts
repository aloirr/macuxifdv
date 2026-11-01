/**
 * Fixture "dois-tenants" para os testes de RLS/vazamento e de licenças (pedido R-20261030-235502-testes,
 * tests/plano/sprint-0.md §3). SEPARADA do seed da Fase M. Dono: banco-dados.
 *
 * - Tenant A "Distribuidora Alfa" (America/Manaus): core, vendedor, promotor, teste, teste-dependente, catalogo;
 *   8 usuários (admin, analista, assistente, gerente, supervisor, vendedor-1 equipe 1, vendedor-2 equipe 2, promotor).
 * - Tenant B "Comercial Beta" (America/Sao_Paulo): core, vendedor, catalogo; admin-B, vendedor-B.
 * - O Vendedor depende do Catálogo (ADR 0005, T-0007; RN-CORE-03): todo perfil com 'vendedor' também tem 'catalogo'.
 *   'catalogo' vai NO FIM das listas para não deslocar os UUIDs sequenciais já gravados (upsert por id + únicos).
 * - UUIDs fixos: prefixo aaaaaaaa- (A) e bbbbbbbb- (B); formato <prefixo>-<grupo>-4000-8000-<seq>.
 * - Pelo menos 1 linha em TODA tabela com tenant_id, nos dois tenants (o teste de vazamento confere).
 * - Caso de borda S0-072: vendedor-1 (A) e vendedor-B (B) têm o MESMO e-mail (único por tenant, Q3).
 * - Senha de todos: MACUXI_SENHA_TESTE (padrão "Teste@1234", só para teste), hash argon2id.
 * - Login (T-0003 F2, 0004): código da empresa 'alfa'/'beta'; todos com tentativas_falhas = 0 e sem bloqueio_ate
 *   (recarregar a fixture ZERA o bloqueio por tentativas). Aparelhos: vendedor-1 (A, liberado), promotor (A,
 *   BLOQUEADO remotamente) e vendedor-B. Sessões (refresh) válidas até 2099 para vendedor-1 e vendedor-B; o token
 *   entregue ao cliente é DOIS_TENANTS.X.refresh.token (o banco guarda só o sha256 hex do segredo).
 * - Sprint 1 (0005–0007; desenho T-0016 §7): contatos, financeiro, títulos vencidos/a vencer/vencendo hoje, histórico
 *   de 12 meses, rota de HOJE com paradas, visitas (feita, aberta fora do raio, cliente fechado com foto, esquecida
 *   fechada "auto"), etapas, motivos, notificação por usuário, metas do mês, indicador diário, arquivos e pedidos.
 *   c1/c2 (A) e c1 (B) têm coordenada; c3 (A) NÃO tem (RN-CORE-10: coordenada sugerida). Carteiras sem mudança.
 *   Datas RELATIVAS a "hoje" no fuso de cada tenant (opção `hoje` fixa a data para teste determinístico): recarregar
 *   no mesmo dia não muda nada; em outro dia só move datas (mesmos ids, nada duplica). Os instantes do dia (check-in,
 *   checkout, recebido_em) são horas UTC FIXAS da data civil (ex.: v2c2Aberta às 14:00Z): conforme a hora do relógio
 *   eles ficam no passado ou no futuro, então teste nenhum compara instante da fixture com now() — use instante
 *   relativo ao da fixture (checkin_em + interval) ou fixo. `agora` (ou MACUXI_AGORA no global-setup) simula o relógio.
 *   Motivos padrão (os de sistema da RN-CORE-14 e os de não venda) e os parâmetros do Core NÃO estão nas listas: o
 *   gatilho core.semear_tenant cria no INSERT do tenant (ids em DOIS_TENANTS.X.motivos, via idMotivoPadrao).
 * - T-0029 (0008–0009): tabela de preço por tenant (A: c1 e c2 na tabela, c3 SEM tabela; produto 2 de A com vigência
 *   que termina hoje 04:00Z), condições À vista (padrão) e 28 dias (A; c1 com as duas, c2 sem lista), contador do
 *   número (A = 3, B = 1; recarregar não volta o contador), números 000001.. nos pedidos, p2 de A pendente no nível
 *   gerente (12%) e a linha do tempo (pedido_evento) dos pedidos p1/p2 de A e p1 de B.
 * - T-0032 (0010, schema integracao): Conector por tenant (A "erp-alfa" com as 8 entidades; B "erp-beta" só cliente e produto,
 *   IP 203.0.113.0/24), chave atual com hash = HMAC-SHA256(PEPPER_HUB_FIXTURE, chave) (chave em DOIS_TENANTS.X.integracao.chave),
 *   política de versão, sessões fechadas, lotes (completo e delta com staging), erro de linha, espelho com 1 inativado (A),
 *   pendências (A confirmada pelo analista + aguardando até 2099; B recusada pelo admin) com auditoria, cursor, reconciliação,
 *   mapeamento, fila do ERP (p3 de A, p1 de B) com retorno e item descartado. Instantes fixos (2026-10-30). Os módulos dos
 *   tenants NÃO mudaram (a licença 'integracao' não está na fixture).
 */
import { createHash, createHmac } from 'node:crypto';
import type { ClientBase } from 'pg';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idFixo, idMotivoPadrao } from '../../src/ids';
import { anoMes, hojeNoFuso, instante, menorData, somarDias } from '../../src/datas';
import { hashSenha } from '../../src/senha';

const G = {
  tenant: 0x00,
  usuario: 0x01,
  equipe: 0x02,
  produto: 0x03,
  cliente: 0x04,
  carteira: 0x05,
  dispositivo: 0x06,
  sessao: 0x07,
  tenant_modulo: 0x10,
  perfil_modulo: 0x11,
  usuario_modulo: 0x12,
  evento: 0x13,
  parametro: 0x14,
  auditoria: 0x15,
  evento_consumo: 0x16,
  cliente_contato: 0x20,
  cliente_financeiro: 0x21,
  titulo: 0x22,
  historico_compra: 0x23,
  motivo: 0x24,
  rota: 0x25,
  rota_parada: 0x26,
  visita: 0x27,
  visita_etapa: 0x28,
  notificacao: 0x29,
  meta: 0x2a,
  indicador_diario: 0x2b,
  arquivo: 0x2c,
  pedido: 0x30,
  pedido_item: 0x31,
  condicao_pagamento: 0x32,
  cliente_condicao: 0x33,
  numeracao_pedido: 0x34,
  pedido_evento: 0x35,
  tabela_preco: 0x40,
  tabela_preco_item: 0x41,
  cliente_tabela_preco: 0x42,
  conector: 0x50,
  credencial: 0x51,
  politica_versao: 0x52,
  sessao_carga: 0x53,
  sessao_carga_recebido: 0x54,
  lote: 0x55,
  lote_staging: 0x56,
  lote_linha_erro: 0x57,
  registro_atual: 0x58,
  pendencia_inativacao: 0x59,
  inativacao_auditoria: 0x5a,
  cursor_entidade: 0x5b,
  reconciliacao: 0x5c,
  mapeamento: 0x5d,
  pedido_fila_erp: 0x5e,
  pedido_retorno: 0x5f,
  pedido_retorno_erro: 0x60,
} as const;

const a = (grupo: keyof typeof G, seq: number) => idFixo('aaaaaaaa', G[grupo], seq);
const b = (grupo: keyof typeof G, seq: number) => idFixo('bbbbbbbb', G[grupo], seq);

/** Datas FIXAS (fixture idempotente: recarregar não muda nada). */
const DATA_FIXA_ACESSO = '2026-10-31T12:00:00Z';
const VALIDADE_FIXA_REFRESH = '2099-12-31T00:00:00Z';

/** Refresh da fixture: segredo fixo (só teste), token `<tenant_id>.<segredo>` e sha256 hex gravado em core.sessao. */
const refreshFixture = (tenantId: string, segredo: string) => ({
  segredo,
  token: `${tenantId}.${segredo}`,
  hash: createHash('sha256').update(segredo).digest('hex'),
});

/**
 * Chave de API da fixture (T-0032): pepper e chaves SÓ de teste. O banco guarda HMAC-SHA256(pepper, chave) em hex, como a
 * API do Hub calcula com MACUXI_HUB_CHAVE_PEPPER (ADR 0013 §8). Para autenticar nos testes: pepper = PEPPER_HUB_FIXTURE.
 */
export const PEPPER_HUB_FIXTURE = 'fixture-pepper-hub-somente-teste-0032';
const chaveHubFixture = (prefixo: string, segredo: string) => {
  const chave = `mxk_${prefixo}_${segredo}`;
  return { prefixo, chave, hash: createHmac('sha256', PEPPER_HUB_FIXTURE).update(chave).digest('hex') };
};

/** IDs para asserts determinísticos nos testes. */
export const DOIS_TENANTS = {
  A: {
    tenantId: a('tenant', 1),
    codigo: 'alfa',
    fuso: 'America/Manaus',
    modulos: ['core', 'vendedor', 'promotor', 'teste', 'teste-dependente', 'catalogo'],
    usuarios: {
      admin: a('usuario', 1),
      analista: a('usuario', 2),
      assistente: a('usuario', 3),
      gerente: a('usuario', 4),
      supervisor: a('usuario', 5),
      vendedor1: a('usuario', 6),
      vendedor2: a('usuario', 7),
      promotor: a('usuario', 8),
    },
    equipes: { regional: a('equipe', 1), equipe1: a('equipe', 2), equipe2: a('equipe', 3) },
    clientes: { c1: a('cliente', 1), c2: a('cliente', 2), c3: a('cliente', 3) },
    dispositivos: { vendedor1: a('dispositivo', 1), promotorBloqueado: a('dispositivo', 2) },
    sessoes: { vendedor1: a('sessao', 1) },
    familias: { vendedor1: a('sessao', 101) },
    refresh: refreshFixture(a('tenant', 1), 'fixture-refresh-alfa-vendedor1'),
    /** Sprint 1 (0006): motivos padrão semeados pelo gatilho + o motivo próprio da fixture. */
    motivos: {
      lojaFechada: idMotivoPadrao(a('tenant', 1), 'loja_fechada'),
      acessoNegado: idMotivoPadrao(a('tenant', 1), 'acesso_negado'),
      estoqueAlto: idMotivoPadrao(a('tenant', 1), 'estoque_alto'),
      obraNaVia: a('motivo', 1),
    },
    /** Rotas de HOJE: vendedor-1 (c1, c3), vendedor-2 (c2), promotor (c1). */
    rotas: { vendedor1: a('rota', 1), vendedor2: a('rota', 2), promotor: a('rota', 3) },
    paradas: { v1c1: a('rota_parada', 1), v1c3: a('rota_parada', 2), v2c2: a('rota_parada', 3), promotorC1: a('rota_parada', 4) },
    visitas: {
      /** hoje, vendedor-1 em c1: fechada com pedido (pedidos.p1). */
      v1c1Hoje: a('visita', 1),
      /** ontem, vendedor-1 em c3 (sem coordenada, extra): cliente fechado, loja_fechada + foto (arquivos.fachadaV1). */
      v1c3Ontem: a('visita', 2),
      /** hoje, vendedor-2 em c2: ABERTA, fora do raio com justificativa (RN-CORE-10/11). */
      v2c2Aberta: a('visita', 3),
      /** hoje, promotor em c1: fechada, atendido. */
      promotorC1Hoje: a('visita', 4),
      /** anteontem, vendedor-1 em c1: esquecida, fechada auto como nao_finalizado (RN-CORE-11). */
      v1c1Esquecida: a('visita', 5),
    },
    /** checkout_id (UUID do comando de checkout) das visitas fechadas pelo usuário. */
    checkouts: { v1c1Hoje: a('visita', 101), v1c3Ontem: a('visita', 102), promotorC1Hoje: a('visita', 104) },
    arquivos: { fachadaV1: a('arquivo', 1) },
    pedidos: { p1: a('pedido', 1), p2: a('pedido', 2), p3: a('pedido', 3) },
    /** T-0029 (0008): tabela de preço de c1 e c2; c3 SEM tabela (todo produto sem preço, RN-CAT-06). */
    tabelasPreco: { padrao: a('tabela_preco', 1) },
    /** T-0029 (0009): À vista (padrão) e 28 dias; c1 com as duas, c2 sem lista (só a padrão). */
    condicoes: { avista: a('condicao_pagamento', 1), d28: a('condicao_pagamento', 2) },
    /**
     * T-0032 (0010): Conector "erp-alfa" (8 entidades, recebe pedidos) com chave atual (hash = HMAC do PEPPER_HUB_FIXTURE);
     * sessão de produto fechada (1 id inválido guardado) com pendência CONFIRMADA pelo analista e auditada; sessão de cliente
     * fechada com pendência AGUARDANDO (expira em 2099); lote delta recebido com corpo no staging; p3 de A na fila
     * (faturado parcial) com 1 retorno e 1 item descartado (P-4).
     */
    integracao: {
      conector: a('conector', 1),
      identificador: 'erp-alfa',
      chave: chaveHubFixture('alfa0001', 'fixtureChaveAlfaSomenteTesteT0032aaaaaaaaaa'),
      credencial: a('credencial', 1),
      sessoes: { produto: a('sessao_carga', 1), cliente: a('sessao_carga', 2) },
      sessaoUuids: { produto: 'aaaaaaaa-0053-4000-8000-000000000101', cliente: 'aaaaaaaa-0053-4000-8000-000000000102' },
      lotes: { completoProduto: a('lote', 1), delta: a('lote', 2), completoCliente: a('lote', 3) },
      pendencias: { confirmada: a('pendencia_inativacao', 1), aguardando: a('pendencia_inativacao', 2) },
      fila: { p3: a('pedido_fila_erp', 1) },
      retornos: { p3: a('pedido_retorno', 1) },
    },
  },
  B: {
    tenantId: b('tenant', 1),
    codigo: 'beta',
    fuso: 'America/Sao_Paulo',
    modulos: ['core', 'vendedor', 'catalogo'],
    usuarios: { admin: b('usuario', 1), vendedor: b('usuario', 2) },
    equipes: { equipe: b('equipe', 1) },
    clientes: { c1: b('cliente', 1) },
    dispositivos: { vendedor: b('dispositivo', 1) },
    sessoes: { vendedor: b('sessao', 1) },
    familias: { vendedor: b('sessao', 101) },
    refresh: refreshFixture(b('tenant', 1), 'fixture-refresh-beta-vendedor'),
    motivos: {
      lojaFechada: idMotivoPadrao(b('tenant', 1), 'loja_fechada'),
      acessoNegado: idMotivoPadrao(b('tenant', 1), 'acesso_negado'),
      estoqueAlto: idMotivoPadrao(b('tenant', 1), 'estoque_alto'),
      inadimplente: b('motivo', 1),
    },
    rotas: { vendedor: b('rota', 1) },
    paradas: { c1: b('rota_parada', 1) },
    visitas: { c1Hoje: b('visita', 1), c1OntemFechado: b('visita', 2) },
    checkouts: { c1Hoje: b('visita', 101), c1OntemFechado: b('visita', 102) },
    /** foto da fachada AINDA NÃO enviada (situacao aguardando, ADR 0010). */
    arquivos: { fachadaAguardando: b('arquivo', 1) },
    pedidos: { p1: b('pedido', 1) },
    tabelasPreco: { padrao: b('tabela_preco', 1) },
    condicoes: { avista: b('condicao_pagamento', 1) },
    /**
     * T-0032 (0010): Conector "erp-beta" (só cliente e produto, recebe pedidos, IP restrito a 203.0.113.0/24); sessão de
     * cliente com pendência RECUSADA pelo admin (auditada); p1 de B na fila (faturado total) com retorno e 1 item descartado.
     */
    integracao: {
      conector: b('conector', 1),
      identificador: 'erp-beta',
      chave: chaveHubFixture('beta0001', 'fixtureChaveBetaSomenteTesteT0032bbbbbbbbbb'),
      credencial: b('credencial', 1),
      sessoes: { cliente: b('sessao_carga', 1) },
      sessaoUuids: { cliente: 'bbbbbbbb-0053-4000-8000-000000000101' },
      lotes: { completoCliente: b('lote', 1), delta: b('lote', 2) },
      pendencias: { recusada: b('pendencia_inativacao', 1) },
      fila: { p1: b('pedido_fila_erp', 1) },
      retornos: { p1: b('pedido_retorno', 1) },
    },
  },
  /** E-mail repetido de propósito em A (vendedor-1) e B (vendedor-B). */
  emailRepetido: 'vendedor@exemplo.com.br',
} as const;

/** Ordem de gravação (respeita as FKs). */
/** Tabelas da Sprint 1 (0005–0007), na ordem das FKs (arquivo antes de visita: FK da foto da fachada). */
const ORDEM_SPRINT1 = [
  'core.cliente_contato',
  'core.cliente_financeiro',
  'core.titulo',
  'core.historico_compra',
  'core.motivo',
  'core.rota',
  'core.rota_parada',
  'plataforma.arquivo',
  'core.visita',
  'core.visita_etapa',
  'core.notificacao',
  'core.meta',
  'core.indicador_diario',
  'vendedor.pedido',
  'vendedor.pedido_item',
] as const;

/** Tabelas da T-0029 (0008 catálogo de preço, 0009 vendedor), na ordem das FKs. As condições vêm antes do pedido. */
const ORDEM_T0029_ANTES_DO_PEDIDO = [
  'catalogo.tabela_preco',
  'catalogo.tabela_preco_item',
  'catalogo.cliente_tabela_preco',
  'vendedor.condicao_pagamento',
  'vendedor.cliente_condicao',
  'vendedor.numeracao_pedido',
] as const;
type TabelaT0029 = (typeof ORDEM_T0029_ANTES_DO_PEDIDO)[number] | 'vendedor.pedido_evento';

/** Tabelas da T-0032 (0010, schema integracao), na ordem das FKs. */
const ORDEM_T0032 = [
  'integracao.conector',
  'integracao.credencial',
  'integracao.politica_versao',
  'integracao.sessao_carga',
  'integracao.sessao_carga_recebido',
  'integracao.lote',
  'integracao.lote_staging',
  'integracao.lote_linha_erro',
  'integracao.registro_atual',
  'integracao.pendencia_inativacao',
  'integracao.inativacao_auditoria',
  'integracao.cursor_entidade',
  'integracao.reconciliacao',
  'integracao.mapeamento',
  'integracao.pedido_fila_erp',
  'integracao.pedido_retorno',
  'integracao.pedido_retorno_erro',
] as const;
type TabelaT0032 = (typeof ORDEM_T0032)[number];
const DO_PEDIDO = ['vendedor.pedido', 'vendedor.pedido_item'] as const;

export const ORDEM_TABELAS = [
  'plataforma.tenant',
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'core.equipe',
  'core.usuario',
  'plataforma.usuario_modulo',
  'core.produto',
  'core.cliente',
  'core.carteira',
  'core.dispositivo',
  'core.sessao',
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.parametro',
  'plataforma.auditoria',
  ...ORDEM_SPRINT1.filter((t): t is Exclude<(typeof ORDEM_SPRINT1)[number], (typeof DO_PEDIDO)[number]> => !(DO_PEDIDO as readonly string[]).includes(t)),
  ...ORDEM_T0029_ANTES_DO_PEDIDO,
  ...DO_PEDIDO,
  'vendedor.pedido_evento',
  ...ORDEM_T0032,
] as const;

export type DadosFixture = Record<(typeof ORDEM_TABELAS)[number], Linha[]>;

const usuario = (id: string, tenant_id: string, nome: string, email: string, perfil: string, equipe_id: string | null, senha_hash: string): Linha => ({
  id,
  tenant_id,
  nome,
  nome_curto: nome,
  email,
  perfil,
  equipe_id,
  senha_hash,
  ativo: true,
  tentativas_falhas: 0,
  bloqueio_ate: null,
  external_id: null,
});

export interface OpcoesDadosFixture {
  /** Data (AAAA-MM-DD) usada como "hoje" nos DOIS tenants; padrão: hoje no fuso de cada tenant. */
  hoje?: string;
  /** Instante de referência para o "hoje" de cada fuso quando `hoje` não vem (padrão: o relógio). */
  agora?: Date;
}

/** Coordenadas fictícias (c3 de A fica sem, de propósito). */
const COORDENADAS = { a1: [-3.1019, -60.025], a2: [-3.0874, -60.0172], b1: [-23.5505, -46.6333] } as const;

export function dadosDoisTenants(senhaHash: string, opcoes: OpcoesDadosFixture = {}): DadosFixture {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const agora = opcoes.agora ?? new Date();
  const hojeA = opcoes.hoje ?? hojeNoFuso(A.fuso, agora);
  const hojeB = opcoes.hoje ?? hojeNoFuso(B.fuso, agora);

  const perfilModulo: Array<[string, string, string]> = [
    // tenant, perfil, módulo — A conforme o plano §3 (+ admin/analista/assistente, complemento do banco)
    [tA, 'vendedor', 'core'], [tA, 'vendedor', 'vendedor'], [tA, 'vendedor', 'teste'],
    [tA, 'promotor', 'core'], [tA, 'promotor', 'promotor'], [tA, 'promotor', 'teste'],
    [tA, 'supervisor', 'core'], [tA, 'supervisor', 'vendedor'], [tA, 'supervisor', 'promotor'],
    [tA, 'gerente', 'core'], [tA, 'gerente', 'vendedor'], [tA, 'gerente', 'promotor'],
    [tA, 'admin', 'core'],
    [tA, 'analista', 'core'], [tA, 'analista', 'vendedor'], [tA, 'analista', 'promotor'],
    [tA, 'assistente', 'core'], [tA, 'assistente', 'vendedor'],
    [tB, 'vendedor', 'core'], [tB, 'vendedor', 'vendedor'],
    [tB, 'admin', 'core'], [tB, 'admin', 'vendedor'],
    // Catálogo junto de todo perfil com 'vendedor' (ADR 0005); no fim para manter os ids anteriores.
    [tA, 'vendedor', 'catalogo'], [tA, 'supervisor', 'catalogo'], [tA, 'gerente', 'catalogo'],
    [tA, 'analista', 'catalogo'], [tA, 'assistente', 'catalogo'],
    [tB, 'vendedor', 'catalogo'], [tB, 'admin', 'catalogo'],
  ];
  const seqPerfil = { [tA]: 0, [tB]: 0 } as Record<string, number>;

  return {
    'plataforma.tenant': [
      { id: tA, codigo: A.codigo, nome: 'Distribuidora Alfa', documento: '11111111000191', fuso: A.fuso, plano: 'piloto', status: 'ativo', external_id: null },
      { id: tB, codigo: B.codigo, nome: 'Comercial Beta', documento: '22222222000191', fuso: B.fuso, plano: 'piloto', status: 'ativo', external_id: null },
    ],
    'plataforma.tenant_modulo': [
      ...A.modulos.map((modulo, i) => ({ id: a('tenant_modulo', i + 1), tenant_id: tA, modulo, ativo: true, plano: 'piloto', licencas: null, parametros: {}, external_id: null })),
      ...B.modulos.map((modulo, i) => ({ id: b('tenant_modulo', i + 1), tenant_id: tB, modulo, ativo: true, plano: 'piloto', licencas: null, parametros: {}, external_id: null })),
    ],
    'plataforma.perfil_modulo': perfilModulo.map(([tenant_id, perfil, modulo]) => {
      seqPerfil[tenant_id] = (seqPerfil[tenant_id] ?? 0) + 1;
      const id = tenant_id === tA ? a('perfil_modulo', seqPerfil[tenant_id]!) : b('perfil_modulo', seqPerfil[tenant_id]!);
      return { id, tenant_id, perfil, modulo, external_id: null };
    }),
    // equipes: gravadas primeiro sem responsável (ciclo equipe <-> usuario); responsável aplicado depois.
    'core.equipe': [
      { id: A.equipes.regional, tenant_id: tA, nome: 'Regional Alfa', equipe_pai_id: null, responsavel_id: A.usuarios.gerente, ativo: true, external_id: null },
      { id: A.equipes.equipe1, tenant_id: tA, nome: 'Equipe 1', equipe_pai_id: A.equipes.regional, responsavel_id: A.usuarios.supervisor, ativo: true, external_id: null },
      { id: A.equipes.equipe2, tenant_id: tA, nome: 'Equipe 2', equipe_pai_id: A.equipes.regional, responsavel_id: null, ativo: true, external_id: null },
      { id: B.equipes.equipe, tenant_id: tB, nome: 'Equipe Beta', equipe_pai_id: null, responsavel_id: B.usuarios.admin, ativo: true, external_id: null },
    ],
    'core.usuario': [
      usuario(A.usuarios.admin, tA, 'Admin Alfa', 'admin@exemplo.com.br', 'admin', null, senhaHash),
      usuario(A.usuarios.analista, tA, 'Analista Alfa', 'analista@exemplo.com.br', 'analista', null, senhaHash),
      usuario(A.usuarios.assistente, tA, 'Assistente Alfa', 'assistente@exemplo.com.br', 'assistente', null, senhaHash),
      usuario(A.usuarios.gerente, tA, 'Gerente Alfa', 'gerente@exemplo.com.br', 'gerente', A.equipes.regional, senhaHash),
      usuario(A.usuarios.supervisor, tA, 'Supervisor Alfa', 'supervisor@exemplo.com.br', 'supervisor', A.equipes.equipe1, senhaHash),
      usuario(A.usuarios.vendedor1, tA, 'Vendedor Um', DOIS_TENANTS.emailRepetido, 'vendedor', A.equipes.equipe1, senhaHash),
      usuario(A.usuarios.vendedor2, tA, 'Vendedor Dois', 'vendedor2@exemplo.com.br', 'vendedor', A.equipes.equipe2, senhaHash),
      usuario(A.usuarios.promotor, tA, 'Promotor Alfa', 'promotor@exemplo.com.br', 'promotor', A.equipes.equipe1, senhaHash),
      usuario(B.usuarios.admin, tB, 'Admin Beta', 'admin.b@exemplo.com.br', 'admin', null, senhaHash),
      usuario(B.usuarios.vendedor, tB, 'Vendedor Beta', DOIS_TENANTS.emailRepetido, 'vendedor', B.equipes.equipe, senhaHash),
    ],
    'plataforma.usuario_modulo': [
      { id: a('usuario_modulo', 1), tenant_id: tA, usuario_id: A.usuarios.vendedor2, modulo: 'teste', efeito: 'remover', motivo: 'fixture: exceção que remove teste (S0-042)', external_id: null },
      { id: b('usuario_modulo', 1), tenant_id: tB, usuario_id: B.usuarios.admin, modulo: 'vendedor', efeito: 'remover', motivo: 'fixture: garante linha em B', external_id: null },
    ],
    'core.produto': [
      { id: a('produto', 1), tenant_id: tA, sku: 'ALFA-001', ean: '7890000000011', nome: 'Pastilha de freio dianteira', marca: 'Norfreio', categoria: 'Freios', unidade: 'PC', ativo: true, external_id: 'ERP-A-001' },
      { id: a('produto', 2), tenant_id: tA, sku: 'ALFA-002', ean: null, nome: 'Filtro de óleo', marca: 'FiltraMax', categoria: 'Filtros', unidade: 'PC', ativo: true, external_id: null },
      { id: b('produto', 1), tenant_id: tB, sku: 'BETA-001', ean: '7890000000028', nome: 'Óleo 5W30 1 L', marca: 'Lubrion', categoria: 'Lubrificantes', unidade: 'UN', ativo: true, external_id: 'ERP-B-001' },
    ],
    'core.cliente': [
      cliente(A.clientes.c1, tA, '33333333000191', 'Auto Peças Um', 'Manaus', 'AM', COORDENADAS.a1),
      cliente(A.clientes.c2, tA, '44444444000191', 'Auto Peças Dois', 'Manaus', 'AM', COORDENADAS.a2),
      // c3 SEM coordenada: o 1º check-in sugere a coordenada ao BKO (RN-CORE-10)
      cliente(A.clientes.c3, tA, '55555555000191', 'Auto Peças Três', 'Manacapuru', 'AM', null),
      cliente(B.clientes.c1, tB, '66666666000191', 'Mecânica Beta', 'São Paulo', 'SP', COORDENADAS.b1),
    ],
    'core.carteira': [
      { id: a('carteira', 1), tenant_id: tA, cliente_id: A.clientes.c1, usuario_id: A.usuarios.vendedor1, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 2), tenant_id: tA, cliente_id: A.clientes.c1, usuario_id: A.usuarios.promotor, papel: 'promotor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 3), tenant_id: tA, cliente_id: A.clientes.c2, usuario_id: A.usuarios.vendedor2, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 4), tenant_id: tA, cliente_id: A.clientes.c3, usuario_id: A.usuarios.vendedor1, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: b('carteira', 1), tenant_id: tB, cliente_id: B.clientes.c1, usuario_id: B.usuarios.vendedor, papel: 'vendedor', inicio: null, fim: null, external_id: null },
    ],
    'core.dispositivo': [
      { id: A.dispositivos.vendedor1, tenant_id: tA, usuario_id: A.usuarios.vendedor1, nome: 'Aparelho Vendedor Um', plataforma: 'android', ultimo_acesso_em: DATA_FIXA_ACESSO, bloqueado_em: null, external_id: null },
      { id: A.dispositivos.promotorBloqueado, tenant_id: tA, usuario_id: A.usuarios.promotor, nome: 'Aparelho Promotor', plataforma: 'android', ultimo_acesso_em: DATA_FIXA_ACESSO, bloqueado_em: DATA_FIXA_ACESSO, external_id: null },
      { id: B.dispositivos.vendedor, tenant_id: tB, usuario_id: B.usuarios.vendedor, nome: 'Aparelho Vendedor Beta', plataforma: 'android', ultimo_acesso_em: DATA_FIXA_ACESSO, bloqueado_em: null, external_id: null },
    ],
    'core.sessao': [
      sessao(A.sessoes.vendedor1, tA, A.usuarios.vendedor1, A.familias.vendedor1, A.refresh.hash, A.dispositivos.vendedor1),
      sessao(B.sessoes.vendedor, tB, B.usuarios.vendedor, B.familias.vendedor, B.refresh.hash, B.dispositivos.vendedor),
    ],
    'plataforma.evento': [
      evento(a('evento', 1), tA, A.usuarios.vendedor2),
      evento(b('evento', 1), tB, B.usuarios.admin),
    ],
    'plataforma.evento_consumo': [
      { id: a('evento_consumo', 1), tenant_id: tA, consumidor: 'core.fixture', evento_id: a('evento', 1), external_id: null },
      { id: b('evento_consumo', 1), tenant_id: tB, consumidor: 'core.fixture', evento_id: b('evento', 1), external_id: null },
    ],
    'plataforma.parametro': [
      { id: a('parametro', 1), tenant_id: tA, modulo: 'core', chave: 'raio_checkin_m', valor: '200', external_id: null },
      { id: a('parametro', 2), tenant_id: tA, modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: '5', external_id: null },
      { id: b('parametro', 1), tenant_id: tB, modulo: 'core', chave: 'raio_checkin_m', valor: '300', external_id: null },
    ],
    'plataforma.auditoria': [
      auditoria(a('auditoria', 1), tA, A.usuarios.admin, A.usuarios.vendedor2),
      auditoria(b('auditoria', 1), tB, B.usuarios.admin, B.usuarios.admin),
    ],
    ...dadosSprint1(hojeA, hojeB),
    ...dadosT0029(hojeA, hojeB),
    ...dadosT0032(),
  };
}

type TabelaSprint1 = (typeof ORDEM_SPRINT1)[number];

/**
 * Tabelas da Sprint 1 (0005–0007). Instantes em UTC: A (Manaus, UTC−4) 13:00Z = 09:00 local; B (São Paulo, UTC−3)
 * 12:00Z = 09:00 local — data_local da visita = data do check-in no fuso do tenant.
 */
function dadosSprint1(hojeA: string, hojeB: string): Pick<DadosFixture, TabelaSprint1> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const ontemA = somarDias(hojeA, -1);
  const anteontemA = somarDias(hojeA, -2);
  const ontemB = somarDias(hojeB, -1);
  const comuns = { deleted_at: null, external_id: null };

  const contato = (id: string, tenant_id: string, cliente_id: string, nome: string, cargo: string | null, telefone: string | null, whatsapp: string | null, email: string | null, principal: boolean): Linha => ({
    id, tenant_id, cliente_id, nome, cargo, telefone, whatsapp, email, principal, ...comuns,
  });
  const financeiro = (id: string, tenant_id: string, cliente_id: string, limite: number, saldo: number, credito: number | null, bloqueado: boolean, motivo: string | null): Linha => ({
    id, tenant_id, cliente_id, limite_cents: limite, saldo_aberto_cents: saldo, credito_disponivel_cents: credito, bloqueado, motivo_bloqueio: motivo,
    atualizado_erp_em: DATA_FIXA_ACESSO, ...comuns,
  });
  const titulo = (id: string, tenant_id: string, cliente_id: string, documento: string, parcela: string | null, emissao: string, vencimento: string, valor: number, saldo: number, situacao: string, liquidado_em: string | null): Linha => ({
    id, tenant_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents: valor, saldo_cents: saldo, situacao, liquidado_em, ...comuns,
  });
  /** n meses de histórico até o mês de `hoje` (inclusive); o mês corrente com a última compra até hoje. */
  const historico = (pre: typeof a, seq0: number, tenant_id: string, cliente_id: string, hoje: string, meses: number, base: number, ateMesAnterior = false): Linha[] =>
    Array.from({ length: meses }, (_, i) => {
      const desloc = i - meses + (ateMesAnterior ? 0 : 1);
      const am = anoMes(hoje, desloc);
      return {
        id: pre('historico_compra', seq0 + i), tenant_id, cliente_id, ano_mes: am, valor_cents: base + i * 25_000, pedidos: 2 + (i % 3), itens: 10 + i,
        ultima_compra_em: menorData(`${am}-05`, hoje), origem: 'erp', ...comuns,
      };
    });
  const rota = (id: string, tenant_id: string, usuario_id: string, data: string, regiao: string): Linha => ({
    id, tenant_id, usuario_id, data, situacao: 'publicada', origem: 'bko', regiao, observacao: null, ...comuns,
  });
  const parada = (id: string, tenant_id: string, rota_id: string, usuario_id: string, data: string, cliente_id: string, sequencia: number, janela: [string, string] | null): Linha => ({
    id, tenant_id, rota_id, usuario_id, data, cliente_id, sequencia, janela_inicio: janela?.[0] ?? null, janela_fim: janela?.[1] ?? null, ...comuns,
  });
  const visita = (v: Partial<Linha> & { id: string; tenant_id: string; usuario_id: string; cliente_id: string; data_local: string; checkin_em: string }): Linha => ({
    rota_parada_id: null, checkin_lat: null, checkin_lng: null, checkin_precisao_m: null, sem_gps: false, distancia_m: null, fora_do_raio: false,
    justificativa_fora_raio: null, sugere_coordenada: false, extra: false, checkout_id: null, checkout_em: null, checkout_lat: null, checkout_lng: null,
    resultado: null, motivo_id: null, motivo_texto: null, pedido_id: null, foto_fachada_id: null, fechada_por: null, recebido_em: v.checkin_em,
    ...comuns, ...v,
  });
  const notificacao = (id: string, tenant_id: string, usuario_id: string, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, usuario_id, tipo: 'sistema', titulo: 'Bem-vindo ao Macuxi', corpo: 'Sua conta está pronta. Sincronize o aparelho antes de sair para a rota.',
    link: null, origem_modulo: 'core', origem_evento_id: null, envio_id: null, autor_id: null, prioridade: 'normal', lida_em: null, expira_em: null,
    push_enviado_em: null, ...comuns, ...extra,
  });
  const meta = (id: string, tenant_id: string, usuario_id: string, periodo: string, indicador: string, valor: number): Linha => ({
    id, tenant_id, usuario_id, periodo, indicador, valor, ...comuns,
  });
  const pedido = (p: Partial<Linha> & { id: string; tenant_id: string; cliente_id: string; vendedor_id: string; status: string }): Linha => ({
    autor_id: p.vendedor_id, condicao_pagamento: '28 dias', desconto_pct: 0, total_tabela_cents: 0, total_cents: 0, observacao: null, visita_id: null,
    rota_parada_id: null, criado_no_aparelho_em: null, recebido_em: null, numero_erp: null, motivo_cancelamento: null,
    // 0009 (T-0029): número, retrato, condição e aprovação
    numero: null, hash_envio: null, cliente_resumo: null, cliente_nome: null, vendedor_nome: null, tabela_preco_id: null, condicao_pagamento_id: null,
    condicao_pagamento_descricao: null, nivel_aprovacao: null, motivos_aprovacao: arrayDeTexto([]), aprovacao_automatica: false, decidido_por_id: null, decidido_em: null,
    motivo_rejeicao: null, ...comuns, ...p,
  });
  const item = (id: string, tenant_id: string, pedido_id: string, sequencia: number, produto_id: string, quantidade: number, tabela: number, desconto: number): Linha => {
    const unitario = Math.round((tabela * (100 - desconto)) / 100);
    return {
      id, tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents: tabela, preco_unitario_cents: unitario, desconto_pct: desconto,
      total_cents: unitario * quantidade, produto_sku: null, produto_nome: null, unidade: null, ...comuns,
    };
  };

  return {
    'core.cliente_contato': [
      contato(a('cliente_contato', 1), tA, A.clientes.c1, 'Marcos Compras', 'Comprador', '9232220001', '92999990001', 'compras.um@exemplo.com.br', true),
      contato(a('cliente_contato', 2), tA, A.clientes.c1, 'Rita Financeiro', 'Financeiro', '9232220002', null, null, false),
      contato(a('cliente_contato', 3), tA, A.clientes.c2, 'João Balcão', 'Gerente da loja', '9232220003', '92999990003', null, true),
      contato(a('cliente_contato', 4), tA, A.clientes.c3, 'Pedro Dono', 'Proprietário', null, '92999990004', null, true),
      contato(b('cliente_contato', 1), tB, B.clientes.c1, 'Sônia Compras', 'Compradora', '1130000001', '11999990001', 'compras.beta@exemplo.com.br', true),
    ],
    'core.cliente_financeiro': [
      financeiro(a('cliente_financeiro', 1), tA, A.clientes.c1, 5_000_000, 1_000_000, null, false, null),
      financeiro(a('cliente_financeiro', 2), tA, A.clientes.c2, 2_000_000, 2_100_000, null, true, 'Títulos vencidos há mais de 30 dias'),
      financeiro(a('cliente_financeiro', 3), tA, A.clientes.c3, 1_000_000, 300_000, 700_000, false, null),
      financeiro(b('cliente_financeiro', 1), tB, B.clientes.c1, 3_000_000, 300_000, null, false, null),
    ],
    'core.titulo': [
      // c1: um vencido, um a vencer e um liquidado
      titulo(a('titulo', 1), tA, A.clientes.c1, 'NF-1001', '1/2', somarDias(hojeA, -40), somarDias(hojeA, -10), 500_000, 500_000, 'aberto', null),
      titulo(a('titulo', 2), tA, A.clientes.c1, 'NF-1001', '2/2', somarDias(hojeA, -40), somarDias(hojeA, 20), 500_000, 500_000, 'aberto', null),
      titulo(a('titulo', 3), tA, A.clientes.c1, 'NF-0950', '1/1', somarDias(hojeA, -70), somarDias(hojeA, -40), 250_000, 0, 'liquidado', instante(somarDias(hojeA, -38), '15:00')),
      // c2: vencido há 45 dias (cliente bloqueado)
      titulo(a('titulo', 4), tA, A.clientes.c2, 'NF-1010', '1/1', somarDias(hojeA, -75), somarDias(hojeA, -45), 2_100_000, 2_100_000, 'aberto', null),
      // c3: vencendo HOJE (borda do fuso) e um cancelado antigo, fora da janela do pull
      titulo(a('titulo', 5), tA, A.clientes.c3, 'NF-1020', '1/1', somarDias(hojeA, -5), hojeA, 300_000, 300_000, 'aberto', null),
      titulo(a('titulo', 6), tA, A.clientes.c3, 'NF-0800', '1/1', somarDias(hojeA, -150), somarDias(hojeA, -120), 90_000, 0, 'cancelado', null),
      titulo(b('titulo', 1), tB, B.clientes.c1, 'NF-B-01', '1/2', somarDias(hojeB, -33), somarDias(hojeB, -3), 150_000, 150_000, 'aberto', null),
      titulo(b('titulo', 2), tB, B.clientes.c1, 'NF-B-01', '2/2', somarDias(hojeB, -33), somarDias(hojeB, 15), 150_000, 150_000, 'aberto', null),
    ],
    'core.historico_compra': [
      ...historico(a, 1, tA, A.clientes.c1, hojeA, 12, 800_000),
      // c2: 6 meses, sem compra no mês corrente; c3 sem histórico (borda)
      ...historico(a, 13, tA, A.clientes.c2, hojeA, 6, 400_000, true),
      ...historico(b, 1, tB, B.clientes.c1, hojeB, 12, 600_000),
    ],
    'core.motivo': [
      { id: A.motivos.obraNaVia, tenant_id: tA, tipo: 'fora_do_raio', codigo: 'obra_na_via', descricao: 'Obra na via de acesso', exige_foto: false, sistema: false, ativo: true, ordem: 1, ...comuns },
      { id: B.motivos.inadimplente, tenant_id: tB, tipo: 'nao_venda', codigo: 'cliente_inadimplente', descricao: 'Cliente inadimplente', exige_foto: false, sistema: false, ativo: true, ordem: 5, ...comuns },
    ],
    'core.rota': [
      rota(A.rotas.vendedor1, tA, A.usuarios.vendedor1, hojeA, 'Manaus Centro'),
      rota(A.rotas.vendedor2, tA, A.usuarios.vendedor2, hojeA, 'Manaus Norte'),
      rota(A.rotas.promotor, tA, A.usuarios.promotor, hojeA, 'Manaus Centro'),
      rota(B.rotas.vendedor, tB, B.usuarios.vendedor, hojeB, 'São Paulo Centro'),
    ],
    'core.rota_parada': [
      parada(A.paradas.v1c1, tA, A.rotas.vendedor1, A.usuarios.vendedor1, hojeA, A.clientes.c1, 1, ['08:00', '10:00']),
      parada(A.paradas.v1c3, tA, A.rotas.vendedor1, A.usuarios.vendedor1, hojeA, A.clientes.c3, 2, null),
      parada(A.paradas.v2c2, tA, A.rotas.vendedor2, A.usuarios.vendedor2, hojeA, A.clientes.c2, 1, null),
      parada(A.paradas.promotorC1, tA, A.rotas.promotor, A.usuarios.promotor, hojeA, A.clientes.c1, 1, ['10:00', '12:00']),
      parada(B.paradas.c1, tB, B.rotas.vendedor, B.usuarios.vendedor, hojeB, B.clientes.c1, 1, null),
    ],
    'plataforma.arquivo': [
      {
        id: A.arquivos.fachadaV1, tenant_id: tA, modulo: 'core', finalidade: 'fachada', entidade: 'visita', entidade_id: A.visitas.v1c3Ontem,
        cliente_id: A.clientes.c3, enviado_por: A.usuarios.vendedor1, tipo: 'image/jpeg', tamanho_bytes: 245_760,
        sha256: createHash('sha256').update('fixture-fachada-alfa').digest('hex'), largura_px: 1600, altura_px: 1200, situacao: 'recebido',
        recebido_em: instante(ontemA, '14:20'), chave_armazenamento: `${tA}/core/${anoMes(ontemA)}/${A.arquivos.fachadaV1}.jpg`, ...comuns,
      },
      {
        id: B.arquivos.fachadaAguardando, tenant_id: tB, modulo: 'core', finalidade: 'fachada', entidade: 'visita', entidade_id: B.visitas.c1OntemFechado,
        cliente_id: B.clientes.c1, enviado_por: B.usuarios.vendedor, tipo: 'image/jpeg', tamanho_bytes: null, sha256: null, largura_px: null, altura_px: null,
        situacao: 'aguardando', recebido_em: null, chave_armazenamento: null, ...comuns,
      },
    ],
    'core.visita': [
      visita({
        id: A.visitas.v1c1Hoje, tenant_id: tA, usuario_id: A.usuarios.vendedor1, cliente_id: A.clientes.c1, rota_parada_id: A.paradas.v1c1, data_local: hojeA,
        checkin_em: instante(hojeA, '13:05'), checkin_lat: -3.1021, checkin_lng: -60.0252, checkin_precisao_m: 12, distancia_m: 32,
        checkout_id: A.checkouts.v1c1Hoje, checkout_em: instante(hojeA, '13:40'), checkout_lat: -3.1021, checkout_lng: -60.0252,
        resultado: 'pedido', pedido_id: A.pedidos.p1, fechada_por: 'usuario',
      }),
      visita({
        id: A.visitas.v1c3Ontem, tenant_id: tA, usuario_id: A.usuarios.vendedor1, cliente_id: A.clientes.c3, data_local: ontemA,
        checkin_em: instante(ontemA, '14:00'), checkin_lat: -3.29, checkin_lng: -60.6206, checkin_precisao_m: 20, sugere_coordenada: true, extra: true,
        checkout_id: A.checkouts.v1c3Ontem, checkout_em: instante(ontemA, '14:10'), resultado: 'cliente_fechado', motivo_id: A.motivos.lojaFechada,
        foto_fachada_id: A.arquivos.fachadaV1, fechada_por: 'usuario',
      }),
      visita({
        id: A.visitas.v2c2Aberta, tenant_id: tA, usuario_id: A.usuarios.vendedor2, cliente_id: A.clientes.c2, rota_parada_id: A.paradas.v2c2, data_local: hojeA,
        checkin_em: instante(hojeA, '14:00'), checkin_lat: -3.095, checkin_lng: -60.0225, checkin_precisao_m: 15, distancia_m: 850, fora_do_raio: true,
        justificativa_fora_raio: 'Cliente atendeu na filial ao lado',
      }),
      visita({
        id: A.visitas.promotorC1Hoje, tenant_id: tA, usuario_id: A.usuarios.promotor, cliente_id: A.clientes.c1, rota_parada_id: A.paradas.promotorC1, data_local: hojeA,
        checkin_em: instante(hojeA, '15:00'), sem_gps: true, checkout_id: A.checkouts.promotorC1Hoje, checkout_em: instante(hojeA, '15:30'),
        resultado: 'atendido', fechada_por: 'usuario',
      }),
      visita({
        id: A.visitas.v1c1Esquecida, tenant_id: tA, usuario_id: A.usuarios.vendedor1, cliente_id: A.clientes.c1, data_local: anteontemA,
        checkin_em: instante(anteontemA, '19:00'), checkin_lat: -3.1019, checkin_lng: -60.025, distancia_m: 0,
        // virada do dia em Manaus (UTC−4): 00:00 local = 04:00Z do dia seguinte
        checkout_em: instante(ontemA, '04:00'), resultado: 'nao_finalizado', fechada_por: 'auto',
      }),
      visita({
        id: B.visitas.c1Hoje, tenant_id: tB, usuario_id: B.usuarios.vendedor, cliente_id: B.clientes.c1, rota_parada_id: B.paradas.c1, data_local: hojeB,
        checkin_em: instante(hojeB, '12:00'), checkin_lat: -23.5507, checkin_lng: -46.6331, distancia_m: 30, checkout_id: B.checkouts.c1Hoje,
        checkout_em: instante(hojeB, '12:30'), resultado: 'sem_pedido', motivo_id: B.motivos.estoqueAlto, fechada_por: 'usuario',
      }),
      visita({
        id: B.visitas.c1OntemFechado, tenant_id: tB, usuario_id: B.usuarios.vendedor, cliente_id: B.clientes.c1, data_local: ontemB,
        checkin_em: instante(ontemB, '13:00'), checkin_lat: -23.5506, checkin_lng: -46.6334, distancia_m: 12, checkout_id: B.checkouts.c1OntemFechado,
        checkout_em: instante(ontemB, '13:05'), resultado: 'cliente_fechado', motivo_id: B.motivos.acessoNegado, foto_fachada_id: B.arquivos.fachadaAguardando,
        fechada_por: 'usuario',
      }),
    ],
    'core.visita_etapa': [
      { id: a('visita_etapa', 1), tenant_id: tA, visita_id: A.visitas.v1c1Hoje, modulo: 'vendedor', etapa: 'pedido', situacao: 'concluida', referencia_id: A.pedidos.p1, registrada_em: instante(hojeA, '13:40'), ...comuns },
      { id: a('visita_etapa', 2), tenant_id: tA, visita_id: A.visitas.promotorC1Hoje, modulo: 'promotor', etapa: 'checklist', situacao: 'concluida', referencia_id: null, registrada_em: instante(hojeA, '15:30'), ...comuns },
      { id: a('visita_etapa', 3), tenant_id: tA, visita_id: A.visitas.v1c3Ontem, modulo: 'pesquisa', etapa: 'pesquisa_obrigatoria', situacao: 'dispensada', referencia_id: null, registrada_em: instante(ontemA, '14:10'), ...comuns },
      { id: b('visita_etapa', 1), tenant_id: tB, visita_id: B.visitas.c1Hoje, modulo: 'core', etapa: 'motivo_nao_venda', situacao: 'concluida', referencia_id: null, registrada_em: instante(hojeB, '12:30'), ...comuns },
    ],
    'core.notificacao': [
      ...Object.values(A.usuarios).map((usuario_id, i) => notificacao(a('notificacao', i + 1), tA, usuario_id, usuario_id === A.usuarios.admin ? { lida_em: DATA_FIXA_ACESSO } : {})),
      notificacao(a('notificacao', 9), tA, A.usuarios.vendedor1, {
        tipo: 'recado', titulo: 'Visite o Auto Peças Três', corpo: 'Cliente com título vencendo hoje: confirme o pagamento na visita.', link: '/m/core-rota',
        origem_modulo: 'core', envio_id: a('notificacao', 109), autor_id: A.usuarios.supervisor, prioridade: 'alta',
      }),
      ...Object.values(B.usuarios).map((usuario_id, i) => notificacao(b('notificacao', i + 1), tB, usuario_id)),
    ],
    'core.meta': [
      meta(a('meta', 1), tA, A.usuarios.vendedor1, anoMes(hojeA), 'venda_cents', 15_000_000),
      meta(a('meta', 2), tA, A.usuarios.vendedor1, anoMes(hojeA), 'visitas', 80),
      meta(a('meta', 3), tA, A.usuarios.vendedor1, anoMes(hojeA), 'positivacao', 30),
      meta(a('meta', 4), tA, A.usuarios.vendedor1, anoMes(hojeA), 'cobertura_pct', 9_000),
      meta(a('meta', 5), tA, A.usuarios.vendedor2, anoMes(hojeA), 'venda_cents', 12_000_000),
      meta(a('meta', 6), tA, A.usuarios.promotor, anoMes(hojeA), 'visitas', 100),
      meta(b('meta', 1), tB, B.usuarios.vendedor, anoMes(hojeB), 'venda_cents', 8_000_000),
    ],
    'core.indicador_diario': [
      { id: a('indicador_diario', 1), tenant_id: tA, usuario_id: A.usuarios.vendedor1, data: ontemA, pedidos: 3, vendido_cents: 450_000, cancelado_cents: 0, ...comuns },
      { id: b('indicador_diario', 1), tenant_id: tB, usuario_id: B.usuarios.vendedor, data: ontemB, pedidos: 1, vendido_cents: 45_000, cancelado_cents: 0, ...comuns },
    ],
    'vendedor.pedido': [
      pedido({
        id: A.pedidos.p1, tenant_id: tA, cliente_id: A.clientes.c1, vendedor_id: A.usuarios.vendedor1, status: 'received', desconto_pct: 5,
        total_tabela_cents: 300_000, total_cents: 285_000, visita_id: A.visitas.v1c1Hoje, rota_parada_id: A.paradas.v1c1,
        criado_no_aparelho_em: instante(hojeA, '13:30'), recebido_em: instante(hojeA, '13:35'),
        numero: '000003', hash_envio: 'a'.repeat(64), cliente_nome: 'Auto Peças Um', vendedor_nome: 'Vendedor Um', tabela_preco_id: A.tabelasPreco.padrao,
        condicao_pagamento_id: A.condicoes.d28, condicao_pagamento_descricao: '28 dias',
        cliente_resumo: { razao_social: 'Auto Peças Um Ltda', nome_fantasia: 'Auto Peças Um', documento: '33333333000191', endereco: null, bairro: null, cidade: 'Manaus', uf: 'AM', codigo_erp: null },
      }),
      // em nome do vendedor-2, digitado pelo supervisor (RN-VEN-35; conta para o vendedor, RN-CORE-21)
      pedido({
        id: A.pedidos.p2, tenant_id: tA, cliente_id: A.clientes.c2, vendedor_id: A.usuarios.vendedor2, autor_id: A.usuarios.supervisor,
        status: 'pending_approval', desconto_pct: 12, total_tabela_cents: 500_000, total_cents: 440_000, recebido_em: instante(ontemA, '16:00'),
        numero: '000002', nivel_aprovacao: 'gerente', motivos_aprovacao: arrayDeTexto(['desconto']), condicao_pagamento_id: A.condicoes.avista,
        condicao_pagamento_descricao: 'À vista',
      }),
      pedido({
        id: A.pedidos.p3, tenant_id: tA, cliente_id: A.clientes.c3, vendedor_id: A.usuarios.vendedor1, status: 'invoiced', total_tabela_cents: 150_000,
        total_cents: 150_000, recebido_em: instante(somarDias(hojeA, -20), '15:00'), numero_erp: 'PV1003', numero: '000001', aprovacao_automatica: true,
      }),
      pedido({
        id: B.pedidos.p1, tenant_id: tB, cliente_id: B.clientes.c1, vendedor_id: B.usuarios.vendedor, status: 'approved', total_tabela_cents: 45_000,
        total_cents: 45_000, recebido_em: instante(ontemB, '14:00'), numero: '000001', aprovacao_automatica: true,
        condicao_pagamento_id: B.condicoes.avista, condicao_pagamento_descricao: 'À vista', tabela_preco_id: B.tabelasPreco.padrao,
      }),
    ],
    'vendedor.pedido_item': [
      item(a('pedido_item', 1), tA, A.pedidos.p1, 1, a('produto', 1), 2, 100_000, 5),
      item(a('pedido_item', 2), tA, A.pedidos.p1, 2, a('produto', 2), 1, 100_000, 5),
      item(a('pedido_item', 3), tA, A.pedidos.p2, 1, a('produto', 1), 5, 100_000, 12),
      item(a('pedido_item', 4), tA, A.pedidos.p3, 1, a('produto', 2), 3, 50_000, 0),
      item(b('pedido_item', 1), tB, B.pedidos.p1, 1, b('produto', 1), 10, 4_500, 0),
    ],
  };
}

/**
 * T-0029 (0008–0009): preço (tabela, itens, tabela do cliente), condições de pagamento, contador do número e linha do
 * tempo dos pedidos. A: c1 e c2 na tabela "Padrão Alfa" (produto 2 com vigência até hoje 04:00Z), c3 sem tabela
 * (RN-CAT-06); B: c1 na "Padrão Beta". Vigências em instantes fixos da data civil (como o resto da fixture).
 */
function dadosT0029(hojeA: string, hojeB: string): Pick<DadosFixture, TabelaT0029> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const comuns = { deleted_at: null, external_id: null };
  const inicioA = instante(somarDias(hojeA, -30), '04:00');
  const evento = (id: string, tenant_id: string, pedido_id: string, de: string | null, para: string, autor_id: string, autor_nome: string, autor_perfil: string, motivo: string, ocorrido_em: string, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel: null, acima_do_nivel: false, ocorrido_em, ...comuns, ...extra,
  });
  return {
    'catalogo.tabela_preco': [
      { id: A.tabelasPreco.padrao, tenant_id: tA, codigo: 'PADRAO', nome: 'Padrão Alfa', ativo: true, ...comuns },
      { id: B.tabelasPreco.padrao, tenant_id: tB, codigo: 'PADRAO', nome: 'Padrão Beta', ativo: true, ...comuns },
    ],
    'catalogo.tabela_preco_item': [
      { id: a('tabela_preco_item', 1), tenant_id: tA, tabela_preco_id: A.tabelasPreco.padrao, produto_id: a('produto', 1), preco_cents: 100_000, vigencia_inicio: inicioA, vigencia_fim: null, ...comuns },
      { id: a('tabela_preco_item', 2), tenant_id: tA, tabela_preco_id: A.tabelasPreco.padrao, produto_id: a('produto', 2), preco_cents: 50_000, vigencia_inicio: inicioA, vigencia_fim: instante(hojeA, '04:00'), ...comuns },
      { id: b('tabela_preco_item', 1), tenant_id: tB, tabela_preco_id: B.tabelasPreco.padrao, produto_id: b('produto', 1), preco_cents: 4_500, vigencia_inicio: null, vigencia_fim: null, ...comuns },
    ],
    'catalogo.cliente_tabela_preco': [
      { id: a('cliente_tabela_preco', 1), tenant_id: tA, cliente_id: A.clientes.c1, tabela_preco_id: A.tabelasPreco.padrao, ...comuns },
      { id: a('cliente_tabela_preco', 2), tenant_id: tA, cliente_id: A.clientes.c2, tabela_preco_id: A.tabelasPreco.padrao, ...comuns },
      { id: b('cliente_tabela_preco', 1), tenant_id: tB, cliente_id: B.clientes.c1, tabela_preco_id: B.tabelasPreco.padrao, ...comuns },
    ],
    'vendedor.condicao_pagamento': [
      { id: A.condicoes.avista, tenant_id: tA, codigo: 'AVISTA', descricao: 'À vista', ativo: true, padrao: true, ...comuns },
      { id: A.condicoes.d28, tenant_id: tA, codigo: '28D', descricao: '28 dias', ativo: true, padrao: false, ...comuns },
      { id: B.condicoes.avista, tenant_id: tB, codigo: 'AVISTA', descricao: 'À vista', ativo: true, padrao: true, ...comuns },
    ],
    'vendedor.cliente_condicao': [
      { id: a('cliente_condicao', 1), tenant_id: tA, cliente_id: A.clientes.c1, condicao_pagamento_id: A.condicoes.avista, ...comuns },
      { id: a('cliente_condicao', 2), tenant_id: tA, cliente_id: A.clientes.c1, condicao_pagamento_id: A.condicoes.d28, ...comuns },
      { id: b('cliente_condicao', 1), tenant_id: tB, cliente_id: B.clientes.c1, condicao_pagamento_id: B.condicoes.avista, ...comuns },
    ],
    // contador = maior número já usado pelos pedidos da fixture (A: 000001..000003; B: 000001)
    'vendedor.numeracao_pedido': [
      { id: a('numeracao_pedido', 1), tenant_id: tA, ultimo: 3, ...comuns },
      { id: b('numeracao_pedido', 1), tenant_id: tB, ultimo: 1, ...comuns },
    ],
    'vendedor.pedido_evento': [
      evento(a('pedido_evento', 1), tA, A.pedidos.p1, null, 'received', A.usuarios.vendedor1, 'Vendedor Um', 'vendedor', 'Recebido pelo servidor', instante(hojeA, '13:35')),
      evento(a('pedido_evento', 2), tA, A.pedidos.p2, null, 'received', A.usuarios.supervisor, 'Supervisor Alfa', 'supervisor', 'Recebido pelo servidor', instante(somarDias(hojeA, -1), '16:00')),
      evento(a('pedido_evento', 3), tA, A.pedidos.p2, 'received', 'pending_approval', A.usuarios.supervisor, 'Supervisor Alfa', 'supervisor', 'Desconto de 12,0% acima da alçada de 5,0%: aguardando gerente', instante(somarDias(hojeA, -1), '16:00'), { nivel: 'gerente' }),
      evento(b('pedido_evento', 1), tB, B.pedidos.p1, null, 'received', B.usuarios.vendedor, 'Vendedor Beta', 'vendedor', 'Recebido pelo servidor', instante(somarDias(hojeB, -1), '14:00')),
      evento(b('pedido_evento', 2), tB, B.pedidos.p1, 'received', 'approved', B.usuarios.vendedor, 'Vendedor Beta', 'vendedor', 'Dentro da alçada (5,0%)', instante(somarDias(hojeB, -1), '14:00')),
    ],
  };
}

/**
 * T-0032 (0010, schema integracao): uma linha (ou mais) em cada tabela nos DOIS tenants, com instantes FIXOS (recarregar não
 * muda nada). A pendência aguardando de A expira em 2099 (continua decidível nos testes). Ids em DOIS_TENANTS.X.integracao.
 */
function dadosT0032(): Pick<DadosFixture, TabelaT0032> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const IA = A.integracao;
  const IB = B.integracao;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const comuns = { deleted_at: null, external_id: null };
  const T = (hora: string, dia = '2026-10-30') => `${dia}T${hora}Z`;
  const sha = (x: string) => createHash('sha256').update(x).digest('hex');
  const conector = (id: string, tenant_id: string, identificador: string, nome: string, entidades: readonly string[], ips: string): Linha => ({
    id, tenant_id, identificador, nome, tipo: 'conector', ativo: true, recebe_pedidos: true, entidades: arrayDeTexto(entidades), ips_permitidos: ips,
    versao_conector: '1.2.0', versao_contrato: 'v1', ultimo_sinal_em: T('12:00:00'), parado_por_versao: false, sinal_resumo: { fila_local: 0 },
    deriva_relogio_s: 0, ...comuns,
  });
  const credencial = (id: string, tenant_id: string, conector_id: string, chave: { prefixo: string; hash: string }): Linha => ({
    id, tenant_id, conector_id, prefixo: chave.prefixo, hash_chave: chave.hash, versao_pepper: 1, escopo: 'integracao.v1', papel: 'atual',
    expira_em: null, anterior_valida_ate: null, revogada_em: null, revogada_por: null, motivo_revogacao: null, ultimo_uso_em: null, ...comuns,
  });
  const sessao = (id: string, tenant_id: string, sessao_uuid: string, conector_id: string, entidade: string, inativadas: number): Linha => ({
    id, tenant_id, sessao_uuid, conector_id, entidade, iniciada_em: T('10:00:00'), ultima_parte: 1, fechada_em: T('10:05:00'), situacao: 'completa',
    inativadas, linhas_sem_identificacao: 0, invalidas_omitidas: 0, ...comuns,
  });
  const lote = (id: string, tenant_id: string, conector_id: string, entidade: string, sessao_id: string | null, extra: Partial<Linha>): Linha => ({
    id, tenant_id, conector_id, entidade, modo: sessao_id ? 'completo' : 'delta', versao_contrato: 'v1', sessao_id,
    sessao_parte: sessao_id ? 1 : null, sessao_ultimo: sessao_id ? true : null, chave_idempotencia: sha(`idem:${id}`), hash_conteudo: sha(`conteudo:${id}`),
    status: 'concluido', recebidas: 1, duplicadas_no_lote: 0, com_erro: 0, novas: 1, atualizadas: 0, inalteradas: 0, obsoletas: 0, inativadas: 0,
    invalidas_omitidas: 0, aplicado_ate_indice: 0, cursor_declarado: null, cursor_resultante: null, versao_conector: '1.2.0', bytes: 1024, avisos: null,
    tentativas: 1, ultimo_erro: null, recebido_em: T('10:01:00'), iniciado_em: T('10:01:05'), concluido_em: T('10:01:30'), ...comuns, ...extra,
  });
  const loteRecebido = { status: 'recebido', novas: 0, aplicado_ate_indice: null, tentativas: 0, recebido_em: T('12:00:00'), iniciado_em: null, concluido_em: null };
  const registro = (id: string, tenant_id: string, entidade: string, conector_id: string, externalId: string, lote_id: string, sessao_id: string, inativado: boolean): Linha => ({
    id, tenant_id, entidade, conector_id, hash: inativado ? null : sha(`registro:${id}`), payload: { external_id: externalId, nome: `Registro ${externalId}` },
    valor_controle: 0, alterado_em: '2026-10-30T09:00:00.123Z', ativo: true, lote_id, sessao_id, visto_em: T('10:01:30'), aplicado_em: T('10:01:30'),
    deleted_at: inativado ? T('10:30:00') : null, external_id: externalId,
  });
  interface Decisao { estado: string; por: string | null; perfil: string | null; motivo: string | null }
  const pendencia = (id: string, tenant_id: string, sessao_id: string, entidade: string, conector_id: string, lote_id: string, d: Decisao, expira_em: string): Linha => ({
    id, tenant_id, sessao_id, entidade, conector_id, lote_id, estado: d.estado, candidatos: 1, total_ativos: 2, percentual: '50.00', limite_pct: '30.00',
    amostra: [`${entidade.slice(0, 3).toUpperCase()}-2`], expira_em, decidida_em: d.por ? T('10:30:00') : null, decidida_por: d.por,
    decidida_por_perfil: d.perfil, motivo_decisao: d.motivo, ...comuns,
  });
  const auditoria = (id: string, tenant_id: string, p: Linha, acao: 'confirmar' | 'recusar', inativadas: number | null): Linha => ({
    id, tenant_id, pendencia_id: p.id, sessao_id: p.sessao_id, lote_id: p.lote_id, entidade: p.entidade, conector_id: p.conector_id, acao,
    decidida_por: p.decidida_por, perfil: p.decidida_por_perfil, decidida_em: p.decidida_em, quantidade: p.candidatos, total_ativos: p.total_ativos,
    percentual: p.percentual, motivo: p.motivo_decisao, inativadas, ...comuns,
  });
  const fila = (id: string, tenant_id: string, pedido_uuid: string, conector_id: string, estado: string, numero_erp: string, nota: string, total: number): Linha => ({
    id, tenant_id, pedido_uuid, estado, payload: { versao_contrato: 'v1', pedido_uuid }, payload_origem: { pedido_uuid }, retencao_codigo: null,
    retencao_mensagem: null, conector_id, enviado_em: T('11:00:00'), tentativas: 1, numero_erp, motivo: null, nota_numero: nota, nota_serie: '1',
    nota_emitida_em: T('11:30:00'), nota_total_cents: total, notas_aplicadas: [{ numero: nota, serie: '1' }],
    itens_faturados_acumulados: { '1': { quantidade: 2, valor_cents: total } }, ultimo_retorno_em: T('11:30:00'), aprovado_em: T('10:50:00'), ...comuns,
  });
  const retorno = (id: string, tenant_id: string, f: Linha): Linha => ({
    id, tenant_id, pedido_uuid: f.pedido_uuid, status: f.estado, numero_erp: f.numero_erp, motivo: null, nota_numero: f.nota_numero, nota_serie: '1',
    nota_emitida_em: f.nota_emitida_em, nota_total_cents: f.nota_total_cents, itens_faturados: [{ sequencia: 1, quantidade: 2 }], ocorrido_em: T('11:30:00'),
    conector_id: f.conector_id, ...comuns,
  });
  const descartado = (id: string, tenant_id: string, r: Linha, codigo: string, campo: string, motivo: string): Linha => ({
    id, tenant_id, pedido_uuid: r.pedido_uuid, pedido_retorno_id: r.id, status: r.status, numero_erp: r.numero_erp, nota_numero: r.nota_numero, nota_serie: '1',
    ocorrido_em: r.ocorrido_em, indice: 1, sequencia: 9, produto_external_id: 'PRD-9', quantidade: 1, codigo, codigos: arrayDeTexto([codigo]), campo, motivo,
    conector_id: r.conector_id, resolvido_em: null, ...comuns,
  });

  const expira = T('10:05:00', '2026-11-06');
  const pendA1 = pendencia(IA.pendencias.confirmada, tA, IA.sessoes.produto, 'produto', IA.conector, IA.lotes.completoProduto, { estado: 'confirmada', por: A.usuarios.analista, perfil: 'analista', motivo: 'Produto descontinuado no ERP.' }, expira);
  const pendA2 = pendencia(IA.pendencias.aguardando, tA, IA.sessoes.cliente, 'cliente', IA.conector, IA.lotes.completoCliente, { estado: 'aguardando', por: null, perfil: null, motivo: null }, '2099-12-31T00:00:00Z');
  const pendB1 = pendencia(IB.pendencias.recusada, tB, IB.sessoes.cliente, 'cliente', IB.conector, IB.lotes.completoCliente, { estado: 'recusada', por: B.usuarios.admin, perfil: 'admin', motivo: 'Carga parcial do ERP; aguardar a próxima.' }, expira);
  const filaA = fila(IA.fila.p3, tA, A.pedidos.p3, IA.conector, 'faturado_parcial', 'PV1003', '1001', 100_000);
  const filaB = fila(IB.fila.p1, tB, B.pedidos.p1, IB.conector, 'faturado_total', 'PVB0001', '2001', 45_000);
  const retA = retorno(IA.retornos.p3, tA, filaA);
  const retB = retorno(IB.retornos.p1, tB, filaB);
  return {
    'integracao.conector': [
      conector(IA.conector, tA, IA.identificador, 'ERP Alfa', ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'], '{}'),
      conector(IB.conector, tB, IB.identificador, 'ERP Beta', ['cliente', 'produto'], '{203.0.113.0/24}'),
    ],
    'integracao.credencial': [credencial(IA.credencial, tA, IA.conector, IA.chave), credencial(IB.credencial, tB, IB.conector, IB.chave)],
    'integracao.politica_versao': [
      { id: a('politica_versao', 1), tenant_id: tA, versao_minima: '1.1.0', versao_recomendada: '1.2.0', mensagem: 'Atualize o Conector para a 1.2.0.', pacote: null, ...comuns },
      { id: b('politica_versao', 1), tenant_id: tB, versao_minima: '1.0.0', versao_recomendada: '1.2.0', mensagem: null, pacote: null, ...comuns },
    ],
    'integracao.sessao_carga': [
      sessao(IA.sessoes.produto, tA, IA.sessaoUuids.produto, IA.conector, 'produto', 1),
      sessao(IA.sessoes.cliente, tA, IA.sessaoUuids.cliente, IA.conector, 'cliente', 0),
      sessao(IB.sessoes.cliente, tB, IB.sessaoUuids.cliente, IB.conector, 'cliente', 0),
    ],
    'integracao.sessao_carga_recebido': [
      { id: a('sessao_carga_recebido', 1), tenant_id: tA, sessao_id: IA.sessoes.produto, deleted_at: null, external_id: 'PRD-INVALIDO-9' },
      { id: b('sessao_carga_recebido', 1), tenant_id: tB, sessao_id: IB.sessoes.cliente, deleted_at: null, external_id: 'CLI-INVALIDO-9' },
    ],
    'integracao.lote': [
      lote(IA.lotes.completoProduto, tA, IA.conector, 'produto', IA.sessoes.produto, {
        status: 'concluido_com_erros', recebidas: 3, com_erro: 1, novas: 2, inativadas: 1, aplicado_ate_indice: 2,
        cursor_resultante: { alterado_em: '2026-10-30T09:00:00.123Z', external_id: 'PRD-1' },
      }),
      lote(IA.lotes.delta, tA, IA.conector, 'produto', null, loteRecebido),
      lote(IA.lotes.completoCliente, tA, IA.conector, 'cliente', IA.sessoes.cliente, {}),
      lote(IB.lotes.completoCliente, tB, IB.conector, 'cliente', IB.sessoes.cliente, {}),
      lote(IB.lotes.delta, tB, IB.conector, 'cliente', null, loteRecebido),
    ],
    'integracao.lote_staging': [
      { id: a('lote_staging', 1), tenant_id: tA, lote_id: IA.lotes.delta, corpo: { registros: [{ external_id: 'PRD-3', nome: 'Produto Três' }], linhas_invalidas: [] }, ...comuns },
      { id: b('lote_staging', 1), tenant_id: tB, lote_id: IB.lotes.delta, corpo: { registros: [{ external_id: 'CLI-3', razao_social: 'Cliente Três' }], linhas_invalidas: [] }, ...comuns },
    ],
    'integracao.lote_linha_erro': [
      {
        id: a('lote_linha_erro', 1), tenant_id: tA, lote_id: IA.lotes.completoProduto, indice: 2, origem: 'hub', codigo: 'campo_obrigatorio', campo: 'nome',
        mensagem: 'Informe o nome do produto.', reprocessavel: false, payload: { external_id: 'PRD-INVALIDO-9' }, resolvido_em: null, resolvido_no_lote_id: null,
        deleted_at: null, external_id: 'PRD-INVALIDO-9',
      },
      {
        id: b('lote_linha_erro', 1), tenant_id: tB, lote_id: IB.lotes.completoCliente, indice: 0, origem: 'conector', codigo: 'formato_invalido', campo: 'cep',
        mensagem: 'CEP com formato inválido no ERP.', reprocessavel: false, payload: null, resolvido_em: null, resolvido_no_lote_id: null,
        deleted_at: null, external_id: 'CLI-INVALIDO-9',
      },
    ],
    'integracao.registro_atual': [
      registro(a('registro_atual', 1), tA, 'produto', IA.conector, 'PRD-1', IA.lotes.completoProduto, IA.sessoes.produto, false),
      registro(a('registro_atual', 2), tA, 'produto', IA.conector, 'PRD-2', IA.lotes.completoProduto, IA.sessoes.produto, true),
      registro(b('registro_atual', 1), tB, 'cliente', IB.conector, 'CLI-1', IB.lotes.completoCliente, IB.sessoes.cliente, false),
    ],
    'integracao.pendencia_inativacao': [pendA1, pendA2, pendB1],
    'integracao.inativacao_auditoria': [auditoria(a('inativacao_auditoria', 1), tA, pendA1, 'confirmar', 1), auditoria(b('inativacao_auditoria', 1), tB, pendB1, 'recusar', null)],
    'integracao.cursor_entidade': [
      { id: a('cursor_entidade', 1), tenant_id: tA, conector_id: IA.conector, entidade: 'produto', cursor_alterado_em: '2026-10-30T09:00:00.123Z', cursor_external_id: 'PRD-1', atualizado_em: T('10:01:30'), ...comuns },
      { id: b('cursor_entidade', 1), tenant_id: tB, conector_id: IB.conector, entidade: 'cliente', cursor_alterado_em: '2026-10-30T09:00:00.123Z', cursor_external_id: 'CLI-1', atualizado_em: T('10:01:30'), ...comuns },
    ],
    'integracao.reconciliacao': [
      {
        id: a('reconciliacao', 1), tenant_id: tA, conector_id: IA.conector, entidade: 'produto', data_referencia: '2026-10-30', contagem_erp: 2, soma_erp: null,
        contagem_macuxi: 1, soma_macuxi: null, diferenca_contagem: 1, diferenca_soma: null, diferenca_pct: null, divergente: true,
        motivos: arrayDeTexto(['contagem_divergente']), situacao: 'comparada', evento_publicado: true, calculada_em: T('23:00:00'), ...comuns,
      },
      {
        id: b('reconciliacao', 1), tenant_id: tB, conector_id: IB.conector, entidade: 'cliente', data_referencia: '2026-10-30', contagem_erp: 1, soma_erp: null,
        contagem_macuxi: 1, soma_macuxi: null, diferenca_contagem: 0, diferenca_soma: null, diferenca_pct: null, divergente: false,
        motivos: arrayDeTexto([]), situacao: 'comparada', evento_publicado: false, calculada_em: T('23:00:00'), ...comuns,
      },
    ],
    'integracao.mapeamento': [
      { id: a('mapeamento', 1), tenant_id: tA, tipo: 'condicao_pagamento', codigo_erp: '001', codigo_macuxi: 'AVISTA', descricao: 'À vista', ativo: true, ...comuns },
      { id: a('mapeamento', 2), tenant_id: tA, tipo: 'condicao_pagamento', codigo_erp: '028', codigo_macuxi: '28D', descricao: '28 dias', ativo: true, ...comuns },
      { id: b('mapeamento', 1), tenant_id: tB, tipo: 'condicao_pagamento', codigo_erp: 'AV', codigo_macuxi: 'AVISTA', descricao: 'À vista', ativo: true, ...comuns },
    ],
    'integracao.pedido_fila_erp': [filaA, filaB],
    'integracao.pedido_retorno': [retA, retB],
    'integracao.pedido_retorno_erro': [
      descartado(a('pedido_retorno_erro', 1), tA, retA, 'sequencia_inexistente', 'itens_faturados[1].sequencia', 'A sequência 9 não existe no pedido enviado ao ERP. Confira a consulta de itens da nota no Conector.'),
      descartado(b('pedido_retorno_erro', 1), tB, retB, 'produto_divergente', 'itens_faturados[1].produto_external_id', 'O produto "PRD-9" da sequência 9 não é o que foi enviado ao ERP.'),
    ],
  };
}

function cliente(id: string, tenant_id: string, documento: string, nome: string, cidade: string, uf: string, coord: readonly [number, number] | null): Linha {
  return {
    id, tenant_id, documento, razao_social: `${nome} Ltda`, nome_fantasia: nome, segmento: 'Linha leve', telefone: null, email: null,
    logradouro: null, numero: null, bairro: null, cidade, uf, cep: null, latitude: coord?.[0] ?? null, longitude: coord?.[1] ?? null,
    ativo: true, external_id: null,
  };
}

function sessao(id: string, tenant_id: string, usuario_id: string, familia_id: string, token_hash: string, dispositivo_id: string): Linha {
  return { id, tenant_id, usuario_id, familia_id, token_hash, dispositivo_id, expira_em: VALIDADE_FIXA_REFRESH, usado_em: null, revogado_em: null, external_id: null };
}

function evento(id: string, tenant_id: string, usuarioId: string): Linha {
  return {
    id, tenant_id, nome: 'core.usuario.modulos_alterados@1', modulo: 'core', agregado_id: usuarioId,
    payload: { usuario_id: usuarioId, fixture: true }, publicado_em: null, tentativas: 0, ultimo_erro: null,
    usuario_id: usuarioId, request_id: 'fixture', external_id: null,
  };
}

function auditoria(id: string, tenant_id: string, autor: string, alvo: string): Linha {
  return {
    id, tenant_id, usuario_id: autor, modulo: 'core', acao: 'licenca.alterar', entidade: 'usuario_modulo', entidade_id: alvo,
    antes: { modulos: ['core', 'vendedor', 'teste'] }, depois: { modulos: ['core', 'vendedor'] }, request_id: 'fixture', external_id: null,
  };
}

/**
 * Carrega a fixture com um cliente ADMIN (o papel de aplicação não pode criar tenant). Idempotente.
 * Roda numa transação: ou entra tudo, ou nada.
 */
export async function carregarDoisTenants(admin: ClientBase, opcoes: { senha?: string } & OpcoesDadosFixture = {}): Promise<DadosFixture> {
  const senha = opcoes.senha ?? process.env.MACUXI_SENHA_TESTE ?? 'Teste@1234';
  const dados = dadosDoisTenants(hashSenha(senha), { hoje: opcoes.hoje, agora: opcoes.agora });
  await admin.query('begin');
  try {
    for (const tabela of ORDEM_TABELAS) {
      const linhas = tabela === 'core.equipe' ? dados[tabela].map((e) => ({ ...e, responsavel_id: null })) : dados[tabela];
      const preservar = tabela === 'core.usuario' ? ['senha_hash'] : tabela === 'vendedor.numeracao_pedido' ? ['ultimo'] : [];
      await gravarLinhas(admin, tabela, linhas, { preservar });
      if (tabela === 'core.usuario') await gravarLinhas(admin, 'core.equipe', dados['core.equipe']);
    }
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
  return dados;
}
