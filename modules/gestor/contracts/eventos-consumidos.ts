/**
 * Eventos que o Gestor consome (`<modulo>.<entidade>.<fato>@vN`) — T-0024. NÃO há cópia de payload alheio: o dono de cada
 * evento publica a definição no próprio `contracts` (core, vendedor, promotor, pesquisa, treinamento) e o Gestor importa
 * de lá (caminho relativo; fronteira permitida) e lê de forma TOLERANTE (`tolerante` do platform-sdk): chave a mais num
 * `@1` (campo opcional novo do publicador) é descartada; tipo, enum, mínimo, `default` e refinamento (RN-PRO) continuam
 * validados. Campo que o Gestor precisa e o dono não publica = recado ao dono pedindo o campo opcional, nunca cópia.
 * Os tipos abaixo são `z.infer` dos schemas do dono. Situação de cada evento: `.coord/contratos/eventos.md`.
 *
 * `core.rota.dia_planejado@1` tem schema do Core, mas o Core ainda não o publica (fora do `publica` dele): por isso fica
 * em `EVENTOS_PROPOSTOS` e fora do `consome` do manifesto. `core.meta.definida@1` é publicado; o Gestor só usa o
 * indicador `venda_cents` (`periodo` = mês, `valor` = centavos), nos nomes internos de `MetaDoMes`.
 * O envelope (`evento_id`, `ocorrido_em`…) é do platform-sdk; `evento_id` é a chave de idempotência.
 */
import { z } from 'zod';
import { tolerante } from '@macuxi/platform-sdk';
import {
  EVENTO_CLIENTE_ATUALIZADO,
  EVENTO_META_DEFINIDA,
  EVENTO_ROTA_DIA_PLANEJADO,
  EVENTO_VISITA_CHECKIN,
  EVENTO_VISITA_CHECKOUT,
  type ClienteAtualizadoSchema,
  type MetaDefinidaSchema,
  type RotaDiaPlanejadoSchema,
  type VisitaCheckinSchema,
  type VisitaCheckoutSchema,
} from '@macuxi/core/contracts';
import {
  EVENTO_PEDIDO_APROVACAO_SOLICITADA,
  EVENTO_PEDIDO_CRIADO,
  EVENTO_PEDIDO_FATURADO,
  EVENTO_PEDIDO_STATUS_ALTERADO,
  type AprovacaoSolicitadaEvento,
  type PedidoCriadoEvento,
  type PedidoFaturadoEvento,
  type PedidoStatusAlteradoEvento,
} from '../../vendedor/contracts';
import { EVENTOS_PROMOTOR, type VisitaLojaConcluidaV1 as VisitaLojaConcluidaV1Promotor } from '../../promotor/contracts';
import { DEF_RESPOSTA_REGISTRADA, type RespostaRegistradaV1 as RespostaRegistradaOficial } from '../../pesquisa/contracts';
import {
  DEFINICAO_LICAO_CONCLUIDA,
  DEFINICAO_MEDALHA_CONQUISTADA,
  type LicaoConcluidaV1 as LicaoConcluidaOficial,
  type MedalhaConquistadaV1 as MedalhaConquistadaOficial,
} from '../../treinamento/contracts';
import { InstanteUtc } from './base';

// ---------- Core ----------
/** RN-GES-01: frequência de visita do cliente (semanal = 7 dias, quinzenal = 14, mensal = 30), vocabulário do Core. */
export type FrequenciaVisita = NonNullable<z.infer<typeof ClienteAtualizadoSchema>['frequencia_visita']>;

/** `core.cliente.atualizado@1` (carteira: `vendedor_id`, `ativo`, `frequencia_visita`, `na_carteira_desde`; o nome vem de `core.cadastro_resumo@1`). */
export type ClienteAtualizadoV1 = z.infer<typeof ClienteAtualizadoSchema>;
/** `campos` do evento que mexem na carteira: com um deles e sem `vendedor_id` no payload, a carteira conhecida fica desatualizada. */
export const CAMPOS_CARTEIRA = ['vendedor_id', 'ativo'] as const;

export type VisitaCheckinV1 = z.infer<typeof VisitaCheckinSchema>;
/**
 * `core.visita.checkout@1`: `fechada_por: 'auto'` = fechada pelo servidor na virada do dia ("não finalizado", RN-CORE-11):
 * não entra no tempo em cliente. `permanencia_s` é o tempo calculado pelo Core. Precedência: o checkout do `usuario`
 * substitui o `auto` e nunca o contrário.
 */
export type VisitaCheckoutV1 = z.infer<typeof VisitaCheckoutSchema>;
/** Rota do dia do usuário (visitas planejadas). Última versão do dia vence. */
export type RotaDiaPlanejadoV1 = z.infer<typeof RotaDiaPlanejadoSchema>;
/** Payload oficial de `core.meta.definida@1` (RF-CORE-08, RN-CORE-21/22). */
export type MetaDefinidaV1 = z.infer<typeof MetaDefinidaSchema>;

/** Meta mensal de venda como o Gestor guarda no read-model: `periodo` → `mes`, `valor` (indicador `venda_cents`) → `meta_cents`. */
export interface MetaDoMes {
  usuario_id: string;
  /** Mês da meta `AAAA-MM`. */
  mes: string;
  meta_cents: number;
}

