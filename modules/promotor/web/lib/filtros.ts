/**
 * Filtros do BKO de trade na URL (`?de=AAAA-MM-DD&ate=AAAA-MM-DD&loja=<uuid>`): compartilháveis e preservados no
 * voltar do navegador. Valor fora do formato é ignorado (cai no padrão da API: últimos 30 dias).
 */
export interface FiltrosTrade {
  de?: string;
  ate?: string;
  cliente_id?: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerFiltrosTrade(search: string): FiltrosTrade {
  const p = new URLSearchParams(search);
  const f: FiltrosTrade = {};
  const de = p.get('de');
  const ate = p.get('ate');
  const loja = p.get('loja');
  if (de && DATA.test(de)) f.de = de;
  if (ate && DATA.test(ate)) f.ate = ate;
  if (f.de && f.ate && f.de > f.ate) delete f.ate;
  if (loja && UUID.test(loja)) f.cliente_id = loja;
  return f;
}

export function paraBuscaTrade(f: FiltrosTrade): string {
  const p = new URLSearchParams();
  if (f.de) p.set('de', f.de);
  if (f.ate) p.set('ate', f.ate);
  if (f.cliente_id) p.set('loja', f.cliente_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Query da API (`FiltroRelatorio`). */
export function paraQueryTrade(f: FiltrosTrade): Record<string, string> {
  return { ...(f.de ? { de: f.de } : {}), ...(f.ate ? { ate: f.ate } : {}), ...(f.cliente_id ? { cliente_id: f.cliente_id } : {}) };
}
