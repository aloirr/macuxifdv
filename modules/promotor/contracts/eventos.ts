/**
 * Schemas oficiais dos eventos publicados pelo Promotor (`promotor.<entidade>.<fato>@vN`), T-0040.
 * Registro: `.coord/contratos/eventos.md`; tabela com campos e consumidores: `docs/modulos/promotor/eventos.md`.
 *
 * Regras do payload (valem para todos os eventos abaixo):
 *  - payload COMPLETO: toda chave é obrigatória (`null` explícito quando não se aplica) e não há `default`;
 *    o tipo inferido é o mesmo na entrada e na saída do schema;
 *  - `.strict()`: o publicador não manda chave a mais (nada de texto livre, nome, documento ou endereço — só ids,
 *    códigos, números e instantes). O consumidor lê sem `strict` e ignora o que não conhece;
 *  - ids são UUID (gerados no aparelho); instantes em UTC (`...Z`); dinheiro em centavos inteiros;
 *  - `tenant_id`, `evento_id` e `ocorrido_em` são do envelope do platform-sdk, não do payload;
 *  - os números derivados (permanência, share, atingimento, preço efetivo, índice) são revalidados aqui com as
 *    mesmas funções do `domain` (RN-PRO-03/04/07): evento com conta que não fecha não é publicado.
 * Mudança incompatível (tirar/renomear campo, mudar tipo ou vocabulário, campo novo obrigatório) = `@2` + ADR.
 * O teste `eventos.test.ts` congela o formato de cada `@1` (tipo e chaves) e quebra se isso acontecer sem versão nova.
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk';
import { DESFECHOS_VISITA } from '../domain/checklist';
import { CONFORMIDADES } from '../domain/gondola';
import { permanenciaMinutos, PERMANENCIA_TOLERANCIA_MIN } from '../domain/permanencia';
import { indicePreco, precoEfetivoCents, validarPrecoObservado } from '../domain/preco';
import { quantidadeRepostaValida, STATUS_PRESENCA } from '../domain/ruptura';
import { atingimentoShare, calcularShare } from '../domain/share';
import { ClienteId, InstanteUtc, PctNumero, PrecoCents, ProdutoId, Uuid } from './base';

const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
const Contagem = z.number().int().nonnegative();

// ---------- promotor.visita_loja.concluida@1 (RF-PRO-02, RN-PRO-02/06/07) ----------
/** Formato congelado do `@1` (sem refinamentos); o schema publicado é `VisitaLojaConcluidaV1`. */
export const VisitaLojaConcluidaV1Objeto = z
  .object({
    visita_loja_id: Uuid,
    /** Visita (check-in/checkout) do Core à qual esta visita de loja se refere. */
    visita_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    /** RN-PRO-10: checklist vigente no check-in; `null` = loja sem checklist cadastrado. */
    checklist_modelo_id: Uuid.nullable(),
    checkin_em: InstanteUtc,
    checkout_em: InstanteUtc,
    /** RN-PRO-07: minutos entre check-in e checkout (recalculado aqui; tolerância de arredondamento do aparelho). */
    permanencia_min: z.number().finite().nonnegative(),
    /** Vocabulário do domain (`DESFECHOS_VISITA`): `realizada`, `loja_fechada`, `acesso_negado`. */
    desfecho: z.enum(DESFECHOS_VISITA),
    /** RN-PRO-06: obrigatória em `loja_fechada` e `acesso_negado`. */
    foto_fachada_id: Uuid.nullable(),
    /** RN-PRO-02: fotos da visita e quantas saíram sem coordenada (`sem_gps`). */
    fotos_total: Contagem,
    fotos_sem_gps: Contagem,
  })
  .strict();

