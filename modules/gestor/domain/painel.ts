/**
 * Painel do dia por usuário de campo (`gestor.painel_vendedor_dia`, RF-GES-01/02/10) e meta do mês (RN-CORE-21/22).
 * Tudo é DERIVADO do estado da projeção (projecao.ts): reaplicar eventos ou recebê-los fora de ordem não muda o painel.
 * O "dia" é a data civil no fuso do tenant (`parametros.fuso`); o armazenado é sempre UTC.
 * Módulo opcional desativado (ou seção que não se aplica ao perfil) ⇒ a seção é `null`, o painel continua válido.
 */
import { businessDays, localDate } from '@macuxi/comum';
import type { PainelDia, PainelMes, PainelPesquisa, PainelTrade, PainelTreinamento, PainelVendas, PainelVisitas, StatusDia } from '../contracts';
import { statusAtual, vendasApuradas } from './apuracao';
import { arredondar, dividirCents, instanteMs, percentual, somarDias } from './numeros';
import { resolverParametros, type ParametrosGestor } from './parametros';
import type { EstadoProjecao } from './projecao';

export type PerfilPainel = PainelDia['perfil'];

export interface UsuarioPainel {
  id: string;
  perfil: PerfilPainel;
}

export interface ContextoPainel {
  params?: Partial<ParametrosGestor>;
  /** Módulos efetivos do usuário que consulta (RN-CORE-01). `core` é implícito. */
  modulos: ReadonlySet<string>;
  /** Instante UTC do cálculo (vira `calculado_em`). */
  agora: string;
}

/** Data civil de um instante UTC no fuso do tenant. */
export function diaLocal(instante: string, fuso: string): string {
  return localDate(new Date(instanteMs(instante)), fuso);
}

const dentro = (dia: string, inicio: string, fim: string): boolean => dia >= inicio && dia <= fim;
const soma = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

// ---------- visitas (Core) ----------
interface VisitaDoUsuario {
  visita_id: string;
  cliente_id: string;
  /** `null` = aberta ou sem permanência confiável (fechada automaticamente). */
  permanencia_min: number | null;
  aberta: boolean;
  automatica: boolean;
}

function visitasDoUsuario(estado: EstadoProjecao, usuarioId: string, inicio: string, fim: string, fuso: string): VisitaDoUsuario[] {
  const lojaPorVisita = new Map<string, number>();
  for (const l of Object.values(estado.visitas_loja)) lojaPorVisita.set(l.visita_id, l.permanencia_min);
  const out: VisitaDoUsuario[] = [];
  for (const [visita_id, f] of Object.entries(estado.visitas)) {
    if (!f.checkin || f.checkin.usuario_id !== usuarioId) continue;
    if (!dentro(diaLocal(f.checkin.checkin_em, fuso), inicio, fim)) continue;
    const co = f.checkout;
    const automatica = co?.encerramento === 'automatico';
    let permanencia: number | null = null;
    if (co && !automatica) {
      const doPromotor = lojaPorVisita.get(visita_id);
      permanencia = doPromotor ?? Math.max(0, (instanteMs(co.checkout_em) - instanteMs(f.checkin.checkin_em)) / 60_000);
    }
    out.push({ visita_id, cliente_id: f.checkin.cliente_id, permanencia_min: permanencia, aberta: !co, automatica });
  }
  return out;
}

/** RF-GES-01: "em visita" = check-in aberto hoje; "em rota" = já visitou e nenhuma aberta; "sem check-in" = nenhuma visita hoje. */
export function statusDoDia(estado: EstadoProjecao, usuarioId: string, dia: string, paramsParciais: Partial<ParametrosGestor> = {}): StatusDia {
  const { fuso } = resolverParametros(paramsParciais);
  const vs = visitasDoUsuario(estado, usuarioId, dia, dia, fuso);
  if (vs.some((v) => v.aberta)) return 'em_visita';
  return vs.length > 0 ? 'em_rota' : 'sem_checkin';
}

/** Visitas planejadas (rota) somadas no período: um registro de rota por (usuário, dia). */
function planejadasNoPeriodo(estado: EstadoProjecao, usuarioId: string, inicio: string, fim: string): number {
  let n = 0;
  for (const r of Object.values(estado.planejadas)) if (r.usuario_id === usuarioId && dentro(r.data, inicio, fim)) n += new Set(r.cliente_ids).size;
  return n;
}

/**
 * Visitas do período (dia = inicio = fim). RN-CORE-20: realizadas = clientes distintos com check-in. Promotor
 * (RN-PRO-07): só conta a visita encerrada com a permanência mínima; abertas e fechadas automaticamente ficam de fora
 * de "realizadas"; as abaixo do mínimo são "curtas" (sinalizadas ao gestor). Tempo em cliente = visitas encerradas
 * normalmente que contam; fechamento automático (RN-CORE-11) não tem tempo confiável e fica fora.
 */
