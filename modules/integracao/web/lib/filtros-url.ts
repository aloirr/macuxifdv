/**
 * Estado do monitor na URL (T-0051; padrão do BKO: quem recarrega ou compartilha o link vê a mesma tela): o histórico aberto de uma
 * entidade e o lote aberto na gaveta de erros. Validados pelos schemas do contrato (`Entidade`, `Uuid`). Funções puras; o hook que
 * liga ao navegador está em `use-filtros.ts`.
 */
import { Entidade, Uuid } from '../../contracts';

export interface FiltrosMonitor {
  /** Entidade cujo Histórico está aberto; vazio = fechado. */
  historico: string;
  /** Lote aberto na gaveta de erros. */
  lote: string;
}

export const FILTROS_VAZIOS: FiltrosMonitor = { historico: '', lote: '' };

const valido = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: string | null): string => (v && schema.safeParse(v).success ? v : '');

export function lerFiltros(busca: string): FiltrosMonitor {
  const p = new URLSearchParams(busca);
  return { historico: valido(Entidade, p.get('historico')), lote: valido(Uuid, p.get('lote')) };
}

export function paraBusca(f: FiltrosMonitor): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
