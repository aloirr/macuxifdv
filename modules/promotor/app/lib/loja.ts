/**
 * Lógica da aba Loja no aparelho (T-0056), pura e testável: acha o check-in aberto do Core nas linhas locais e na fila,
 * e monta cada coleta no formato do contrato com os cálculos do domain (share, atingimento, presença, preço,
 * permanência) — a tela não calcula nada. Offline-first: tudo vem do que está no aparelho; a API revalida depois.
 * RN-PRO-01: nenhuma coleta fala de pedido.
 */
import type { CheckinVisita, CheckoutVisita, VisitaSync } from '@macuxi/core/contracts';
import type { ChecklistResposta, ColetaPreco, FotoColeta, GondolaRegistro, MedicaoShare, RupturaItem, TarefaExecucao, TipoFoto, VisitaLoja } from '../../contracts';
import {
  arredondar,
  atingimentoShare,
  calcularShare,
  classificarPresenca,
  exigeConfirmacaoDePreco,
  permanenciaMinutos,
  validarConformidade,
  type Conformidade,
  type DesfechoVisita,
} from '../../domain';

/** Check-in aberto do Core que a loja usa como "visita" (RN-PRO-02). */
export interface CheckinAberto {
  visita_id: string;
  cliente_id: string;
  checkin_em: string;
}

/** Item da fila do motor (subconjunto estrutural de `ItemOutbox`). */
export interface ItemFila {
  entidade: string;
  payload: unknown;
}

/**
 * RN-PRO-02: a visita do Core aberta do usuário — linhas do pull (sem checkout) + check-ins ainda na fila, menos as que
 * têm checkout na fila. Mais de uma (não deveria, RN-CORE-11): a de check-in mais recente.
 */
export function checkinAberto(linhas: readonly Pick<VisitaSync, 'id' | 'usuario_id' | 'cliente_id' | 'checkin_em' | 'checkout_em' | 'deleted_at'>[], fila: readonly ItemFila[], usuarioId: string): CheckinAberto | null {
  const fechadas = new Set(fila.filter((i) => i.entidade === 'visita_checkout').map((i) => (i.payload as CheckoutVisita).visita_id));
  const abertas: CheckinAberto[] = [
    ...linhas.filter((l) => l.usuario_id === usuarioId && !l.deleted_at && !l.checkout_em).map((l) => ({ visita_id: l.id, cliente_id: l.cliente_id, checkin_em: new Date(l.checkin_em).toISOString() })),
    ...fila.filter((i) => i.entidade === 'visita').map((i) => i.payload as CheckinVisita).map((p) => ({ visita_id: p.id, cliente_id: p.cliente_id, checkin_em: new Date(p.checkin_em).toISOString() })),
  ].filter((v) => !fechadas.has(v.visita_id));
  if (abertas.length === 0) return null;
  return abertas.reduce((a, b) => (Date.parse(b.checkin_em) > Date.parse(a.checkin_em) ? b : a));
}

/** Visita de loja aberta sobre o check-in do Core (mesmo instante do check-in: a janela da RN-PRO-02 começa nele). */
export function abrirVisitaLoja(id: string, c: CheckinAberto, checklist_modelo_id: string | null): VisitaLoja {
  return { id, visita_id: c.visita_id, cliente_id: c.cliente_id, checklist_modelo_id, checkin_em: c.checkin_em, checkout_em: null, permanencia_min: null, desfecho: null, foto_fachada_id: null, observacao: null };
}

/** Checkout da visita de loja: permanência calculada pelo domain (RN-PRO-07). */
export function fecharVisitaLoja(v: VisitaLoja, agora: Date, desfecho: DesfechoVisita = 'realizada', foto_fachada_id: string | null = null): VisitaLoja {
  const fim = new Date(Math.max(agora.getTime(), Date.parse(v.checkin_em))).toISOString();
  return { ...v, checkout_em: fim, permanencia_min: arredondar(permanenciaMinutos(v.checkin_em, fim)), desfecho, foto_fachada_id };
}

