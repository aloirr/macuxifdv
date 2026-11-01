/**
 * ESPELHO dos payloads dos eventos que o Gestor consome (`<modulo>.<entidade>.<fato>@vN`). O dono de cada
 * evento publica o schema oficial no próprio `contracts`; enquanto o dono não publica, o Gestor lê só o que precisa
 * (campo novo opcional no publicador continua `@1` e é ignorado aqui: o Zod descarta chave desconhecida). Quando o
 * schema oficial existe, o Gestor passa a validar com ele (Promotor, T-0046). Divergência = recado ao dono (T-0014).
 *
 * Situação de cada espelho (ver `.coord/contratos/eventos.md`):
 *  - EXISTE no registro, mas o payload ainda não tem schema do publicador: tudo abaixo, exceto o que está marcado;
 *  - PROPOSTO (não está no registro; pedido ao engenheiro-software na T-0014): `core.rota.dia_planejado@1`,
 *    `core.meta.definida@1`. Por isso NÃO estão em `consome` do manifesto até o registro existir.
 *  - Campos marcados "PEDIDO" são acréscimos opcionais pedidos ao publicador; ausentes ⇒ indicador `null`.
 *  - CÓPIA PROVISÓRIA: `vendedor.pedido.faturado@1` espelha `PedidoFaturadoEvento` (modules/vendedor/contracts/eventos.ts).
 *    O engenheiro-software vai publicar o formato de cada evento no contracts do dono; aí o Gestor importa de lá.
 *  - OFICIAL (sem espelho): `promotor.*@1` usa os schemas do contrato do Promotor (T-0040/T-0046, seção abaixo).
 * O envelope (`evento_id`, `ocorrido_em`…) é do platform-sdk; `evento_id` é a chave de idempotência.
 */
import { z } from 'zod';
import { EVENTOS_PROMOTOR, type VisitaLojaConcluidaV1 as VisitaLojaConcluidaV1Promotor } from '../../promotor/contracts';
import { Cents, CentsNaoNeg, ContagemNaoNeg, InstanteUtc, IsoDate, NivelAprovacao, MotivoAprovacao, PctNumero, StatusPedido, Uuid } from './base';

// ---------- Core ----------
/** RN-GES-01: frequência de visita do cliente (semanal = 7 dias, quinzenal = 14, mensal = 30). */
export const FREQUENCIAS_VISITA = ['semanal', 'quinzenal', 'mensal'] as const;
export const FrequenciaVisita = z.enum(FREQUENCIAS_VISITA);
export type FrequenciaVisita = z.infer<typeof FrequenciaVisita>;

export const ClienteAtualizadoV1 = z.object({
  cliente_id: Uuid,
  /** Vendedor da carteira (RN-CORE-04); `null` = sem carteira. */
  vendedor_id: Uuid.nullable(),
  ativo: z.boolean().default(true),
  nome: z.string().min(1).max(200).optional(),
  /** RN-GES-01: frequência de visita do cliente. PEDIDO ao Core; ausente ⇒ limite `dias_sem_visita_padrao`. */
  frequencia_visita: FrequenciaVisita.nullable().default(null),
  /** RN-GES-02: quando o cliente entrou na carteira do vendedor atual. PEDIDO ao Core; ausente ⇒ 1º evento visto com este vendedor. */
  na_carteira_desde: InstanteUtc.nullable().default(null),
});
export type ClienteAtualizadoV1 = z.infer<typeof ClienteAtualizadoV1>;

export const VisitaCheckinV1 = z.object({
  visita_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid,
  checkin_em: InstanteUtc,
});
export type VisitaCheckinV1 = z.infer<typeof VisitaCheckinV1>;