export const VisitaLojaConcluidaV1 = VisitaLojaConcluidaV1Objeto.superRefine((v, ctx) => {
  const ini = Date.parse(v.checkin_em);
  const fim = Date.parse(v.checkout_em);
  if (fim < ini) issue(ctx, ['checkout_em'], 'O checkout não pode ser anterior ao check-in.');
  else if (Math.abs(v.permanencia_min - permanenciaMinutos(v.checkin_em, v.checkout_em)) > PERMANENCIA_TOLERANCIA_MIN) {
    issue(ctx, ['permanencia_min'], 'RN-PRO-07: a permanência não confere com o check-in e o checkout.');
  }
  if ((v.desfecho === 'loja_fechada' || v.desfecho === 'acesso_negado') && v.foto_fachada_id === null) {
    issue(ctx, ['foto_fachada_id'], 'RN-PRO-06: loja fechada ou acesso negado exige a foto da fachada.');
  }
  if (v.fotos_sem_gps > v.fotos_total) issue(ctx, ['fotos_sem_gps'], 'RN-PRO-02: fotos sem GPS não podem passar do total de fotos da visita.');
});
export type VisitaLojaConcluidaV1 = z.infer<typeof VisitaLojaConcluidaV1>;

// ---------- promotor.gondola.registrada@1 (RF-PRO-03) ----------
export const GondolaRegistradaV1Objeto = z
  .object({
    gondola_id: Uuid,
    visita_loja_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    categoria_gondola_id: Uuid,
    conformidade: z.enum(CONFORMIDADES),
    foto_antes_id: Uuid,
    foto_depois_id: Uuid,
    /** RN-PRO-10: foto/planograma de referência vigente comparada; `null` = sem referência cadastrada. */
    foto_referencia_id: Uuid.nullable(),
    registrado_em: InstanteUtc,
  })
  .strict();

export const GondolaRegistradaV1 = GondolaRegistradaV1Objeto.superRefine((g, ctx) => {
  if (g.foto_antes_id === g.foto_depois_id) issue(ctx, ['foto_depois_id'], 'A foto do depois precisa ser outra foto, diferente da do antes.');
});
export type GondolaRegistradaV1 = z.infer<typeof GondolaRegistradaV1>;

// ---------- promotor.share.medido@1 (RF-PRO-04, RN-PRO-03) ----------
export const ShareMedidoV1Objeto = z
  .object({
    medicao_id: Uuid,
    visita_loja_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    categoria_gondola_id: Uuid,
    frentes_nossas: Contagem,
    frentes_total: Contagem,
    /** Centímetros lineares: os dois ou nenhum; com cm a base do share é cm (RN-PRO-03). */
    cm_nossos: z.number().finite().nonnegative().nullable(),
    cm_total: z.number().finite().nonnegative().nullable(),
    /** RN-PRO-03; `null` = categoria sem frentes. */
    share_pct: PctNumero.min(0).max(100).nullable(),
    /** RN-PRO-10: meta vigente usada; as duas nulas = sem meta cadastrada. */
    meta_share_id: Uuid.nullable(),
    meta_pct: PctNumero.min(0).max(100).nullable(),
    /** RN-PRO-03: share ÷ meta × 100; `null` sem share ou sem meta. */
    atingimento_pct: PctNumero.nonnegative().nullable(),
    medido_em: InstanteUtc,
  })
  .strict();

export const ShareMedidoV1 = ShareMedidoV1Objeto.superRefine((m, ctx) => {
  const r = calcularShare(m);
  if (r.status === 'inconsistente') issue(ctx, ['frentes_nossas'], r.motivo ?? 'Medição de share inconsistente.');
  else if (r.share_pct !== m.share_pct) issue(ctx, ['share_pct'], 'RN-PRO-03: o share não confere com as frentes (ou centímetros) medidos.');
  if ((m.meta_share_id === null) !== (m.meta_pct === null)) issue(ctx, ['meta_share_id'], 'RN-PRO-10: informe a meta vigente e o valor dela juntos, ou nenhum.');
  const esperado = atingimentoShare(r.status === 'inconsistente' ? null : r.share_pct, m.meta_pct).atingimento_pct;
  if (m.atingimento_pct !== esperado) issue(ctx, ['atingimento_pct'], 'RN-PRO-03: o atingimento não confere com o share e a meta.');
});
export type ShareMedidoV1 = z.infer<typeof ShareMedidoV1>;