/** Foto tirada agora pela câmera do app (RN-PRO-02); sem coordenada = `sem_gps`. */
export function montarFoto(e: { id: string; visita_loja_id: string; tipo: TipoFoto; agora: Date; latitude?: number | null; longitude?: number | null }): FotoColeta {
  const temGps = typeof e.latitude === 'number' && typeof e.longitude === 'number';
  return {
    id: e.id,
    visita_loja_id: e.visita_loja_id,
    tipo: e.tipo,
    origem: 'camera',
    tirada_em: e.agora.toISOString(),
    latitude: temGps ? (e.latitude as number) : null,
    longitude: temGps ? (e.longitude as number) : null,
    sem_gps: !temGps,
    arquivo_ref: null,
    enviada_em: null,
  };
}

export type Montagem<T> = { ok: true; coleta: T } | { ok: false; erro: string };

const inteiro = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** Share da categoria (RN-PRO-03): % e atingimento na hora, com a meta vigente da loja (ou sem meta). */
export function montarShare(e: { id: string; visita_loja_id: string; categoria_gondola_id: string; frentes_nossas: string; frentes_total: string; meta: { id: string; meta_pct: number } | null; agora: Date }): Montagem<MedicaoShare> {
  const nossas = inteiro(e.frentes_nossas);
  const total = inteiro(e.frentes_total);
  if (nossas === null || total === null) return { ok: false, erro: 'Informe as frentes como números inteiros.' };
  const r = calcularShare({ frentes_nossas: nossas, frentes_total: total });
  if (r.status === 'inconsistente') return { ok: false, erro: r.motivo ?? 'Confira a contagem das frentes.' };
  const a = atingimentoShare(r.share_pct, e.meta?.meta_pct ?? null);
  return {
    ok: true,
    coleta: {
      id: e.id,
      visita_loja_id: e.visita_loja_id,
      categoria_gondola_id: e.categoria_gondola_id,
      frentes_nossas: nossas,
      frentes_total: total,
      cm_nossos: null,
      cm_total: null,
      share_pct: r.share_pct,
      meta_share_id: a.meta_pct === null ? null : (e.meta?.id ?? null),
      meta_pct: a.meta_pct,
      atingimento_pct: a.atingimento_pct,
      medido_em: e.agora.toISOString(),
    },
  };
}

/** Presença de um item do mix (RF-PRO-06, RN-PRO-05): na gôndola / falta com estoque no depósito / sem estoque. */
export function montarRuptura(e: { id: string; visita_loja_id: string; produto_id: string; mix_obrigatorio_id: string; na_gondola: boolean; no_deposito: boolean | null; quantidade_reposta?: number; agora: Date }): Montagem<RupturaItem> {
  let status: RupturaItem['status'];
  try {
    status = classificarPresenca({ na_gondola: e.na_gondola, no_deposito: e.no_deposito });
  } catch (x) {
    return { ok: false, erro: (x as Error).message };
  }
  return {
    ok: true,
    coleta: { id: e.id, visita_loja_id: e.visita_loja_id, produto_id: e.produto_id, mix_obrigatorio_id: e.mix_obrigatorio_id, status, quantidade_reposta: status === 'ruptura_total' ? 0 : (e.quantidade_reposta ?? 0), foto_id: null, registrado_em: e.agora.toISOString() },
  };
}

/** Converte reais digitados ("10,90", "10.90", "R$ 10") em centavos inteiros; `null` se inválido. */
export function reaisParaCentavos(s: string): number | null {
  const t = s.trim().replace(/\s|R\$/g, '');
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(t)) return null;
  const [inteira, dec = ''] = t.split(/[.,]/);
  const c = Number(inteira) * 100 + Number(dec.padEnd(2, '0'));
  return c > 0 ? c : null;
}

/**
 * Preço de prateleira do NOSSO item (RF-PRO-05). RN-PRO-04: variação acima do limite sobre a última coleta exige a
 * confirmação explícita (`confirmar_variacao`); sem ela, a montagem devolve `precisa_confirmar`.
 */