export const ENCERRAMENTOS_VISITA = ['normal', 'automatico'] as const;
export const VisitaCheckoutV1 = z.object({
  visita_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid,
  checkout_em: InstanteUtc,
  /** RN-CORE-11: `automatico` = fechada na virada do dia ("não finalizado"); não entra no tempo em cliente. */
  encerramento: z.enum(ENCERRAMENTOS_VISITA).default('normal'),
});
export type VisitaCheckoutV1 = z.infer<typeof VisitaCheckoutV1>;

/** PROPOSTO — rota do dia do usuário (visitas planejadas). Última versão do dia vence. */
export const RotaDiaPlanejadoV1 = z.object({
  usuario_id: Uuid,
  data: IsoDate,
  cliente_ids: z.array(Uuid),
});
export type RotaDiaPlanejadoV1 = z.infer<typeof RotaDiaPlanejadoV1>;

/** PROPOSTO — meta mensal do usuário (RF-CORE-08, RN-CORE-21/22). Última versão do mês vence. */
export const MetaDefinidaV1 = z.object({
  usuario_id: Uuid,
  /** Mês da meta `AAAA-MM`. */
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  meta_cents: CentsNaoNeg,
});
export type MetaDefinidaV1 = z.infer<typeof MetaDefinidaV1>;

// ---------- Vendedor ----------
export const TIPOS_PEDIDO = ['pedido', 'orcamento'] as const;

/** Linha do pedido: quantidade na unidade de venda e total final da linha em centavos (RN-VEN-02). */
export const ItemPedidoV1 = z.object({
  produto_id: Uuid,
  quantidade: z.number().int().positive(),
  total_cents: CentsNaoNeg,
});
export type ItemPedidoV1 = z.infer<typeof ItemPedidoV1>;
export const PedidoCriadoV1 = z.object({
  pedido_id: Uuid,
  /** RN-VEN-35: o pedido em nome conta para o vendedor; `autor_id` = quem digitou (gestor). */
  vendedor_id: Uuid,
  autor_id: Uuid,
  cliente_id: Uuid,
  visita_id: Uuid.nullable().default(null),
  /** Orçamento não é venda (RN-VEN-32). */
  tipo: z.enum(TIPOS_PEDIDO).default('pedido'),
  /** Total final do pedido, em centavos (RN-VEN-02). */
  total_cents: CentsNaoNeg,
  /** Total pela tabela, sem descontos, em centavos; base do desconto efetivo (RN-VEN-03). PEDIDO ao Vendedor. */
  total_tabela_cents: CentsNaoNeg.nullable().default(null),
  criado_em: InstanteUtc,
  /**
   * RN-GES-06: itens com o total final da linha (centavos), para valorizar o faturamento parcial pelos itens faturados.
   * PEDIDO ao Vendedor; ausente ⇒ o parcial fica sem valor até o faturamento total.
   */
  itens: z.array(ItemPedidoV1).nullable().default(null),
});
export type PedidoCriadoV1 = z.infer<typeof PedidoCriadoV1>;

/**
 * `vendedor.pedido.faturado@1` (CÓPIA de `PedidoFaturadoEvento` do Vendedor): um por retorno do ERP aceito;
 * `itens` = o que foi faturado NESTE retorno (o consumidor soma); `parcial: false` = faturamento total (cobre o saldo).
 */
export const PedidoFaturadoV1 = z.object({
  pedido_id: Uuid,
  vendedor_id: Uuid,
  faturado_em: InstanteUtc,
  parcial: z.boolean(),
  itens: z.array(z.object({ produto_id: Uuid, quantidade: z.number().int().positive() })).min(1),
});
export type PedidoFaturadoV1 = z.infer<typeof PedidoFaturadoV1>;

export const PedidoStatusAlteradoV1 = z.object({
  pedido_id: Uuid,
  vendedor_id: Uuid,
  de: StatusPedido.nullable().default(null),
  para: StatusPedido,
  alterado_em: InstanteUtc,
  autor_id: Uuid.nullable().default(null),
  motivo: z.string().max(500).nullable().default(null),
});
export type PedidoStatusAlteradoV1 = z.infer<typeof PedidoStatusAlteradoV1>;

