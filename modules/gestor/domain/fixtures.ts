/** Auxiliares de teste do domain do Gestor (builders de eventos e ids). Não faz parte da API pública do módulo. */
import type { EventoRecebido } from './projecao';

/** UUID determinístico. */
export const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let seq = 0;

/**
 * T-0024: os payloads são os OFICIAIS do dono (todo campo obrigatório presente). Para os testes não repetirem campos que o
 * Gestor não usa, o `ev` completa o que faltar com um valor neutro; campo informado nunca é trocado. Payload ruim (ex.: só
 * `{ pedido_id: 'x' }`) continua ruim, porque o campo essencial segue ausente ou inválido.
 */
const COMPLETAR: Record<string, (p: Record<string, unknown>, ocorrido_em: string) => Record<string, unknown>> = {
  'core.visita.checkin@1': (p) => ({ rota_parada_id: null, data_local: String(p.checkin_em ?? '').slice(0, 10), fora_do_raio: false, distancia_m: null, sem_gps: false, extra: false }),
  'vendedor.pedido.criado@1': (p) => ({ visita_id: null, tipo: 'pedido', total_tabela_cents: p.total_cents, itens: [], status: 'em_aprovacao' }),
  'vendedor.pedido.status_alterado@1': () => ({ de: null, autor_id: null, motivo: null }),
  'vendedor.pedido.aprovacao_solicitada@1': () => ({ credito: null, historico: null }),
  'vendedor.pedido.aprovacao_solicitada@2': () => ({ credito: null, historico: null, inadimplencia: null }),
  'vendedor.pedido.aprovacao_decidida@1': () => ({ autor_id: null, texto: null }),
  'pesquisa.resposta.registrada@1': (p) => ({ tenant_id: u(1), versao_id: u(9102), equipe_id: null, cliente_id: null, visita_id: null, modo: 'avulsa', recebida_em: p.respondida_em, total_itens: 1 }),
  'treinamento.licao.concluida@1': () => ({ tenant_id: u(1), tempo_gasto_seg: 60, nota_quiz_pct: null }),
  'treinamento.medalha.conquistada@1': () => ({ tenant_id: u(1), nome: 'Medalha' }),
};

/** Meta mensal de venda no formato OFICIAL de `core.meta.definida@1`. */
export function meta(usuario: string, mes: string, cents: number, em: string, id?: string) {
  return ev('core.meta.definida@1', em, { usuario_id: usuario, periodo: mes, indicador: 'venda_cents', valor: cents, valor_anterior: null, definido_por: u(9) }, id);
}

/** Evento recebido com id sequencial único (ou o `evento_id` informado, para testar reentrega). */
export function ev(nome: string, ocorrido_em: string, payload: Record<string, unknown>, evento_id?: string): EventoRecebido {
  seq += 1;
  const completo = { ...(COMPLETAR[nome]?.(payload, ocorrido_em) ?? {}), ...payload };
  return { evento_id: evento_id ?? `ev-${seq}`, nome, ocorrido_em, payload: completo };
}

export const VENDEDOR = u(100);
export const VENDEDOR_2 = u(101);
export const PROMOTOR = u(200);
export const SUPERVISOR = u(300);
export const GERENTE = u(400);
export const CLIENTE_A = u(501);
export const CLIENTE_B = u(502);
export const CLIENTE_C = u(503);

export function pedidoCriado(o: { pedido?: string; vendedor?: string; autor?: string; cliente?: string; total: number; tabela?: number; em?: string; emitido?: string; visita?: string | null }, id?: string) {
  return ev(
    'vendedor.pedido.criado@1',
    o.em ?? '2026-10-30T14:00:00Z',
    {
      pedido_id: o.pedido ?? u(1000),
      vendedor_id: o.vendedor ?? VENDEDOR,
      autor_id: o.autor ?? o.vendedor ?? VENDEDOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      visita_id: o.visita ?? null,
      tipo: 'pedido',
      total_cents: o.total,
      total_tabela_cents: o.tabela === undefined ? o.total : o.tabela,
      criado_em: o.em ?? '2026-10-30T14:00:00Z',
      ...(o.emitido ? { emitido_em: o.emitido } : {}),
    },
    id,
  );
}

