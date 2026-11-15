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
 *   mapeamento, fila do ERP (p3 de A, p1 de B) com retorno e item descartado. Instantes operacionais relativos ao "hoje" da carga (dia de operação = hoje − 2; T-0042). Os módulos dos
 *   tenants NÃO mudaram (a licença 'integracao' não está na fixture).
 * - T-0071 (0020): relacionados do produto (catalogo.produto_relacao, grupo 0x4e) em A (ativa, inativa e apagada) e em B;
 *   os pedidos da fixture seguem com ajuste em % (colunas de R$ no padrão 0/0/'pct').
 * - T-0084/T-0085 (0033): aplicação no conteúdo de A ("Motos 150 cc") e de B (diferente, para o isolamento), etiquetas em A,
 *   aplicação e referências no documento de busca do servidor, retrato da aplicação no item 1 do p1 de A e referências
 *   cruzadas (catalogo.produto_referencia, grupo 0x4f): A com 2 vivas no p1 (marca = o concorrente do Promotor de A, sem
 *   FK) e 1 apagada na mesma ordem; B com 1 de código diferente (marca = o concorrente do Promotor de B). 0034: as vivas
 *   levam marca_nome (MARCA_NOME_FIXTURE, retrato do nome do concorrente); a apagada fica nula (linha anterior à 0034).
 * - T-0113 (0045, ADR 0034): catalogo.marca_concorrente (grupo 0x3c; MARCAS_FIXTURE) — por tenant a ativa com o MESMO id e
 *   nome do concorrente do Promotor (a cópia da migração; promotor.concorrente segue na fixture, só de leitura), uma inativa
 *   (com external_id) e uma apagada; as referências cruzadas apontam para a ativa (FK produto_referencia_marca_fk).
 * - T-0054 (0050, RN-VEN-37): vendedor.pedido_devolucao (grupo 0x3d; DEVOLUCOES_FIXTURE) — A com devolução parcial viva no
 *   p3 (R$ 200,00) e a mesma nota apagada; B com uma viva no p1 (mesma chave de nota: o único é por tenant).
 * - T-0087 (0036): convites de 1º acesso (core.usuario_convite, grupo 0x08; CONVITES_FIXTURE): A pendente + revogado do
 *   vendedor-2 e usado do promotor; B pendente do vendedor-B, gerado por um super-admin (id sem FK).
 * - T-0094 (0040): usuários com senha definitiva (trocar_senha falso, sem temporária); outbox de e-mail
 *   (plataforma.email_saida, grupo 0x09; EMAILS_FIXTURE) só com linhas despachadas, sem carga.
 * - T-0089 (0037; PAGAMENTO_FIXTURE): o gatilho tenant_semear_pagamento cria em A e em B a forma "À vista" (AVISTA) com o
 *   prazo "À vista" [0] (fora das listas, como os motivos e as medidas; ids em PAGAMENTO_FIXTURE.X.semeada). Nas listas
 *   (grupos 0x37 e 0x3a): A com as formas PIX (prazo PIX-AV [0]) e BOLETO (external_id FP-BOL; prazos BOL-28-56 [28,56]
 *   médio 42 com external_id PZ-2856, BOL-30-60-90 [30,60,90] médio 60 e BOL-28 INATIVO) e B com DINHEIRO (DIN-AV [0]); c1
 *   de A com prazo médio máximo 45 e só PIX e BOLETO; c1 de B com prazo médio máximo 30 e todas as formas (nulo); os demais
 *   clientes sem nada (nulo). Tabela escalonada (grupo 0x3b): A no p1 com 10 PC a R$ 950,00 (todas as tabelas), 2 CX a
 *   R$ 900,00 por PC (só a Padrão Alfa) e uma vencida ontem (5 PC); B no p1 com 12 UN a R$ 42,00 (aberta). Nenhum pedido da
 *   fixture leva forma e prazo (como os do APK antigo; o teste da 0037 grava um em transação desfeita).
 * - T-0149 (0056, RN-CORE-39; FILIAIS_FIXTURE): o gatilho tenant_semear_filial cria a padrão '0001' em A e em B (fora das
 *   listas, id idFilialPadrao); nas listas (grupo 0x0a) A tem a '0002' Boa Vista/RR e B a '0002' Campinas/SP, as duas SEM
 *   cliente (todo cliente da fixture fica na padrão: estoque e preço de hoje não mudam). Depósitos, itens de preço e faixas da
 *   fixture não informam a filial: o gatilho grava a padrão (a regra "ausente = padrão" do Hub). Os testes que precisam de
 *   cliente, depósito ou preço na 0002 gravam em transação desfeita.
 * - T-0147 (0057, RN-CORE-38; FOTOS_PDV_FIXTURE): o gatilho tenant_semear_foto_tipo cria a "Fachada" (obrigatória) em A e em B
 *   (fora das listas, id idFotoTipoFachada); nas listas (grupo 0x0b) A tem "CNH do sócio" (sensível, obrigatória) e B
 *   "Contrato social" (sensível). Fotos (grupo 0x0c): A com a fachada e a CNH de c1 (arquivo da CNH com perfis_leitura
 *   admin/analista/gerente/supervisor = PERFIS_DOC_SENSIVEL do Core, ADR 0041), B com a fachada de c1. Os arquivos (grupo 0x2c, seq 11+) ficam 'recebido'.
 * - T-0158 (0058, ADR 0043; DIAGNOSTICOS_FIXTURE, grupo 0x0d): diagnósticos do aparelho com o alerta já resolvido — A com 1 do
 *   botão (vendedor-1, enviado) e 1 queda (promotor, desligado), B com 1 erro de tela (vendedor-B, enviado). Sem print; o
 *   protocolo vem da sequência global (a fixture não grava a coluna).
 * - T-0170 (0064–0066; T0170_FIXTURE, grupos 0x61–0x66): tarefa (A: do gerente para o vendedor-2, aberta, prazo hoje+7; B:
 *   do admin para o vendedor-B) com 1 destinatário em cada; frase do dia própria (além das 30 padrão do gatilho
 *   tenant_semear_frase_dia, fora das listas); avatar vivo (A: supervisor 'm2'; B: admin 'iniciais'); meta de produtividade
 *   (A: equipe-2 visitas_dia 12 desde 2026-01; B: tenant km_dia 150 km desde 2026-01); resumo de km de ontem (A: promotor;
 *   B: vendedor-B). Fora dos usuários e das vigências que os testes t0170-*.db.test.ts usam (analista, assistente,
 *   vendedor-1 nas metas e no km, 2030-01, 2031-12, 2032-01).
 * - 0070 (ADR 0054; SYNC_PACOTE_FIXTURE, grupos 0x67 e 0x68): pacotes da primeira carga — A com o 'catalogo' · 'tenant'
 *   pronto, o 'catalogo' · 'filial:<padrão>' pronto e um 'catalogo' · 'tenant' substituído; B com o 'core' · 'tenant' pronto.
 *   Pedidos de geração já atendidos (A: lote; B: manifesto): nenhum pendente (o teste grava o seu em transação desfeita).
 */
import { createHash, createHmac } from 'node:crypto';
import type { ClientBase } from 'pg';
import { arrayDeInteiros, arrayDeTexto, arrayDeTextoLivre, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeChave, idFilialPadrao, idFixo, idFotoTipoFachada, idMedida, idMotivoPadrao, idPerfilFabrica, idUsuarioPerfil } from '../../src/ids';
import { anoMes, hojeNoFuso, instante, menorData, somarDias } from '../../src/datas';
import { hashSenha } from '../../src/senha';
import { PERFIS_DOC_SENSIVEL } from '../../../modules/core/domain/fotos-pdv';
import { dadosGestor, ORDEM_GESTOR } from './gestor';
import { dadosPromotorFixture, ORDEM_PROMOTOR, PROMOTOR_FIXTURE } from './promotor';
import { dadosPesquisaFixture, ORDEM_PESQUISA } from './pesquisa';

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
  // 0013 (catálogo, vendedor e core)
  produto_unidade: 0x2d,
  cliente_endereco: 0x2e,
  transportadora: 0x36,
  pedido_faturamento: 0x38,
  uso_ia: 0x43,
  catalogo_no: 0x44,
  produto_no: 0x45,
  produto_conteudo: 0x46,
  produto_atributo: 0x47,
  produto_midia: 0x48,
  sinonimo: 0x49,
  produto_busca: 0x4a,
  deposito: 0x4b,
  estoque_saldo: 0x4c,
  busca_log: 0x4d,
  // 0019 (T-0066)
  nota_erp: 0x2f,
  // 0020 (T-0071)
  produto_relacao: 0x4e,
  // 0033 (T-0085)
  produto_referencia: 0x4f,
  // 0028 (T-0082)
  plano_rv: 0x39,
  // 0036 (T-0087)
  usuario_convite: 0x08,
  // 0040 (T-0094)
  email_saida: 0x09,
  // 0041 (T-0111/T-0112, ADR 0033): perfis de acesso
  perfil: 0x17,
  perfil_permissao: 0x18,
  usuario_perfil: 0x19,
  // 0037 (T-0089)
  forma_pagamento: 0x37,
  prazo_pagamento: 0x3a,
  tabela_escalonada: 0x3b,
  // 0045 (T-0113, ADR 0034): marcas concorrentes no Catálogo (a ativa de cada tenant tem o id do concorrente do Promotor)
  marca_concorrente: 0x3c,
  // 0050 (T-0054, RN-VEN-37): devolução do pedido
  pedido_devolucao: 0x3d,
  // 0056 (T-0149, RN-CORE-39): filial (a padrão vem do gatilho tenant_semear_filial, id idFilialPadrao)
  filial: 0x0a,
  // 0057 (T-0147, RN-CORE-38): tipos e fotos do PDV (a "Fachada" vem do gatilho tenant_semear_foto_tipo, id idFotoTipoFachada)
  foto_tipo: 0x0b,
  cliente_foto: 0x0c,
  // 0058 (T-0158, ADR 0043): diagnóstico do aparelho (protocolo da sequência global; nunca fixo na fixture)
  diagnostico: 0x0d,
  // 0064–0066 (T-0170): tarefas, frase do dia, avatar, metas de produtividade e resumo do km
  tarefa: 0x61,
  tarefa_destinatario: 0x62,
  frase_dia: 0x63,
  usuario_avatar: 0x64,
  meta_produtividade: 0x65,
  deslocamento_dia: 0x66,
  // 0070 (ADR 0054): pacote da primeira carga e pedido de geração
  sync_pacote: 0x67,
  sync_pacote_pedido: 0x68,
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
 * 0036 (T-0087, RN-CORE-31): convites de 1º acesso. Token `<tenant_id>.<segredo>` (como o refresh; segredo fixo só de teste,
 * 43 caracteres base64url); o banco guarda só o sha256 hex do segredo. A: 1 PENDENTE do vendedor-2 (válido até 2099; o token
 * entregue é CONVITES_FIXTURE.A.pendente.token), 1 REVOGADO do vendedor-2 (renovado) e 1 USADO do promotor; B: 1 PENDENTE do
 * vendedor-B. Os usuários da fixture já têm senha: aceitar o pendente troca a senha (teste em transação desfeita).
 */
