/**
 * Contratos das coletas do promotor (docs/produto/04, schema `promotor`). Todas as coletas:
 *  - têm `id` UUID gerado no aparelho e `visita_loja_id` (a coleta só existe com check-in aberto, RN-PRO-02);
 *  - guardam a versão vigente das regras no momento (RN-PRO-10) por `*_id` do cadastro vigente;
 *  - referenciam produto nosso pelo produto base do Core (`produto_id`).
 * `tenant_id`, `promotor_id`, `created_at`… vêm do token/servidor e não entram no payload do aparelho.
 * Refinamentos de regra rodam aqui também (a API sempre revalida), reaproveitando o `domain`.
 */
import { z } from 'zod';
import { DESFECHOS_VISITA } from '../domain/checklist';
import { permanenciaMinutos, PERMANENCIA_TOLERANCIA_MIN } from '../domain/permanencia';
import { CONFORMIDADES, validarConformidade } from '../domain/gondola';
import { conferirPontoExtra, TIPOS_PONTO_EXTRA } from '../domain/pontos-extras';
import { validarPrecoObservado, precoEfetivoCents, indicePreco } from '../domain/preco';
import { quantidadeRepostaValida, STATUS_PRESENCA } from '../domain/ruptura';
import { atingimentoShare, calcularShare } from '../domain/share';
import { ehDataCivil } from '../domain/numeros';
import { ClienteId, InstanteUtc, IsoDate, Latitude, Longitude, PctNumero, PrecoCents, ProdutoId, TextoCurto, Uuid } from './base';

const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

// ---------- foto ----------
export const TIPOS_FOTO = ['gondola_antes', 'gondola_depois', 'validade', 'avaria', 'ponto_extra', 'concorrencia', 'fachada', 'tarefa', 'preco', 'outro'] as const;
export const TipoFoto = z.enum(TIPOS_FOTO);
export type TipoFoto = z.infer<typeof TipoFoto>;

/**
 * Foto da coleta. RN-PRO-02: tirada na hora pela câmera do app (galeria bloqueada), com data/hora e
 * coordenada. Comprimida no aparelho e enviada em segundo plano (`enviada_em` nulo até o upload).
 */
export const FotoColeta = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    tipo: TipoFoto,
    origem: z.literal('camera'),
    tirada_em: InstanteUtc,
    /** RN-PRO-02: coordenada quando disponível; sem sinal de GPS a foto é aceita com `sem_gps = true`. */
    latitude: Latitude.nullable(),
    longitude: Longitude.nullable(),
    sem_gps: z.boolean(),
    /** Referência do arquivo no armazenamento (preenchida após o upload). */
    arquivo_ref: z.string().min(1).nullable().default(null),
    enviada_em: InstanteUtc.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const lat = v.latitude !== null;
    const lon = v.longitude !== null;
    if (lat !== lon) issue(ctx, [lat ? 'longitude' : 'latitude'], 'RN-PRO-02: informe latitude e longitude juntas, ou nenhuma.');
    else if (lat && v.sem_gps) issue(ctx, ['sem_gps'], 'RN-PRO-02: a foto tem coordenada, então sem_gps deve ser falso.');
    else if (!lat && !v.sem_gps) issue(ctx, ['sem_gps'], 'RN-PRO-02: foto sem coordenada deve ser marcada com sem_gps verdadeiro.');
  });
export type FotoColeta = z.infer<typeof FotoColeta>;

// ---------- visita de loja (RF-PRO-02, RN-PRO-06/07) ----------
export const DesfechoVisita = z.enum(DESFECHOS_VISITA);