export function montarPreco(e: { id: string; visita_loja_id: string; produto_id: string; preco: string; anterior_cents: number | null; confirmar_variacao: boolean; limite_pct: number; agora: Date }): Montagem<ColetaPreco> | { ok: false; erro: string; precisa_confirmar: true } {
  const cents = reaisParaCentavos(e.preco);
  if (cents === null) return { ok: false, erro: 'Informe o preço em reais, por exemplo 10,90.' };
  if (!e.confirmar_variacao && exigeConfirmacaoDePreco(cents, e.anterior_cents, e.limite_pct)) {
    return { ok: false, erro: `O preço variou mais de ${e.limite_pct}% desde a última coleta. Confira o valor e confirme.`, precisa_confirmar: true };
  }
  return {
    ok: true,
    coleta: {
      id: e.id,
      visita_loja_id: e.visita_loja_id,
      produto_id: e.produto_id,
      concorrente_id: null,
      produto_concorrente_id: null,
      preco_cents: cents,
      em_promocao: false,
      em_encarte: false,
      preco_promocional_cents: null,
      preco_nosso_ref_cents: null,
      indice_preco: null,
      preco_anterior_cents: e.anterior_cents,
      variacao_confirmada: e.confirmar_variacao && exigeConfirmacaoDePreco(cents, e.anterior_cents, e.limite_pct),
      coletado_em: e.agora.toISOString(),
    },
  };
}

/** Gôndola (RF-PRO-03): fotos antes e depois + conformidade; motivo obrigatório em não conforme. */
export function montarGondola(e: { id: string; visita_loja_id: string; categoria_gondola_id: string; foto_antes_id: string | null; foto_depois_id: string | null; foto_referencia_id: string | null; conformidade: Conformidade; motivo: string; agora: Date }): Montagem<GondolaRegistro> {
  if (!e.foto_antes_id || !e.foto_depois_id) return { ok: false, erro: 'Tire a foto do antes e a do depois da arrumação.' };
  const motivo = e.motivo.trim() || null;
  const erros = validarConformidade({ conformidade: e.conformidade, motivo });
  if (erros.length) return { ok: false, erro: erros[0]! };
  return { ok: true, coleta: { id: e.id, visita_loja_id: e.visita_loja_id, categoria_gondola_id: e.categoria_gondola_id, foto_antes_id: e.foto_antes_id, foto_depois_id: e.foto_depois_id, foto_referencia_id: e.foto_referencia_id, conformidade: e.conformidade, motivo, registrado_em: e.agora.toISOString() } };
}

/** Resposta de uma etapa do checklist (RF-PRO-02); `obrigatoria` é o retrato do checklist vigente (RN-PRO-06/10). */
export function montarResposta(e: { id: string; visita_loja_id: string; checklist_item_id: string; obrigatoria: boolean; concluida: boolean; agora: Date }): ChecklistResposta {
  return { id: e.id, visita_loja_id: e.visita_loja_id, checklist_item_id: e.checklist_item_id, obrigatoria: e.obrigatoria, concluida: e.concluida, respondido_em: e.agora.toISOString(), valor: null, foto_id: null };
}

/** Conclusão de tarefa de campanha (RF-PRO-10): ao menos uma foto. */
export function montarTarefa(e: { id: string; tarefa_trade_id: string; visita_loja_id: string; cliente_id: string; foto_ids: readonly string[]; agora: Date }): Montagem<TarefaExecucao> {
  if (e.foto_ids.length === 0) return { ok: false, erro: 'Tire ao menos uma foto para comprovar a tarefa.' };
  return { ok: true, coleta: { id: e.id, tarefa_trade_id: e.tarefa_trade_id, visita_loja_id: e.visita_loja_id, cliente_id: e.cliente_id, foto_ids: [...e.foto_ids], observacao: null, concluida_em: e.agora.toISOString() } };
}
