/**
 * Resumo legível da trilha de auditoria: "antes → depois" só com o que mudou.
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@macuxi/vendedor/contracts';

export const ENTITY_LABEL: Record<string, string> = {
  sales_order: 'Pedido',
  incentive_plan: 'Plano de RV',
  incentive_rule: 'Plano de RV',
  discount_policy: 'Alçadas de desconto',
  goal_period: 'Fechamento do mês',
  goal: 'Meta',
  route_plan: 'Rota',
  visit: 'Visita',
  // API nova (`tx.auditar` / auditoria do Core, RN-AUD-01): entidades em português
  pedido: 'Pedido',
  alcada: 'Alçadas de desconto',
  rota: 'Rota',
  meta: 'Meta',
  carteira: 'Carteira',
  cliente: 'Cliente',
  motivo: 'Motivo de não venda',
  dispositivo: 'Aparelho',
  notificacao: 'Notificação',
  licenca: 'Licença de módulo',
  parametro: 'Parâmetro',
};

export const ACTION_LABEL: Record<string, string> = {
  create: 'criou',
  update: 'alterou',
  approve: 'aprovou',
  reject: 'recusou',
  resend: 'reenviou ao ERP',
  close: 'fechou o mês',
  reopen: 'reabriu o mês',
  export_payout: 'exportou para o RH',
  create_version: 'criou nova versão',
  checkin: 'fez check-in',
  // API nova: `<entidade>.<verbo>` → rótulo do verbo
  criar: 'criou',
  editar: 'alterou',
  remover: 'removeu',
  aprovar: 'aprovou',
  recusar: 'recusou',
  copiar: 'copiou',
  gerar: 'gerou',
  vincular: 'vinculou',
  desvincular: 'desvinculou',
  bloquear: 'bloqueou',
  desbloquear: 'desbloqueou',
  enviar: 'enviou',
  aprovar_coordenada: 'aprovou a coordenada',
};

export const entityLabel = (e: string) => ENTITY_LABEL[e] ?? e;
/** Fase M (`approve`) ou API nova (`pedido.aprovar` → rótulo de `aprovar`). */
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? ACTION_LABEL[a.split('.').at(-1) ?? ''] ?? a;

const KEY_LABEL: Record<string, string> = {
  status: 'status',
  reason: 'motivo',
  weight_pct: 'peso',
  is_trigger: 'gatilho',
  max_amount_cents: 'teto',
  total_cents: 'valor',
  discount_pct: 'desconto',
  seller_pct: 'vendedor',
  supervisor_pct: 'supervisor',
  manager_pct: 'gestor',
  above_manager: 'acima do gestor',
  max_discount_pct: 'alçada',
  valid_from: 'vale a partir de',
  name: 'nome',
  applies_to: 'aplica-se a',
  number: 'nº',
  customer: 'cliente',
  outcome: 'resultado',
  no_order_reason: 'motivo',
  year_month: 'mês',
  period: 'mês',
  target_value: 'meta',
  incentive_total_cents: 'RV total',
  mode: 'modo',
  from_pct: 'início',
  payout_pct: '% pago',
  revenue: 'faturamento',
  coverage: 'positivação',
  mix: 'mix',
  campaign: 'campanha',
  delinquency: 'inadimplência',
  paradas: 'paradas',
  destinatarios: 'destinatários',
  prioridade: 'prioridade',
  semana: 'semana',
  criadas: 'criadas',
  ignoradas: 'ignoradas',
  motivo: 'motivo',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Campos que não ajudam a ler a mudança. */
const IGNORED = new Set(['id', 'tenant_id', 'updated_at', 'updated_by', 'last_change', 'bands_text', 'rule_text', 'kpi_name', 'seller_name', 'received_at', 'checkin_at', 'seller_id', 'customer_id', 'route_stop_id', 'lat', 'lng', 'idempotency_key', 'closed_at', 'closed_by', 'usuario_id', 'visita_id']);

type Flat = Map<string, unknown>;

function keyOf(item: unknown, i: number): string {
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    for (const k of ['kpi_code', 'seller_id', 'customer_id', 'id']) if (typeof o[k] === 'string') return String(o[k]);
    if (typeof o.from_pct === 'number') return `${o.from_pct}%`;
  }
  return String(i + 1);
}