// ---------- promotor.preco.coletado@1 (RF-PRO-05, RN-PRO-04) ----------
/** `produto_concorrente_id` nulo = preço do NOSSO item; preenchido = preço do concorrente comparado ao `produto_id`. */
export const PrecoColetadoV1Objeto = z
  .object({
    coleta_id: Uuid,
    visita_loja_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    produto_id: ProdutoId,
    concorrente_id: Uuid.nullable(),
    produto_concorrente_id: Uuid.nullable(),
    preco_cents: PrecoCents,
    em_promocao: z.boolean(),
    em_encarte: z.boolean(),
    preco_promocional_cents: PrecoCents.nullable(),
    /** RN-PRO-04: promocional em promoção/encarte; senão o de prateleira. */
    preco_efetivo_cents: PrecoCents,
    /** Preço efetivo do nosso item na mesma visita (só em linha de concorrente com índice). */
    preco_nosso_ref_cents: PrecoCents.nullable(),
    /** RN-PRO-04: nosso ÷ concorrente × 100 (2 casas); só em linha de concorrente com referência. */
    indice_preco: PctNumero.nonnegative().nullable(),
    /** RN-PRO-04: o promotor confirmou um preço que variou mais que o limite. */
    variacao_confirmada: z.boolean(),
    coletado_em: InstanteUtc,
  })
  .strict();

export const PrecoColetadoV1 = PrecoColetadoV1Objeto.superRefine((c, ctx) => {
  const erros = validarPrecoObservado(c);
  for (const msg of erros) issue(ctx, ['preco_promocional_cents'], msg);
  if (erros.length === 0 && precoEfetivoCents(c) !== c.preco_efetivo_cents) {
    issue(ctx, ['preco_efetivo_cents'], 'RN-PRO-04: o preço efetivo não confere com o preço de prateleira e a promoção.');
  }
  const concorrente = c.produto_concorrente_id !== null;
  if (concorrente && c.concorrente_id === null) issue(ctx, ['concorrente_id'], 'Informe o concorrente do produto coletado.');
  if (!concorrente && (c.indice_preco !== null || c.preco_nosso_ref_cents !== null)) {
    issue(ctx, ['indice_preco'], 'RN-PRO-04: o índice de preço só existe nas linhas de preço do concorrente.');
  }
  if (concorrente && c.indice_preco !== null) {
    if (c.preco_nosso_ref_cents === null) issue(ctx, ['preco_nosso_ref_cents'], 'RN-PRO-04: informe o preço do nosso item usado no índice.');
    else if (erros.length === 0 && indicePreco(c.preco_nosso_ref_cents, precoEfetivoCents(c)) !== c.indice_preco) {
      issue(ctx, ['indice_preco'], 'RN-PRO-04: o índice de preço não confere com os preços informados.');
    }
  }
});
export type PrecoColetadoV1 = z.infer<typeof PrecoColetadoV1>;

// ---------- promotor.ruptura.registrada@1 (RF-PRO-06, RN-PRO-05) ----------
/**
 * Um evento por item do mix obrigatório conferido na visita, INCLUSIVE `presente` (o Gestor precisa do total para
 * o % de ruptura). Só os status de `STATUS_RUPTURA_COM_ALERTA` geram alerta ao vendedor (Vendedor, P1).
 */
