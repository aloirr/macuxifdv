/**
 * RN-CAT-22: índice de veículos lido das aplicações em texto (as mesmas lidas pelas RN-CAT-12, 15, 16, 19 e 20). Cada segmento da
 * aplicação (o mesmo separador do "Serve em") que cita um nome de veículo da base vira uma entrada: montadora, modelo, anos, motores
 * e versões. Função pura: a mesma montagem no aparelho (sem sinal) e na API. Premissas do desenho `docs/desenho/filtro-veiculo.md` §8:
 * modelo = a primeira palavra de veículo do segmento (P-a); motor = só a cilindrada `1.0` (P-b); montadora = a lista `MONTADORAS` (P-c).
 */
import { expandirAplicacao } from './aplicacao';
import { APELIDOS_MONTADORA, MONTADORAS } from './montadoras';
import { PALAVRA_RE, SEPARADOR_SEGMENTO } from './serve-em';
import { normalizarTexto, palavrasInteiras } from './texto';
import type { NomesDeVeiculo } from './veiculos';

const MOTOR_RE = /(?<![\p{L}\p{N}.,])(\d)[.,](\d)(?![\p{N}])/gu;
/** Um trecho = o que fica entre dois separadores do "Serve em" (a mesma definição, em `serve-em.ts`). */
const SEGMENTO_RE = new RegExp(`${SEPARADOR_SEGMENTO.source.replace(/^\[/, '[^')}+`, 'g');

/** Um trecho da aplicação que cita um modelo. Chaves = texto normalizado (`normalizarTexto`); a exibição fica em `IndiceVeiculos.nomes`. */
export interface SegmentoVeiculo {
  /** Montadora escrita no trecho (chave); `null` = não escrita. */
  montadora: string | null;
  modelo: string;
  anos: readonly number[];
  /** Cilindradas ("1.0"); vazio = qualquer motor. */
  motores: readonly string[];
  /** Outros nomes de veículo depois do modelo (Highline); vazio = qualquer versão. */
  versoes: readonly string[];
  /** Posições do trecho (já sem espaços das pontas) no texto da aplicação, fim exclusivo. */
  inicio: number;
  fim: number;
  /** Posições do modelo e da montadora escrita (esta, `null` sem montadora), dentro do texto da aplicação. */
  posModelo: readonly [number, number];
  posMontadora: readonly [number, number] | null;
  /** Grafias como escritas (para escolher a de exibição). */
  escrito: { modelo: string; versoes: readonly string[] };
}

export interface OpcoesSegmentos {
  /** Ano civil no fuso do tenant (faixa aberta "2015+"). */
  anoAtual: number;
  veiculos: ReadonlySet<string>;
}

interface MontadoraAchada {
  chave: string;
  nome: string;
}

let montadorasPorChave: Map<string, string> | null = null;
/** chave normalizada (nome ou apelido, RN-CAT-15) → nome de exibição da montadora; a busca da folha e o índice usam. */
export function apelidosDeMontadora(): ReadonlyMap<string, string> {
  if (montadorasPorChave) return montadorasPorChave;
  const m = new Map<string, string>();
  const porNome = new Map(MONTADORAS.map((n) => [normalizarTexto(n), n]));
  for (const [chave, nome] of porNome) m.set(chave, nome);
  for (const a of APELIDOS_MONTADORA) {
    const nome = porNome.get(normalizarTexto(a.term));
    if (!nome) continue;
    for (const s of a.synonyms) m.set(normalizarTexto(s), nome);
  }
  montadorasPorChave = m;
  return m;
}

/** Palavras que são nome de veículo: o conjunto da base e as derivadas inteiras (RN-CAT-20: CrossFox). */
const derivadasDe = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();
function ehVeiculo(veiculos: ReadonlySet<string>, palavra: string): boolean {
  if (veiculos.has(palavra)) return true;
  const mapa = (veiculos as Partial<NomesDeVeiculo>).derivadas;
  if (!mapa) return false;
  let d = derivadasDe.get(veiculos);
  if (!d) {
    d = new Set([...mapa.values()].flat());
    derivadasDe.set(veiculos, d);
  }
  return d.has(palavra);
}

/** A montadora cujo nome ou apelido é a(s) palavra(s) de `i`: tenta duas palavras ("land rover") antes de uma. */
function montadoraEm(ws: readonly { chave: string }[], i: number): { achada: MontadoraAchada; palavras: number } | null {
  const m = apelidosDeMontadora();
  if (i + 1 < ws.length) {
    const dupla = `${ws[i]!.chave} ${ws[i + 1]!.chave}`;
    const nome = m.get(dupla);
    if (nome) return { achada: { chave: normalizarTexto(nome), nome }, palavras: 2 };
  }
  const nome = m.get(ws[i]!.chave);
  return nome ? { achada: { chave: normalizarTexto(nome), nome }, palavras: 1 } : null;
}