export function statusAlterado(o: { pedido?: string; vendedor?: string; para: string; em: string }, id?: string) {
  return ev('vendedor.pedido.status_alterado@1', o.em, { pedido_id: o.pedido ?? u(1000), vendedor_id: o.vendedor ?? VENDEDOR, para: o.para, alterado_em: o.em }, id);
}

/** Check-in de cada visita criado por `checkin()` neste arquivo de teste (o `checkout()` usa como início padrão). */
const inicioDaVisita = new Map<string, string>();

/** `core.visita.checkin@1` (o Gestor lê `visita_id`, `usuario_id`, `cliente_id`, `checkin_em`). */
export function checkin(o: { visita?: string; usuario?: string; cliente?: string; em: string }) {
  const visita = o.visita ?? u(2000);
  inicioDaVisita.set(visita, o.em);
  return ev('core.visita.checkin@1', o.em, { visita_id: visita, usuario_id: o.usuario ?? VENDEDOR, cliente_id: o.cliente ?? CLIENTE_A, checkin_em: o.em });
}

/**
 * `core.visita.checkout@1` OFICIAL do Core (`VisitaCheckoutSchema`): `fechada_por` `usuario` (padrão) ou `auto` (servidor,
 * RN-CORE-11); `permanencia_s` = checkout − início (o início padrão é o do `checkin()` da mesma visita).
 */
export function checkout(o: { visita?: string; usuario?: string; cliente?: string; em: string; inicio?: string; fechada_por?: 'usuario' | 'auto'; ocorrido_em?: string }, id?: string) {
  const visita = o.visita ?? u(2000);
  const inicio = o.inicio ?? inicioDaVisita.get(visita) ?? o.em;
  const auto = o.fechada_por === 'auto';
  return ev(
    'core.visita.checkout@1',
    o.ocorrido_em ?? o.em,
    {
      visita_id: visita,
      usuario_id: o.usuario ?? VENDEDOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      checkin_em: inicio,
      checkout_em: o.em,
      data_local: inicio.slice(0, 10),
      resultado: auto ? 'nao_finalizado' : 'atendido',
      motivo_codigo: null,
      pedido_id: null,
      fechada_por: o.fechada_por ?? 'usuario',
      permanencia_s: Math.max(0, Math.round((Date.parse(o.em) - Date.parse(inicio)) / 1000)),
    },
    id,
  );
}

// ---------- Promotor: payloads OFICIAIS `promotor.*@1` (T-0040), completos, como o Promotor publica ----------
/** Instante `min` minutos depois de `iso` (aritmética sobre o dado de entrada; nada lê o relógio real). */
export const maisMin = (iso: string, min: number): string => new Date(Date.parse(iso) + min * 60_000).toISOString();

export type DesfechoTeste = 'realizada' | 'loja_fechada' | 'acesso_negado';

/** `promotor.visita_loja.concluida@1`. `fotos` = [total, sem GPS]; sem atendimento leva a foto da fachada (RN-PRO-06). */
export function visitaLoja(
  n: number,
  o: { em: string; min?: number; visita?: string; cliente?: string; promotor?: string; desfecho?: DesfechoTeste; fotos?: [number, number] },
  id?: string,
) {
  const desfecho = o.desfecho ?? 'realizada';
  const min = o.min ?? 30;
  return ev(
    'promotor.visita_loja.concluida@1',
    o.em,
    {
      visita_loja_id: u(3000 + n),
      visita_id: o.visita ?? u(2000 + n),
      promotor_id: o.promotor ?? PROMOTOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      checklist_modelo_id: desfecho === 'realizada' ? u(40) : null,
      checkin_em: o.em,
      checkout_em: maisMin(o.em, min),
      permanencia_min: min,
      desfecho,
      foto_fachada_id: desfecho === 'realizada' ? null : u(3500 + n),
      fotos_total: o.fotos?.[0] ?? (desfecho === 'realizada' ? 0 : 1),
      fotos_sem_gps: o.fotos?.[1] ?? 0,
    },
    id,
  );
}