export const RupturaRegistradaV1Objeto = z
  .object({
    registro_id: Uuid,
    visita_loja_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    produto_id: ProdutoId,
    /** RN-PRO-10: mix obrigatório vigente que originou o item. */
    mix_obrigatorio_id: Uuid,
    /** RN-PRO-05: `ruptura_gondola` = fora da gôndola com produto no depósito (falha de reposição). */
    status: z.enum(STATUS_PRESENCA),
    quantidade_reposta: Contagem,
    registrado_em: InstanteUtc,
  })
  .strict();

export const RupturaRegistradaV1 = RupturaRegistradaV1Objeto.superRefine((r, ctx) => {
  if (!quantidadeRepostaValida(r.status, r.quantidade_reposta)) issue(ctx, ['quantidade_reposta'], 'RN-PRO-05: em ruptura total não há quantidade reposta (informe 0).');
});
export type RupturaRegistradaV1 = z.infer<typeof RupturaRegistradaV1>;

/** Status que viram alerta ao vendedor responsável (RN-PRO-05; `presente` não alerta). */
export const STATUS_RUPTURA_COM_ALERTA = ['ruptura_gondola', 'ruptura_total'] as const satisfies readonly (typeof STATUS_PRESENCA)[number][];

// ---------- promotor.tarefa.concluida@1 (RF-PRO-10) ----------
export const TarefaConcluidaV1Objeto = z
  .object({
    /** Execução da tarefa nesta loja (uma por loja/visita; chave de idempotência do fato). */
    execucao_id: Uuid,
    /** Tarefa de trade (campanha) cadastrada no BKO. */
    tarefa_id: Uuid,
    visita_loja_id: Uuid,
    promotor_id: Uuid,
    cliente_id: ClienteId,
    /** Comprovação por foto (RF-PRO-10): pelo menos uma. */
    fotos_total: z.number().int().min(1),
    concluida_em: InstanteUtc,
  })
  .strict();

export const TarefaConcluidaV1 = TarefaConcluidaV1Objeto;
export type TarefaConcluidaV1 = z.infer<typeof TarefaConcluidaV1>;

// ---------- definições e registro por nome ----------
/** Publicação na outbox: `tx.publicar(EVENTO_..., payload, agregadoId)` (o SDK valida pelo `schema`). */
export const EVENTO_VISITA_LOJA_CONCLUIDA = definirEvento('promotor.visita_loja.concluida@1', VisitaLojaConcluidaV1);
export const EVENTO_GONDOLA_REGISTRADA = definirEvento('promotor.gondola.registrada@1', GondolaRegistradaV1);
export const EVENTO_SHARE_MEDIDO = definirEvento('promotor.share.medido@1', ShareMedidoV1);
export const EVENTO_PRECO_COLETADO = definirEvento('promotor.preco.coletado@1', PrecoColetadoV1);
export const EVENTO_RUPTURA_REGISTRADA = definirEvento('promotor.ruptura.registrada@1', RupturaRegistradaV1);
export const EVENTO_TAREFA_CONCLUIDA = definirEvento('promotor.tarefa.concluida@1', TarefaConcluidaV1);

/** Evento por nome → schema do payload. As chaves são exatamente o `publica` do manifesto (teste). */
export const EVENTOS_PROMOTOR = {
  'promotor.visita_loja.concluida@1': VisitaLojaConcluidaV1,
  'promotor.gondola.registrada@1': GondolaRegistradaV1,
  'promotor.share.medido@1': ShareMedidoV1,
  'promotor.preco.coletado@1': PrecoColetadoV1,
  'promotor.ruptura.registrada@1': RupturaRegistradaV1,
  'promotor.tarefa.concluida@1': TarefaConcluidaV1,
} as const;

export type NomeEventoPromotor = keyof typeof EVENTOS_PROMOTOR;
export type PayloadEventoPromotor<N extends NomeEventoPromotor> = z.infer<(typeof EVENTOS_PROMOTOR)[N]>;
export const NOMES_EVENTOS_PROMOTOR = Object.keys(EVENTOS_PROMOTOR) as NomeEventoPromotor[];
