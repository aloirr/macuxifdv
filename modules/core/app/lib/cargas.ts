/**
 * Cargas do Core para o aparelho (etapas de sync do módulo — `moduloApp.etapasSync`). Enquanto o servidor de
 * desenvolvimento é o mock-api da Fase M (sem `/v1/sync/pull`), a carteira, a rota do dia, as metas e o
 * atendimento aberto vêm do REST da Fase M e são gravados no armazenamento do módulo (`ctx.armazenamento`).
 * Quando o pull genérico existir (T-0004), estas etapas saem e as entidades `cliente`, `rota`, `meta`… entram.
 */
import { monthStart } from '@macuxi/ui/mobile/puro';
import type { EtapaSync } from '@macuxi/platform-sdk';

import type { CustomerSummary, OpenVisit, RouteDay, SellerGoals } from '../../contracts';
import { CHAVES, fusoDe, type VisitaServidor } from './estado';
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
    id: 'clientes',
    rotulo: 'Carteira de clientes',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const r = await http.get<Pagina<CustomerSummary>>('/customers', { limit: 5000 });
      await ctx.armazenamento.gravar(CHAVES.clientes, r.items);
      await ctx.armazenamento.gravar(CHAVES.carregadoEm, ctx.agora().toISOString());
    },
  },
  {
    id: 'rota',
    rotulo: 'Rota do dia',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const rota = await ou4xxNulo(() => http.get<RouteDay>('/routes/today'));
      await ctx.armazenamento.gravar(CHAVES.rota, rota);
    },
  },
  {
    id: 'visita-aberta',
    rotulo: 'Atendimento em aberto',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const buscado_em = ctx.agora().toISOString();
      const aberta = await http.get<OpenVisit>('/visits/open');
      const valor: VisitaServidor = { aberta, buscado_em };
      // a conciliação com as visitas do aparelho (e da fila) acontece ao carregar o estado (ArmazemCore)
      await ctx.armazenamento.gravar(CHAVES.visitaServidor, valor);
    },
  },
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
