/**
 * Histórico do pedido e do orçamento em tags (RN-VEN-30, RF-VEN-05, T-0138): traduz os eventos que o módulo tem para a forma que
 * o `tagsDoHistorico` do kit espera (o mesmo no Campo, na Gestão e no BKO). Funções puras. Regras:
 * - nunca texto técnico ("Recebido pelo servidor") nem status cru: o kit esconde o que não tem tag;
 * - Rejeitado e Cancelado levam o motivo; os outros estados não mostram nota;
 * - o autor só aparece quando não é o vendedor do pedido e é uma pessoa (não "aparelho", "ERP").
 */
import type { OrderEvent } from '../contracts';
import { ROTULO_MOTIVO_APROVACAO, type MotivoAprovacao } from './aprovacao';
import type { SituacaoOrcamento } from './orcamento';

/** Mesma forma do `EventoDoHistorico` do kit de UI (o domain não importa o kit). */
export interface EventoHistoricoPedido {
  id?: string;
  status: string;
  em: string;
  motivo?: string | null;
  autor?: string | null;
  autorEhVendedor?: boolean;
  numeroPedido?: string | null;
}

/** Autores que não são pessoas ("aparelho", "servidor", "ERP"): o nome não aparece na tag. */
const AUTORES_TECNICOS = new Set(['aparelho', 'servidor', 'sistema', 'erp', 'api', 'hub', 'conector']);

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** O autor é o vendedor do pedido, ou não é uma pessoa (sistema)? Então o nome não aparece (RN-VEN-30). */
export function autorEhOVendedor(autor: string | null | undefined, vendedorNome: string | null | undefined): boolean {
  const a = semAcento(autor ?? '');
  if (a === '' || AUTORES_TECNICOS.has(a)) return true;
  return a === semAcento(vendedorNome ?? '');
}

/** Frases técnicas que nunca viram motivo ("Recebido pelo servidor."). */
const MOTIVO_TECNICO = /^(recebido pelo servidor|aguardando envio|criado no aparelho sem sinal|pedido recebido)\.?$/i;
export function motivoDoEvento(nota: string | null | undefined): string | null {
  const n = (nota ?? '').replace(/\s+/g, ' ').trim();
  return n === '' || MOTIVO_TECNICO.test(n) ? null : n;
}

/** Eventos do PEDIDO para o `tagsDoHistorico` do kit: o que não tem tag (ex.: enviado_erp, Editado) o kit esconde. */
export function eventosDoPedido(historico: ReadonlyArray<OrderEvent>, ctx: { vendedorNome: string; motivoDoFechamento?: string | null }): EventoHistoricoPedido[] {
  const vistos = new Set<string>();
  const out: EventoHistoricoPedido[] = [];
  historico.forEach((e, i) => {
    const chave = `${e.status}|${e.at}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    const fecha = ['rejected', 'cancelled'].includes(e.status);
    out.push({ id: `${e.status}-${i}`, status: e.status, em: e.at, motivo: motivoDoEvento(e.note) ?? (fecha ? motivoDoEvento(ctx.motivoDoFechamento) : null), autor: e.by, autorEhVendedor: autorEhOVendedor(e.by, ctx.vendedorNome) });
  });
  return out;
}

/**
 * Eventos do ORÇAMENTO (RN-VEN-30/18): Salvo (o primeiro evento) · Transformado em pedido nº (calculado) · Cancelado (+ motivo).
 * O orçamento não tem status próprio nem vence (RN-VEN-18, 09/11): `convertido` vem da situação calculada.
 */
export function eventosDoOrcamento(
  historico: ReadonlyArray<OrderEvent>,
  ctx: { vendedorNome: string; situacao: SituacaoOrcamento; criadoEm: string; convertidoEm?: string | null; numeroPedido?: string | null },
): EventoHistoricoPedido[] {
  const primeiro = historico[0];
  const salvoEm = primeiro?.at ?? ctx.criadoEm;
  const out: EventoHistoricoPedido[] = [{ id: 'salvo', status: 'salvo', em: salvoEm, autor: primeiro?.by ?? null, autorEhVendedor: autorEhOVendedor(primeiro?.by, ctx.vendedorNome) }];
  const cancelado = historico.find((e) => ['cancelled', 'cancelado'].includes(semAcento(e.status)));
  if (cancelado) out.push({ id: 'cancelado', status: 'cancelado', em: cancelado.at, motivo: motivoDoEvento(cancelado.note), autor: cancelado.by, autorEhVendedor: autorEhOVendedor(cancelado.by, ctx.vendedorNome) });
  if (ctx.situacao === 'convertido') out.push({ id: 'convertido', status: 'convertido', em: ctx.convertidoEm ?? salvoEm, numeroPedido: ctx.numeroPedido ?? null, autorEhVendedor: true });
  return out;
}



/**
 * T-0184 (P3 B, prancha 02, MC-1760): a etapa "Em aprovação" do Histórico vira uma por motivo ainda pendente, SEM data
 * ("Em aprovação · Crédito"), e cada motivo já aprovado entra logo antes dela como "Aprovado · <motivo>" (tom sucesso).
 * Cada motivo aparece uma vez. As outras etapas ficam como estão. Sem motivos pendentes, nada muda.
 */
export function tagsPorMotivoPendente<T extends { id: string; rotulo: string; texto: string; leitura: string; tom: string }>(
  tags: readonly T[],
  motivosPendentes: readonly MotivoAprovacao[],
  motivosAprovados: readonly MotivoAprovacao[] = [],
): T[] {
  if (motivosPendentes.length === 0) return [...tags];
  return tags.flatMap((t) => {
    if (t.rotulo !== 'Em aprovação') return [t];
    const aprovadas = motivosAprovados.map((m) => ({ ...t, id: `${t.id}-aprovado-${m}`, rotulo: 'Aprovado', texto: `Aprovado · ${ROTULO_MOTIVO_APROVACAO[m]}`, leitura: `Aprovado, ${ROTULO_MOTIVO_APROVACAO[m]}`, tom: 'sucesso' }));
    const pendentes = motivosPendentes.map((m) => ({ ...t, id: `${t.id}-${m}`, rotulo: `${t.rotulo} · ${ROTULO_MOTIVO_APROVACAO[m]}`, texto: `${t.rotulo} · ${ROTULO_MOTIVO_APROVACAO[m]}`, leitura: `${t.rotulo}, ${ROTULO_MOTIVO_APROVACAO[m]}` }));
    return [...aprovadas, ...pendentes];
  });
}
