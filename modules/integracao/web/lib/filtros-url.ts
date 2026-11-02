/**
 * Filtros do monitor do Hub na URL (T-0051; padrão do BKO: quem recarrega ou compartilha o link vê a mesma lista) e o lote aberto
 * na gaveta. Validados pelos schemas do contrato (`ConectorIdentificador`, `Entidade`, `EstadoLote`, `Uuid`). Funções puras; o hook
 * que liga ao navegador está em `use-filtros.ts`.
 */
import { ConectorIdentificador, Entidade, EstadoLote, Uuid, type LoteListagemItem } from '../../contracts';

export interface FiltrosMonitor {
  /** Identificador do Conector (`conector_id`); vazio = todos. */
  conector: string;
  entidade: string;
  status: string;
  /** `'1'` = só lotes com erro por linha. */
  com_erro: string;
  /** Lote aberto na gaveta de erros. */
  lote: string;
}

export const FILTROS_VAZIOS: FiltrosMonitor = { conector: '', entidade: '', status: '', com_erro: '', lote: '' };

const valido = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: string | null): string => (v && schema.safeParse(v).success ? v : '');

export function lerFiltros(busca: string): FiltrosMonitor {
  const p = new URLSearchParams(busca);
  return {
    conector: valido(ConectorIdentificador, p.get('conector')),
    entidade: valido(Entidade, p.get('entidade')),
    status: valido(EstadoLote, p.get('status')),
    com_erro: p.get('com_erro') === '1' ? '1' : '',
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
  return Boolean(f.conector || f.entidade || f.status || f.com_erro);
}

/** Query de `LoteListagemQuery` (`GET /v1/integracao/lotes`), sem os vazios. */
export function paraQueryLotes(f: FiltrosMonitor): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.conector) q.conector_id = f.conector;
  if (f.entidade) q.entidade = f.entidade;
  if (f.status) q.status = f.status;
  if (f.com_erro) q.com_erro = 'true';
  return q;
}

/** Filtra os lotes recentes do `MonitorResumo` com os filtros da tela. */
export function filtrarLotes(lotes: readonly LoteListagemItem[], f: FiltrosMonitor): LoteListagemItem[] {
  return lotes.filter(
    (l) =>
      (!f.conector || l.conector_id === f.conector) &&
      (!f.entidade || l.entidade === f.entidade) &&
      (!f.status || l.status === f.status) &&
      (!f.com_erro || l.com_erro > 0),
  );
}
