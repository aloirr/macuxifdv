/**
 * Busca textual no aparelho (desenho T-0008 §2; P5): capacidade GENÉRICA do SDK. O dono do índice (ex.: Catálogo,
 * RN-CAT-01) declara fontes, colunas, pesos e `documento()`; a DDL (doc table + FTS5) vem das migrações do módulo
 * (`migracoesAparelho`, dono banco-dados). Expansão por sinônimos, correção de digitação e regras de ordenação são do
 * domínio do módulo, que entrega uma `ConsultaTexto` estruturada — o módulo NUNCA escreve sintaxe FTS.
 *
 * - SQLite (aparelho e testes): FTS5 com content externo, `bm25` com os pesos das colunas (`sqlite/armazenamento.ts`).
 * - Sem SQLite (memória, AsyncStorage, navegador): `comBuscaEmJs`, varredura em JS sobre os mesmos documentos, mesma
 *   normalização e mesma semântica (AND dos grupos, OR das alternativas, frase, prefixo só no último grupo). O CONJUNTO
 *   de resultados é igual; a ordem pode diferir.
 */
import { MODULOS, type ModuloId } from './nomes';
import { ENTIDADE_SYNC_RE } from './nomes';
import type { ArmazenamentoSync } from './motor-sync';
import type { LinhaSync } from './sync';
import type { BuscaTextoSync, ConsultaTexto, DesfechoBusca, ResultadoBusca } from './busca-tipos';

export type { BuscaTextoSync, ConsultaTexto, DesfechoBusca, MotivoSemBusca, ResultadoBusca } from './busca-tipos';

// ---------- consulta ----------


export const LIMITES_CONSULTA = { grupos: 8, alternativas: 10, caracteresPorTermo: 40, resultados: 500, padrao: 200 } as const;
/** Termo do prefixo precisa de pelo menos 2 caracteres (o índice tem `prefix='2 3'`); 1 letra não consulta. */
export const MINIMO_PREFIXO = 2;

/**
 * Normalização igual à do tokenizer `unicode61 remove_diacritics 2`: decomposição CANÔNICA (NFD), sem marcas,
 * minúsculas, separando em tudo que não é letra/dígito. Sem NFKD de propósito: o tokenizer não dobra compatibilidade
 * (`nº` fica `nº`, `ﬁ` fica `ﬁ`), e a consulta tem de produzir os mesmos termos do índice.
 */