export const CONVITES_FIXTURE = {
  A: {
    pendente: { id: a('usuario_convite', 1), ...refreshFixture(a('tenant', 1), 'fixtureConviteAlfaPendenteSomenteTesteT0087a') },
    revogado: { id: a('usuario_convite', 2), ...refreshFixture(a('tenant', 1), 'fixtureConviteAlfaRevogadoSomenteTesteT0087a') },
    usado: { id: a('usuario_convite', 3), ...refreshFixture(a('tenant', 1), 'fixtureConviteAlfaUsadoPromotorSomenteT0087a') },
  },
  B: {
    pendente: { id: b('usuario_convite', 1), ...refreshFixture(b('tenant', 1), 'fixtureConviteBetaPendenteSomenteTesteT0087b') },
  },
} as const;

/**
 * 0040 (T-0094, ADR 0032): outbox de e-mail. Só linhas JÁ DESPACHADAS (carga nula; um despachante de teste não acha nada
 * pendente): A com 1 enviada ao vendedor-1 ("Seu acesso ao Macuxi") e 1 que falhou ao vendedor-2 ("Sua nova senha"); B com 1
 * enviada ao vendedor-B. Os testes que precisam de pendente gravam a sua em transação desfeita.
 */
export const EMAILS_FIXTURE = {
  A: { enviado: a('email_saida', 1), falhou: a('email_saida', 2) },
  B: { enviado: b('email_saida', 1) },
} as const;

/**
 * 0037 (T-0089, RN-VEN-23/24/25): formas, prazos e faixas da fixture. `semeada` = a forma e o prazo "À vista" que o gatilho
 * tenant_semear_pagamento cria em todo tenant (ids determinísticos, iguais aos da função vendedor.semear_pagamento).
 */
export const PAGAMENTO_FIXTURE = {
  A: {
    semeada: { forma: idDeChave(`${a('tenant', 1)}:vendedor.forma_pagamento:AVISTA`), prazo: idDeChave(`${a('tenant', 1)}:vendedor.prazo_pagamento:AVISTA`) },
    formas: { pix: a('forma_pagamento', 1), boleto: a('forma_pagamento', 2) },
    prazos: { pixAvista: a('prazo_pagamento', 1), bol2856: a('prazo_pagamento', 2), bol306090: a('prazo_pagamento', 3), bol28Inativo: a('prazo_pagamento', 4) },
    faixas: { un10: a('tabela_escalonada', 1), cx2: a('tabela_escalonada', 2), vencida: a('tabela_escalonada', 3) },
  },
  B: {
    semeada: { forma: idDeChave(`${b('tenant', 1)}:vendedor.forma_pagamento:AVISTA`), prazo: idDeChave(`${b('tenant', 1)}:vendedor.prazo_pagamento:AVISTA`) },
    formas: { dinheiro: b('forma_pagamento', 1) },
    prazos: { dinAvista: b('prazo_pagamento', 1) },
    faixas: { un12: b('tabela_escalonada', 1) },
  },
} as const;

function dadosPagamento(hojeA: string, hojeB: string): Pick<DadosFixture, 'vendedor.forma_pagamento' | 'vendedor.prazo_pagamento' | 'catalogo.tabela_escalonada'> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const PA = PAGAMENTO_FIXTURE.A;
  const PB = PAGAMENTO_FIXTURE.B;
  const forma = (id: string, tenant_id: string, codigo: string, nome: string, ordem: number, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, codigo, nome, ativo: true, ordem, deleted_at: null, external_id: null, ...extra,
  });
  const prazo = (id: string, tenant_id: string, forma_pagamento_id: string, codigo: string, descricao: string, parcelas: number[], medio: number, ordem: number, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, forma_pagamento_id, codigo, descricao, parcelas_dias: arrayDeInteiros(parcelas), prazo_medio_dias: medio, ativo: true, ordem,
    deleted_at: null, external_id: null, ...extra,
  });
  const faixa = (id: string, tenant_id: string, produto_id: string, medida: string | null, quantidade_minima: number, preco_unidade_cents: number, inicio: string, fim: string | null, tabela_preco_id: string | null): Linha => ({
    id, tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio: inicio, vigencia_fim: fim, tabela_preco_id, ativo: true,
    deleted_at: null, external_id: null,
  });
  return {
    'vendedor.forma_pagamento': [
      forma(PA.formas.pix, A.tenantId, 'PIX', 'Pix', 1),
      forma(PA.formas.boleto, A.tenantId, 'BOLETO', 'Boleto', 2, { external_id: 'FP-BOL' }),
      forma(PB.formas.dinheiro, B.tenantId, 'DINHEIRO', 'Dinheiro', 1),
    ],
    'vendedor.prazo_pagamento': [
      prazo(PA.prazos.pixAvista, A.tenantId, PA.formas.pix, 'PIX-AV', 'À vista', [0], 0, 1),
      prazo(PA.prazos.bol2856, A.tenantId, PA.formas.boleto, 'BOL-28-56', '28/56 dias', [28, 56], 42, 2, { external_id: 'PZ-2856' }),
      prazo(PA.prazos.bol306090, A.tenantId, PA.formas.boleto, 'BOL-30-60-90', '30/60/90 dias', [30, 60, 90], 60, 3),
      prazo(PA.prazos.bol28Inativo, A.tenantId, PA.formas.boleto, 'BOL-28', '28 dias', [28], 28, 1, { ativo: false }),
      prazo(PB.prazos.dinAvista, B.tenantId, PB.formas.dinheiro, 'DIN-AV', 'À vista', [0], 0, 1),
    ],
    // datas civis relativas ao "hoje" de cada tenant (vigência fechada nas duas pontas)
    'catalogo.tabela_escalonada': [
      faixa(PA.faixas.un10, A.tenantId, A.produtos.p1, null, 10, 95_000, somarDias(hojeA, -30), null, null),
      faixa(PA.faixas.cx2, A.tenantId, A.produtos.p1, 'CX', 2, 90_000, somarDias(hojeA, -30), null, A.tabelasPreco.padrao),
      faixa(PA.faixas.vencida, A.tenantId, A.produtos.p1, null, 5, 97_000, somarDias(hojeA, -60), somarDias(hojeA, -1), null),
      faixa(PB.faixas.un12, B.tenantId, b('produto', 1), null, 12, 4_200, somarDias(hojeB, -30), null, null),
    ],
  };
}

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
/**
 * 0056 (T-0149, RN-CORE-39): filiais. A padrão ('0001', 'Filial padrão', cidade/UF nulas) vem do gatilho tenant_semear_filial
 * (id idFilialPadrao, fora das listas); a '0002' de cada tenant está nas listas, sem cliente.
 */
export const FILIAIS_FIXTURE = {
  A: { padrao: idFilialPadrao(a('tenant', 1)), boaVista: a('filial', 1) },
  B: { padrao: idFilialPadrao(b('tenant', 1)), campinas: b('filial', 1) },
} as const;

/**
 * 0057 (T-0147, RN-CORE-38): tipos e fotos do PDV. A "Fachada" vem do gatilho tenant_semear_foto_tipo (id idFotoTipoFachada);
 * A: CNH do sócio (sensível, obrigatória), fachada e CNH de c1 (arquivo da CNH restrito a admin/analista/supervisor);
 * B: Contrato social (sensível), fachada de c1.
 */
export const FOTOS_PDV_FIXTURE = {
  A: {
    tipos: { fachada: idFotoTipoFachada(a('tenant', 1)), cnh: a('foto_tipo', 1) },
    fotos: { c1Fachada: a('cliente_foto', 1), c1Cnh: a('cliente_foto', 2) },
    arquivos: { c1Fachada: a('arquivo', 11), c1Cnh: a('arquivo', 12) },
  },
  B: {
    tipos: { fachada: idFotoTipoFachada(b('tenant', 1)), contrato: b('foto_tipo', 1) },
    fotos: { c1Fachada: b('cliente_foto', 1) },
    arquivos: { c1Fachada: b('arquivo', 11) },
  },
} as const;

/**
 * 0058 (T-0158, ADR 0043): diagnósticos do aparelho, todos com o alerta já resolvido (um worker de teste não acha pendente):
 * A com 1 do botão do vendedor-1 (enviado, recado R-20261031-120000-diagnostico) e 1 queda do promotor (desligado, sem token);
 * B com 1 erro de tela do vendedor-B (enviado). Sem print. O protocolo vem da sequência (a fixture não grava a coluna).
 * Os testes que precisam de pendente ou de print gravam o seu em transação desfeita.
 */
