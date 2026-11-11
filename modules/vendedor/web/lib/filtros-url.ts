/**
 * Filtros da lista de pedidos do BKO na URL (T-0029 §8): quem recarrega ou compartilha o link vê a mesma lista.
 * Funções puras (testadas); o hook que liga ao navegador está em `use-filtros.ts`.
 */
import { ORDER_STATUSES } from '../../contracts';

export interface FiltrosPedidos {
  /** vazio = todos */
  status: string;
  seller_id: string;
  /** filial do pedido (T-0149; vazio = todas) */
  branch_id: string;
  /** AAAA-MM-DD no fuso do tenant */
  from: string;
  to: string;
  /** cliente ou número do pedido */
  q: string;
}

export const FILTROS_VAZIOS: FiltrosPedidos = { status: '', seller_id: '', branch_id: '', from: '', to: '', q: '' };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê `?status=...` ignorando o que não faz sentido (link velho ou digitado à mão). */
export function lerFiltros(busca: string): FiltrosPedidos {
  const p = new URLSearchParams(busca);
  const status = p.get('status') ?? '';
  const seller = p.get('seller_id') ?? '';
  const branch = p.get('branch_id') ?? '';
  const from = p.get('from') ?? '';
  const to = p.get('to') ?? '';
  return {
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? status : '',
    seller_id: UUID.test(seller) ? seller : '',
    branch_id: UUID.test(branch) ? branch : '',
    from: DATA.test(from) ? from : '',
    to: DATA.test(to) ? to : '',
    q: (p.get('q') ?? '').slice(0, 100),
  };
}

/** Querystring só com o que está preenchido (`''` quando não há filtro). */
export function paraBusca(f: FiltrosPedidos): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Query da API (sem os vazios). */
export function paraQuery(f: FiltrosPedidos): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
}

export function temFiltro(f: FiltrosPedidos): boolean {
  return Object.values(f).some((v) => v !== '');
}