export function visitasDoPeriodo(
  estado: EstadoProjecao,
  usuario: UsuarioPainel,
  inicio: string,
  fim: string,
  paramsParciais: Partial<ParametrosGestor> = {},
  comConversao = false,
): PainelVisitas {
  const params = resolverParametros(paramsParciais);
  const todas = visitasDoUsuario(estado, usuario.id, inicio, fim, params.fuso);
  const promotor = usuario.perfil === 'promotor';
  const curtas = promotor ? todas.filter((v) => v.permanencia_min !== null && v.permanencia_min < params.permanencia_min_min) : [];
  const contam = promotor ? todas.filter((v) => v.permanencia_min !== null && v.permanencia_min >= params.permanencia_min_min) : todas;
  const planejadas = planejadasNoPeriodo(estado, usuario.id, inicio, fim);
  const realizadas = new Set(contam.map((v) => v.cliente_id)).size;
  const comTempo = contam.filter((v) => v.permanencia_min !== null);
  const tempo_total = arredondar(soma(comTempo.map((v) => v.permanencia_min!)));

  let conversao: number | null = null;
  if (comConversao && contam.length > 0) {
    const ids = new Set(contam.map((v) => v.visita_id));
    const comPedido = new Set<string>();
    for (const p of Object.values(estado.pedidos)) {
      const c = p.criado;
      if (!c || c.tipo !== 'pedido' || !c.visita_id || !ids.has(c.visita_id)) continue;
      const st = statusAtual(p);
      if (st === 'cancelado' || st === 'rejeitado') continue;
      comPedido.add(c.visita_id);
    }
    conversao = percentual(comPedido.size, contam.length);
  }

  return {
    planejadas,
    realizadas,
    em_andamento: todas.filter((v) => v.aberta).length,
    cobertura_pct: percentual(realizadas, planejadas),
    tempo_total_min: tempo_total,
    tempo_medio_min: comTempo.length > 0 ? arredondar(tempo_total / comTempo.length) : null,
    curtas: curtas.length,
    conversao_pedido_pct: conversao,
  };
}

// ---------- vendas (Vendedor) ----------
/** Vendas apuradas do vendedor no período (RN-CORE-21: base do tenant, líquida de cancelamentos). */
export function vendasDoPeriodo(estado: EstadoProjecao, vendedorId: string, inicio: string, fim: string, paramsParciais: Partial<ParametrosGestor> = {}): PainelVendas {
  const params = resolverParametros(paramsParciais);
  const vs = vendasApuradas(estado, params.base_apuracao).filter((v) => v.vendedor_id === vendedorId && dentro(diaLocal(v.apurada_em, params.fuso), inicio, fim));
  const total = soma(vs.map((v) => v.total_cents));
  const comTabela = vs.filter((v) => v.total_tabela_cents !== null);
  const somaTabela = soma(comTabela.map((v) => v.total_tabela_cents!));
  const somaFinalComTabela = soma(comTabela.map((v) => v.total_cents));
  return {
    vendas_cents: total,
    pedidos: vs.length,
    clientes_positivados: new Set(vs.map((v) => v.cliente_id)).size,
    ticket_medio_cents: dividirCents(total, vs.length),
    desconto_medio_pct: somaTabela > 0 ? arredondar((1 - somaFinalComTabela / somaTabela) * 100) : null,
  };
}

export interface EntradaMeta {
  meta_cents: number | null;
  /** Realizado do mês até hoje (inclusive). */
  realizado_cents: number;
  /** Realizado do mês até ontem (exclui hoje). */
  realizado_ate_ontem_cents: number;
  dias_uteis_total: number;
  dias_uteis_decorridos: number;
  dias_uteis_restantes: number;
}

export interface ResultadoMeta {
  atingimento_pct: number | null;
  falta_cents: number | null;
  necessidade_diaria_cents: number | null;
  ritmo_pct: number | null;
}

/**
 * RN-CORE-21/22. Atingimento = realizado ÷ meta × 100. Falta = max(0, meta − realizado). Necessidade diária =
 * falta ÷ dias úteis restantes (hoje conta se for útil), centavos meio para cima; 0 se a meta já foi batida;
 * `null` sem meta ou sem dia útil restante. Ritmo = realizado até ontem ÷ (meta × decorridos ÷ total) × 100.
 */