export const VisitaLoja = z
  .object({
    id: Uuid,
    /** Visita (check-in/checkout) do Core à qual esta visita de loja se refere. */
    visita_id: Uuid,
    cliente_id: ClienteId,
    /** RN-PRO-10: checklist vigente no momento do check-in. */
    checklist_modelo_id: Uuid.nullable(),
    checkin_em: InstanteUtc,
    checkout_em: InstanteUtc.nullable(),
    /**
     * Derivado de check-in/checkout (RN-PRO-07); guardado para relatórios. O aparelho NÃO é fonte da verdade:
     * o contrato recusa valor que diverge de `permanenciaMinutos(checkin_em, checkout_em)`.
     */
    permanencia_min: z.number().nonnegative().nullable(),
    desfecho: DesfechoVisita.nullable(),
    /** RN-PRO-06: loja fechada / acesso negado exigem a foto da fachada. */
    foto_fachada_id: Uuid.nullable(),
    observacao: z.string().max(1000).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.checkout_em !== null) {
      if (Date.parse(v.checkout_em) < Date.parse(v.checkin_em)) issue(ctx, ['checkout_em'], 'O checkout não pode ser anterior ao check-in.');
      else if (v.permanencia_min === null || Math.abs(v.permanencia_min - permanenciaMinutos(v.checkin_em, v.checkout_em)) > PERMANENCIA_TOLERANCIA_MIN) {
        issue(ctx, ['permanencia_min'], 'RN-PRO-07: a permanência informada não confere com o check-in e o checkout.');
      }
      if (v.desfecho === null) issue(ctx, ['desfecho'], 'Informe o desfecho da visita no checkout.');
    } else if (v.desfecho !== null || v.permanencia_min !== null) {
      issue(ctx, ['checkout_em'], 'Desfecho e permanência só existem depois do checkout.');
    }
    if ((v.desfecho === 'loja_fechada' || v.desfecho === 'acesso_negado') && v.foto_fachada_id === null) {
      issue(ctx, ['foto_fachada_id'], 'RN-PRO-06: loja fechada ou acesso negado exige a foto da fachada.');
    }
  });
export type VisitaLoja = z.infer<typeof VisitaLoja>;

export const ChecklistResposta = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    checklist_item_id: Uuid,
    /** Snapshot: a etapa era obrigatória no checklist vigente (RN-PRO-06/10). */
    obrigatoria: z.boolean(),
    concluida: z.boolean(),
    respondido_em: InstanteUtc,
    valor: z.string().max(1000).nullable().default(null),
    foto_id: Uuid.nullable().default(null),
  })
  .strict();
export type ChecklistResposta = z.infer<typeof ChecklistResposta>;

// ---------- gôndola (RF-PRO-03) ----------
export const ConformidadeGondola = z.enum(CONFORMIDADES);

export const GondolaRegistro = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    categoria_gondola_id: Uuid,
    foto_antes_id: Uuid,
    foto_depois_id: Uuid,
    /** Foto/planograma de referência vigente comparada (RN-PRO-10). */
    foto_referencia_id: Uuid.nullable(),
    conformidade: ConformidadeGondola,
    motivo: z.string().max(500).nullable().default(null),
    registrado_em: InstanteUtc,
  })
  .strict()
  .superRefine((g, ctx) => {
    for (const msg of validarConformidade(g)) issue(ctx, ['motivo'], msg);
  });
export type GondolaRegistro = z.infer<typeof GondolaRegistro>;

// ---------- share (RF-PRO-04, RN-PRO-03) ----------
const Frentes = z.number().int().nonnegative();
const Cm = z.number().nonnegative();

export const MedicaoShare = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    categoria_gondola_id: Uuid,
    frentes_nossas: Frentes,
    frentes_total: Frentes,
    cm_nossos: Cm.nullable().default(null),
    cm_total: Cm.nullable().default(null),
    /** Calculado na hora (RN-PRO-03); a API recalcula e recusa se divergir. `null` = categoria sem frentes. */
    share_pct: PctNumero.min(0).max(100).nullable(),
    /** Meta vigente da loja/categoria no momento (RN-PRO-10); `null` = sem meta cadastrada. */
    meta_share_id: Uuid.nullable(),
    meta_pct: PctNumero.min(0).max(100).nullable(),
    atingimento_pct: PctNumero.min(0).nullable(),
    medido_em: InstanteUtc,
  })
  .strict()
  .superRefine((m, ctx) => {
    const r = calcularShare(m);
    if (r.status === 'inconsistente') issue(ctx, ['frentes_nossas'], r.motivo ?? 'Medição inconsistente.');
    else if (r.share_pct !== m.share_pct) issue(ctx, ['share_pct'], 'O share informado não confere com as frentes (ou centímetros) medidos.');
    if (m.meta_pct === null && m.meta_share_id !== null) issue(ctx, ['meta_pct'], 'Meta vigente informada sem o valor da meta.');
    if (m.meta_pct !== null && m.meta_share_id === null) issue(ctx, ['meta_share_id'], 'RN-PRO-10: informe a meta vigente usada no atingimento.');
    // RN-PRO-03: o atingimento é sempre recalculado de share e meta; o do aparelho só passa se conferir.
    const esperado = atingimentoShare(r.status === 'inconsistente' ? null : r.share_pct, m.meta_pct).atingimento_pct;
    if (m.atingimento_pct !== esperado) issue(ctx, ['atingimento_pct'], 'RN-PRO-03: o atingimento informado não confere com o share e a meta.');
  });