// ---------- Vendedor ----------
/** `vendedor.pedido.criado@1`: só `tipo: 'pedido'` (orçamento não é publicado, RN-VEN-32); `total_tabela_cents` e `itens` sempre presentes (RN-GES-06). */
export type PedidoCriadoV1 = PedidoCriadoEvento;
export type ItemPedidoV1 = PedidoCriadoEvento['itens'][number];
/** `vendedor.pedido.faturado@1`: um por retorno do ERP aceito; `itens` = o faturado NESTE retorno; `parcial: false` = total. */
export type PedidoFaturadoV1 = PedidoFaturadoEvento;
export type PedidoStatusAlteradoV1 = PedidoStatusAlteradoEvento;
/** `vendedor.pedido.aprovacao_solicitada@1`: `credito`/`historico` `objeto | null` (RF-GES-04; `null` ⇒ a tela mostra "indisponível"). */
export type AprovacaoSolicitadaV1 = AprovacaoSolicitadaEvento;

// ---------- Promotor ----------
/**
 * `promotor.*@1`: schemas OFICIAIS do Promotor (`modules/promotor/contracts/eventos.ts`, T-0040), com as revalidações de
 * RN-PRO-02/03/04/05/06/07, lidos de forma tolerante. Import relativo à pasta `contracts` do Promotor (fronteira
 * permitida); o Promotor é dependência OPCIONAL no manifesto, então não entra no package.json (o pacote só lê o
 * contrato, não precisa do módulo ativo). Fotos com/sem GPS: `fotos_total` e `fotos_sem_gps` no `visita_loja.concluida@1`
 * (com GPS = total − sem). Aqui só se reexportam os TIPOS, para o domain do Gestor.
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
export type RespostaRegistradaV1 = RespostaRegistradaOficial;
export type LicaoConcluidaV1 = LicaoConcluidaOficial;
export type MedalhaConquistadaV1 = MedalhaConquistadaOficial;

// ---------- registro por nome ----------
/**
 * Evento por nome → schema OFICIAL do dono, em leitura tolerante. É o que o consumidor valida antes de chamar
 * `aplicarEvento` (o despachante continua com `z.unknown()`: evento ruim vira aviso, não trava a fila).
 */
export const EVENTOS_CONSUMIDOS = {
  'core.cliente.atualizado@1': tolerante(EVENTO_CLIENTE_ATUALIZADO.schema),
  'core.visita.checkin@1': tolerante(EVENTO_VISITA_CHECKIN.schema),
  'core.visita.checkout@1': tolerante(EVENTO_VISITA_CHECKOUT.schema),
  'core.rota.dia_planejado@1': tolerante(EVENTO_ROTA_DIA_PLANEJADO.schema),
  'core.meta.definida@1': tolerante(EVENTO_META_DEFINIDA.schema),
  'vendedor.pedido.criado@1': tolerante(EVENTO_PEDIDO_CRIADO.schema),
  'vendedor.pedido.status_alterado@1': tolerante(EVENTO_PEDIDO_STATUS_ALTERADO.schema),
  'vendedor.pedido.aprovacao_solicitada@1': tolerante(EVENTO_PEDIDO_APROVACAO_SOLICITADA.schema),
  'vendedor.pedido.faturado@1': tolerante(EVENTO_PEDIDO_FATURADO.schema),
  'promotor.visita_loja.concluida@1': tolerante(EVENTOS_PROMOTOR['promotor.visita_loja.concluida@1']),
  'promotor.gondola.registrada@1': tolerante(EVENTOS_PROMOTOR['promotor.gondola.registrada@1']),
  'promotor.share.medido@1': tolerante(EVENTOS_PROMOTOR['promotor.share.medido@1']),
  'promotor.preco.coletado@1': tolerante(EVENTOS_PROMOTOR['promotor.preco.coletado@1']),
  'promotor.ruptura.registrada@1': tolerante(EVENTOS_PROMOTOR['promotor.ruptura.registrada@1']),
  'promotor.tarefa.concluida@1': tolerante(EVENTOS_PROMOTOR['promotor.tarefa.concluida@1']),
  'pesquisa.resposta.registrada@1': tolerante(DEF_RESPOSTA_REGISTRADA.schema),
  'treinamento.licao.concluida@1': tolerante(DEFINICAO_LICAO_CONCLUIDA.schema),
  'treinamento.medalha.conquistada@1': tolerante(DEFINICAO_MEDALHA_CONQUISTADA.schema),
} as const;

export type NomeEventoConsumido = keyof typeof EVENTOS_CONSUMIDOS;
export const NOMES_EVENTOS_CONSUMIDOS = Object.keys(EVENTOS_CONSUMIDOS) as NomeEventoConsumido[];

/** Eventos PROPOSTOS (fora do `consome` do manifesto até o Core publicá-los de fato). */
export const EVENTOS_PROPOSTOS: readonly NomeEventoConsumido[] = ['core.rota.dia_planejado@1'];

/** Envelope mínimo usado pelo Gestor (subconjunto do `EnvelopeEvento` do platform-sdk). */
export const EnvelopeConsumido = z.object({
  evento_id: z.string().min(1),
  nome: z.string().min(1),
  ocorrido_em: InstanteUtc,
  payload: z.unknown(),
});
export type EnvelopeConsumido = z.infer<typeof EnvelopeConsumido>;