export const CreditoClienteV1 = z.object({
  limite_cents: CentsNaoNeg,
  saldo_aberto_cents: CentsNaoNeg,
  /** RN-VEN-12: limite − saldo em aberto − aprovados não faturados (pode ser negativo). */
  disponivel_cents: Cents,
});
export type CreditoClienteV1 = z.infer<typeof CreditoClienteV1>;

export const HistoricoClienteV1 = z.object({
  ultima_compra_em: InstanteUtc.nullable(),
  pedidos_90d: ContagemNaoNeg,
  ticket_medio_cents: CentsNaoNeg.nullable(),
});
export type HistoricoClienteV1 = z.infer<typeof HistoricoClienteV1>;

export const AprovacaoSolicitadaV1 = z.object({
  pedido_id: Uuid,
  vendedor_id: Uuid,
  cliente_id: Uuid,
  solicitada_em: InstanteUtc,
  /** Nível decidido pela alçada do Vendedor (RN-VEN-10/11); o Gestor NÃO recalcula. */
  nivel: NivelAprovacao,
  motivos: z.array(MotivoAprovacao).min(1),
  /** RN-VEN-03, em % (12.5 = 12,5%). */
  desconto_efetivo_pct: PctNumero.nonnegative(),
  total_cents: CentsNaoNeg,
  /** Contexto exibido na mesma tela (RF-GES-04). PEDIDO ao Vendedor; ausente ⇒ a tela mostra "indisponível". */
  credito: CreditoClienteV1.nullable().default(null),
  historico: HistoricoClienteV1.nullable().default(null),
});
export type AprovacaoSolicitadaV1 = z.infer<typeof AprovacaoSolicitadaV1>;

// ---------- Promotor ----------
/**
 * `promotor.*@1` NÃO tem espelho próprio (T-0046): o Gestor valida com os schemas OFICIAIS publicados pelo Promotor
 * na T-0040 (`modules/promotor/contracts/eventos.ts`) — os mesmos que o SDK usa na publicação; payload completo e
 * `.strict()`, com as revalidações de RN-PRO-02/03/04/05/06/07. Import relativo à pasta `contracts` do Promotor
 * (fronteira permitida); o Promotor é dependência OPCIONAL no manifesto, então não entra no package.json (o pacote
 * só lê o contrato, não precisa do módulo ativo). Aqui só se reexportam os TIPOS, para o domain do Gestor.
 */
export type {
  GondolaRegistradaV1,
  PrecoColetadoV1,
  RupturaRegistradaV1,
  ShareMedidoV1,
  TarefaConcluidaV1,
  VisitaLojaConcluidaV1,
} from '../../promotor/contracts';

/** Desfecho da visita de loja, no vocabulário do Promotor (`realizada`, `loja_fechada`, `acesso_negado`). */
export type DesfechoVisitaLoja = VisitaLojaConcluidaV1Promotor['desfecho'];

/**
 * Como o Gestor lê cada desfecho (RN-CORE-14, RN-PRO-06/07): `atendida` entra nos indicadores (se tiver a permanência
 * mínima); `sem_atendimento` (cliente fechado, com foto da fachada) não é loja visitada, não é visita curta e é
 * contado à parte em `trade.visitas_sem_atendimento`. O `Record` quebra o typecheck se o Promotor criar desfecho novo.
 */
export const ATENDIMENTO_POR_DESFECHO = {
  realizada: 'atendida',
  loja_fechada: 'sem_atendimento',
  acesso_negado: 'sem_atendimento',
} as const satisfies Record<DesfechoVisitaLoja, 'atendida' | 'sem_atendimento'>;
export type AtendimentoVisitaLoja = (typeof ATENDIMENTO_POR_DESFECHO)[DesfechoVisitaLoja];