function flatten(v: unknown, prefix: string[], out: Flat, depth = 0) {
  if (v === null || v === undefined || typeof v !== 'object') {
    out.set(prefix.join('.'), v);
    return;
  }
  if (depth > 4) {
    out.set(prefix.join('.'), JSON.stringify(v));
    return;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) {
      out.set(prefix.join('.'), v.join(', '));
      return;
    }
    v.forEach((item, i) => flatten(item, [...prefix, keyOf(item, i)], out, depth + 1));
    return;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (IGNORED.has(k)) continue;
    flatten(val, [...prefix, k], out, depth + 1);
  }
}

/** Valor curto: centavos em R$, percentuais com %, status com rótulo. */
export function formatAuditValue(path: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const last = path.split('.').at(-1) ?? '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') {
    if (last.endsWith('_cents')) return formatBRL(v);
    if (last.endsWith('_pct')) return formatPct(v, v % 1 === 0 ? 0 : 1);
    return v.toLocaleString('pt-BR');
  }
  const s = String(v);
  if (last === 'status' && s in ORDER_STATUS_LABEL) return ORDER_STATUS_LABEL[s as OrderStatus];
  if (last === 'above_manager') return s === 'director' ? 'vai para a diretoria' : s === 'block' ? 'bloqueia' : s;
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** 'rules.revenue.weight_pct' → 'peso faturamento' (campo primeiro, depois o contexto). */
function labelPath(path: string): string {
  const segs = path
    .split('.')
    .filter((p) => p && !['rules', 'bands', 'exceptions'].includes(p) && !UUID.test(p))
    .map((p) => KEY_LABEL[p] ?? p.replace(/_/g, ' '));
  if (segs.length <= 1) return segs[0] ?? '';
  return [segs[segs.length - 1], ...segs.slice(0, -1)].join(' ');
}

/** Até `max` mudanças no formato "peso revenue: 50% → 45%". */
export function summarizeChange(before: unknown, after: unknown, max = 3): string {
  const a: Flat = new Map();
  const b: Flat = new Map();
  if (before !== null && before !== undefined) flatten(before, [], a);
  if (after !== null && after !== undefined) flatten(after, [], b);
  if (Array.isArray(after) && after.every((x) => typeof x === 'string')) {
    const n = after.length;
    const prev = Array.isArray(before) ? before.length : null;
    return prev === null ? `${n} paradas` : `${prev} → ${n} paradas`;
  }
  // regra de plano isolada ({ kpi_code, weight_pct }): diz de qual indicador é
  const kpi = [after, before].map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>).kpi_code : undefined)).find((x) => typeof x === 'string') as string | undefined;
  const ctx = kpi ? ` ${KEY_LABEL[kpi] ?? kpi}` : '';
  const lines: string[] = [];
  if (a.size === 0) {
    for (const [k, v] of b) {
      if (v === '' || v === null || v === undefined || k === 'kpi_code') continue;
      lines.push(`${labelPath(k)}${k.includes('.') ? '' : ctx}: ${formatAuditValue(k, v)}`);
    }
  } else {
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) {
      const va = a.get(k);
      const vb = b.get(k);
      if (JSON.stringify(va) === JSON.stringify(vb)) continue;
      if (!b.has(k)) continue; // o "depois" não traz o campo: não é mudança
      lines.push(`${labelPath(k)}${k.includes('.') ? '' : ctx}: ${formatAuditValue(k, va)} → ${formatAuditValue(k, vb)}`);
    }
  }
  if (lines.length === 0) return 'sem mudança de valores';
  const extra = lines.length - max;
  return lines.slice(0, max).join(' · ') + (extra > 0 ? ` · +${extra}` : '');
}
