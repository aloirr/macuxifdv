/**
 * Emissão dos eventos `promotor.*@1` (T-0040): monta o payload pelo TIPO do contrato (`contracts/eventos.ts`) a
 * partir da coleta já aceita e valida com o schema ANTES de publicar. Payload inválido = `ErroPayloadEvento` com
 * a lista do que está errado; nada é devolvido para publicar (nunca sai evento pela metade).
 * Funções puras, sem relógio e sem I/O: o instante do fato vem da coleta (`*_em`), o envelope (`evento_id`,
 * `ocorrido_em`, `tenant_id`) é do platform-sdk. Na API, montar o evento na MESMA transação que grava a coleta:
 * se falhar, a escrita é recusada junto (outbox, ADR 0007).
 * RN-PRO-01: nenhum evento do Promotor fala de pedido.
 */
import type { ColetaPreco, FotoColeta, GondolaRegistro, MedicaoShare, RupturaItem, TarefaExecucao, VisitaLoja } from '../contracts/coletas';
import {
  EVENTOS_PROMOTOR,
  STATUS_RUPTURA_COM_ALERTA,
  type GondolaRegistradaV1,
  type NomeEventoPromotor,
  type PayloadEventoPromotor,
  type PrecoColetadoV1,
  type RupturaRegistradaV1,
  type ShareMedidoV1,
  type TarefaConcluidaV1,
  type VisitaLojaConcluidaV1,
} from '../contracts/eventos';
import { precoEfetivoCents, validarPrecoObservado } from './preco';

/** Evento pronto para `tx.publicar`: nome com versão + payload já validado pelo schema do contrato. */
export interface EventoPromotor<N extends NomeEventoPromotor = NomeEventoPromotor> {
  readonly nome: N;
  readonly payload: PayloadEventoPromotor<N>;
}

/** Payload que não passa no schema do contrato. `problemas` = `campo: mensagem`, em português. */
export class ErroPayloadEvento extends Error {
  readonly evento: string;
  readonly problemas: readonly string[];
  constructor(evento: string, problemas: readonly string[]) {
    super(`Evento ${evento} não publicado: payload inválido — ${problemas.join('; ')}`);
    this.name = 'ErroPayloadEvento';
    this.evento = evento;
    this.problemas = problemas;
  }
}

/**
 * Valida `payload` com o schema de `nome` e devolve o evento pronto (payload = saída do schema, congelada).
 * Lança `ErroPayloadEvento` se o nome não for do Promotor ou se o payload não passar.
 */
export function montarEventoPromotor<N extends NomeEventoPromotor>(nome: N, payload: PayloadEventoPromotor<N>): EventoPromotor<N> {
  const schema = EVENTOS_PROMOTOR[nome];
  if (!schema) throw new ErroPayloadEvento(String(nome), ['evento não publicado pelo Promotor (veja EVENTOS_PROMOTOR)']);
  const r = schema.safeParse(payload);
  if (!r.success) {
    throw new ErroPayloadEvento(
      nome,
      r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(payload)'}: ${i.message}`),
    );
  }
  return Object.freeze({ nome, payload: Object.freeze(r.data) as PayloadEventoPromotor<N> });
}

/** Quem e onde: `promotor_id` vem do token (servidor), `cliente_id` da visita de loja. */
export interface OrigemEvento {
  promotor_id: string;
  cliente_id: string;
}

/**
 * `promotor.visita_loja.concluida@1` no checkout. `fotos` = fotos desta visita (RN-PRO-02: conta as sem GPS).
 * Visita sem checkout/desfecho ou foto de outra visita = erro (bug de quem chama).
 */
export function eventoVisitaLojaConcluida(visita: VisitaLoja, origem: { promotor_id: string }, fotos: readonly Pick<FotoColeta, 'visita_loja_id' | 'sem_gps'>[]): EventoPromotor<'promotor.visita_loja.concluida@1'> {
  const nome = 'promotor.visita_loja.concluida@1' as const;
  const problemas: string[] = [];
  if (visita.checkout_em === null || visita.desfecho === null || visita.permanencia_min === null) {
    problemas.push('checkout_em: a visita de loja só é concluída depois do checkout (com desfecho e permanência).');
  }
  if (fotos.some((f) => f.visita_loja_id !== visita.id)) problemas.push('fotos: informe só as fotos desta visita de loja.');
  if (problemas.length) throw new ErroPayloadEvento(nome, problemas);
  const payload: VisitaLojaConcluidaV1 = {
    visita_loja_id: visita.id,
    visita_id: visita.visita_id,
    promotor_id: origem.promotor_id,
    cliente_id: visita.cliente_id,
    checklist_modelo_id: visita.checklist_modelo_id,
    checkin_em: visita.checkin_em,
    checkout_em: visita.checkout_em as string,
    permanencia_min: visita.permanencia_min as number,
    desfecho: visita.desfecho as NonNullable<VisitaLoja['desfecho']>,
    foto_fachada_id: visita.foto_fachada_id,
    fotos_total: fotos.length,
    fotos_sem_gps: fotos.filter((f) => f.sem_gps).length,
  };
  return montarEventoPromotor(nome, payload);
}