/** Os segmentos da aplicação que citam um modelo (vazio = aplicação universal ou sem veículo). */
export function segmentosDeVeiculo(aplicacao: string | null | undefined, opcoes: OpcoesSegmentos): SegmentoVeiculo[] {
  const texto = aplicacao ?? '';
  if (texto.trim() === '') return [];
  const saida: SegmentoVeiculo[] = [];
  for (const parte of texto.matchAll(SEGMENTO_RE)) {
    const bruto = parte[0];
    const ini0 = parte.index!;
    const seg = bruto.trim();
    if (seg === '') continue;
    const inicio = ini0 + (bruto.length - bruto.trimStart().length);
    const fim = inicio + seg.length;
    const ws: { chave: string; ini: number; fim: number; raw: string }[] = [];
    for (const m of seg.matchAll(PALAVRA_RE)) {
      const chave = palavrasInteiras(m[0], false)[0]; // com memória: as mesmas palavras se repetem em milhares de aplicações
      if (chave) ws.push({ chave, ini: inicio + m.index!, fim: inicio + m.index! + m[0].length, raw: m[0] });
    }
    let montadora: MontadoraAchada | null = null;
    let posMontadora: [number, number] | null = null;
    const usadas = new Set<number>();
    for (let i = 0; i < ws.length; i++) {
      const mo = montadoraEm(ws, i);
      if (!mo) continue;
      if (!montadora) {
        montadora = mo.achada;
        posMontadora = [ws[i]!.ini, ws[i + mo.palavras - 1]!.fim];
      }
      for (let k = 0; k < mo.palavras; k++) usadas.add(i + k);
      i += mo.palavras - 1;
    }
    let modelo = -1;
    const versoes: number[] = [];
    for (let i = 0; i < ws.length; i++) {
      if (usadas.has(i) || !ehVeiculo(opcoes.veiculos, ws[i]!.chave)) continue;
      if (modelo < 0) modelo = i;
      else versoes.push(i);
    }
    if (modelo < 0) continue;
    const motores = new Set<string>();
    for (const m of seg.matchAll(MOTOR_RE)) motores.add(`${m[1]}.${m[2]}`);
    const m0 = ws[modelo]!;
    saida.push({
      montadora: montadora?.chave ?? null,
      modelo: m0.chave,
      anos: expandirAplicacao(seg, { anoAtual: opcoes.anoAtual }).anos,
      motores: [...motores],
      versoes: [...new Set(versoes.map((i) => ws[i]!.chave))],
      inicio,
      fim,
      posModelo: [m0.ini, m0.fim],
      posMontadora,
      escrito: { modelo: m0.raw, versoes: versoes.map((i) => ws[i]!.raw) },
    });
  }
  return saida;
}

export interface EntradaVeiculo extends SegmentoVeiculo {
  produto: string;
}

export interface IndiceVeiculos {
  anoAtual: number;
  entradas: readonly EntradaVeiculo[];
  /** chave → nome de exibição (a grafia mais frequente na base) de modelos, versões e montadoras. */
  nomes: ReadonlyMap<string, string>;
  /** montadora (chave) → modelos (chaves). */
  modelosDaMontadora: ReadonlyMap<string, readonly string[]>;
  /** modelo (chave) → entradas de todos os produtos. */
  doModelo: ReadonlyMap<string, readonly EntradaVeiculo[]>;
  /** produto → entradas (ausente = universal). */
  doProduto: ReadonlyMap<string, readonly EntradaVeiculo[]>;
}

/**
 * RN-CAT-22: o índice só com as entradas dos produtos de `escopo` (os vendáveis ao cliente, RN-CAT-06, ou os `produto_ids` pedidos).
 * A cascata, a busca da folha e o "tem veículo" passam a contar só o que se pode vender; o aparelho e a API usam esta mesma função.
 * `nomes` é o mesmo (a grafia de exibição não muda com o escopo).
 */
export function restringirIndice(indice: IndiceVeiculos, escopo: ReadonlySet<string>): IndiceVeiculos {
  const entradas = indice.entradas.filter((e) => escopo.has(e.produto));
  return { anoAtual: indice.anoAtual, entradas, nomes: indice.nomes, ...mapasDoIndice(entradas) };
}

/** Os três mapas do índice (montadora → modelos, modelo → entradas, produto → entradas) sobre as `entradas`; uma passada, sem copiar listas. */
function mapasDoIndice(entradas: readonly EntradaVeiculo[]): Pick<IndiceVeiculos, 'modelosDaMontadora' | 'doModelo' | 'doProduto'> {
  const modelosDaMontadora = new Map<string, Set<string>>();
  const doModelo = new Map<string, EntradaVeiculo[]>();
  const doProduto = new Map<string, EntradaVeiculo[]>();
  const juntar = <K>(m: Map<K, EntradaVeiculo[]>, k: K, e: EntradaVeiculo) => {
    const l = m.get(k);
    if (l) l.push(e);
    else m.set(k, [e]);
  };
  for (const e of entradas) {
    if (e.montadora) {
      let s = modelosDaMontadora.get(e.montadora);
      if (!s) modelosDaMontadora.set(e.montadora, (s = new Set()));
      s.add(e.modelo);
    }
    juntar(doModelo, e.modelo, e);
    juntar(doProduto, e.produto, e);
  }
  return { modelosDaMontadora: new Map([...modelosDaMontadora].map(([k, v]) => [k, [...v]])), doModelo, doProduto };
}

