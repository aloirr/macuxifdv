/**
 * Passagem AsyncStorage → SQLite na 1ª abertura do usuário (desenho T-0088 §2; ADR 0003, adendo de 2026-11-06). TS puro:
 * a origem é injetada (`chaves`/`ler`, o adaptador AsyncStorage do shell) e o destino é o `ArmazenamentoSqlite` já
 * aberto. Roda ANTES do motor existir (ninguém escreve durante a cópia).
 *
 * Grupos de chaves (`grupoDaChave`):
 * - A (não pode perder): `sync:fila`, `sync:aceitos`, `sync:arquivos`, `mod:*` (rascunhos e dados dos módulos);
 * - B (estado): `sync:modulos`, `sync:parametros`, `sync:limpeza_pendente`, `sync:geracao_base` e qualquer chave não listada;
 * - C (refazível pelo pull): `ent:<e>` (→ `ent_<e>` em lotes, cursor no último), `sync:cursor:*`, `sync:escopo:*`,
 *   `sync:ressinc:*`, `sync:carga`, `sync:novidades`, `sync:sincronizado_em`;
 * - fora: `sync:lease` (efêmero) e chaves internas do adaptador (`_*`).
 *
 * A e B são copiados e CONFERIDOS (mesmo JSON; nas filas, mesma quantidade e mesmos `id` na mesma ordem): divergência
 * ou exceção = `abortada` (o marcador fica `copiando`, a sessão segue no AsyncStorage e a próxima abertura recomeça do
 * zero: a origem está intacta). Falha no C = os dados do C saem do SQLite e o marcador diz `pull: 'refazer'` (sem
 * cursores nem `sync:sincronizado_em`, o motor faz a carga completa; a fila sai antes, no push). `concluida` nunca recopia.
 */
import type { ArmazenamentoSync } from '../motor-sync';
import type { LinhaSync } from '../sync';
import { TAMANHO_LOTE_GRAVACAO, type ArmazenamentoSqlite } from './armazenamento';
import { tabelaDaEntidade } from './esquema';

/** Marcador da passagem na `kv` do SQLite (chave interna: a passagem nunca a copia nem a apaga na limpeza). */
export const MARCADOR_PASSAGEM = '_migracao:asyncstorage';

export type GrupoPassagem = 'A' | 'B' | 'C';

const FILAS: ReadonlySet<string> = new Set(['sync:fila', 'sync:aceitos', 'sync:arquivos']);
const C_EXATAS: ReadonlySet<string> = new Set(['sync:carga', 'sync:novidades', 'sync:sincronizado_em']);
const C_PREFIXOS = ['ent:', 'sync:cursor:', 'sync:escopo:', 'sync:ressinc:'] as const;
const CHAVE_FILA = 'sync:fila';
const PREFIXO_ENT = 'ent:';

/** Grupo de uma chave da origem (sem o prefixo do usuário). */
export function grupoDaChave(chave: string): GrupoPassagem | 'fora' {
  if (chave === 'sync:lease' || chave.startsWith('_')) return 'fora';
  if (FILAS.has(chave) || chave.startsWith('mod:')) return 'A';
  if (C_EXATAS.has(chave) || C_PREFIXOS.some((p) => chave.startsWith(p))) return 'C';
  return 'B';
}

export interface ContagensPassagem {
  /** Chaves copiadas e conferidas de cada grupo (C = 0 quando o pull vai ser refeito). */
  a: number;
  b: number;
  c: number;
  /** Linhas de pull copiadas para as `ent_<e>`. */
  linhas: number;
}

export interface MarcadorPassagem {
  versao: 1;
  estado: 'copiando' | 'concluida';
  /** Tentativas até aqui (a abortada conta). */
  tentativas: number;
  iniciada_em: string;
  concluida_em?: string;
  /** `refazer` = o grupo C não entrou: o motor faz a carga completa no próximo sync. */
  pull?: 'copiado' | 'refazer';
  contagens?: ContagensPassagem;
}

