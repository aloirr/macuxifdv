/**
 * Normalização do texto de busca e expansão por sinônimos do tenant (RF-CAT-02, RN-CAT-01).
 * Funções puras: rodam igual no app (offline, antes do FTS5), na web e na API. A mesma normalização vale para o
 * texto que entra no índice e para a consulta, então eventuais imperfeições do plural simples se anulam.
 */

/** Grupo de sinônimos do tenant (forma mínima de `Sinonimo` do contrato). */
export interface SinonimoDoTenant {
  term: string;
  synonyms: readonly string[];
  active?: boolean;
}

/** Fator de cada unidade para a unidade-base da grandeza (ml, g, cm, mm, un, cx, pct). */
const UNIDADES: Readonly<Record<string, { base: string; fator: number }>> = {
  l: { base: 'ml', fator: 1000 },
  lt: { base: 'ml', fator: 1000 },
  lts: { base: 'ml', fator: 1000 },
  litro: { base: 'ml', fator: 1000 },
  litros: { base: 'ml', fator: 1000 },
  ml: { base: 'ml', fator: 1 },
  mililitro: { base: 'ml', fator: 1 },
  mililitros: { base: 'ml', fator: 1 },
  kg: { base: 'g', fator: 1000 },
  kgs: { base: 'g', fator: 1000 },
  quilo: { base: 'g', fator: 1000 },
  quilos: { base: 'g', fator: 1000 },
  quilograma: { base: 'g', fator: 1000 },
  quilogramas: { base: 'g', fator: 1000 },
  g: { base: 'g', fator: 1 },
  gr: { base: 'g', fator: 1 },
  grs: { base: 'g', fator: 1 },
  grama: { base: 'g', fator: 1 },
  gramas: { base: 'g', fator: 1 },
  m: { base: 'cm', fator: 100 },
  mt: { base: 'cm', fator: 100 },
  mts: { base: 'cm', fator: 100 },
  metro: { base: 'cm', fator: 100 },
  metros: { base: 'cm', fator: 100 },
  cm: { base: 'cm', fator: 1 },
  centimetro: { base: 'cm', fator: 1 },
  centimetros: { base: 'cm', fator: 1 },
  mm: { base: 'mm', fator: 1 },
  milimetro: { base: 'mm', fator: 1 },
  milimetros: { base: 'mm', fator: 1 },
  un: { base: 'un', fator: 1 },
  und: { base: 'un', fator: 1 },
  unid: { base: 'un', fator: 1 },
  unids: { base: 'un', fator: 1 },
  unidade: { base: 'un', fator: 1 },
  unidades: { base: 'un', fator: 1 },
};

/** Palavras de embalagem que ficam como palavra (ex.: "cx 12"), com forma única. */
const EMBALAGENS: Readonly<Record<string, string>> = { caixa: 'cx', caixas: 'cx', cx: 'cx', pacote: 'pct', pacotes: 'pct', pct: 'pct', pcte: 'pct' };

const STOPWORDS: ReadonlySet<string> = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'para', 'pra', 'pro', 'por', 'o', 'a', 'os', 'as', 'e', 'um', 'uma', 'em', 'no', 'na', 'nos', 'nas', 'que', 'ao', 'quero', 'preciso', 'ate']);

const MEDIDA_RE = /^\d+(ml|g|cm|mm|un)$/;

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "0,5" → 0.5; "1.500" → 1500 (ponto com 3 casas após 1–3 dígitos, e parte inteira ≠ 0, é milhar); "0.500" → 0.5. */
function lerNumero(bruto: string): number {
  const milhar = /^[1-9]\d{0,2}(\.\d{3})+$/.test(bruto);
  const limpo = milhar ? bruto.replace(/\./g, '') : bruto.replace(',', '.');
  return Number(limpo);
}