// ---------- Pesquisa e Treinamento ----------
export const RespostaRegistradaV1 = z.object({
  resposta_id: Uuid,
  questionario_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid.nullable().default(null),
  respondida_em: InstanteUtc,
  /** RN-PES-04: aceita e sinalizada. */
  suspeita: z.boolean().default(false),
});
export type RespostaRegistradaV1 = z.infer<typeof RespostaRegistradaV1>;

export const LicaoConcluidaV1 = z.object({
  progresso_id: Uuid,
  usuario_id: Uuid,
  trilha_id: Uuid,
  licao_id: Uuid,
  concluida_em: InstanteUtc,
  xp_ganho: ContagemNaoNeg,
  trilha_concluida: z.boolean().default(false),
});
export type LicaoConcluidaV1 = z.infer<typeof LicaoConcluidaV1>;

export const MedalhaConquistadaV1 = z.object({
  medalha_usuario_id: Uuid,
  usuario_id: Uuid,
  medalha_codigo: z.string().min(1).max(60),
  conquistada_em: InstanteUtc,
});
export type MedalhaConquistadaV1 = z.infer<typeof MedalhaConquistadaV1>;

// ---------- registro por nome ----------
/** Evento por nome → schema do payload. É o que o consumidor valida antes de chamar `aplicarEvento`. */
export const EVENTOS_CONSUMIDOS = {
  'core.cliente.atualizado@1': ClienteAtualizadoV1,
  'core.visita.checkin@1': VisitaCheckinV1,
  'core.visita.checkout@1': VisitaCheckoutV1,
  'core.rota.dia_planejado@1': RotaDiaPlanejadoV1,
  'core.meta.definida@1': MetaDefinidaV1,
  'vendedor.pedido.criado@1': PedidoCriadoV1,
  'vendedor.pedido.status_alterado@1': PedidoStatusAlteradoV1,
  'vendedor.pedido.aprovacao_solicitada@1': AprovacaoSolicitadaV1,
  'vendedor.pedido.faturado@1': PedidoFaturadoV1,
  // schemas oficiais do Promotor (mesma referência; teste em contracts/index.test.ts)
  'promotor.visita_loja.concluida@1': EVENTOS_PROMOTOR['promotor.visita_loja.concluida@1'],
  'promotor.gondola.registrada@1': EVENTOS_PROMOTOR['promotor.gondola.registrada@1'],
  'promotor.share.medido@1': EVENTOS_PROMOTOR['promotor.share.medido@1'],
  'promotor.preco.coletado@1': EVENTOS_PROMOTOR['promotor.preco.coletado@1'],
  'promotor.ruptura.registrada@1': EVENTOS_PROMOTOR['promotor.ruptura.registrada@1'],
  'promotor.tarefa.concluida@1': EVENTOS_PROMOTOR['promotor.tarefa.concluida@1'],
  'pesquisa.resposta.registrada@1': RespostaRegistradaV1,
  'treinamento.licao.concluida@1': LicaoConcluidaV1,
  'treinamento.medalha.conquistada@1': MedalhaConquistadaV1,
} as const;

export type NomeEventoConsumido = keyof typeof EVENTOS_CONSUMIDOS;
export const NOMES_EVENTOS_CONSUMIDOS = Object.keys(EVENTOS_CONSUMIDOS) as NomeEventoConsumido[];

/** Eventos PROPOSTOS (fora do `consome` do manifesto até o engenheiro-software registrá-los em eventos.md). */
export const EVENTOS_PROPOSTOS: readonly NomeEventoConsumido[] = ['core.rota.dia_planejado@1', 'core.meta.definida@1'];

/** Envelope mínimo usado pelo Gestor (subconjunto do `EnvelopeEvento` do platform-sdk). */
export const EnvelopeConsumido = z.object({
  evento_id: z.string().min(1),
  nome: z.string().min(1),
  ocorrido_em: InstanteUtc,
  payload: z.unknown(),
});
export type EnvelopeConsumido = z.infer<typeof EnvelopeConsumido>;