/** O que a passagem lê da origem (o adaptador AsyncStorage do usuário serve como está). */
export type OrigemPassagem = Pick<ArmazenamentoSync, 'chaves' | 'ler'>;

/** Origem sem chave nenhuma (passagem já feita para outro arquivo do mesmo usuário: nada a copiar). */
export const ORIGEM_VAZIA: OrigemPassagem = { chaves: async () => [], ler: async () => null };

export interface ProgressoPassagem {
  grupo: GrupoPassagem;
  feitos: number;
  total: number;
}

export interface OpcoesPassagem {
  origem: OrigemPassagem;
  destino: ArmazenamentoSqlite;
  /** Fuso do tenant (versão dos documentos de busca conferida ANTES da carga: sem reindexação à toa depois). */
  fuso?: string;
  /** Tela "Atualizando os dados do aparelho…". Exceção aqui não interrompe a passagem. */
  aoProgredir?: (p: ProgressoPassagem) => void;
  /** Sem dado pessoal: só nomes de chave, contagens e a mensagem do erro. */
  registrarErro?: (mensagem: string) => void;
  agora?: () => Date;
}

export type EtapaPassagem = 'abertura' | 'limpeza' | 'copia' | 'conferencia' | 'dados' | 'marcador';

export type ResultadoPassagem =
  | { desfecho: 'concluida'; marcador: MarcadorPassagem; jaConcluida: boolean }
  | { desfecho: 'abortada'; etapa: EtapaPassagem; erro: string };

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const json = (v: unknown) => JSON.stringify(v);

const entidadeValida = (e: string) => {
  try {
    tabelaDaEntidade(e);
    return true;
  } catch {
    return false;
  }
};

/** Mesmo JSON; nas filas, também a mesma quantidade e os mesmos `id` na mesma ordem (a prova pedida pela T-0088). */
function conferirChave(chave: string, origem: unknown, destino: unknown): void {
  if (FILAS.has(chave) && Array.isArray(origem)) {
    if (!Array.isArray(destino) || destino.length !== origem.length) throw new Error(`fila ${chave} com quantidade diferente`);
    const id = (x: unknown) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined);
    if (origem.some((x, k) => id(x) !== id(destino[k]))) throw new Error(`fila ${chave} com ids diferentes ou fora de ordem`);
  }
  if (json(origem) !== json(destino)) throw new Error(`chave ${chave} diferente da origem`);
}

/** Tentativa anterior que caiu no meio: tira tudo o que ela gravou (linhas e chaves; as internas `_*` ficam). */
async function limparTentativa(d: ArmazenamentoSqlite): Promise<void> {
  const chaves = await d.chaves('');
  if (chaves.length === 0) return;
  await d.emTransacao(async (tx) => {
    for (const k of chaves) {
      if (k.startsWith(PREFIXO_ENT)) await tx.linhas!.limpar(k.slice(PREFIXO_ENT.length));
      else if (!k.startsWith('_')) await tx.remover(k);
    }
  });
}