/** `promotor.gondola.registrada@1` da visita de loja `loja`. */
export function gondola(n: number, loja: number, conformidade: 'conforme' | 'parcial' | 'nao_conforme', em: string, cliente = CLIENTE_A) {
  return ev('promotor.gondola.registrada@1', em, {
    gondola_id: u(4000 + n),
    visita_loja_id: u(3000 + loja),
    promotor_id: PROMOTOR,
    cliente_id: cliente,
    categoria_gondola_id: u(50),
    conformidade,
    foto_antes_id: u(4100 + n),
    foto_depois_id: u(4200 + n),
    foto_referencia_id: null,
    registrado_em: em,
  });
}

/**
 * `promotor.share.medido@1`: `share` inteiro vira `share` frentes nossas de 100 (o share confere, RN-PRO-03); `null` =
 * categoria sem frentes. Atingimento = share ÷ meta × 100 (2 casas), como o Promotor calcula.
 */
export function shareMedido(n: number, loja: number, share: number | null, meta: number | null, em: string) {
  return ev('promotor.share.medido@1', em, {
    medicao_id: u(5000 + n),
    visita_loja_id: u(3000 + loja),
    promotor_id: PROMOTOR,
    cliente_id: CLIENTE_A,
    categoria_gondola_id: u(50),
    frentes_nossas: share ?? 0,
    frentes_total: share === null ? 0 : 100,
    cm_nossos: null,
    cm_total: null,
    share_pct: share,
    meta_share_id: meta === null ? null : u(70),
    meta_pct: meta,
    atingimento_pct: share === null || meta === null ? null : Math.round((share / meta) * 10_000) / 100,
    medido_em: em,
  });
}

/**
 * `promotor.preco.coletado@1`: com `indice` inteiro = linha do CONCORRENTE (prateleira 10,00; nosso de referência =
 * índice × 10 centavos, então o índice confere, RN-PRO-04); `null` = preço do NOSSO item (sem índice).
 */
export function precoColetado(n: number, loja: number, indice: number | null, em: string) {
  const concorrente = indice !== null;
  return ev('promotor.preco.coletado@1', em, {
    coleta_id: u(8000 + n),
    visita_loja_id: u(3000 + loja),
    promotor_id: PROMOTOR,
    cliente_id: CLIENTE_A,
    produto_id: u(90),
    concorrente_id: concorrente ? u(91) : null,
    produto_concorrente_id: concorrente ? u(92) : null,
    preco_cents: 1000,
    em_promocao: false,
    em_encarte: false,
    preco_promocional_cents: null,
    preco_efetivo_cents: 1000,
    preco_nosso_ref_cents: concorrente ? indice * 10 : null,
    indice_preco: indice,
    variacao_confirmada: false,
    coletado_em: em,
  });
}

/** `promotor.ruptura.registrada@1` (um por item do mix conferido, inclusive `presente`). */
export function rupturaRegistrada(n: number, loja: number, status: 'presente' | 'ruptura_gondola' | 'ruptura_total', em: string, cliente = CLIENTE_A) {
  return ev('promotor.ruptura.registrada@1', em, {
    registro_id: u(6000 + n),
    visita_loja_id: u(3000 + loja),
    promotor_id: PROMOTOR,
    cliente_id: cliente,
    produto_id: u(7000 + n),
    mix_obrigatorio_id: u(80),
    status,
    quantidade_reposta: status === 'ruptura_gondola' ? 6 : 0,
    registrado_em: em,
  });
}

/** `promotor.tarefa.concluida@1`: execução `execucao` da tarefa de campanha `tarefa` na visita de loja `loja`. */
export function tarefaConcluida(o: { execucao: number; tarefa: number; loja: number; em: string; cliente?: string; promotor?: string; fotos?: number }, id?: string) {
  return ev(
    'promotor.tarefa.concluida@1',
    o.em,
    {
      execucao_id: u(9100 + o.execucao),
      tarefa_id: u(9000 + o.tarefa),
      visita_loja_id: u(3000 + o.loja),
      promotor_id: o.promotor ?? PROMOTOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      fotos_total: o.fotos ?? 1,
      concluida_em: o.em,
    },
    id,
  );
}
