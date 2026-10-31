/** Auxiliares de teste do domain do Gestor (builders de eventos e ids). Não faz parte da API pública do módulo. */
import type { EventoRecebido } from './projecao';

/** UUID determinístico. */
export const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let seq = 0;
/** Evento recebido com id sequencial único (ou o `evento_id` informado, para testar reentrega). */
export function ev(nome: string, ocorrido_em: string, payload: Record<string, unknown>, evento_id?: string): EventoRecebido {
  seq += 1;
  return { evento_id: evento_id ?? `ev-${seq}`, nome, ocorrido_em, payload };
}

export const VENDEDOR = u(100);
export const VENDEDOR_2 = u(101);
export const PROMOTOR = u(200);
export const SUPERVISOR = u(300);
export const GERENTE = u(400);
export const CLIENTE_A = u(501);
export const CLIENTE_B = u(502);
export const CLIENTE_C = u(503);

export function pedidoCriado(o: { pedido?: string; vendedor?: string; autor?: string; cliente?: string; total: number; tabela?: number | null; em?: string; tipo?: 'pedido' | 'orcamento'; visita?: string | null }, id?: string) {
  return ev(
    'vendedor.pedido.criado@1',
    o.em ?? '2026-10-30T14:00:00Z',
    {
      pedido_id: o.pedido ?? u(1000),
      vendedor_id: o.vendedor ?? VENDEDOR,
      autor_id: o.autor ?? o.vendedor ?? VENDEDOR,
      cliente_id: o.cliente ?? CLIENTE_A,
      visita_id: o.visita ?? null,
      tipo: o.tipo ?? 'pedido',
      total_cents: o.total,
      total_tabela_cents: o.tabela === undefined ? o.total : o.tabela,
      criado_em: o.em ?? '2026-10-30T14:00:00Z',
    },
    id,
  );
}

export function statusAlterado(o: { pedido?: string; vendedor?: string; para: string; em: string }, id?: string) {
  return ev('vendedor.pedido.status_alterado@1', o.em, { pedido_id: o.pedido ?? u(1000), vendedor_id: o.vendedor ?? VENDEDOR, para: o.para, alterado_em: o.em }, id);
}

export function checkin(o: { visita?: string; usuario?: string; cliente?: string; em: string }) {
  return ev('core.visita.checkin@1', o.em, { visita_id: o.visita ?? u(2000), usuario_id: o.usuario ?? VENDEDOR, cliente_id: o.cliente ?? CLIENTE_A, checkin_em: o.em });
}

export function checkout(o: { visita?: string; usuario?: string; cliente?: string; em: string; encerramento?: 'normal' | 'automatico' }) {
  return ev('core.visita.checkout@1', o.em, { visita_id: o.visita ?? u(2000), usuario_id: o.usuario ?? VENDEDOR, cliente_id: o.cliente ?? CLIENTE_A, checkout_em: o.em, encerramento: o.encerramento ?? 'normal' });
}
