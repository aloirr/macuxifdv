/** Conversões comuns dos adaptadores de ERP (puras): dinheiro, data local do ERP para UTC, textos e sim/não. */

/** Reais (número ou texto com ponto decimal) para centavos inteiros; `null` se não for número finito. */
export function reaisParaCentavos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON * Math.sign(n)) * 100) : null;
}

export function numeroOuNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Texto aparado; vazio, nulo ou não texto/número = `null`. */
export function textoOuNull(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Sim/não dos ERPs: `tYES`/`tNO` (SAP B1), `S`/`N` (Sankhya), `Y`/`N`, `1`/`0`, booleano. Outro valor = `null`. */
export function simNao(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  if (['TYES', 'Y', 'S', 'SIM', 'TRUE', '1'].includes(t)) return true;
  if (['TNO', 'N', 'NAO', 'NÃO', 'FALSE', '0'].includes(t)) return false;
  return null;
}

/** Deslocamento do fuso (ms) no instante dado: hora local menos UTC. */
function deslocamentoMs(fuso: string, instanteUtcMs: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instanteUtcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(instanteUtcMs / 1000) * 1000;
}

/**
 * Data civil `AAAA-MM-DD` e hora `HH:MM[:SS]` gravadas em hora LOCAL do ERP, no fuso informado, para ISO em UTC com `Z`
 * (§9 risco 9). Hora ausente = 00:00:00. Entrada fora do formato ou fuso inválido = `null`.
 */
export function dataHoraLocalParaUtc(data: unknown, hora: unknown, fuso: string): string | null {
  if (typeof data !== 'string') return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(data.trim());
  if (!d) return null;
  let h = 0;
  let mi = 0;
  let s = 0;
  if (typeof hora === 'string' && hora.trim() !== '') {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(hora.trim());
    if (!t) return null;
    h = Number(t[1]);
    mi = Number(t[2]);
    s = Number(t[3] ?? 0);
  }
  const local = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, mi, s);
  if (Number.isNaN(local)) return null;
  try {
    let utc = local - deslocamentoMs(fuso, local);
    utc = local - deslocamentoMs(fuso, utc);
    return new Date(utc).toISOString();
  } catch {
    return null;
  }
}

/** `dd/MM/yyyy[ HH:mm[:ss]]` (formato da Sankhya) para `{ data: 'AAAA-MM-DD', hora: 'HH:mm:ss' | null }`. */
export function dataBrParaPartes(v: unknown): { data: string; hora: string | null } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (!m) return null;
  return { data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4]}:${m[5]}:${m[6] ?? '00'}` : null };
}

/** URL completa: `url_base` + caminho + query codificada (espaço vira %20; o `$` do OData fica como está). */
export function montarUrl(urlBase: string, caminho: string, query?: Readonly<Record<string, string>>): string {
  const base = urlBase.replace(/\/+$/, '');
  const q = query && Object.keys(query).length > 0 ? `?${Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%24/g, '$').replace(/%2C/g, ',')}`).join('&')}` : '';
  return `${base}/${caminho.replace(/^\/+/, '')}${q}`;
}

/** Ficha de próxima página que o ERP devolve: caminho relativo, sem esquema nem `//` (nunca leva a outro host). */
export function caminhoRelativoSeguro(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '' || t.length > 2000 || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//') || t.includes('\\') || /[\u0000-\u001f]/.test(t)) return null;
  return t.replace(/^\/+/, '');
}

/** Campos que faltam em TODAS as linhas (o ERP mudou o formato). Lista vazia ou sem linhas = nada a dizer. */
export function camposAusentesEmTodas(linhas: readonly unknown[], obrigatorios: readonly string[]): string[] {
  if (linhas.length === 0) return [];
  return obrigatorios.filter((c) => linhas.every((l) => !l || typeof l !== 'object' || (l as Record<string, unknown>)[c] === undefined));
}