/** O catálogo tem veículo nas aplicações (o botão Veículo aparece). */
export const indiceTemVeiculo = (i: IndiceVeiculos): boolean => i.entradas.length > 0;

/** Montagem incremental (a carga cede o laço entre os pedaços): `acrescentar` por produto ativo e `concluir`. */
export class ConstrutorIndiceVeiculos {
  private readonly brutas: EntradaVeiculo[] = [];
  constructor(private readonly opcoes: OpcoesSegmentos) {}

  acrescentar(produto: string, aplicacao: string | null | undefined): void {
    for (const s of segmentosDeVeiculo(aplicacao, this.opcoes)) this.brutas.push({ ...s, produto });
  }

  concluir(): IndiceVeiculos {
    // montadora do modelo escrito sem ela: a mais frequente do mesmo modelo na base
    const contagem = new Map<string, Map<string, number>>();
    const grafias = new Map<string, Map<string, number>>();
    const grafar = (chave: string, raw: string) => {
      let g = grafias.get(chave);
      if (!g) grafias.set(chave, (g = new Map()));
      g.set(raw, (g.get(raw) ?? 0) + 1);
    };
    for (const e of this.brutas) {
      if (e.montadora) {
        let c = contagem.get(e.modelo);
        if (!c) contagem.set(e.modelo, (c = new Map()));
        c.set(e.montadora, (c.get(e.montadora) ?? 0) + 1);
      }
      grafar(e.modelo, e.escrito.modelo);
      e.versoes.forEach((v, k) => grafar(v, e.escrito.versoes[k] ?? v));
    }
    const maisFrequente = (m: Map<string, number>): string => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const daMontadora = new Map([...contagem].map(([modelo, c]) => [modelo, maisFrequente(c)] as const));
    const entradas = this.brutas.map((e) => (e.montadora ? e : { ...e, montadora: daMontadora.get(e.modelo) ?? null }));

    const nomes = new Map<string, string>();
    for (const [chave, g] of grafias) {
      // a grafia mais frequente; no empate, a que não está toda em maiúsculas
      const ordem = [...g].sort((a, b) => b[1] - a[1] || Number(a[0] === a[0].toUpperCase()) - Number(b[0] === b[0].toUpperCase()) || a[0].localeCompare(b[0]));
      nomes.set(chave, ordem[0]![0]);
    }
    for (const n of MONTADORAS) nomes.set(normalizarTexto(n), n);

    return { anoAtual: this.opcoes.anoAtual, entradas, nomes, ...mapasDoIndice(entradas) };
  }
}

/** Fontes por pedaço da montagem assíncrona: cada pedaço leva poucos ms (a tela cede o laço entre eles). */
export const LOTE_MONTAGEM_INDICE = 500;
const cederLaco = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 0));

/**
 * O mesmo índice de `construirIndiceVeiculos`, montado em pedaços de `lote` produtos com um `await` entre eles (`ceder`; por padrão um
 * `setTimeout(0)`): a tela não trava com 20 mil produtos. `aoCeder` roda a cada pedaço (teste mede o maior pedaço).
 */
export async function construirIndiceVeiculosEmLotes(
  fontes: Iterable<{ id: string; aplicacao?: string | null | undefined }>,
  opcoes: OpcoesSegmentos,
  { lote = LOTE_MONTAGEM_INDICE, ceder = cederLaco }: { lote?: number; ceder?: () => Promise<void> } = {},
): Promise<IndiceVeiculos> {
  const c = new ConstrutorIndiceVeiculos(opcoes);
  let n = 0;
  for (const f of fontes) {
    c.acrescentar(f.id, f.aplicacao);
    if (++n % lote === 0) await ceder();
  }
  return c.concluir();
}

/** Atalho: o índice de uma lista de produtos ativos com a aplicação. */
export function construirIndiceVeiculos(fontes: Iterable<{ id: string; aplicacao?: string | null | undefined }>, opcoes: OpcoesSegmentos): IndiceVeiculos {
  const c = new ConstrutorIndiceVeiculos(opcoes);
  for (const f of fontes) c.acrescentar(f.id, f.aplicacao);
  return c.concluir();
}

const DO_PRODUTOS = new WeakMap<readonly object[], Map<number, IndiceVeiculos>>();
/** O índice de uma lista de produtos, guardado enquanto a lista (e o ano atual) for a mesma. */
export function indiceVeiculosDe(produtos: readonly object[], anoAtual: number): IndiceVeiculos | undefined {
  return DO_PRODUTOS.get(produtos)?.get(anoAtual);
}
export function definirIndiceVeiculos(produtos: readonly object[], indice: IndiceVeiculos): void {
  let m = DO_PRODUTOS.get(produtos);
  if (!m) DO_PRODUTOS.set(produtos, (m = new Map()));
  m.clear(); // só o ano atual vale
  m.set(indice.anoAtual, indice);
}
