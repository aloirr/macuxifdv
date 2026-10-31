/**
 * ESPELHO dos payloads dos eventos que o Gestor consome (`<modulo>.<entidade>.<fato>@vN`). O dono de cada
 * evento publica o schema oficial no próprio `contracts`; o Gestor não importa o contrato de módulo que não é
 * dependência declarada, então lê só o que precisa (campo novo opcional no publicador continua `@1` e é ignorado
 * aqui: o Zod descarta chave desconhecida). Divergência com o publicador = recado ao dono (T-0014).
 *
 * Situação de cada espelho (ver `.coord/contratos/eventos.md`):
 *  - EXISTE no registro, mas o payload ainda não tem schema do publicador: tudo abaixo, exceto o que está marcado;
 *  - PROPOSTO (não está no registro; pedido ao engenheiro-software na T-0014): `core.rota.dia_planejado@1`,
 *    `core.meta.definida@1`. Por isso NÃO estão em `consome` do manifesto até o registro existir.
 *  - Campos marcados "PEDIDO" são acréscimos opcionais pedidos ao publicador; ausentes ⇒ indicador `null`.
 * O envelope (`evento_id`, `ocorrido_em`…) é do platform-sdk; `evento_id` é a chave de idempotência.
 */
import { z } from 'zod';
import { Cents, CentsNaoNeg, ContagemNaoNeg, InstanteUtc, IsoDate, NivelAprovacao, MotivoAprovacao, PctNumero, StatusPedido, Uuid } from './base';

// ---------- Core ----------
export const ClienteAtualizadoV1 = z.object({
  cliente_id: Uuid,
  /** Vendedor da carteira (RN-CORE-04); `null` = sem carteira. */
  vendedor_id: Uuid.nullable(),
  ativo: z.boolean().default(true),
  nome: z.string().min(1).max(200).optional(),
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
});
export type PedidoCriadoV1 = z.infer<typeof PedidoCriadoV1>;

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
export const DESFECHOS_VISITA_LOJA = ['concluida', 'loja_fechada', 'acesso_negado', 'nao_finalizada'] as const;
export const VisitaLojaConcluidaV1 = z.object({
  visita_loja_id: Uuid,
  /** Visita (check-in/checkout) do Core à qual esta visita de loja se refere. */
  visita_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid,
  checkin_em: InstanteUtc,
  checkout_em: InstanteUtc,
  /** RN-PRO-07; já calculada pelo Promotor. */
  permanencia_min: z.number().nonnegative(),
  desfecho: z.enum(DESFECHOS_VISITA_LOJA).default('concluida'),
  /** RN-PRO-02: fotos da visita e as sem coordenada. PEDIDO ao Promotor; ausente ⇒ % de fotos sem GPS = `null`. */
  fotos_total: ContagemNaoNeg.nullable().default(null),
  fotos_sem_gps: ContagemNaoNeg.nullable().default(null),
});
export type VisitaLojaConcluidaV1 = z.infer<typeof VisitaLojaConcluidaV1>;

export const CONFORMIDADES_GONDOLA = ['conforme', 'parcial', 'nao_conforme'] as const;
export const GondolaRegistradaV1 = z.object({
  gondola_id: Uuid,
  visita_loja_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid,
  conformidade: z.enum(CONFORMIDADES_GONDOLA),
  registrado_em: InstanteUtc,
});
export type GondolaRegistradaV1 = z.infer<typeof GondolaRegistradaV1>;

export const ShareMedidoV1 = z.object({
  medicao_id: Uuid,
  visita_loja_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid,
  /** RN-PRO-03; `null` = categoria sem frentes. */
  share_pct: PctNumero.min(0).max(100).nullable(),
  meta_pct: PctNumero.min(0).max(100).nullable(),
  medido_em: InstanteUtc,
});
export type ShareMedidoV1 = z.infer<typeof ShareMedidoV1>;

export const PrecoColetadoV1 = z.object({
  coleta_id: Uuid,
  visita_loja_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid,
  /** RN-PRO-04; só nas linhas de concorrente com referência, senão `null`. */
  indice_preco: PctNumero.nonnegative().nullable(),
  coletado_em: InstanteUtc,
});
export type PrecoColetadoV1 = z.infer<typeof PrecoColetadoV1>;

export const STATUS_PRESENCA = ['presente', 'ruptura_gondola', 'ruptura_total'] as const;
export const RupturaRegistradaV1 = z.object({
  registro_id: Uuid,
  visita_loja_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid,
  produto_id: Uuid,
  /** RN-PRO-05: ruptura_gondola = fora da gôndola COM produto no depósito (falha de reposição). */
  status: z.enum(STATUS_PRESENCA),
  registrado_em: InstanteUtc,
});
export type RupturaRegistradaV1 = z.infer<typeof RupturaRegistradaV1>;

export const TarefaConcluidaV1 = z.object({
  tarefa_id: Uuid,
  promotor_id: Uuid,
  cliente_id: Uuid.nullable().default(null),
  concluida_em: InstanteUtc,
});
export type TarefaConcluidaV1 = z.infer<typeof TarefaConcluidaV1>;

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
  'promotor.visita_loja.concluida@1': VisitaLojaConcluidaV1,
  'promotor.gondola.registrada@1': GondolaRegistradaV1,
  'promotor.share.medido@1': ShareMedidoV1,
  'promotor.preco.coletado@1': PrecoColetadoV1,
  'promotor.ruptura.registrada@1': RupturaRegistradaV1,
  'promotor.tarefa.concluida@1': TarefaConcluidaV1,
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
