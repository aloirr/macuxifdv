/**
 * Etapas de carga do Vendedor (REST da Fase M, até o `/v1/sync/pull` genérico existir — T-0004).
 * Rodam depois do envio da fila, só com o módulo efetivo, e gravam no armazenamento do módulo.
 * Falha de rede não apaga o que já está no aparelho.
 */
import type { CustomerSummary, Me } from '@macuxi/core/contracts';
import type { ContextoEtapaSync, EtapaSync } from '@macuxi/platform-sdk';
import { DEFAULT_TZ, monthStart } from '@macuxi/ui/mobile/puro';
import type { DiscountPolicy, Order } from '../contracts';
import type { Product } from '@macuxi/catalogo/contracts';
import { chavesAApagarNaBaseRecriada } from '../domain/base-recriada';
import { criarRepositorio, DADOS_VAZIOS, MARCA_PODAR_EXIBICOES, type DadosVendedor } from './lib/repositorio';

interface Pagina<T> {
  items: T[];
}

/** Rota inexistente (404) ou sync não implementado (501 / SYNC_NAO_IMPLEMENTADO). Os demais 4xx (401, 403, 423 DISPOSITIVO_BLOQUEADO...) seguem como erro (RN-CORE-15). */
export function rotaInexistente(e: unknown): boolean {
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown } | null;
  return x?.status === 404 || x?.status === 501 || x?.code === 'SYNC_NAO_IMPLEMENTADO' || x?.codigo === 'SYNC_NAO_IMPLEMENTADO';
}

/** Pula a etapa (sem derrubar a sincronização) quando a rota REST da Fase M não existe na API real. Rede e 5xx seguem como erro. */
export function toleraSemRota(etapa: EtapaSync): EtapaSync {
  return {
    ...etapa,
    executar: async (ctx) => {
      try {
        await etapa.executar(ctx);
      } catch (e) {
        if (!rotaInexistente(e)) throw e;
      }
    },
  };
}

/**
 * ADR 0021 / T-0079: a base do servidor foi recriada. O motor já reenviou a fila e guarda o que não foi aceito; aqui sai a
 * cópia do servidor no armazenamento do módulo (pedido fantasma). Ficam os rascunhos e as exibições, que o use-vendedor
 * poda em seguida para só as dos itens da fila e aceitos (`podarExibicoesOrfas`; sem elas o pedido na fila perderia o nome do cliente). Roda na API v1 também (não passa por soNaDemonstracao).
 * Idempotente: o motor repete a troca se o app cair no meio.
 */
export async function apagarCopiaDoServidor(ctx: ContextoEtapaSync): Promise<void> {
  const repo = criarRepositorio(ctx.armazenamento);
  for (const chave of chavesAApagarNaBaseRecriada(Object.keys(DADOS_VAZIOS))) {
    await repo.gravar(chave as keyof DadosVendedor, DADOS_VAZIOS[chave as keyof DadosVendedor] as never);
  }
  // o contexto da etapa não traz a fila: a poda das exibições órfãs (planoBaseRecriada) roda no use-vendedor, que a enxerga
  await ctx.armazenamento.gravar(MARCA_PODAR_EXIBICOES, true);
}

const etapasFaseM: readonly EtapaSync[] = [
  {
    id: 'alcadas',
    aoTrocarGeracao: apagarCopiaDoServidor,
    rotulo: 'Alçadas de desconto',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const repo = criarRepositorio(ctx.armazenamento);
      const [me, politica] = await Promise.all([ctx.http.get<Me>('/me'), ctx.http.get<DiscountPolicy>('/discount-policy')]);
      await repo.gravar('me', me);
      await repo.gravar('politica', politica);
    },
  },
  {
    id: 'carteira',
    rotulo: 'Carteira de clientes',
    modulo: 'vendedor',
    executar: async (ctx) => {
      const repo = criarRepositorio(ctx.armazenamento);
      const r = await ctx.http.get<Pagina<CustomerSummary>>('/customers', { limit: 5000 });
      await repo.gravar('clientes', r.items);
    },
  },
  {
    id: 'produtos',
    rotulo: 'Tabelas de preço e estoque',
    modulo: 'vendedor',
    executar: async (ctx) => {
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
        const r = await ctx.http.get<Pagina<Product>>('/products', { customer_id: customerId, limit: 5000 });
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
      const repo = criarRepositorio(ctx.armazenamento);
      const me = await repo.ler('me');
      const tz = me?.tenant.timezone || DEFAULT_TZ;
      const r = await ctx.http.get<Pagina<Order>>('/orders', { from: monthStart(ctx.agora(), tz), limit: 1000 });
      await repo.gravar('pedidos', r.items);
      await repo.gravar('sincronizado_em', ctx.agora().toISOString());
    },
  },
];

/**
 * Só a demonstração (mock-api) usa estas cargas REST. Na API v1 o login traz o fuso do tenant e as telas leem o pull
 * (`pedido`, `pedido_item`, `pedido_evento`, `cliente`, `produto`...): nenhuma rota da Fase M é chamada (T-0029 §8).
 */
export function soNaDemonstracao(etapa: EtapaSync): EtapaSync {
  return {
    ...etapa,
    executar: async (ctx) => {
      if (ctx.usuario()?.fuso) return;
      await etapa.executar(ctx);
    },
  };
}

export const etapasVendedor: readonly EtapaSync[] = etapasFaseM.map(toleraSemRota).map(soNaDemonstracao);
