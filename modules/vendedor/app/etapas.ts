/**
 * Etapas de carga do Vendedor (REST da Fase M, até o `/v1/sync/pull` genérico existir — T-0004).
 * Rodam depois do envio da fila, só com o módulo efetivo, e gravam no armazenamento do módulo.
 * Falha de rede não apaga o que já está no aparelho.
 */
import type { CustomerSummary, Me } from '@macuxi/core/contracts';
import type { EtapaSync } from '@macuxi/platform-sdk';
import { DEFAULT_TZ, monthStart } from '@macuxi/ui/mobile';
import type { DiscountPolicy, Order, Product } from '../contracts';
import { exigirAmbiente } from './ambiente';
import { criarRepositorio, type DadosVendedor } from './lib/repositorio';

interface Pagina<T> {
  items: T[];
}

export const etapasVendedor: readonly EtapaSync[] = [
  {
    id: 'alcadas',
    rotulo: 'Alçadas de desconto',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const amb = exigirAmbiente();
      const repo = criarRepositorio(ctx.armazenamento);
      const [me, politica] = await Promise.all([amb.requisitar<Me>('GET', '/me'), amb.requisitar<DiscountPolicy>('GET', '/discount-policy')]);
      await repo.gravar('me', me);
      await repo.gravar('politica', politica);
    },
  },
  {
    id: 'carteira',
    rotulo: 'Carteira de clientes',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const amb = exigirAmbiente();
      const repo = criarRepositorio(ctx.armazenamento);
      const r = await amb.requisitar<Pagina<CustomerSummary>>('GET', '/customers', { query: { limit: 5000 } });
      await repo.gravar('clientes', r.items);
    },
  },
  {
    id: 'produtos',
    rotulo: 'Tabelas de preço e estoque',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const amb = exigirAmbiente();
      const repo = criarRepositorio(ctx.armazenamento);
      const clientes = await repo.ler('clientes');
      const agora = ctx.agora().toISOString();
      // uma carga por tabela de preços, usando um cliente dela como referência
      const tabelas = new Map<string, string | undefined>();
      for (const c of clientes) {
        const t = c.price_table_id ?? 'default';
        if (!tabelas.has(t)) tabelas.set(t, c.price_table_id ? c.id : undefined);
      }
      if (tabelas.size === 0) tabelas.set('default', undefined);
      const produtos: DadosVendedor['produtos'] = {};
      for (const [tabela, customerId] of tabelas) {
        const r = await amb.requisitar<Pagina<Product>>('GET', '/products', { query: { customer_id: customerId, limit: 5000 } });
        produtos[tabela] = { items: r.items, synced_at: agora };
      }
      await repo.gravar('produtos', produtos);
    },
  },
  {
    id: 'pedidos',
    rotulo: 'Pedidos do mês',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const amb = exigirAmbiente();
      const repo = criarRepositorio(ctx.armazenamento);
      const me = await repo.ler('me');
      const tz = me?.tenant.timezone || DEFAULT_TZ;
      const r = await amb.requisitar<Pagina<Order>>('GET', '/orders', { query: { from: monthStart(ctx.agora(), tz), limit: 1000 } });
      await repo.gravar('pedidos', r.items);
      await repo.gravar('sincronizado_em', ctx.agora().toISOString());
    },
  },
];