function formatarQuantidade(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Normaliza o texto: minúsculas, sem acento nem pontuação, medidas na forma canônica
 * (`2 litros` → `2000ml`, `1,5 kg` → `1500g`, `2 m` → `200cm`), embalagens (`caixa` → `cx`) e `12x500ml` → `12 x 500ml`.
 */
export function normalizarTexto(texto: string): string {
  let t = semAcento(String(texto ?? '').toLowerCase());
  // multipack colado: 12x500ml → 12 x 500ml
  t = t.replace(/(\d)\s*x\s*(\d)/g, '$1 x $2');
  // separa número e unidade colados: 500ml → 500 ml (a unidade é tratada abaixo)
  t = t.replace(/(\d)([a-z])/g, '$1 $2');
  // pontuação vira espaço, preservando vírgula/ponto entre dígitos
  t = t.replace(/(\d)[,.](?=\d)/g, '$1§').replace(/[^a-z0-9§\s]/g, ' ').replace(/§/g, (_m, off: number, s: string) => (/\d/.test(s[off - 1] ?? '') ? '.' : ' '));
  const partes = t.split(/\s+/).filter(Boolean);
  const saida: string[] = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!;
    const proxima = partes[i + 1];
    if (/^\d+(\.\d+)?$/.test(p) && proxima !== undefined && Object.hasOwn(UNIDADES, proxima)) {
      const u = UNIDADES[proxima]!;
      saida.push(`${formatarQuantidade(lerNumero(p) * u.fator)}${u.base}`);
      i++;
      continue;
    }
    if (Object.hasOwn(EMBALAGENS, p)) {
      saida.push(EMBALAGENS[p]!);
      continue;
    }
    saida.push(p);
  }
  return saida.join(' ');
}

/** Plural simples em português (palavras de 4+ letras, que não sejam números nem medidas). Aplicado nos dois lados da busca. */
function singular(p: string): string {
  if (p.length < 4 || /\d/.test(p)) return p;
  if (p.endsWith('oes') || p.endsWith('aes')) return `${p.slice(0, -3)}ao`;
  if (p.length >= 5 && (p.endsWith('ais') || p.endsWith('eis'))) return `${p.slice(0, -2)}l`;
  if (p.endsWith('res') || p.endsWith('zes')) return p.slice(0, -2);
  if (p.endsWith('s') && !p.endsWith('ss') && !p.endsWith('us') && !p.endsWith('is')) return p.slice(0, -1);
  return p;
}

/** Termos de busca: normaliza, tira stopwords e põe no singular. Medidas e números ficam como estão. */
export function tokensDeBusca(texto: string): string[] {
  return normalizarTexto(texto)
    .split(' ')
    .filter((p) => p !== '' && !STOPWORDS.has(p))
    .map((p) => (MEDIDA_RE.test(p) ? p : singular(p)));
}

/** Frase normalizada com cada termo no singular (chave de comparação de sinônimos e vocabulário). */
export function chaveDeTermo(texto: string): string {
  return normalizarTexto(texto)
    .split(' ')
    .filter(Boolean)
    .map((p) => (MEDIDA_RE.test(p) ? p : singular(p)))
    .join(' ');
}

/**
 * Expande a consulta em grupos de alternativas (um grupo por termo ou frase de sinônimo). Dentro do grupo vale
 * "ou"; entre grupos vale "e". Sinônimos do tenant valem nos dois sentidos; inativos são ignorados. Ordem
 * determinística: a alternativa original primeiro, as demais em ordem alfabética.
 */
export function expandirSinonimos(consulta: string, sinonimos: readonly SinonimoDoTenant[]): string[][] {
  const tokens = tokensDeBusca(consulta);
  // frase (chave) → todas as frases do grupo
  const porFrase = new Map<string, Set<string>>();
  let maxPalavras = 1;
  for (const s of sinonimos) {
    if (s.active === false) continue;
    const frases = [s.term, ...s.synonyms].map(chaveDeTermo).filter((f) => f !== '');
    if (frases.length < 2) continue;
    for (const f of frases) {
      const grupo = porFrase.get(f) ?? new Set<string>();
      for (const g of frases) grupo.add(g);
      porFrase.set(f, grupo);
      maxPalavras = Math.max(maxPalavras, f.split(' ').length);
    }
  }
  const grupos: string[][] = [];
  for (let i = 0; i < tokens.length; ) {
    let achou = false;
    for (let n = Math.min(maxPalavras, tokens.length - i); n >= 1 && !achou; n--) {
      const frase = tokens.slice(i, i + n).join(' ');
      const grupo = porFrase.get(frase);
      if (grupo) {
        grupos.push([frase, ...[...grupo].filter((g) => g !== frase).sort()]);
        i += n;
        achou = true;
      }
    }
    if (!achou) {
      grupos.push([tokens[i]!]);
      i++;
    }
  }
  return grupos;
}