export async function passarDoAsyncStorage(o: OpcoesPassagem): Promise<ResultadoPassagem> {
  const agora = o.agora ?? (() => new Date());
  const log = o.registrarErro ?? (() => {});
  const d = o.destino;
  const progredir = (p: ProgressoPassagem) => {
    try {
      o.aoProgredir?.(p);
    } catch {
      // a tela não derruba a passagem
    }
  };
  const abortar = (etapa: EtapaPassagem, e: unknown): ResultadoPassagem => {
    const erro = mensagem(e);
    log(`passagem AsyncStorage → SQLite abortada (${etapa}); a sessão segue no AsyncStorage: ${erro}`);
    return { desfecho: 'abortada', etapa, erro };
  };

  // 1. abertura, versão dos índices e marcador
  let anterior: MarcadorPassagem | null;
  try {
    await d.pronto;
    await d.busca.conferirVersoes?.({ fuso: o.fuso });
    anterior = await d.ler<MarcadorPassagem>(MARCADOR_PASSAGEM);
  } catch (e) {
    return abortar('abertura', e);
  }
  // 2. concluída nunca recopia
  if (anterior?.estado === 'concluida') return { desfecho: 'concluida', marcador: anterior, jaConcluida: true };
  const marcador: MarcadorPassagem = {
    versao: 1,
    estado: 'copiando',
    tentativas: (anterior?.tentativas ?? 0) + 1,
    iniciada_em: agora().toISOString(),
  };
  try {
    await d.gravar(MARCADOR_PASSAGEM, marcador);
    await limparTentativa(d);
  } catch (e) {
    return abortar('limpeza', e);
  }

  const grupos: Record<GrupoPassagem, string[]> = { A: [], B: [], C: [] };
  const valores = new Map<string, unknown>();
  let contA = 0;
  let contB = 0;
  // 4. grupos A e B: cópia (a fila por último, fora da transação, em synchronous=FULL) e conferência
  try {
    for (const k of [...(await o.origem.chaves(''))].sort()) {
      const g = grupoDaChave(k);
      if (g !== 'fora') grupos[g].push(k);
    }
    progredir({ grupo: 'A', feitos: 0, total: grupos.A.length });
    for (const k of [...grupos.A, ...grupos.B]) {
      const v = await o.origem.ler<unknown>(k);
      // ilegível ou vazia na origem = o motor também a lê como ausente: nada a copiar
      if (v === null || v === undefined) continue;
      valores.set(k, v);
      if (grupoDaChave(k) === 'A') contA++;
      else contB++;
    }
    const semFila = [...valores].filter(([k]) => k !== CHAVE_FILA);
    if (semFila.length > 0)
      await d.emTransacao(async (tx) => {
        for (const [k, v] of semFila) await tx.gravar(k, v);
      });
    if (valores.has(CHAVE_FILA)) await d.gravar(CHAVE_FILA, valores.get(CHAVE_FILA));
  } catch (e) {
    return abortar('copia', e);
  }
  try {
    for (const [k, v] of valores) conferirChave(k, v, await d.ler<unknown>(k));
  } catch (e) {
    return abortar('conferencia', e);
  }
  progredir({ grupo: 'A', feitos: grupos.A.length, total: grupos.A.length });
  progredir({ grupo: 'B', feitos: grupos.B.length, total: grupos.B.length });

  // 5. grupo C: se falhar, sai do SQLite e o pull é refeito (a fila e os rascunhos ficam)
  let pull: 'copiado' | 'refazer' = 'copiado';
  let linhas = 0;
  let contC = 0;
  const tocadas = new Set<string>();
  try {
    const entidades = grupos.C.filter((k) => k.startsWith(PREFIXO_ENT)).map((k) => k.slice(PREFIXO_ENT.length));
    const total = grupos.C.length;
    let feitos = 0;
    progredir({ grupo: 'C', feitos, total });
    const comLinhas = new Set<string>();
    for (const e of entidades) {
      feitos++;
      if (!entidadeValida(e)) {
        log(`passagem: entidade com nome inválido para o SQLite ficou de fora (o pull a traz de novo)`);
        continue;
      }
      tocadas.add(e);
      comLinhas.add(e);
      const mapa = (await o.origem.ler<Record<string, LinhaSync>>(PREFIXO_ENT + e)) ?? {};
      const todas = Object.values(mapa);
      const cursor = (await o.origem.ler<string>(`sync:cursor:${e}`)) ?? null;
      if (todas.length === 0) await d.linhas.aplicar(e, [], cursor);
      for (let i = 0; i < todas.length; i += TAMANHO_LOTE_GRAVACAO) {
        const lote = todas.slice(i, i + TAMANHO_LOTE_GRAVACAO);
        // cursor só no último lote: app morto no meio = marcador `copiando`, a próxima abertura recomeça
        await d.linhas.aplicar(e, lote, i + TAMANHO_LOTE_GRAVACAO >= todas.length ? cursor : null);
        linhas += lote.length;
      }
      contC++;
      if (cursor !== null) contC++;
      progredir({ grupo: 'C', feitos, total });
    }
    for (const k of grupos.C) {
      if (k.startsWith(PREFIXO_ENT)) continue;
      if (k.startsWith('sync:cursor:')) {
        const e = k.slice('sync:cursor:'.length);
        if (comLinhas.has(e) || !entidadeValida(e)) continue;
      }
      feitos++;
      const v = await o.origem.ler<unknown>(k);
      if (v === null || v === undefined) continue;
      await d.gravar(k, v);
      contC++;
    }
    progredir({ grupo: 'C', feitos: total, total });
  } catch (e) {
    log(`passagem: dados do pull não copiados (${mensagem(e)}); o motor refaz a carga completa, a fila fica`);
    try {
      await d.emTransacao(async (tx) => {
        for (const e of tocadas) await tx.linhas!.limpar(e);
        for (const k of grupos.C) if (!k.startsWith(PREFIXO_ENT)) await tx.remover(k);
      });
    } catch (e2) {
      return abortar('dados', e2);
    }
    pull = 'refazer';
    linhas = 0;
    contC = 0;
  }

  // 6. concluída (gravação durável: synchronous=FULL no adaptador)
  const final: MarcadorPassagem = {
    ...marcador,
    estado: 'concluida',
    concluida_em: agora().toISOString(),
    pull,
    contagens: { a: contA, b: contB, c: contC, linhas },
  };
  try {
    await d.gravar(MARCADOR_PASSAGEM, final);
  } catch (e) {
    return abortar('marcador', e);
  }
  return { desfecho: 'concluida', marcador: final, jaConcluida: false };
}