export function calcularMeta(e: EntradaMeta): ResultadoMeta {
  const meta = e.meta_cents;
  if (meta === null || meta <= 0) return { atingimento_pct: null, falta_cents: null, necessidade_diaria_cents: null, ritmo_pct: null };
  const falta = Math.max(0, meta - e.realizado_cents);
  const necessidade = e.dias_uteis_restantes <= 0 ? null : falta === 0 ? 0 : dividirCents(falta, e.dias_uteis_restantes);
  const ritmo = e.dias_uteis_decorridos > 0 && e.dias_uteis_total > 0 ? arredondar((e.realizado_ate_ontem_cents * e.dias_uteis_total * 100) / (meta * e.dias_uteis_decorridos)) : null;
  return { atingimento_pct: percentual(e.realizado_cents, meta), falta_cents: falta, necessidade_diaria_cents: necessidade, ritmo_pct: ritmo };
}

/** Acumulado do mês de `data` até `data` e meta (RN-CORE-21/22). */
export function painelDoMes(estado: EstadoProjecao, vendedorId: string, data: string, paramsParciais: Partial<ParametrosGestor> = {}): PainelMes {
  const params = resolverParametros(paramsParciais);
  const mes = data.slice(0, 7);
  const primeiro = `${mes}-01`;
  const vendas = vendasDoPeriodo(estado, vendedorId, primeiro, data, params);
  const ontem = data === primeiro ? null : vendasDoPeriodo(estado, vendedorId, primeiro, somarDias(data, -1), params);
  const dias = businessDays(mes, data, params.feriados);
  const meta = estado.metas[`${vendedorId}|${mes}`]?.meta_cents ?? null;
  const r = calcularMeta({
    meta_cents: meta,
    realizado_cents: vendas.vendas_cents,
    realizado_ate_ontem_cents: ontem?.vendas_cents ?? 0,
    dias_uteis_total: dias.total,
    dias_uteis_decorridos: dias.elapsed,
    dias_uteis_restantes: dias.remaining,
  });
  return {
    mes,
    vendas_cents: vendas.vendas_cents,
    pedidos: vendas.pedidos,
    clientes_positivados: vendas.clientes_positivados,
    ticket_medio_cents: vendas.ticket_medio_cents,
    meta_cents: meta,
    atingimento_pct: r.atingimento_pct,
    falta_cents: r.falta_cents,
    dias_uteis_restantes: dias.remaining,
    necessidade_diaria_cents: r.necessidade_diaria_cents,
    ritmo_pct: r.ritmo_pct,
  };
}

// ---------- trade (Promotor) ----------
/**
 * Indicadores do promotor no período (RF-GES-10). Espelha as regras do Promotor sobre os eventos `promotor.*@1`:
 * RN-PRO-07 (coletas só de visitas com a permanência mínima), RN-PRO-11 (conformidade com peso do parcial),
 * RN-PRO-03 (share/atingimento), RN-PRO-05 (ruptura e falha de reposição), RN-PRO-04 (índice médio) e RN-PRO-02 (fotos sem GPS).
 */
