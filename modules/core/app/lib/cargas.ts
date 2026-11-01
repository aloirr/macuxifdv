/**
 * Cargas do Core para o aparelho que ainda vêm do REST da Fase M (etapas de sync do módulo — `moduloApp.etapasSync`):
 * só `metas` (T-0020) e `pedidos-da-visita` (ligação do pedido com a visita; o pedido real vem do Vendedor).
 * Carteira, rota do dia e visitas saíram daqui na T-0018: chegam pelo pull genérico (`entidades-cliente.ts`,
 * `entidades-rota.ts`) e a tela lê só o aparelho.
 */
import { monthStart } from '@macuxi/ui/mobile/puro';
import type { EtapaSync } from '@macuxi/platform-sdk';

import type { SellerGoals } from '../../contracts';
import { CHAVES, fusoDe } from './estado';
import { erroDeCliente, exigirHttp } from './http';
import type { OrderLike } from './visit';

interface Pagina<T> {
  items: T[];
}

/** 4xx do servidor (sem rota hoje, sem metas para o perfil) = "vazio", não falha da sincronização. */
async function ou4xxNulo<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    if (erroDeCliente(e)) return null;
    throw e;
  }
}

export const etapasCore: readonly EtapaSync[] = [
  {
    id: 'metas',
    rotulo: 'Metas e RV',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const metas = await ou4xxNulo(() => http.get<SellerGoals>('/goals/me'));
      await ctx.armazenamento.gravar(CHAVES.metas, metas);
    },
  },
  {
    id: 'pedidos-da-visita',
    rotulo: 'Pedidos do mês (ligação com a visita)',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const me = await ctx.armazenamento.ler<Parameters<typeof fusoDe>[0]>(CHAVES.me);
      // sem o módulo Vendedor (403 MODULO_INATIVO) ou sem pedidos: lista vazia, a sincronização segue
      const r = (await ou4xxNulo(() => http.get<Pagina<OrderLike>>('/orders', { from: monthStart(ctx.agora(), fusoDe(me)), limit: 1000 }))) ?? { items: [] };
      const pedidos: OrderLike[] = r.items.map((o) => ({ id: o.id, number: o.number, customer_id: o.customer_id, status: o.status, total_cents: o.total_cents, received_at: o.received_at, created_offline_at: o.created_offline_at ?? null }));
      await ctx.armazenamento.gravar(CHAVES.pedidos, pedidos);
    },
  },
];
