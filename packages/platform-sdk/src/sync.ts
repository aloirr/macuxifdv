/**
 * Sincronização offline (docs/produto/04 "Sincronização offline").
 *
 * - Cada módulo registra as entidades declaradas em `sync` do manifesto, com a política de conflito.
 * - Pull: `GET /v1/sync/pull?entidades=...&cursor=...`, cursor `(updated_at, id)`, inclui removidos,
 *   páginas de 1.000, escopo da carteira, só entidades de módulos efetivos.
 * - Push: `POST /v1/sync/push` com lote da outbox do aparelho; idempotente pelo UUID gerado no
 *   aparelho; resposta por item: aceito | rejeitado (código RN) | conflito.
 *
 * Aqui ficam tipos, registro e funções puras; o motor (SQLite no app, Postgres na API) usa esta interface.
 */
import { z } from 'zod';
import type { Manifesto } from './manifesto';
import type { ModuloId } from './nomes';
import { ENTIDADE_SYNC_RE } from './nomes';

export const TAMANHO_PAGINA_SYNC = 1000;
export const MAX_ITENS_PUSH = 500;

/**
 * - `servidor_vence`: dado vindo do ERP/BKO (cliente, produto, preço, estoque).
 * - `app_edita_ate_status`: o app edita até um status (ex.: pedido até `recebido`).
 * - `somente_insercao`: respostas de pesquisa, progresso, coletas — nunca conflita.
 */
export type PoliticaConflito = 'servidor_vence' | 'app_edita_ate_status' | 'somente_insercao';
export type DirecaoSync = 'pull' | 'push' | 'ambos';

export interface DefinicaoEntidadeSync<S extends z.ZodTypeAny = z.ZodTypeAny> {
  nome: string;
  modulo: ModuloId;
  direcao: DirecaoSync;
  conflito: PoliticaConflito;
  /** Schema do registro (pull) e do payload aceito no push. */
  schema: S;
}

export function definirEntidadeSync<S extends z.ZodTypeAny>(def: DefinicaoEntidadeSync<S>): DefinicaoEntidadeSync<S> {
  if (!ENTIDADE_SYNC_RE.test(def.nome)) throw new Error(`Entidade de sync inválida: ${def.nome}`);
  return def;
}

export function criarRegistroSync(manifestos: readonly Manifesto[]) {
  const porId = new Map(manifestos.map((m) => [m.id, m] as const));
  const entidades = new Map<string, DefinicaoEntidadeSync>();
  return {
    registrar(def: DefinicaoEntidadeSync): void {
      const m = porId.get(def.modulo);
      if (!m) throw new Error(`Módulo ${def.modulo} não está instalado`);
      if (!m.sync.includes(def.nome)) throw new Error(`${def.nome} não está em "sync" do manifesto de ${def.modulo}`);
      const atual = entidades.get(def.nome);
      if (atual) throw new Error(`Entidade de sync ${def.nome} já registrada por ${atual.modulo}`);
      entidades.set(def.nome, def);
    },
    /** Entidades que o aparelho deve puxar/enviar, só de módulos efetivos (RN-CORE-02). */
    entidadesAtivas(modulosAtivos: Iterable<ModuloId>, direcao?: 'pull' | 'push'): DefinicaoEntidadeSync[] {
      const ativos = new Set(modulosAtivos);
      return [...entidades.values()]
        .filter((e) => ativos.has(e.modulo))
        .filter((e) => !direcao || e.direcao === 'ambos' || e.direcao === direcao)
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
    entidade(nome: string): DefinicaoEntidadeSync | undefined {
      return entidades.get(nome);
    },
  };
}

export type RegistroSync = ReturnType<typeof criarRegistroSync>;

// ---------- cursor (updated_at, id) ----------

export interface CursorSync {
  /** Instante UTC ISO 8601. */
  updated_at: string;
  id: string;
}

const SEP = '|';

export function codificarCursor(c: CursorSync): string {
  return `${c.updated_at}${SEP}${c.id}`;
}

export function decodificarCursor(s: string | null | undefined): CursorSync | null {
  if (!s) return null;
  const i = s.indexOf(SEP);
  if (i <= 0 || i === s.length - 1) return null;
  const updated_at = s.slice(0, i);
  if (Number.isNaN(Date.parse(updated_at))) return null;
  return { updated_at, id: s.slice(i + 1) };
}

/** Ordem total do pull: por updated_at e, no empate, por id. */
export function compararCursor(a: CursorSync, b: CursorSync): number {
  const ta = Date.parse(a.updated_at);
  const tb = Date.parse(b.updated_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface LinhaSync extends CursorSync {
  deleted_at: string | null;
}

export interface PaginaSync<L> {
  itens: L[];
  proximo_cursor: string | null;
}

/** Página após o cursor (inclui removidos). Usado no motor em memória e como referência do SQL. */
export function paginar<L extends LinhaSync>(linhas: readonly L[], cursor: string | null, limite = TAMANHO_PAGINA_SYNC): PaginaSync<L> {
  const desde = decodificarCursor(cursor);
  const ordenadas = [...linhas].sort(compararCursor);
  const depois = desde ? ordenadas.filter((l) => compararCursor(l, desde) > 0) : ordenadas;
  const itens = depois.slice(0, limite);
  const ultimo = itens[itens.length - 1];
  return { itens, proximo_cursor: depois.length > limite && ultimo ? codificarCursor(ultimo) : null };
}

// ---------- push ----------

const Uuid = z.string().uuid('id precisa ser UUID gerado no aparelho');

export const ItemPushSchema = z.object({
  entidade: z.string().regex(ENTIDADE_SYNC_RE),
  /** UUID gerado no aparelho; também é a chave de idempotência. */
  id: Uuid,
  operacao: z.enum(['upsert', 'remover']).default('upsert'),
  payload: z.unknown(),
});
export type ItemPush = z.infer<typeof ItemPushSchema>;

export const PushRequestSchema = z.object({ itens: z.array(ItemPushSchema).min(1).max(MAX_ITENS_PUSH) });
export type PushRequest = z.infer<typeof PushRequestSchema>;

export type ResultadoItemPush =
  | { id: string; status: 'aceito' }
  | { id: string; status: 'rejeitado'; codigo: string; mensagem: string }
  | { id: string; status: 'conflito'; mensagem: string; atual?: unknown };

/** Item de entidade desconhecida ou de módulo inativo é rejeitado com código, nunca descartado em silêncio. */
export function rejeitarItensInvalidos(
  req: PushRequest,
  registro: RegistroSync,
  modulosAtivos: Iterable<ModuloId>,
): { validos: ItemPush[]; rejeitados: ResultadoItemPush[] } {
  const ativos = new Set(modulosAtivos);
  const validos: ItemPush[] = [];
  const rejeitados: ResultadoItemPush[] = [];
  for (const item of req.itens) {
    const def = registro.entidade(item.entidade);
    if (!def || def.direcao === 'pull') {
      rejeitados.push({ id: item.id, status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: `Entidade ${item.entidade} não aceita push` });
    } else if (!ativos.has(def.modulo)) {
      rejeitados.push({ id: item.id, status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: `Módulo ${def.modulo} inativo` });
    } else {
      const p = def.schema.safeParse(item.payload);
      if (p.success) validos.push({ ...item, payload: p.data });
      else rejeitados.push({ id: item.id, status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO', mensagem: p.error.issues.map((i) => i.message).join('; ') });
    }
  }
  return { validos, rejeitados };
}
