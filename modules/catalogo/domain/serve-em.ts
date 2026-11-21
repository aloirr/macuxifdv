/**
 * Trecho "Serve em" da busca (RN-CAT-12; T-0084 §5): o pedaço da aplicação que casou com a consulta, com até 90 caracteres,
 * os termos marcados e, quando o ano da consulta casou por faixa, o "inclui 2012". Função pura: app e API.
 */
import type { TrechoBusca } from '../contracts';
import { ehAnoDaConsulta, expandirAplicacao, type FaixaAnos } from './aplicacao';
import { nivelDaPalavra, paresColados, planejarGrupos, type PalavraPlano } from './ranking';
import { tokensDeBusca } from './texto';

export const SERVE_EM_MAX = 90;
const MAX_MARCAS = 20;
const SEPARADOR_SEGMENTO = /[;|•·\r\n]/;
const PALAVRA_RE = /[\p{L}\p{N}]+(?:[.,][\p{N}]+)*/gu;

interface Palavra {
  inicio: number;
  fim: number;
  termo: string;
}

interface Casamento {
  marcas: [number, number][];
  grupos: number;
  /** grupos casados só por palavra exata (prefixo, digitação e ano por faixa não contam) */
  exatos: number;
  incluiAno: number | null;
}

function palavrasDe(segmento: string): Palavra[] {
  const saida: Palavra[] = [];
  for (const m of segmento.matchAll(PALAVRA_RE)) {
    const termo = tokensDeBusca(m[0])[0];
    if (termo) saida.push({ inicio: m.index!, fim: m.index! + m[0].length, termo });
  }
  return saida;
}

/** A palavra do segmento de maior nível para a palavra da consulta (exato antes de prefixo/digitação); a primeira em caso de empate. */
function melhorPalavra(w: PalavraPlano, palavras: readonly Palavra[]): { p: Palavra | null; nivel: number } {
  let p: Palavra | null = null;
  let nivel = 0;
  for (const x of palavras) {
    const n = w.modo === 'v' ? (w.q === x.termo || (w.ou?.includes(x.termo) ?? false) ? 1 : 0) : nivelDaPalavra(w.q, x.termo, { prefixo: w.modo === 'p' });
    if (n > nivel) {
      p = x;
      nivel = n;
    }
  }
  return { p, nivel };
}

function casar(segmento: string, grupos: readonly (readonly string[])[], anoAtual: number, veiculos?: ReadonlySet<string>): Casamento {
  const palavras = palavrasDe(segmento);
  const faixas = expandirAplicacao(segmento, { anoAtual }).faixas;
  const marcas: [number, number][] = [];
  let casados = 0;
  let exatos = 0;
  let incluiAno: number | null = null;
  const plano = planejarGrupos(grupos, veiculos);
  // RN-CAT-19: a palavra grudada da aplicação ("SpaceFox") cobre as duas vizinhas da busca ("space fox") de uma vez
  const viaPar = new Map<number, { marca: [number, number]; exato: boolean }>();
  for (const par of paresColados(grupos)) {
    const achada = melhorPalavra(par.palavra, palavras);
    if (!achada.p) continue;
    for (const gi of par.grupos) if (!viaPar.has(gi)) viaPar.set(gi, { marca: [achada.p.inicio, achada.p.fim], exato: achada.nivel === 1 });
  }
  for (let gi = 0; gi < grupos.length; gi++) {
    const grupo = grupos[gi]!;
    const antes = casados;
    for (let ai = 0; ai < grupo.length; ai++) {
      const alt = grupo[ai]!;
      const partes = alt.split(' ').filter(Boolean);
      if (partes.length === 0) continue;
      const achadas: [number, number][] = [];
      let faixaDoAno: { ano: number; faixa: FaixaAnos } | null = null;
      let todas = true;
      let todasExatas = true;
      for (let pi = 0; pi < partes.length; pi++) {
        const q = partes[pi]!;
        // RN-CAT-18: na aplicação a palavra casa inteira; começo de palavra só na última digitada, e nome de veículo só inteiro
        const { p, nivel } = melhorPalavra(plano[gi]![ai]![pi] ?? { q, modo: 'i' }, palavras);
        if (p) {
          achadas.push([p.inicio, p.fim]);
          if (nivel !== 1) todasExatas = false;
          continue;
        }
        const faixa = partes.length === 1 && ehAnoDaConsulta(q) ? faixas.find((f) => Number(q) >= f.de && Number(q) <= f.ate) : undefined;
        todasExatas = false;
        if (faixa) faixaDoAno = { ano: Number(q), faixa };
        else todas = false;
      }
      if (!todas) continue;
      casados++;
      if (todasExatas) exatos++;
      if (faixaDoAno) {
        marcas.push([faixaDoAno.faixa.inicio, faixaDoAno.faixa.fim]);
        if (incluiAno === null) incluiAno = faixaDoAno.ano;
      } else marcas.push(...achadas);
      break;
    }
    const par = viaPar.get(gi);
    if (casados === antes && par) {
      casados++;
      if (par.exato) exatos++;
      marcas.push(par.marca);
    }
  }
  return { marcas, grupos: casados, exatos, incluiAno };
}

