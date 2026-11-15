/**
 * Filtros do monitor do Hub na URL (T-0051; padrão do BKO: quem recarrega ou compartilha o link vê a mesma lista) e o lote aberto
 * na gaveta. Validados pelos schemas do contrato (`Entidade`, `Uuid`, `STATUS_LOTE`). Funções puras; o hook
 * que liga ao navegador está em `use-filtros.ts`.
 */
import { Entidade, Uuid, type LoteListagemItem } from '../../contracts';
import { STATUS_LOTE, estadosDoStatus, statusDoLote, type StatusLote } from '../../domain';

export interface FiltrosMonitor {
  entidade: string;
  /** Um dos 5 status da tela (`STATUS_LOTE`, RN-INT-15); vazio = todos. */
  status: string;
  /** Lote aberto na gaveta de erros. */
  lote: string;
}

export const FILTROS_VAZIOS: FiltrosMonitor = { entidade: '', status: '', lote: '' };

const valido = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: string | null): string => (v && schema.safeParse(v).success ? v : '');

export function lerFiltros(busca: string): FiltrosMonitor {
  const p = new URLSearchParams(busca);
  return {
    entidade: valido(Entidade, p.get('entidade')),
    status: (STATUS_LOTE as readonly string[]).includes(p.get('status') ?? '') ? (p.get('status') as string) : '',
    lote: valido(Uuid, p.get('lote')),
  };
}

export function paraBusca(f: FiltrosMonitor): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Há filtro de lista (o lote aberto não conta). */
export function temFiltro(f: FiltrosMonitor): boolean {
  return Boolean(f.entidade || f.status);
}

/** Query de `LoteListagemQuery` (`GET /v1/integracao/lotes`), sem os vazios. */
export function paraQueryLotes(f: FiltrosMonitor): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.entidade) q.entidade = f.entidade;
  // a API filtra por estado técnico: o status com um estado só (todos menos Em andamento) vai; Em andamento (2 estados) fica no filtro local
  const estados = f.status ? estadosDoStatus(f.status as StatusLote) : [];
  if (estados.length === 1) q.status = estados[0] as string;
  return q;
}

/** Filtra os lotes recentes do `MonitorResumo` com os filtros da tela. */
export function filtrarLotes(lotes: readonly LoteListagemItem[], f: FiltrosMonitor): LoteListagemItem[] {
  return lotes.filter(
    (l) =>
      (!f.entidade || l.entidade === f.entidade) &&
      (!f.status || statusDoLote(l.status) === f.status),
  );
}