/** `promotor.gondola.registrada@1` (RF-PRO-03). O motivo (texto livre) fica na coleta, não no evento. */
export function eventoGondolaRegistrada(g: GondolaRegistro, origem: OrigemEvento): EventoPromotor<'promotor.gondola.registrada@1'> {
  const payload: GondolaRegistradaV1 = {
    gondola_id: g.id,
    visita_loja_id: g.visita_loja_id,
    promotor_id: origem.promotor_id,
    cliente_id: origem.cliente_id,
    categoria_gondola_id: g.categoria_gondola_id,
    conformidade: g.conformidade,
    foto_antes_id: g.foto_antes_id,
    foto_depois_id: g.foto_depois_id,
    foto_referencia_id: g.foto_referencia_id,
    registrado_em: g.registrado_em,
  };
  return montarEventoPromotor('promotor.gondola.registrada@1', payload);
}

/** `promotor.share.medido@1` (RF-PRO-04, RN-PRO-03): share e atingimento conferidos pelo schema. */
export function eventoShareMedido(m: MedicaoShare, origem: OrigemEvento): EventoPromotor<'promotor.share.medido@1'> {
  const payload: ShareMedidoV1 = {
    medicao_id: m.id,
    visita_loja_id: m.visita_loja_id,
    promotor_id: origem.promotor_id,
    cliente_id: origem.cliente_id,
    categoria_gondola_id: m.categoria_gondola_id,
    frentes_nossas: m.frentes_nossas,
    frentes_total: m.frentes_total,
    cm_nossos: m.cm_nossos,
    cm_total: m.cm_total,
    share_pct: m.share_pct,
    meta_share_id: m.meta_share_id,
    meta_pct: m.meta_pct,
    atingimento_pct: m.atingimento_pct,
    medido_em: m.medido_em,
  };
  return montarEventoPromotor('promotor.share.medido@1', payload);
}

/** `promotor.preco.coletado@1` (RF-PRO-05, RN-PRO-04): preço efetivo calculado pelo domain. */
export function eventoPrecoColetado(c: ColetaPreco, origem: OrigemEvento): EventoPromotor<'promotor.preco.coletado@1'> {
  const nome = 'promotor.preco.coletado@1' as const;
  const erros = validarPrecoObservado(c);
  if (erros.length) throw new ErroPayloadEvento(nome, erros.map((e) => `preco_cents: ${e}`));
  const payload: PrecoColetadoV1 = {
    coleta_id: c.id,
    visita_loja_id: c.visita_loja_id,
    promotor_id: origem.promotor_id,
    cliente_id: origem.cliente_id,
    produto_id: c.produto_id,
    concorrente_id: c.concorrente_id,
    produto_concorrente_id: c.produto_concorrente_id,
    preco_cents: c.preco_cents,
    em_promocao: c.em_promocao,
    em_encarte: c.em_encarte,
    preco_promocional_cents: c.preco_promocional_cents,
    preco_efetivo_cents: precoEfetivoCents(c),
    preco_nosso_ref_cents: c.preco_nosso_ref_cents,
    indice_preco: c.indice_preco,
    variacao_confirmada: c.variacao_confirmada,
    coletado_em: c.coletado_em,
  };
  return montarEventoPromotor(nome, payload);
}

/** `promotor.ruptura.registrada@1` (RF-PRO-06, RN-PRO-05): um por item do mix, inclusive `presente`. */
export function eventoRupturaRegistrada(r: RupturaItem, origem: OrigemEvento): EventoPromotor<'promotor.ruptura.registrada@1'> {
  const payload: RupturaRegistradaV1 = {
    registro_id: r.id,
    visita_loja_id: r.visita_loja_id,
    promotor_id: origem.promotor_id,
    cliente_id: origem.cliente_id,
    produto_id: r.produto_id,
    mix_obrigatorio_id: r.mix_obrigatorio_id,
    status: r.status,
    quantidade_reposta: r.quantidade_reposta,
    registrado_em: r.registrado_em,
  };
  return montarEventoPromotor('promotor.ruptura.registrada@1', payload);
}

/** RN-PRO-05: o item em ruptura (gôndola ou total) gera alerta ao vendedor; `presente` não. */
export function rupturaGeraAlerta(p: Pick<RupturaRegistradaV1, 'status'>): boolean {
  return (STATUS_RUPTURA_COM_ALERTA as readonly string[]).includes(p.status);
}

/** `promotor.tarefa.concluida@1` (RF-PRO-10): comprovação por foto (pelo menos uma). */
export function eventoTarefaConcluida(t: TarefaExecucao, origem: { promotor_id: string }): EventoPromotor<'promotor.tarefa.concluida@1'> {
  const payload: TarefaConcluidaV1 = {
    execucao_id: t.id,
    tarefa_id: t.tarefa_trade_id,
    visita_loja_id: t.visita_loja_id,
    promotor_id: origem.promotor_id,
    cliente_id: t.cliente_id,
    fotos_total: t.foto_ids.length,
    concluida_em: t.concluida_em,
  };
  return montarEventoPromotor('promotor.tarefa.concluida@1', payload);
}