export const DIAGNOSTICOS_FIXTURE = {
  A: { botao: a('diagnostico', 1), queda: a('diagnostico', 2) },
  B: { erroTela: b('diagnostico', 1) },
} as const;

/**
 * 0070 (ADR 0054): pacotes da primeira carga e pedidos de geração (ver o cabeçalho). geracao_base fixa (a do tenant é aleatória
 * na fixture; o gerador grava a do tenant). Nenhum pedido pendente.
 */
export const SYNC_PACOTE_FIXTURE = {
  A: { catalogo: a('sync_pacote', 1), filialPadrao: a('sync_pacote', 2), substituido: a('sync_pacote', 3), pedido: a('sync_pacote_pedido', 1) },
  B: { core: b('sync_pacote', 1), pedido: b('sync_pacote_pedido', 1) },
} as const;

/** 0064–0066 (T-0170): uma linha de cada tabela nova em A e em B (ver o cabeçalho). */
export const T0170_FIXTURE = {
  A: {
    tarefa: a('tarefa', 1),
    destinatario: a('tarefa_destinatario', 1),
    frase: a('frase_dia', 1),
    avatar: a('usuario_avatar', 1),
    meta: a('meta_produtividade', 1),
    deslocamento: a('deslocamento_dia', 1),
  },
  B: {
    tarefa: b('tarefa', 1),
    destinatario: b('tarefa_destinatario', 1),
    frase: b('frase_dia', 1),
    avatar: b('usuario_avatar', 1),
    meta: b('meta_produtividade', 1),
    deslocamento: b('deslocamento_dia', 1),
  },
} as const;

/** 0057 (ADR 0041): quem abre documento sensível do PDV = PERFIS_DOC_SENSIVEL do Core (fonte única; o gerente entrou em R-20261110-084206). */
export const PERFIS_LEITURA_DOC_SENSIVEL = PERFIS_DOC_SENSIVEL;

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
    /**
     * 0041 (T-0111/T-0112, ADR 0033): perfil PERSONALIZADO vendedor_externo (base vendedor, escopo de dados 'proprio' por
     * sobreposição, módulos core, vendedor e catalogo; cargo vendedor), SEM usuário. Os 7 de fábrica vêm do gatilho tenant_semear_perfis
     * (idPerfilFabrica). Desde a 0069 (um perfil por usuário) a fixture não tem multiperfil: cada usuário fica só com o de
     * fábrica do principal (gatilho usuario_perfil_principal); o vínculo vendedor-2 + vendedor_externo saiu.
     */
    perfis: { vendedorExterno: a('perfil', 1) },
    sobreposicoes: { vendedorExternoEscopo: a('perfil_permissao', 1) },
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
    /** 0018 (T-0063): produtos de A (unidade PC; p1 com a unidade de venda CX c/ 10) e a medida própria PC. */
    produtos: { p1: a('produto', 1), p2: a('produto', 2) },
    medidas: { pc: idMedida(a('tenant', 1), 'PC') },
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
    /**
     * 0041 (T-0111): perfil PERSONALIZADO vendedor_balcao (base vendedor, cargo vendedor, acesso.campo revogado por
     * sobreposição), sem usuário. Desde a 0069 (um perfil por usuário) o vendedor-B tem só o vendedor (o promotor extra saiu;
     * ele segue fazendo as coletas de trade da fixture do Promotor em B: o banco não confere perfil no promotor_id).
     */
    perfis: { vendedorBalcao: b('perfil', 1) },
    sobreposicoes: { vendedorBalcaoCampo: b('perfil_permissao', 1) },
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

/** Tabelas da 0013 (cadastro mínimo, unidade, endereço; conteúdo e cota do Catálogo; frete e faturamento), na ordem das FKs. */
const ORDEM_T0013 = [
  'core.produto_unidade',
  'core.cliente_endereco',
  'catalogo.uso_ia',
  'catalogo.catalogo_no',
  'catalogo.produto_no',
  'catalogo.produto_conteudo',
  'catalogo.produto_atributo',
  'catalogo.produto_midia',
  'catalogo.sinonimo',
  'catalogo.produto_busca',
  'catalogo.deposito',
  'catalogo.estoque_saldo',
  'catalogo.busca_log',
  'vendedor.transportadora',
  'vendedor.pedido_faturamento',
] as const;
type TabelaT0013 = (typeof ORDEM_T0013)[number];
const DO_PEDIDO = ['vendedor.pedido', 'vendedor.pedido_item'] as const;

export const ORDEM_TABELAS = [
  'plataforma.tenant',
  'plataforma.tenant_modulo',
  // 0041 (T-0111): perfis personalizados e sobreposições (os 7 de fábrica vêm do gatilho do tenant), antes da FK de perfil_modulo
  'plataforma.perfil',
  'plataforma.perfil_permissao',
  'plataforma.perfil_modulo',
  'core.equipe',
  'core.usuario',
  // 0041 (T-0112): vínculos além do principal — vazio desde a 0069 (um perfil por usuário: o gatilho usuario_perfil_principal liga o de fábrica de core.usuario.perfil)
  'plataforma.usuario_perfil',
  'plataforma.usuario_modulo',
  // 0018 (T-0063): a lista inicial vem do gatilho tenant_semear_medidas; aqui só as siglas próprias de cada tenant
  'core.medida',
  'core.produto',
  // 0056 (T-0149): filiais além da padrão (a padrão vem do gatilho tenant_semear_filial), antes da FK cliente_filial_fk
  'core.filial',
  'core.cliente',
  'core.carteira',
  'core.dispositivo',
  'core.sessao',
  // 0036 (T-0087): convite de 1º acesso (FK composta -> core.usuario)
  'core.usuario_convite',
  // 0040 (T-0094): outbox de e-mail (FK composta -> core.usuario); só linhas já despachadas (sem carga)
  'plataforma.email_saida',
  // 0058 (T-0158): diagnóstico do aparelho (FK composta -> core.usuario); alerta já resolvido, sem print
  'plataforma.diagnostico',
  // 0070 (ADR 0054): pacote da primeira carga e pedido de geração (sem FK além do tenant)
  'plataforma.sync_pacote',
  'plataforma.sync_pacote_pedido',
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.parametro',
  'plataforma.auditoria',
  ...ORDEM_SPRINT1.filter((t): t is Exclude<(typeof ORDEM_SPRINT1)[number], (typeof DO_PEDIDO)[number]> => !(DO_PEDIDO as readonly string[]).includes(t)),
  ...ORDEM_T0029_ANTES_DO_PEDIDO,
  ...DO_PEDIDO,
  'vendedor.pedido_evento',
  ...ORDEM_T0032,
  ...ORDEM_T0013,
  // 0019 (T-0066): notas do ERP (FK do cliente)
  'core.nota_erp',
  // 0020 (T-0071): relacionados do produto (sem FK para core.produto)
  'catalogo.produto_relacao',
  // 0045 (T-0113): marcas concorrentes (antes da referência: FK produto_referencia_marca_fk)
  'catalogo.marca_concorrente',
  // 0033 (T-0085): referências cruzadas (sem FK para core.produto; desde a 0045, FK para catalogo.marca_concorrente)
  'catalogo.produto_referencia',
  // 0037 (T-0089): formas e prazos (FK do prazo -> forma) e a tabela escalonada (FK -> catalogo.tabela_preco)
  'vendedor.forma_pagamento',
  'vendedor.prazo_pagamento',
  'catalogo.tabela_escalonada',
  // 0050 (T-0054): devolução do pedido (FK composta -> vendedor.pedido)
  'vendedor.pedido_devolucao',
  // 0028 (T-0082): plano de RV (FK atualizado_por -> core.usuario)
  'core.plano_rv',
  // 0057 (T-0147): tipos de foto além da "Fachada" (gatilho) e as fotos do PDV (FKs -> core.cliente, core.foto_tipo, core.usuario)
  'core.foto_tipo',
  'core.cliente_foto',
  // 0064 (T-0170): tarefas (FKs -> core.usuario, core.cliente, core.equipe) e destinatários (FKs -> core.tarefa, core.usuario)
  'core.tarefa',
  'core.tarefa_destinatario',
  // 0065 (T-0170): frase própria (as 30 padrão vêm do gatilho tenant_semear_frase_dia) e avatar (FKs -> core.usuario)
  'core.frase_dia',
  'core.usuario_avatar',
  // 0066 (T-0170): meta de produtividade (FKs -> core.equipe, core.usuario) e resumo do km (FK -> core.usuario)
  'core.meta_produtividade',
  'core.deslocamento_dia',
  // T-0055 (0014, schema gestor): seeds/fixtures/gestor.ts
  ...ORDEM_GESTOR,
  // 0015 (T-0056): schema promotor — linhas de A e B em ./promotor.ts
  ...ORDEM_PROMOTOR,
  // 0016 (T-0057): schema pesquisa — linhas de A e B em ./pesquisa.ts (itens e fotos da resposta: gatilho do banco)
  ...ORDEM_PESQUISA,
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
  // 0040 (T-0094): senha definitiva; recarregar desfaz "trocar senha" e a temporária paralela (a sessao_versao não volta)
  trocar_senha: false,
  senha_expira_em: null,
  senha_temporaria_hash: null,
  senha_temporaria_expira_em: null,
  senha_temporaria_criada_em: null,
  external_id: null,
});