export function normalizarBusca(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

interface Alternativa {
  termos: string[];
  prefixo: boolean;
}

/** Consulta já normalizada e cortada nos limites (a mesma para o FTS e para a varredura em JS). */
export function prepararConsulta(c: ConsultaTexto): Alternativa[][] | null {
  const grupos: Alternativa[][] = [];
  const brutos = c.grupos.slice(0, LIMITES_CONSULTA.grupos);
  brutos.forEach((g, gi) => {
    const ultimo = gi === brutos.length - 1;
    const alts: Alternativa[] = [];
    const vistos = new Set<string>();
    for (const a of g.slice(0, LIMITES_CONSULTA.alternativas)) {
      const termos = normalizarBusca(String(a).slice(0, 4 * LIMITES_CONSULTA.caracteresPorTermo))
        .map((t) => t.slice(0, LIMITES_CONSULTA.caracteresPorTermo))
        .slice(0, LIMITES_CONSULTA.grupos);
      if (termos.length === 0) continue;
      const prefixo = c.prefixoNoUltimo && ultimo && (termos.at(-1)?.length ?? 0) >= MINIMO_PREFIXO;
      const variantes: Alternativa[] = [{ termos, prefixo }];
      // código com separador (`6203-2RS`): também a forma compacta (`62032rs`), que o documento grava em `codigos`
      if (termos.length > 1 && termos.some((t) => /\p{N}/u.test(t)))
        variantes.push({ termos: [termos.join('').slice(0, LIMITES_CONSULTA.caracteresPorTermo)], prefixo });
      for (const v of variantes) {
        const k = `${v.termos.join(' ')}|${v.prefixo}`;
        if (!vistos.has(k)) {
          vistos.add(k);
          alts.push(v);
        }
      }
    }
    if (alts.length > 0) grupos.push(alts);
  });
  if (grupos.length === 0) return null;
  // só 1 caractere no total (ex.: "a"): não consulta — a tela pede "digite ao menos 2 letras"
  if (grupos.length === 1 && grupos[0]!.every((a) => a.termos.join('').length < MINIMO_PREFIXO)) return null;
  return grupos;
}

const aspas = (t: string) => `"${t.replace(/"/g, '""')}"`;

/**
 * Sintaxe FTS5 a partir da consulta estruturada (desenho T-0008 §2.7). Cada termo vira `"termo"` (frase `"a b"`), o
 * último grupo ganha `*`, alternativas com ` OR ` entre parênteses e grupos com ` AND ` explícito. `null` = não consulta.
 * A string vai por parâmetro (`MATCH ?`), nunca concatenada no SQL.
 */
export function montarConsultaFts(c: ConsultaTexto): string | null {
  const grupos = prepararConsulta(c);
  if (!grupos) return null;
  return grupos
    .map((alts) => {
      const partes = alts.map((a) => `${aspas(a.termos.join(' '))}${a.prefixo ? '*' : ''}`);
      return partes.length === 1 ? partes[0]! : `(${partes.join(' OR ')})`;
    })
    .join(' AND ');
}

export function limiteDaConsulta(c: ConsultaTexto): number {
  const l = c.limite ?? LIMITES_CONSULTA.padrao;
  return Math.max(1, Math.min(LIMITES_CONSULTA.resultados, Math.trunc(Number.isFinite(l) ? l : LIMITES_CONSULTA.padrao)));
}

// ---------- índice ----------

/** Leitura das linhas das fontes, dentro da mesma transação da página do pull. */
export interface LeitorLinhas {
  porIds<L extends LinhaSync>(entidade: string, ids: readonly string[]): Promise<L[]>;
  /** Linhas com `dados.<campo> = valor` (ex.: atributos de um produto). O índice de expressão é do dono da entidade. */
  porCampo<L extends LinhaSync>(entidade: string, campo: string, valor: string): Promise<L[]>;
}

export type DocumentoBusca<C extends string = string> = Readonly<Record<C, string | null>>;

export interface IndiceBusca<C extends string = string> {
  /** `<modulo>.<nome>` (ex.: `catalogo.produto`). */
  id: string;
  modulo: ModuloId;
  /** Tabela de documentos (`<modulo>__*`): `rid INTEGER PRIMARY KEY`, `<colunaChave> TEXT NOT NULL UNIQUE` + colunas. */
  tabelaDoc: string;
  /** Tabela FTS5 com content externo sobre `tabelaDoc` (`content_rowid = 'rid'`), colunas na MESMA ordem. */
  tabelaFts: string;
  colunaChave: string;
  /** Coluna → peso do `bm25` (ordem = ordem da DDL). */
  colunas: Readonly<Record<C, number>>;
  /** Entidades de sync que alimentam o índice (do próprio módulo ou de módulo em `depende`). */
  fontes: readonly string[];
  /** Chave do documento afetado por uma linha da fonte (`null` = nenhuma). Recebe também a linha antiga/removida. */
  chaveDe(entidade: string, linha: LinhaSync): string | null;
  /** Documento da chave ou `null` (= sai do índice). */
  documento(chave: string, ler: LeitorLinhas): Promise<DocumentoBusca<C> | null>;
}

const NOME_SQL_RE = /^[a-z][a-z0-9_]*$/;

export function definirIndiceBusca<C extends string>(i: IndiceBusca<C>): IndiceBusca<C> {
  const erro = (m: string) => new Error(`Índice de busca ${i.id}: ${m}`);
  if (!(MODULOS as readonly string[]).includes(i.modulo)) throw erro(`módulo desconhecido ${i.modulo}`);
  if (!new RegExp(`^${i.modulo}\\.[a-z][a-z0-9_]*$`).test(i.id)) throw erro('id precisa ser <modulo>.<nome>');
  for (const t of [i.tabelaDoc, i.tabelaFts])
    if (!NOME_SQL_RE.test(t) || !t.startsWith(`${i.modulo}__`)) throw erro(`tabela ${t} precisa começar com ${i.modulo}__`);
  if (i.tabelaDoc === i.tabelaFts) throw erro('tabelaDoc e tabelaFts precisam ser diferentes');
  if (!NOME_SQL_RE.test(i.colunaChave)) throw erro(`coluna-chave inválida: ${i.colunaChave}`);
  const cols = Object.keys(i.colunas);
  if (cols.length === 0) throw erro('declare ao menos uma coluna');
  for (const c of cols) {
    if (!NOME_SQL_RE.test(c) || c === 'rid' || c === i.colunaChave || c === 'rank') throw erro(`coluna inválida: ${c}`);
    const peso = i.colunas[c as C];
    if (!(typeof peso === 'number' && peso > 0 && Number.isFinite(peso))) throw erro(`peso da coluna ${c} precisa ser > 0`);
  }
  if (i.fontes.length === 0) throw erro('declare ao menos uma fonte');
  for (const f of i.fontes) if (!ENTIDADE_SYNC_RE.test(f)) throw erro(`fonte inválida: ${f}`);
  return i;
}


// ---------- varredura em JS (sem SQLite) ----------

/** Casa a consulta preparada num documento (colunas já normalizadas); devolve a pontuação (menor = melhor) ou `null`. */
export function pontuarDocumento(
  grupos: Alternativa[][],
  doc: ReadonlyArray<readonly [peso: number, termos: readonly string[]]>,
): number | null {
  let total = 0;
  for (const alts of grupos) {
    let melhor = 0;
    for (const [peso, termos] of doc) {
      if (alts.some((a) => casaFrase(termos, a))) melhor += peso;
    }
    if (melhor === 0) return null;
    total += melhor;
  }
  return -total;
}

function casaFrase(termos: readonly string[], a: Alternativa): boolean {
  const n = a.termos.length;
  for (let i = 0; i + n <= termos.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const t = termos[i + j]!;
      const q = a.termos[j]!;
      if (j === n - 1 && a.prefixo ? !t.startsWith(q) : t !== q) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Linhas guardadas de uma entidade, pela extensão `linhas` ou pela chave `ent:<e>` (caminho chave→JSON). */
async function linhasDe(base: ArmazenamentoSync, entidade: string): Promise<LinhaSync[]> {
  if (base.linhas) return base.linhas.listar(entidade);
  return Object.values((await base.ler<Record<string, LinhaSync>>(`ent:${entidade}`)) ?? {});
}

export function leitorSobre(base: ArmazenamentoSync): LeitorLinhas {
  return {
    async porIds<L extends LinhaSync>(entidade: string, ids: readonly string[]) {
      if (base.linhas) return base.linhas.porIds<L>(entidade, ids);
      const m = (await base.ler<Record<string, L>>(`ent:${entidade}`)) ?? {};
      return ids.flatMap((id) => (m[id] ? [m[id]] : []));
    },
    async porCampo<L extends LinhaSync>(entidade: string, campo: string, valor: string) {
      return (await linhasDe(base, entidade)).filter(
        (l) => (l as unknown as Record<string, unknown>)[campo] === valor,
      ) as L[];
    },
  };
}

/**
 * Busca em JS sobre qualquer armazenamento sem SQLite: monta os documentos na hora (mesmo `documento()`), mesma
 * normalização. Para listas do tamanho do aparelho de demonstração; no aparelho real vale o FTS5.
 */
export function comBuscaEmJs(base: ArmazenamentoSync, indices: readonly IndiceBusca[]): ArmazenamentoSync {
  const porId = new Map(indices.map((i) => [i.id, i] as const));
  const busca: Required<Pick<BuscaTextoSync, 'buscar' | 'buscarComDesfecho'>> = {
    async buscar(id, consulta) {
      const d = await busca.buscarComDesfecho(id, consulta);
      return d.buscou ? d.resultados : [];
    },
    async buscarComDesfecho(id, consulta): Promise<DesfechoBusca> {
      const indice = porId.get(id);
      if (!indice) throw new Error(`Índice de busca ${id} não registrado`);
      const grupos = prepararConsulta(consulta);
      if (!grupos) return { buscou: false, motivo: 'consulta_vazia' };
      const ler = leitorSobre(base);
      const chaves = new Set<string>();
      for (const f of indice.fontes)
        for (const l of await linhasDe(base, f)) {
          const k = indice.chaveDe(f, l);
          if (k) chaves.add(k);
        }
      const pesos = Object.entries(indice.colunas) as [string, number][];
      const achados: ResultadoBusca[] = [];
      for (const chave of chaves) {
        const doc = await indice.documento(chave, ler);
        if (!doc) continue;
        const cols = pesos.map(([c, p]) => [p, normalizarBusca(doc[c] ?? '')] as const);
        const pontuacao = pontuarDocumento(grupos, cols);
        if (pontuacao !== null) achados.push({ chave, pontuacao });
      }
      achados.sort((a, b) => a.pontuacao - b.pontuacao || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
      return { buscou: true, resultados: achados.slice(0, limiteDaConsulta(consulta)) };
    },
  };
  return { ...base, busca: busca satisfies BuscaTextoSync };
}