/** Une marcas que se tocam e ordena. */
function unir(marcas: readonly [number, number][]): [number, number][] {
  const ord = [...marcas].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const saida: [number, number][] = [];
  for (const m of ord) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && m[0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], m[1]);
    else saida.push([m[0], m[1]]);
  }
  return saida;
}

/** Desempate do "Serve em" (RN-CAT-12): grupos, exatos, mais curto; empate total mantém o anterior. */
function vence(c: Casamento, seg: string, atual: Casamento, segAtual: string): boolean {
  if (c.grupos !== atual.grupos) return c.grupos > atual.grupos;
  if (c.exatos !== atual.exatos) return c.exatos > atual.exatos;
  return seg.length < segAtual.length;
}

/**
 * RN-CAT-12: trecho da aplicação para a linha "Serve em". `grupos` são os da consulta (`expandirSinonimos`).
 * Nulo quando a aplicação é vazia ou nenhum grupo casou nela.
 */
export function trechoServeEm(aplicacao: string | null | undefined, grupos: readonly (readonly string[])[], opcoes: { anoAtual: number; max?: number; veiculos?: ReadonlySet<string> }): TrechoBusca | null {
  const texto = aplicacao ?? '';
  if (texto.trim() === '' || grupos.length === 0) return null;
  const max = opcoes.max ?? SERVE_EM_MAX;

  // desempate em vence
  let melhor: { texto: string; c: Casamento } | null = null;
  for (const bruto of texto.split(SEPARADOR_SEGMENTO)) {
    const seg = bruto.trim();
    if (seg === '') continue;
    const c = casar(seg, grupos, opcoes.anoAtual, opcoes.veiculos);
    if (c.grupos > 0 && (melhor === null || vence(c, seg, melhor.c, melhor.texto))) melhor = { texto: seg, c };
  }
  if (!melhor) return null;

  const marcas = unir(melhor.c.marcas).slice(0, MAX_MARCAS);
  const seg = melhor.texto;
  if (seg.length <= max) return { texto: seg, marcas, inclui_ano: melhor.c.incluiAno };

  // janela de até `max` (o "…" conta) em volta da primeira marca, em palavra inteira
  const primeira = marcas[0]?.[0] ?? 0;
  let ini = Math.max(0, primeira - 20);
  if (ini > 0 && seg[ini - 1] !== ' ') {
    const esp = seg.indexOf(' ', ini);
    if (esp >= 0 && esp + 1 <= primeira) ini = esp + 1;
  }
  const orcamento = max - (ini > 0 ? 1 : 0);
  let fim: number;
  if (seg.length - ini <= orcamento) fim = seg.length;
  else {
    const limite = ini + orcamento - 1;
    fim = limite;
    if (seg[limite] !== ' ') {
      const esp = seg.lastIndexOf(' ', limite);
      if (esp > ini) fim = esp;
    }
    while (fim > ini && seg[fim - 1] === ' ') fim--;
  }
  const prefixo = ini > 0 ? '…' : '';
  const sufixo = fim < seg.length ? '…' : '';
  const deslocamento = prefixo.length - ini;
  const recorte = marcas.filter(([a, b]) => a >= ini && b <= fim).map(([a, b]): [number, number] => [a + deslocamento, b + deslocamento]);
  return { texto: `${prefixo}${seg.slice(ini, fim)}${sufixo}`, marcas: recorte, inclui_ano: melhor.c.incluiAno };
}