/** 0057 (T-0147): arquivos das fotos do PDV (recebidos; a CNH com perfis_leitura). */
function arquivosFotosPdv(hojeA: string, hojeB: string): Linha[] {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const FA = FOTOS_PDV_FIXTURE.A;
  const FB = FOTOS_PDV_FIXTURE.B;
  const arquivo = (id: string, tenant_id: string, entidade_id: string, cliente_id: string, enviado_por: string, hoje: string, perfis: readonly string[] | null): Linha => ({
    id, tenant_id, modulo: 'core', finalidade: 'pdv', entidade: 'cliente_foto', entidade_id, cliente_id, enviado_por, tipo: 'image/jpeg',
    tamanho_bytes: 180_224, sha256: createHash('sha256').update(`fixture-pdv-${id}`).digest('hex'), largura_px: 1600, altura_px: 1200,
    situacao: 'recebido', recebido_em: instante(hoje, '12:30'), chave_armazenamento: `${tenant_id}/core/${anoMes(hoje)}/${id}.jpg`,
    perfis_leitura: perfis ? arrayDeTexto(perfis) : null, deleted_at: null, external_id: null,
  });
  return [
    arquivo(FA.arquivos.c1Fachada, A.tenantId, FA.fotos.c1Fachada, A.clientes.c1, A.usuarios.vendedor1, hojeA, null),
    arquivo(FA.arquivos.c1Cnh, A.tenantId, FA.fotos.c1Cnh, A.clientes.c1, A.usuarios.vendedor1, hojeA, PERFIS_LEITURA_DOC_SENSIVEL),
    arquivo(FB.arquivos.c1Fachada, B.tenantId, FB.fotos.c1Fachada, B.clientes.c1, B.usuarios.vendedor, hojeB, null),
  ];
}

/** 0056 (T-0149) e 0057 (T-0147): filiais além da padrão, tipos de foto além da "Fachada" e as fotos do PDV. */
function dadosFilialEFotosPdv(hojeA: string, hojeB: string): Pick<DadosFixture, 'core.filial' | 'core.foto_tipo' | 'core.cliente_foto'> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const FA = FOTOS_PDV_FIXTURE.A;
  const FB = FOTOS_PDV_FIXTURE.B;
  const foto = (id: string, tenant_id: string, cliente_id: string, foto_tipo_id: string, arquivo_id: string, origem: 'camera' | 'galeria', enviado_por: string, hoje: string): Linha => ({
    id, tenant_id, cliente_id, foto_tipo_id, arquivo_id, origem, enviado_por, tirada_em: instante(hoje, '12:00'), external_id: null,
  });
  return {
    'core.filial': [
      { id: FILIAIS_FIXTURE.A.boaVista, tenant_id: A.tenantId, codigo: '0002', nome: 'Filial Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true, external_id: 'FIL-BV' },
      { id: FILIAIS_FIXTURE.B.campinas, tenant_id: B.tenantId, codigo: '0002', nome: 'Filial Campinas', cidade: 'Campinas', uf: 'SP', padrao: false, ativo: true, external_id: null },
    ],
    'core.foto_tipo': [
      { id: FA.tipos.cnh, tenant_id: A.tenantId, nome: 'CNH do sócio', obrigatorio: true, sensivel: true, fachada: false, ordem: 1, ativo: true, external_id: null },
      { id: FB.tipos.contrato, tenant_id: B.tenantId, nome: 'Contrato social', obrigatorio: false, sensivel: true, fachada: false, ordem: 1, ativo: true, external_id: null },
    ],
    'core.cliente_foto': [
      foto(FA.fotos.c1Fachada, A.tenantId, A.clientes.c1, FA.tipos.fachada, FA.arquivos.c1Fachada, 'camera', A.usuarios.vendedor1, hojeA),
      foto(FA.fotos.c1Cnh, A.tenantId, A.clientes.c1, FA.tipos.cnh, FA.arquivos.c1Cnh, 'galeria', A.usuarios.vendedor1, hojeA),
      foto(FB.fotos.c1Fachada, B.tenantId, B.clientes.c1, FB.tipos.fachada, FB.arquivos.c1Fachada, 'camera', B.usuarios.vendedor, hojeB),
    ],
  };
}

/**
 * 0019 (T-0066): notas do ERP. A: c1 com faturamento (pedido p1 como retrato, sem FK) e faturamento cancelado no dia 1º do
 * mês corrente e devolução no dia 10 do mês anterior (meses distintos em qualquer dia); B: c1 com um faturamento. ano_mes =
 * mês da data civil de emissão (fuso do tenant; 15:00Z cai no mesmo dia em Manaus e em São Paulo).
 */
function dadosNotaErp(hojeA: string, hojeB: string): Linha[] {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const nota = (id: string, tenant_id: string, cliente_id: string, dia: string, n: Partial<Linha> & { tipo: string; numero: string; external_id: string; total_cents: number }): Linha => ({
    id, tenant_id, cliente_id, serie: '1', emitida_em: instante(dia, '15:00'), ano_mes: anoMes(dia), quantidade_itens: 3, pedido_uuid: null, cancelada: false,
    deleted_at: null, ...n,
  });
  const diaA = `${anoMes(hojeA)}-01`;
  const mesPassadoA = `${anoMes(hojeA, -1)}-10`;
  return [
    nota(a('nota_erp', 1), A.tenantId, A.clientes.c1, diaA, { tipo: 'faturamento', numero: '5001', external_id: 'NF-1-5001', total_cents: 285_000, pedido_uuid: A.pedidos.p1 }),
    nota(a('nota_erp', 2), A.tenantId, A.clientes.c1, diaA, { tipo: 'faturamento', numero: '5002', external_id: 'NF-1-5002', total_cents: 120_000, cancelada: true }),
    nota(a('nota_erp', 3), A.tenantId, A.clientes.c1, mesPassadoA, { tipo: 'devolucao', numero: '7001', external_id: 'ND-1-7001', total_cents: 30_000, quantidade_itens: 1 }),
    nota(b('nota_erp', 1), B.tenantId, B.clientes.c1, somarDias(hojeB, -1), { tipo: 'faturamento', numero: 'B-900', external_id: 'NF-1-B900', total_cents: 150_000 }),
  ];
}

/**
 * 0020 (T-0071): relacionados do produto (RF-CAT-03). A: p2 (filtro) complementa p1 (pastilha) e p1 é o substituto do p2,
 * mais uma relação INATIVA (superior) e uma APAGADA (soft delete) do mesmo par, para o pull e a consulta das sugestões
 * filtrarem ativo/deleted_at. B: o p1 com um superior de id que não está na carga (sem FK: a API do Catálogo valida).
 */
function dadosProdutoRelacao(): Linha[] {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const rel = (id: string, tenant_id: string, produto_id: string, relacionado_id: string, tipo: string, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, produto_id, relacionado_id, tipo, ordem: 1, ativo: true, deleted_at: null, external_id: null, ...extra,
  });
  return [
    rel(a('produto_relacao', 1), A.tenantId, A.produtos.p1, A.produtos.p2, 'complementar', { external_id: 'REL-A-1' }),
    rel(a('produto_relacao', 2), A.tenantId, A.produtos.p2, A.produtos.p1, 'substituto'),
    rel(a('produto_relacao', 3), A.tenantId, A.produtos.p1, A.produtos.p2, 'superior', { ordem: 2, ativo: false }),
    rel(a('produto_relacao', 4), A.tenantId, A.produtos.p2, A.produtos.p1, 'complementar', { deleted_at: DATA_FIXA_ACESSO }),
    rel(b('produto_relacao', 1), B.tenantId, b('produto', 1), b('produto', 2), 'superior', { external_id: 'REL-B-1' }),
  ];
}

/**
 * 0033 (T-0085, RN-CAT-09): referências cruzadas. A: o p1 (pastilha) equivale a "CB 3401" e a "FR-77.2" do concorrente
 * do Promotor de A (ordem 1 e 2), mais uma APAGADA na ordem 1 (o único vivo deixa); B: o p1 com "LB 0099" do concorrente
 * do Promotor de B. codigo_compacto = codigoCompacto do domain do Catálogo (sem acento, minúsculas, só [a-z0-9]).
 */
export const REFERENCIAS_FIXTURE = {
  A: { cb3401: a('produto_referencia', 1), fr772: a('produto_referencia', 2), apagada: a('produto_referencia', 3) },
  B: { lb0099: b('produto_referencia', 1) },
} as const;
/** 0034: retrato do nome da marca nas referências vivas (= nome do concorrente do Promotor de cada tenant na fixture). */
export const MARCA_NOME_FIXTURE = { A: 'Freios Rivais', B: 'Lubri Rival' } as const;
/**
 * 0045 (T-0113, ADR 0034): marcas concorrentes do Catálogo por tenant — a ATIVA com o MESMO id, nome, ativo, deleted_at e
 * external_id do concorrente do Promotor (PROMOTOR_FIXTURE.X.concorrente, o que a cópia da 0045 faz), uma INATIVA e uma APAGADA
 * (criadas depois da migração, só no Catálogo). As referências cruzadas apontam para a ativa.
 */
/**
 * Devolução do pedido (0050, T-0054, RN-VEN-37; grupo 0x3d): A com uma devolução PARCIAL viva no p3 (faturado R$ 1.500,00,
 * devolvido R$ 200,00) e a mesma nota antes de corrigida, apagada (soft delete; o único é só entre as vivas); B com uma viva
 * no p1 (a mesma chave de nota de A: o único é por tenant).
 */
export const DEVOLUCOES_FIXTURE = {
  A: { viva: a('pedido_devolucao', 1), apagada: a('pedido_devolucao', 2), external_id: 'NFD-1-7001', total_cents: 20_000 },
  B: { viva: b('pedido_devolucao', 1), external_id: 'NFD-1-7001', total_cents: 5_000 },
} as const;

function dadosPedidoDevolucao(hojeA: string, hojeB: string): Linha[] {
  const tA = DOIS_TENANTS.A.tenantId;
  const tB = DOIS_TENANTS.B.tenantId;
  const linha = (id: string, tenant_id: string, pedido_id: string, external_id: string, total_cents: number, emitida_em: string, deleted_at: string | null): Linha => ({
    id, tenant_id, pedido_id, external_id, nota_numero: '7001', nota_serie: '1', emitida_em, total_cents, deleted_at,
  });
  const D = DEVOLUCOES_FIXTURE;
  return [
    linha(D.A.apagada, tA, DOIS_TENANTS.A.pedidos.p3, D.A.external_id, 30_000, instante(somarDias(hojeA, -10), '10:00'), DATA_FIXA_ACESSO),
    linha(D.A.viva, tA, DOIS_TENANTS.A.pedidos.p3, D.A.external_id, D.A.total_cents, instante(somarDias(hojeA, -10), '10:00'), null),
    linha(D.B.viva, tB, DOIS_TENANTS.B.pedidos.p1, D.B.external_id, D.B.total_cents, instante(hojeB, '14:00'), null),
  ];
}

