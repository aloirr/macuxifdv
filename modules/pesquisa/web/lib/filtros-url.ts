/**
 * Filtros das páginas da Pesquisa no BKO, na URL (padrão do BKO: compartilhável e sobrevive ao F5).
 * Lista: `?situacao=&q=`. Resultados: `?id=&de=&ate=&versao=&equipes=a,b`. Valor inválido é ignorado (não quebra a tela).
 */
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITUACOES = ['rascunho', 'publicada', 'arquivado'] as const;

export interface FiltrosLista {
  situacao?: (typeof SITUACOES)[number];
  q?: string;
}

export interface FiltrosResultado {
  id?: string;
  de?: string;
  ate?: string;
  versao?: string;
  equipes?: string[];
}

export function lerFiltrosLista(busca: string): FiltrosLista {
  const p = new URLSearchParams(busca);
  const s = p.get('situacao');
  const q = p.get('q')?.trim();
  return { ...(s && (SITUACOES as readonly string[]).includes(s) ? { situacao: s as FiltrosLista['situacao'] } : {}), ...(q ? { q: q.slice(0, 100) } : {}) };
}

export function lerFiltrosResultado(busca: string): FiltrosResultado {
  const p = new URLSearchParams(busca);
  const f: FiltrosResultado = {};
  const id = p.get('id');
  if (id && UUID.test(id)) f.id = id;
  const de = p.get('de');
  const ate = p.get('ate');
  if (de && DATA.test(de)) f.de = de;
  if (ate && DATA.test(ate)) f.ate = ate;
  if (f.de && f.ate && f.de > f.ate) delete f.ate;
  const versao = p.get('versao');
  if (versao && UUID.test(versao)) f.versao = versao;
  const equipes = (p.get('equipes') ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x));
  if (equipes.length) f.equipes = equipes;
  return f;
}

/** Monta `?a=b&...` só com os preenchidos (ordem estável). */
export function paraBusca(f: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Query da API de resultados a partir dos filtros (sem o id, que vai no caminho). */
export function queryDoResultado(f: FiltrosResultado): Record<string, string | undefined> {
  return { de: f.de, ate: f.ate, versao: f.versao, equipes: f.equipes?.join(',') };
}