/** Dias depois de `concluida` em que a origem sai mesmo sem sync completo (T-0088 §2.8). */
export const DIAS_ATE_APAGAR_ORIGEM = 7;

/**
 * A origem (AsyncStorage do usuário) só sai com o marcador `concluida` E um sync completo com sucesso depois dele (a fila
 * já foi enviada), ou `dias` depois de `concluida`.
 */
export function podeApagarOrigem(
  marcador: MarcadorPassagem | null,
  sincronizadoEm: string | null,
  agora: Date,
  dias = DIAS_ATE_APAGAR_ORIGEM,
): boolean {
  if (marcador?.estado !== 'concluida' || !marcador.concluida_em) return false;
  const concluida = Date.parse(marcador.concluida_em);
  if (Number.isNaN(concluida)) return false;
  const sincronizado = sincronizadoEm ? Date.parse(sincronizadoEm) : NaN;
  return (!Number.isNaN(sincronizado) && sincronizado > concluida) || agora.getTime() - concluida >= dias * 86_400_000;
}

/**
 * Remoção idempotente da origem (repete a cada abertura até não sobrar chave). Devolve `true` se a regra permitia
 * (com ou sem chave a remover); `false` = a origem fica.
 */
export async function apagarOrigemSePossivel(o: {
  origem: Pick<ArmazenamentoSync, 'chaves' | 'remover'>;
  destino: Pick<ArmazenamentoSync, 'ler'>;
  agora?: () => Date;
  dias?: number;
}): Promise<boolean> {
  const marcador = await o.destino.ler<MarcadorPassagem>(MARCADOR_PASSAGEM);
  const sincronizadoEm = await o.destino.ler<string>('sync:sincronizado_em');
  if (!podeApagarOrigem(marcador, sincronizadoEm, (o.agora ?? (() => new Date()))(), o.dias)) return false;
  for (const k of await o.origem.chaves('')) await o.origem.remover(k);
  return true;
}