export const MARCAS_FIXTURE = {
  A: { ativa: PROMOTOR_FIXTURE.A.concorrente, inativa: a('marca_concorrente', 1), apagada: a('marca_concorrente', 2) },
  B: { ativa: PROMOTOR_FIXTURE.B.concorrente, inativa: b('marca_concorrente', 1), apagada: b('marca_concorrente', 2) },
} as const;
function dadosMarcaConcorrente(): Linha[] {
  const marcas = (t: string, m: (typeof MARCAS_FIXTURE)['A' | 'B'], nome: string, sufixo: string): Linha[] => [
    { id: m.ativa, tenant_id: t, nome, ativo: true, deleted_at: null, external_id: null },
    { id: m.inativa, tenant_id: t, nome: `Marca Inativa ${sufixo}`, ativo: false, deleted_at: null, external_id: `MARCA-INATIVA-${sufixo.toUpperCase()}` },
    { id: m.apagada, tenant_id: t, nome: `Marca Apagada ${sufixo}`, ativo: true, deleted_at: DATA_FIXA_ACESSO, external_id: null },
  ];
  return [...marcas(DOIS_TENANTS.A.tenantId, MARCAS_FIXTURE.A, MARCA_NOME_FIXTURE.A, 'Alfa'), ...marcas(DOIS_TENANTS.B.tenantId, MARCAS_FIXTURE.B, MARCA_NOME_FIXTURE.B, 'Beta')];
}
function dadosProdutoReferencia(): Linha[] {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const ref = (id: string, tenant_id: string, produto_id: string, marca_id: string, codigo: string, codigo_compacto: string, ordem: number, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, produto_id, marca_id, marca_nome: null, codigo, codigo_compacto, ordem, deleted_at: null, external_id: null, ...extra,
  });
  // 0034: marca_nome = retrato do nome do concorrente do Promotor do mesmo tenant; a apagada fica NULA (linha anterior à 0034)
  const nomeA = { marca_nome: MARCA_NOME_FIXTURE.A };
  const nomeB = { marca_nome: MARCA_NOME_FIXTURE.B };
  return [
    ref(REFERENCIAS_FIXTURE.A.cb3401, A.tenantId, A.produtos.p1, PROMOTOR_FIXTURE.A.concorrente, 'CB 3401', 'cb3401', 1, { external_id: 'REF-A-1', ...nomeA }),
    ref(REFERENCIAS_FIXTURE.A.fr772, A.tenantId, A.produtos.p1, PROMOTOR_FIXTURE.A.concorrente, 'FR-77.2', 'fr772', 2, nomeA),
    ref(REFERENCIAS_FIXTURE.A.apagada, A.tenantId, A.produtos.p1, PROMOTOR_FIXTURE.A.concorrente, 'CB-3400', 'cb3400', 1, { deleted_at: DATA_FIXA_ACESSO }),
    ref(REFERENCIAS_FIXTURE.B.lb0099, B.tenantId, b('produto', 1), PROMOTOR_FIXTURE.B.concorrente, 'LB 0099', 'lb0099', 1, { external_id: 'REF-B-1', ...nomeB }),
  ];
}

/**
 * 0028 (T-0082, RN-CORE-30): plano de RV. A: vigente desde o mês da fixture para vendedor e promotor (gravado pelo
 * analista) e uma versão APAGADA (soft delete) do mesmo mês de início — o único parcial deixa; B: só vendedor, sem autor.
 * Regras no formato RegraRvSchema (o banco só exige array JSON).
 */