export type MedicaoShare = z.infer<typeof MedicaoShare>;

// ---------- preço (RF-PRO-05, RN-PRO-04) ----------
/**
 * Uma observação de preço. `produto_concorrente_id` nulo = preço do NOSSO item (`produto_id`, produto base
 * do Core); preenchido = preço do concorrente para comparar com o nosso `produto_id`.
 */
export const ColetaPreco = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    produto_id: ProdutoId,
    concorrente_id: Uuid.nullable(),
    produto_concorrente_id: Uuid.nullable(),
    preco_cents: PrecoCents,
    em_promocao: z.boolean().default(false),
    em_encarte: z.boolean().default(false),
    preco_promocional_cents: PrecoCents.nullable().default(null),
    /** Preço efetivo do nosso item na mesma visita, usado no índice (só em linhas de concorrente). */
    preco_nosso_ref_cents: PrecoCents.nullable().default(null),
    /** nosso ÷ concorrente × 100 (RN-PRO-04); só em linhas de concorrente com referência. */
    indice_preco: PctNumero.nonnegative().nullable().default(null),
    /** Preço da última coleta do mesmo item/loja, para a checagem de variação. */
    preco_anterior_cents: PrecoCents.nullable().default(null),
    /** RN-PRO-04: o promotor confirmou o preço que variou mais que o limite. */
    variacao_confirmada: z.boolean().default(false),
    coletado_em: InstanteUtc,
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const msg of validarPrecoObservado(c)) issue(ctx, ['preco_promocional_cents'], msg);
    const concorrente = c.produto_concorrente_id !== null;
    if (concorrente && c.concorrente_id === null) issue(ctx, ['concorrente_id'], 'Informe o concorrente do produto coletado.');
    if (!concorrente && (c.indice_preco !== null || c.preco_nosso_ref_cents !== null)) {
      issue(ctx, ['indice_preco'], 'O índice de preço só existe nas linhas de preço do concorrente.');
    }
    if (concorrente && c.indice_preco !== null) {
      if (c.preco_nosso_ref_cents === null) issue(ctx, ['preco_nosso_ref_cents'], 'Informe o preço do nosso item usado no índice.');
      else if (validarPrecoObservado(c).length === 0) {
        const esperado = indicePreco(c.preco_nosso_ref_cents, precoEfetivoCents(c));
        if (esperado !== c.indice_preco) issue(ctx, ['indice_preco'], 'O índice de preço não confere com os preços informados.');
      }
    }
  });
export type ColetaPreco = z.infer<typeof ColetaPreco>;

// ---------- ruptura (RF-PRO-06, RN-PRO-05) ----------
export const StatusPresenca = z.enum(STATUS_PRESENCA);

export const RupturaItem = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    produto_id: ProdutoId,
    /** Mix obrigatório vigente que originou o item (RN-PRO-10). */
    mix_obrigatorio_id: Uuid,
    status: StatusPresenca,
    quantidade_reposta: z.number().int().nonnegative().default(0),
    foto_id: Uuid.nullable().default(null),
    registrado_em: InstanteUtc,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!quantidadeRepostaValida(r.status, r.quantidade_reposta)) issue(ctx, ['quantidade_reposta'], 'Em ruptura total não há quantidade reposta (informe 0).');
  });
export type RupturaItem = z.infer<typeof RupturaItem>;