export function tradeDoPeriodo(estado: EstadoProjecao, promotorId: string, inicio: string, fim: string, paramsParciais: Partial<ParametrosGestor> = {}): PainelTrade {
  const params = resolverParametros(paramsParciais);
  const dia = (i: string) => diaLocal(i, params.fuso);
  const visitas = Object.values(estado.visitas_loja).filter((l) => l.promotor_id === promotorId);
  const validas = new Set(visitas.filter((l) => l.permanencia_min >= params.permanencia_min_min).map((l) => l.visita_loja_id));
  const daVisitaValida = <T extends { promotor_id: string; visita_loja_id: string }>(xs: readonly T[]) => xs.filter((x) => x.promotor_id === promotorId && validas.has(x.visita_loja_id));

  const lojas = new Set(visitas.filter((l) => validas.has(l.visita_loja_id) && dentro(dia(l.checkin_em), inicio, fim)).map((l) => l.cliente_id));

  const gondolas = daVisitaValida(Object.values(estado.gondolas)).filter((g) => dentro(dia(g.registrado_em), inicio, fim));
  const conformes = gondolas.filter((g) => g.conformidade === 'conforme').length;
  const parciais = gondolas.filter((g) => g.conformidade === 'parcial').length;

  const shares = daVisitaValida(Object.values(estado.shares)).filter((s) => dentro(dia(s.medido_em), inicio, fim));
  const comShare = shares.filter((s) => s.share_pct !== null);
  const comAmbos = shares.filter((s) => s.share_pct !== null && s.meta_pct !== null);
  const somaShareAmbos = soma(comAmbos.map((s) => s.share_pct!));
  const somaMeta = soma(comAmbos.map((s) => s.meta_pct!));

  const rupturas = daVisitaValida(Object.values(estado.rupturas)).filter((r) => dentro(dia(r.registrado_em), inicio, fim));
  const emRuptura = rupturas.filter((r) => r.status !== 'presente').length;
  const falhas = rupturas.filter((r) => r.status === 'ruptura_gondola').length;

  const indices = daVisitaValida(Object.values(estado.precos)).filter((p) => p.indice_preco !== null && dentro(dia(p.coletado_em), inicio, fim));

  const tarefas = Object.values(estado.tarefas).filter((t) => t.promotor_id === promotorId && dentro(dia(t.concluida_em), inicio, fim));

  // RN-PRO-02: fotos do período, de TODAS as visitas (inclusive as curtas), só das que informaram os dois números
  const comFotos = visitas.filter((l) => dentro(dia(l.checkin_em), inicio, fim) && l.fotos_total !== null && l.fotos_sem_gps !== null);
  const fotosTotal = comFotos.length > 0 ? soma(comFotos.map((l) => l.fotos_total!)) : null;
  const fotosSem = comFotos.length > 0 ? soma(comFotos.map((l) => l.fotos_sem_gps!)) : null;

  return {
    lojas_visitadas: lojas.size,
    conformidade_pct: percentual(conformes + parciais * params.peso_parcial_conformidade, gondolas.length),
    conformidade_parciais: parciais,
    share_medio_pct: comShare.length > 0 ? arredondar(soma(comShare.map((s) => s.share_pct!)) / comShare.length) : null,
    meta_share_media_pct: comAmbos.length > 0 ? arredondar(somaMeta / comAmbos.length) : null,
    atingimento_share_pct: percentual(somaShareAmbos, somaMeta),
    ruptura_pct: percentual(emRuptura, rupturas.length),
    falha_reposicao_pct: percentual(falhas, rupturas.length),
    indice_preco_medio: indices.length > 0 ? arredondar(soma(indices.map((p) => p.indice_preco!)) / indices.length) : null,
    tarefas_concluidas: tarefas.length,
    fotos_total: fotosTotal,
    fotos_sem_gps: fotosSem,
    fotos_sem_gps_pct: fotosTotal !== null && fotosSem !== null ? percentual(fotosSem, fotosTotal) : null,
  };
}

// ---------- pesquisa e treinamento ----------
export function pesquisaDoPeriodo(estado: EstadoProjecao, usuarioId: string, inicio: string, fim: string, fuso: string): PainelPesquisa {
  const rs = Object.values(estado.respostas).filter((r) => r.usuario_id === usuarioId && dentro(diaLocal(r.respondida_em, fuso), inicio, fim));
  return { respostas: rs.length, suspeitas: rs.filter((r) => r.suspeita).length };
}

export function treinamentoDoPeriodo(estado: EstadoProjecao, usuarioId: string, inicio: string, fim: string, fuso: string): PainelTreinamento {
  const ls = Object.values(estado.licoes).filter((l) => l.usuario_id === usuarioId && dentro(diaLocal(l.concluida_em, fuso), inicio, fim));
  const ms = Object.values(estado.medalhas).filter((m) => m.usuario_id === usuarioId && dentro(diaLocal(m.conquistada_em, fuso), inicio, fim));
  return { licoes_concluidas: ls.length, trilhas_concluidas: ls.filter((l) => l.trilha_concluida).length, xp_ganho: soma(ls.map((l) => l.xp_ganho)), medalhas: ms.length };
}

// ---------- linha do painel ----------
/** Uma linha de `painel_vendedor_dia` para (usuário, data civil no fuso do tenant). */
export function montarPainelDia(estado: EstadoProjecao, usuario: UsuarioPainel, data: string, ctx: ContextoPainel): PainelDia {
  const params = resolverParametros(ctx.params);
  const vendedorOn = ctx.modulos.has('vendedor') && usuario.perfil === 'vendedor';
  const promotorOn = ctx.modulos.has('promotor') && usuario.perfil === 'promotor';
  return {
    usuario_id: usuario.id,
    perfil: usuario.perfil,
    data,
    status_dia: statusDoDia(estado, usuario.id, data, params),
    visitas: visitasDoPeriodo(estado, usuario, data, data, params, vendedorOn),
    vendas: vendedorOn ? vendasDoPeriodo(estado, usuario.id, data, data, params) : null,
    mes: vendedorOn ? painelDoMes(estado, usuario.id, data, params) : null,
    trade: promotorOn ? tradeDoPeriodo(estado, usuario.id, data, data, params) : null,
    pesquisa: ctx.modulos.has('pesquisa') ? pesquisaDoPeriodo(estado, usuario.id, data, data, params.fuso) : null,
    treinamento: ctx.modulos.has('treinamento') ? treinamentoDoPeriodo(estado, usuario.id, data, data, params.fuso) : null,
    calculado_em: ctx.agora,
  };
}