function dadosPlanoRv(hojeA: string, hojeB: string): Linha[] {
  const A = DOIS_TENANTS.A;
  const faixas = [{ de_pct: 0, modo: 'zero', pagamento_pct: 0 }, { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 }, { de_pct: 100, modo: 'fixo', pagamento_pct: 100 }];
  const regras = [
    { indicador: 'venda_cents', peso_pct: 70, gatilho: false, faixas },
    { indicador: 'visitas', peso_pct: 30, gatilho: false, faixas },
    { indicador: 'cobertura_pct', peso_pct: 0, gatilho: true, faixas: [] },
  ];
  const plano = (id: string, tenant_id: string, vigencia_inicio: string, perfis: string[], atualizado_por: string | null, extra: Partial<Linha> = {}): Linha => ({
    id, tenant_id, nome: 'Plano de RV da fixture', vigencia_inicio, perfis: arrayDeTexto(perfis), valor_maximo_cents: 150_000, regras, atualizado_por,
    deleted_at: null, external_id: null, ...extra,
  });
  return [
    plano(a('plano_rv', 1), A.tenantId, anoMes(hojeA), ['vendedor', 'promotor'], A.usuarios.analista, { external_id: 'RV-A-1' }),
    plano(a('plano_rv', 2), A.tenantId, anoMes(hojeA), ['vendedor'], A.usuarios.admin, { deleted_at: DATA_FIXA_ACESSO }),
    plano(b('plano_rv', 1), DOIS_TENANTS.B.tenantId, anoMes(hojeB), ['vendedor'], null),
  ];
}

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

  const sprint1 = dadosSprint1(hojeA, hojeB);
  // 0016 (T-0057): Pesquisa — as fotos vão para plataforma.arquivo (junto das da Sprint 1), o resto no fim de ORDEM_TABELAS
  const { arquivos: arquivosPesquisa, ...pesquisa } = dadosPesquisaFixture(
    {
      A: { tenantId: tA, vendedor: A.usuarios.vendedor1, analista: A.usuarios.analista, admin: A.usuarios.admin, equipe: A.equipes.equipe1, cliente: A.clientes.c1 },
      B: { tenantId: tB, vendedor: B.usuarios.vendedor, admin: B.usuarios.admin, cliente: B.clientes.c1 },
    },
    hojeA,
    hojeB,
  );

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
    // 0069 (um perfil por usuário): o personalizado vendedor_externo tem os módulos do vendedor (sem o 'teste'), para a troca
    // de perfil manter o Vendedor; antes ele só aparecia em união com o de fábrica. No fim para manter os ids anteriores.
    [tA, 'vendedor_externo', 'core'], [tA, 'vendedor_externo', 'vendedor'], [tA, 'vendedor_externo', 'catalogo'],
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
    // 0041 (ADR 0033): personalizados (os de fábrica são do gatilho tenant_semear_perfis); sobreposições só nos personalizados
    'plataforma.perfil': [
      { id: A.perfis.vendedorExterno, tenant_id: tA, codigo: 'vendedor_externo', nome: 'Vendedor externo', descricao: 'fixture: personalizado sem usuário (A)', base: 'vendedor', cargo: 'vendedor', fabrica: false, ativo: true, external_id: null },
      { id: B.perfis.vendedorBalcao, tenant_id: tB, codigo: 'vendedor_balcao', nome: 'Vendedor de balcão', descricao: 'fixture: personalizado sem usuário', base: 'vendedor', cargo: 'vendedor', fabrica: false, ativo: true, external_id: null },
    ],
    'plataforma.perfil_permissao': [
      { id: A.sobreposicoes.vendedorExternoEscopo, tenant_id: tA, perfil_id: A.perfis.vendedorExterno, chave: 'dados.escopo', concedida: true, nivel: 'proprio', alvos: null, external_id: null },
      { id: B.sobreposicoes.vendedorBalcaoCampo, tenant_id: tB, perfil_id: B.perfis.vendedorBalcao, chave: 'acesso.campo', concedida: false, nivel: null, alvos: null, external_id: null },
    ],
    // 0069: um perfil por usuário — só o vínculo principal, o MESMO que o gatilho usuario_perfil_principal cria (id
    // idUsuarioPerfil; a carga é upsert por id, nada duplica). Fica explícito dos admins para a tabela ter linha em A e em B.
    'plataforma.usuario_perfil': [
      { tenant_id: tA, usuario_id: A.usuarios.admin },
      { tenant_id: tB, usuario_id: B.usuarios.admin },
    ].map(({ tenant_id, usuario_id }) => ({
      id: idUsuarioPerfil(tenant_id, usuario_id, idPerfilFabrica(tenant_id, 'admin')),
      tenant_id,
      usuario_id,
      perfil_id: idPerfilFabrica(tenant_id, 'admin'),
      external_id: null,
    })),
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
    // 0018: sigla própria de cada tenant (A vende em PC; B tem GF, que A não tem — a FK composta recusa GF em A). Id
    // determinístico = o da semeadura do banco (idMedida), para a recarga não colidir com medida_sigla_uk.
    'core.medida': [
      { id: idMedida(tA, 'PC'), tenant_id: tA, sigla: 'PC', descricao: 'Peça', ativo: true, external_id: null },
      { id: idMedida(tB, 'GF'), tenant_id: tB, sigla: 'GF', descricao: 'Garrafa', ativo: true, external_id: null },
    ],
    'core.produto': [
      { id: a('produto', 1), tenant_id: tA, sku: 'ALFA-001', ean: '7890000000011', nome: 'Pastilha de freio dianteira', marca: 'Norfreio', categoria: 'Freios', unidade: 'PC', ativo: true, external_id: 'ERP-A-001' },
      { id: a('produto', 2), tenant_id: tA, sku: 'ALFA-002', ean: null, nome: 'Filtro de óleo', marca: 'FiltraMax', categoria: 'Filtros', unidade: 'PC', ativo: true, external_id: null },
      { id: b('produto', 1), tenant_id: tB, sku: 'BETA-001', ean: '7890000000028', nome: 'Óleo 5W30 1 L', marca: 'Lubrion', categoria: 'Lubrificantes', unidade: 'UN', ativo: true, external_id: 'ERP-B-001' },
    ],
    'core.cliente': [
      // 0037 (RN-VEN-25): c1 de A com prazo médio máximo 45 e só PIX e BOLETO; c1 de B com 30 e todas as formas
      cliente(A.clientes.c1, tA, '33333333000191', 'Auto Peças Um', 'Manaus', 'AM', COORDENADAS.a1, { prazo_medio_max_dias: 45, formas_pagamento: arrayDeTextoLivre(['PIX', 'BOLETO']) }),
      cliente(A.clientes.c2, tA, '44444444000191', 'Auto Peças Dois', 'Manaus', 'AM', COORDENADAS.a2),
      // c3 SEM coordenada: o 1º check-in sugere a coordenada ao BKO (RN-CORE-10)
      cliente(A.clientes.c3, tA, '55555555000191', 'Auto Peças Três', 'Manacapuru', 'AM', null),
      cliente(B.clientes.c1, tB, '66666666000191', 'Mecânica Beta', 'São Paulo', 'SP', COORDENADAS.b1, { prazo_medio_max_dias: 30 }),
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
    'core.usuario_convite': [
      convite(CONVITES_FIXTURE.A.pendente.id, tA, A.usuarios.vendedor2, CONVITES_FIXTURE.A.pendente.hash, { criado_por_id: A.usuarios.admin, criado_por_tipo: 'usuario' }),
      convite(CONVITES_FIXTURE.A.revogado.id, tA, A.usuarios.vendedor2, CONVITES_FIXTURE.A.revogado.hash, { revogado_em: DATA_FIXA_ACESSO, criado_por_id: A.usuarios.admin, criado_por_tipo: 'usuario' }),
      convite(CONVITES_FIXTURE.A.usado.id, tA, A.usuarios.promotor, CONVITES_FIXTURE.A.usado.hash, { usado_em: DATA_FIXA_ACESSO }),
      convite(CONVITES_FIXTURE.B.pendente.id, tB, B.usuarios.vendedor, CONVITES_FIXTURE.B.pendente.hash, { criado_por_id: idFixo('5a5a5a5a', 0x08, 1), criado_por_tipo: 'super_admin' }),
    ],
    'plataforma.email_saida': [
      emailSaida(EMAILS_FIXTURE.A.enviado, tA, A.usuarios.vendedor1, 'acesso_inicial', { enviado_em: DATA_FIXA_ACESSO }),
      emailSaida(EMAILS_FIXTURE.A.falhou, tA, A.usuarios.vendedor2, 'nova_senha', { tentativas: 8, falhou_em: DATA_FIXA_ACESSO, ultimo_erro: 'smtp_recusado' }),
      emailSaida(EMAILS_FIXTURE.B.enviado, tB, B.usuarios.vendedor, 'acesso_inicial', { enviado_em: DATA_FIXA_ACESSO }),
    ],
    'plataforma.diagnostico': [
      diagnostico(DIAGNOSTICOS_FIXTURE.A.botao, tA, A.usuarios.vendedor1, 'vendedor', 'botao', {
        descricao: 'O pedido não subiu depois da sincronização.', alerta_situacao: 'enviado',
        alerta_recado_id: 'R-20261031-120000-diagnostico', alerta_em: DATA_FIXA_ACESSO,
      }),
      diagnostico(DIAGNOSTICOS_FIXTURE.A.queda, tA, A.usuarios.promotor, 'promotor', 'queda', {
        app: 'campo', motivo: 'crash_nativo', alerta_situacao: 'desligado',
        detalhe: { saida_android: { motivo: 4, status: 0, importancia: 100, pss_kb: 0, rss_kb: 0, descricao: 'crash', pilha: null } },
      }),
      diagnostico(DIAGNOSTICOS_FIXTURE.B.erroTela, tB, B.usuarios.vendedor, 'vendedor', 'erro_tela', {
        motivo: 'tela', alerta_situacao: 'enviado', alerta_recado_id: 'R-20261031-120001-diagnostico', alerta_em: DATA_FIXA_ACESSO,
        detalhe: { erro: { mensagem: 'TypeError: x is undefined', pilha: null, origem: 'tela' } },
      }),
    ],
    'plataforma.sync_pacote': [
      syncPacote(SYNC_PACOTE_FIXTURE.A.catalogo, tA, 'catalogo', null, {}),
      syncPacote(SYNC_PACOTE_FIXTURE.A.filialPadrao, tA, 'catalogo', FILIAIS_FIXTURE.A.padrao, {}),
      syncPacote(SYNC_PACOTE_FIXTURE.A.substituido, tA, 'catalogo', null, { situacao: 'substituido', substituido_em: DATA_FIXA_ACESSO }),
      syncPacote(SYNC_PACOTE_FIXTURE.B.core, tB, 'core', null, { entidades: { produto: 2, produto_unidade: 2, medida: 3 } }),
    ],
    'plataforma.sync_pacote_pedido': [
      syncPacotePedido(SYNC_PACOTE_FIXTURE.A.pedido, tA, 'catalogo', null, 'lote'),
      syncPacotePedido(SYNC_PACOTE_FIXTURE.B.pedido, tB, 'core', null, 'manifesto'),
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
    ...sprint1,
    // fotos da Pesquisa (0016) junto das da Sprint 1: plataforma.arquivo é gravada antes das respostas (FK de resposta_foto)
    // 0057 (T-0147): + os arquivos das fotos do PDV; perfis_leitura nula nos demais (todas as linhas com as mesmas colunas)
    'plataforma.arquivo': [...sprint1['plataforma.arquivo'], ...arquivosPesquisa, ...arquivosFotosPdv(hojeA, hojeB)].map((l) => ({ ...l, perfis_leitura: l.perfis_leitura ?? null })),
    ...dadosFilialEFotosPdv(hojeA, hojeB),
    ...dadosT0029(hojeA, hojeB),
    ...dadosT0032(hojeA),
    ...dadosT0013(hojeA, hojeB),
    'core.nota_erp': dadosNotaErp(hojeA, hojeB),
    'catalogo.produto_relacao': dadosProdutoRelacao(),
    'catalogo.marca_concorrente': dadosMarcaConcorrente(),
    'vendedor.pedido_devolucao': dadosPedidoDevolucao(hojeA, hojeB),
    'catalogo.produto_referencia': dadosProdutoReferencia(),
    ...dadosPagamento(hojeA, hojeB),
    'core.plano_rv': dadosPlanoRv(hojeA, hojeB),
    ...dadosT0170(hojeA, hojeB),
    ...dadosGestor({ tenant: tA, vendedor: A.usuarios.vendedor1, cliente: A.clientes.c1 }, { tenant: tB, vendedor: B.usuarios.vendedor, cliente: B.clientes.c1 }),
    ...dadosPromotorFixture(
      {
        A: { tenantId: tA, promotor: A.usuarios.promotor, cliente: A.clientes.c1, visitaCore: A.visitas.promotorC1Hoje, produto: a('produto', 1), produto2: a('produto', 2) },
        B: { tenantId: tB, promotor: B.usuarios.vendedor, cliente: B.clientes.c1, visitaCore: B.visitas.c1Hoje, produto: b('produto', 1) },
      },
      hojeA,
      hojeB,
    ),
    ...pesquisa,
  };
}