// ---------- validade e avarias (RF-PRO-07, RN-PRO-08) ----------
export const TipoOcorrenciaValidade = z.enum(['validade', 'avaria']);

export const ValidadeItem = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    produto_id: ProdutoId,
    tipo: TipoOcorrenciaValidade,
    /** Data civil de vencimento (obrigatória no tipo `validade`). */
    validade: IsoDate.nullable().default(null),
    lote: z.string().max(60).nullable().default(null),
    quantidade: z.number().int().positive(),
    /** Obrigatório na avaria. */
    motivo_avaria: z.string().max(300).nullable().default(null),
    foto_id: Uuid.nullable().default(null),
    registrado_em: InstanteUtc,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tipo === 'validade') {
      if (v.validade === null || !ehDataCivil(v.validade)) issue(ctx, ['validade'], 'Informe a data de validade do item.');
    } else {
      if (!(v.motivo_avaria ?? '').trim()) issue(ctx, ['motivo_avaria'], 'Informe o motivo da avaria.');
      if (v.foto_id === null) issue(ctx, ['foto_id'], 'Tire a foto do produto avariado.');
    }
  });
export type ValidadeItem = z.infer<typeof ValidadeItem>;

// ---------- pontos extras (RF-PRO-08) ----------
export const TipoPontoExtra = z.enum(TIPOS_PONTO_EXTRA);

/** Cadastro (BKO): ponto extra negociado com a loja, com vigência (RN-PRO-10). */
export const PontoExtraNegociado = z
  .object({
    id: Uuid,
    cliente_id: ClienteId,
    tipo: TipoPontoExtra,
    local_combinado: TextoCurto,
    produto_id: ProdutoId.nullable().default(null),
    vigencia_inicio: IsoDate,
    vigencia_fim: IsoDate.nullable().default(null),
  })
  .strict()
  .refine((p) => p.vigencia_fim === null || p.vigencia_fim >= p.vigencia_inicio, { path: ['vigencia_fim'], message: 'O fim da vigência não pode ser anterior ao início.' });
export type PontoExtraNegociado = z.infer<typeof PontoExtraNegociado>;

/**
 * Coleta: conferência de ponto negociado (`ponto_extra_negociado_id` preenchido) ou ponto encontrado sem
 * negociação (nulo). Foto obrigatória quando o ponto existe.
 */
export const PontoExtra = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    ponto_extra_negociado_id: Uuid.nullable(),
    tipo: TipoPontoExtra,
    existe: z.boolean(),
    no_lugar: z.boolean(),
    abastecido: z.boolean(),
    foto_id: Uuid.nullable().default(null),
    observacao: z.string().max(500).nullable().default(null),
    registrado_em: InstanteUtc,
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const msg of conferirPontoExtra(p).erros) issue(ctx, ['existe'], msg);
    if (p.existe && p.foto_id === null) issue(ctx, ['foto_id'], 'Tire a foto do ponto extra encontrado.');
  });
export type PontoExtra = z.infer<typeof PontoExtra>;

// ---------- concorrência (RF-PRO-09) ----------
export const AcaoConcorrencia = z
  .object({
    id: Uuid,
    visita_loja_id: Uuid,
    concorrente_id: Uuid,
    tipo: z.enum(['lancamento', 'promocao', 'acao_pdv', 'outro']),
    descricao: TextoCurto,
    foto_id: Uuid.nullable().default(null),
    registrado_em: InstanteUtc,
  })
  .strict();
export type AcaoConcorrencia = z.infer<typeof AcaoConcorrencia>;

// ---------- tarefa de campanha (RF-PRO-10) ----------
export const TarefaExecucao = z
  .object({
    id: Uuid,
    tarefa_trade_id: Uuid,
    visita_loja_id: Uuid,
    cliente_id: ClienteId,
    /** Comprovação por foto: pelo menos uma. */
    foto_ids: z.array(Uuid).min(1, 'Tire ao menos uma foto para comprovar a tarefa.'),
    observacao: z.string().max(500).nullable().default(null),
    concluida_em: InstanteUtc,
  })
  .strict();
export type TarefaExecucao = z.infer<typeof TarefaExecucao>;