/** 0064–0066 (T-0170): tarefa e destinatário, frase própria, avatar, meta de produtividade e resumo do km (T0170_FIXTURE). */
function dadosT0170(
  hojeA: string,
  hojeB: string,
): Pick<DadosFixture, 'core.tarefa' | 'core.tarefa_destinatario' | 'core.frase_dia' | 'core.usuario_avatar' | 'core.meta_produtividade' | 'core.deslocamento_dia'> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const FA = T0170_FIXTURE.A;
  const FB = T0170_FIXTURE.B;
  const comuns = { deleted_at: null, external_id: null };
  const tarefa = (id: string, tenant_id: string, autor_id: string, titulo: string, prazo: string, cliente_id: string | null): Linha => ({
    id, tenant_id, autor_id, titulo, descricao: null, prazo, cliente_id, tipo: 'simples', questionario_id: null, alvo: 'usuarios', equipe_id: null,
    cancelada_em: null, cancelada_por: null, motivo_cancelamento: null, ...comuns,
  });
  const destinatario = (id: string, tenant_id: string, tarefa_id: string, usuario_id: string): Linha => ({
    id, tenant_id, tarefa_id, usuario_id, concluida_em: null, recebida_em: null, conclusao_id: null, observacao: null, resposta_id: null, suspeita: false, ...comuns,
  });
  const deslocamento = (id: string, tenant_id: string, usuario_id: string, data: string, metros: number, pontos: number): Linha => ({
    id, tenant_id, usuario_id, data, metros, pontos, primeiro_ponto_em: instante(data, '12:00'), ultimo_ponto_em: instante(data, '21:00'), origem: 'rastreamento', ...comuns,
  });
  return {
    'core.tarefa': [
      tarefa(FA.tarefa, A.tenantId, A.usuarios.gerente, 'Conferir a vitrine de freios', somarDias(hojeA, 7), A.clientes.c2),
      tarefa(FB.tarefa, B.tenantId, B.usuarios.admin, 'Levar o catálogo novo', somarDias(hojeB, 7), null),
    ],
    'core.tarefa_destinatario': [
      destinatario(FA.destinatario, A.tenantId, FA.tarefa, A.usuarios.vendedor2),
      destinatario(FB.destinatario, B.tenantId, FB.tarefa, B.usuarios.vendedor),
    ],
    'core.frase_dia': [
      { id: FA.frase, tenant_id: A.tenantId, texto: 'Fixture: frase própria da Alfa.', ativa: true, ordem: 31, padrao_codigo: null, ...comuns },
      { id: FB.frase, tenant_id: B.tenantId, texto: 'Fixture: frase própria da Beta.', ativa: true, ordem: 31, padrao_codigo: null, ...comuns },
    ],
    'core.usuario_avatar': [
      { id: FA.avatar, tenant_id: A.tenantId, usuario_id: A.usuarios.supervisor, tipo: 'avatar', avatar_codigo: 'm2', arquivo_id: null, alterado_em: DATA_FIXA_ACESSO, alterado_por: A.usuarios.supervisor, ...comuns },
      { id: FB.avatar, tenant_id: B.tenantId, usuario_id: B.usuarios.admin, tipo: 'iniciais', avatar_codigo: null, arquivo_id: null, alterado_em: DATA_FIXA_ACESSO, alterado_por: B.usuarios.admin, ...comuns },
    ],
    'core.meta_produtividade': [
      { id: FA.meta, tenant_id: A.tenantId, escopo: 'equipe', equipe_id: A.equipes.equipe2, usuario_id: null, indicador: 'visitas_dia', valor: 12, vigencia_inicio: '2026-01', atualizado_por: A.usuarios.gerente, ...comuns },
      { id: FB.meta, tenant_id: B.tenantId, escopo: 'tenant', equipe_id: null, usuario_id: null, indicador: 'km_dia', valor: 150_000, vigencia_inicio: '2026-01', atualizado_por: null, ...comuns },
    ],
    'core.deslocamento_dia': [
      deslocamento(FA.deslocamento, A.tenantId, A.usuarios.promotor, somarDias(hojeA, -1), 42_300, 150),
      deslocamento(FB.deslocamento, B.tenantId, B.usuarios.vendedor, somarDias(hojeB, -1), 18_700, 96),
    ],
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
  const item = (id: string, tenant_id: string, pedido_id: string, sequencia: number, produto_id: string, quantidade: number, tabela: number, desconto: number, aplicacao: string | null = null): Linha => {
    const unitario = Math.round((tabela * (100 - desconto)) / 100);
    return {
      id, tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents: tabela, preco_unitario_cents: unitario, desconto_pct: desconto,
      total_cents: unitario * quantidade, produto_sku: null, produto_nome: null, unidade: null, aplicacao, ...comuns,
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
        tipo: 'recado', titulo: 'Visite o Auto Peças Três', corpo: 'Cliente com título vencendo hoje: confirme o pagamento na visita.', link: '/m/rota',
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
        // retrato no formato do contrato ClienteDoPedido (modules/vendedor/contracts): tudo texto; o que o cliente não tem = '' (como receber.ts grava)
        cliente_resumo: { razao_social: 'Auto Peças Um Ltda', nome_fantasia: 'Auto Peças Um', documento: '33333333000191', endereco: '', bairro: '', cidade: 'Manaus', uf: 'AM', codigo_erp: '' },
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
      // 0033 (RN-VEN-19): retrato da aplicação do p1 (pastilha) no item 1; os demais sem (nulo)
      item(a('pedido_item', 1), tA, A.pedidos.p1, 1, a('produto', 1), 2, 100_000, 5, 'Motos 150 cc'),
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
 * T-0032 (0010, schema integracao): uma linha (ou mais) em cada tabela nos DOIS tenants. Ids em DOIS_TENANTS.X.integracao.
 * Instantes OPERACIONAIS (sinal do Conector, lotes, sessões, decisões, fila, retorno, reconciliação) relativos ao "hoje" da
 * carga (T-0042, B2): o dia de operação é anteontem (hoje − 2, horas em UTC) e as pendências decididas expiram em hoje + 5.
 * Recarregar no mesmo dia não muda nada. Ficam FIXOS só o que nunca é comparado com o relógio: o `alterado_em` do ERP
 * (2026-10-30T09:00:00.123Z, relógio do ERP, comparado só com outros `alterado_em`/cursores) e o 2099 da pendência
 * aguardando de A (continua decidível nos testes).
 */
function dadosT0032(hojeA: string): Pick<DadosFixture, TabelaT0032> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const IA = A.integracao;
  const IB = B.integracao;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const comuns = { deleted_at: null, external_id: null };
  const diaOperacao = somarDias(hojeA, -2);
  const T = (hora: string, dia = diaOperacao) => `${dia}T${hora}Z`;
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

  const expira = T('10:05:00', somarDias(diaOperacao, 7));
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
        id: a('reconciliacao', 1), tenant_id: tA, conector_id: IA.conector, entidade: 'produto', data_referencia: diaOperacao, contagem_erp: 2, soma_erp: null,
        contagem_macuxi: 1, soma_macuxi: null, diferenca_contagem: 1, diferenca_soma: null, diferenca_pct: null, divergente: true,
        motivos: arrayDeTexto(['contagem_divergente']), situacao: 'comparada', evento_publicado: true, calculada_em: T('23:00:00'), ...comuns,
      },
      {
        id: b('reconciliacao', 1), tenant_id: tB, conector_id: IB.conector, entidade: 'cliente', data_referencia: diaOperacao, contagem_erp: 1, soma_erp: null,
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

/**
 * 0013: uma linha (ou mais) em cada tabela nova nos DOIS tenants. A: produto 1 em UN (padrão) e CX c/ 10; c1 com
 * endereço principal e um de entrega; transportadora em A e B; cota de IA do vendedor-1 hoje
 * (3 consultas); árvore Freios > Pastilhas; p3 (faturado) com 1 faturamento. B: o mínimo (UN, endereço principal, CIF,
 * cota 1, árvore de 1 nível, p1 com 1 faturamento). Instantes relativos ao "hoje" da carga, como o resto da fixture.
 */
function dadosT0013(hojeA: string, hojeB: string): Pick<DadosFixture, TabelaT0013> {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const comuns = { deleted_at: null, external_id: null };
  const unidade = (id: string, tenant_id: string, produto_id: string, un: string, fator: number, padrao: boolean): Linha => ({
    id, tenant_id, produto_id, unidade: un, fator, ean: null, padrao, ativo: true, ...comuns,
  });
  const endereco = (id: string, tenant_id: string, cliente_id: string, tipo: string, principal: boolean, logradouro: string, cidade: string, uf: string, cep: string): Linha => ({
    id, tenant_id, cliente_id, tipo, descricao: principal ? 'Principal' : 'Depósito', logradouro, numero: '100', complemento: null, bairro: 'Centro', cidade, uf, cep,
    latitude: null, longitude: null, principal, ativo: true, ...comuns,
  });
  const no = (id: string, tenant_id: string, pai_id: string | null, nivel: number, codigo: string, nome: string): Linha => ({
    id, tenant_id, pai_id, nivel, codigo, nome, ordem: 1, ativo: true, ...comuns,
  });
  const busca = (id: string, tenant_id: string, produto_id: string, sku: string, nome: string, marca: string, categoria: string, atributos: string, aplicacao: string | null, referencias: string | null): Linha => ({
    id, tenant_id, produto_id, sku, ean: null, nome, marca, categoria, atributos, conteudo: null, ativo: true, aplicacao, referencias, ...comuns,
  });
  const faturamento = (id: string, tenant_id: string, pedido_id: string, evento_id: string, parcial: boolean, numero_erp: string, produto_id: string, quantidade: number, total: number, em: string): Linha => ({
    id, tenant_id, pedido_id, evento_id, parcial, numero_erp, nota_numero: '1001', nota_serie: '1', nota_emitida_em: em, nota_total_cents: total,
    itens: [{ sequencia: 1, produto_id, quantidade, total_cents: total }], faturado_em: em, ...comuns,
  });
  return {
    'core.produto_unidade': [
      unidade(a('produto_unidade', 1), tA, a('produto', 1), 'UN', 1, true),
      unidade(a('produto_unidade', 2), tA, a('produto', 1), 'CX', 10, false),
      unidade(b('produto_unidade', 1), tB, b('produto', 1), 'UN', 1, true),
    ],
    'core.cliente_endereco': [
      endereco(a('cliente_endereco', 1), tA, A.clientes.c1, 'principal', true, 'Rua Um', 'Manaus', 'AM', '69005000'),
      endereco(a('cliente_endereco', 2), tA, A.clientes.c1, 'entrega', false, 'Av. do Depósito', 'Manaus', 'AM', '69075000'),
      endereco(b('cliente_endereco', 1), tB, B.clientes.c1, 'principal', true, 'Rua Beta', 'São Paulo', 'SP', '01001000'),
    ],
    'catalogo.uso_ia': [
      { id: a('uso_ia', 1), tenant_id: tA, usuario_id: A.usuarios.vendedor1, dia: hojeA, consultas: 3, ...comuns },
      { id: b('uso_ia', 1), tenant_id: tB, usuario_id: B.usuarios.vendedor, dia: hojeB, consultas: 1, ...comuns },
    ],
    'catalogo.catalogo_no': [
      no(a('catalogo_no', 1), tA, null, 1, 'FREIOS', 'Freios'),
      no(a('catalogo_no', 2), tA, a('catalogo_no', 1), 2, 'FREIOS-PASTILHAS', 'Pastilhas'),
      no(b('catalogo_no', 1), tB, null, 1, 'LUB', 'Lubrificantes'),
    ],
    'catalogo.produto_no': [
      { id: a('produto_no', 1), tenant_id: tA, produto_id: a('produto', 1), no_id: a('catalogo_no', 2), ...comuns },
      { id: b('produto_no', 1), tenant_id: tB, produto_id: b('produto', 1), no_id: b('catalogo_no', 1), ...comuns },
    ],
    'catalogo.produto_conteudo': [
      {
        id: a('produto_conteudo', 1), tenant_id: tA, produto_id: a('produto', 1), descricao: 'Pastilha cerâmica para eixo dianteiro.', aplicacoes: 'Motos 150 cc',
        argumentos_venda: 'Menos ruído e pó', faq: [{ pergunta: 'Serve em moto 150?', resposta: 'Sim, nas linhas 150 cc.' }], campanha: true, destaque: false,
        etiquetas: arrayDeTextoLivre(['Dianteira', 'Novo']), ...comuns,
      },
      {
        id: b('produto_conteudo', 1), tenant_id: tB, produto_id: b('produto', 1), descricao: 'Óleo sintético 5W30.', aplicacoes: 'Carros flex 1.0 a 2.0 2015–2020', argumentos_venda: null, faq: [],
        campanha: false, destaque: true, etiquetas: arrayDeTextoLivre([]), ...comuns,
      },
    ],
    'catalogo.produto_atributo': [
      { id: a('produto_atributo', 1), tenant_id: tA, produto_id: a('produto', 1), nome: 'Cilindrada', valor: '150', valor_num: 150, unidade: 'cc', ordem: 1, ...comuns },
      { id: b('produto_atributo', 1), tenant_id: tB, produto_id: b('produto', 1), nome: 'Viscosidade', valor: '5W30', valor_num: null, unidade: null, ordem: 1, ...comuns },
    ],
    'catalogo.produto_midia': [
      { id: a('produto_midia', 1), tenant_id: tA, produto_id: a('produto', 1), tipo: 'foto', arquivo_id: null, url: 'https://exemplo.com.br/a/pastilha.jpg', titulo: null, ordem: 1, principal: true, ...comuns },
      { id: b('produto_midia', 1), tenant_id: tB, produto_id: b('produto', 1), tipo: 'pdf', arquivo_id: null, url: 'https://exemplo.com.br/b/ficha.pdf', titulo: 'Ficha técnica', ordem: 1, principal: false, ...comuns },
    ],
    'catalogo.sinonimo': [
      { id: a('sinonimo', 1), tenant_id: tA, termo: 'pastilha', sinonimos: arrayDeTexto(['lona', 'sapata']), ativo: true, ...comuns },
      { id: b('sinonimo', 1), tenant_id: tB, termo: 'oleo', sinonimos: arrayDeTexto(['lubrificante']), ativo: true, ...comuns },
    ],
    'catalogo.produto_busca': [
      busca(a('produto_busca', 1), tA, a('produto', 1), 'ALFA-001', 'Pastilha de freio dianteira', 'Norfreio', 'Freios', 'Cilindrada 150 cc', 'Motos 150 cc', 'CB 3401 cb3401 FR-77.2 fr772'),
      busca(b('produto_busca', 1), tB, b('produto', 1), 'BETA-001', 'Óleo 5W30 1 L', 'Lubrion', 'Lubrificantes', 'Viscosidade 5W30', 'Carros flex 1.0 a 2.0 2015–2020 2016 2017 2018 2019', 'LB 0099 lb0099'),
    ],
    'catalogo.deposito': [
      { id: a('deposito', 1), tenant_id: tA, codigo: 'CD1', nome: 'CD Manaus', ativo: true, ...comuns },
      { id: b('deposito', 1), tenant_id: tB, codigo: 'CD1', nome: 'CD São Paulo', ativo: true, ...comuns },
    ],
    'catalogo.estoque_saldo': [
      { id: a('estoque_saldo', 1), tenant_id: tA, deposito_id: a('deposito', 1), produto_id: a('produto', 1), quantidade: 15, atualizado_erp_em: instante(hojeA, '10:00'), ...comuns },
      { id: b('estoque_saldo', 1), tenant_id: tB, deposito_id: b('deposito', 1), produto_id: b('produto', 1), quantidade: 5, atualizado_erp_em: instante(hojeB, '10:00'), ...comuns },
    ],
    'catalogo.busca_log': [
      { id: a('busca_log', 1), tenant_id: tA, usuario_id: A.usuarios.vendedor1, termo: 'pastilha ceramica 300', origem: 'regras', resultados: 0, duracao_ms: 12, ocorrido_em: instante(hojeA, '13:00'), ...comuns },
      { id: b('busca_log', 1), tenant_id: tB, usuario_id: B.usuarios.vendedor, termo: 'oleo 5w30', origem: 'llm', resultados: 1, duracao_ms: 900, ocorrido_em: instante(hojeB, '13:00'), ...comuns },
    ],
    'vendedor.transportadora': [
      { id: a('transportadora', 1), tenant_id: tA, nome: 'Rápido Norte Transportes', documento: '11444777000161', inscricao_estadual: '041234567', telefone: '9233334444', ativo: true, ...comuns },
      { id: b('transportadora', 1), tenant_id: tB, nome: 'Paulista Cargas', documento: null, inscricao_estadual: null, telefone: null, ativo: true, ...comuns },
    ],
    'vendedor.pedido_faturamento': [
      faturamento(a('pedido_faturamento', 1), tA, A.pedidos.p3, a('pedido_faturamento', 101), false, 'PV1003', a('produto', 2), 3, 150_000, instante(somarDias(hojeA, -18), '15:00')),
      faturamento(b('pedido_faturamento', 1), tB, B.pedidos.p1, b('pedido_faturamento', 101), false, 'PVB001', b('produto', 1), 10, 45_000, instante(hojeB, '12:00')),
    ],
  };
}

function cliente(id: string, tenant_id: string, documento: string, nome: string, cidade: string, uf: string, coord: readonly [number, number] | null, extra: Partial<Linha> = {}): Linha {
  return {
    id, tenant_id, documento, razao_social: `${nome} Ltda`, nome_fantasia: nome, segmento: 'Linha leve', telefone: null, email: null,
    logradouro: null, numero: null, bairro: null, cidade, uf, cep: null, latitude: coord?.[0] ?? null, longitude: coord?.[1] ?? null,
    ativo: true, external_id: null,
    // 0037 (T-0089, RN-VEN-25): nulo = sem teto e todas as formas (§8 P1)
    prazo_medio_max_dias: null, formas_pagamento: null,
    // 0056 (T-0149, RN-CORE-39): todo cliente da fixture na filial padrão do tenant (semeada pelo gatilho)
    filial_id: idFilialPadrao(tenant_id), ...extra,
  };
}

function sessao(id: string, tenant_id: string, usuario_id: string, familia_id: string, token_hash: string, dispositivo_id: string): Linha {
  return { id, tenant_id, usuario_id, familia_id, token_hash, dispositivo_id, expira_em: VALIDADE_FIXA_REFRESH, usado_em: null, revogado_em: null, external_id: null };
}

function convite(id: string, tenant_id: string, usuario_id: string, token_hash: string, extra: Partial<Linha> = {}): Linha {
  return { id, tenant_id, usuario_id, token_hash, expira_em: VALIDADE_FIXA_REFRESH, usado_em: null, revogado_em: null, criado_por_id: null, criado_por_tipo: null, external_id: null, ...extra };
}

function emailSaida(id: string, tenant_id: string, usuario_id: string, modelo: 'acesso_inicial' | 'nova_senha', extra: Partial<Linha>): Linha {
  return {
    id, tenant_id, usuario_id, modelo, chave_idempotencia: `${usuario_id}:fixture`, carga: null, tentativas: 1,
    proxima_tentativa_em: DATA_FIXA_ACESSO, expira_em: VALIDADE_FIXA_REFRESH, enviado_em: null, falhou_em: null, ultimo_erro: null,
    external_id: null, ...extra,
  };
}

/** 0058 (T-0158): diagnóstico só com dado técnico; o protocolo fica com a sequência (coluna fora da linha). */
function diagnostico(id: string, tenant_id: string, usuario_id: string, perfil: string, origem: 'botao' | 'queda' | 'erro_tela', extra: Partial<Linha>): Linha {
  return {
    id, tenant_id, usuario_id, perfil, origem, app: 'campo', versao_app: '1.0.4', build: null, aparelho_fabricante: 'samsung',
    aparelho_modelo: 'SM-A155M', android: '14', android_api: 34, tela: '/m/novo-pedido', motivo: null, descricao: null,
    detalhe: {}, print_id: null, ocorrido_em: DATA_FIXA_ACESSO, recebido_em: DATA_FIXA_ACESSO, alerta_situacao: 'enviado',
    alerta_tentativas: 0, alerta_proxima_em: null, alerta_recado_id: null, alerta_em: null, external_id: null, ...extra,
  };
}

/** 0070 (ADR 0054): pacote com a chave do armazenamento no formato do CHECK sync_pacote_chave_do_tenant. */
function syncPacote(id: string, tenant_id: string, modulo: string, filial_id: string | null, extra: Partial<Linha>): Linha {
  const particao = filial_id ? `filial:${filial_id}` : 'tenant';
  return {
    id, tenant_id, modulo, particao, filial_id, formato: 1, situacao: 'pronto', horizonte: DATA_FIXA_ACESSO,
    geracao_base: '00000000-0000-4000-8000-000000000070',
    chave_armazenamento: `sync-pacotes/${tenant_id}/${modulo}/${particao}/${id}.sqlite.gz`,
    bytes: 4096, md5: 'd41d8cd98f00b204e9800998ecf8427e', entidades: filial_id ? { tabela_preco_item: 4, deposito: 1 } : { catalogo_no: 2, sinonimo: 1 },
    substituido_em: null, arquivo_apagado_em: null, external_id: null, ...extra,
  };
}

/** 0070 (ADR 0054): pedido de geração já atendido (nenhum pendente na fixture). */
function syncPacotePedido(id: string, tenant_id: string, modulo: string, filial_id: string | null, origem: 'lote' | 'manifesto' | 'agendado'): Linha {
  return {
    id, tenant_id, modulo, particao: filial_id ? `filial:${filial_id}` : 'tenant', filial_id, origem, situacao: 'atendido',
    gerar_apos: DATA_FIXA_ACESSO, tentativas: 1, ultimo_erro: null, atendido_em: DATA_FIXA_ACESSO, external_id: null,
  };
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
