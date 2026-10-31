/**
 * Estado do Vendedor no aparelho: tudo no armazenamento do módulo (`motor.armazenamentoDoModulo('vendedor')`,
 * prefixo `mod:vendedor:`), apagado junto se o módulo for desativado (RN-CORE-02). Offline-first: as telas
 * leem daqui; a rede só alimenta (etapas de sync) e confirma (fila de envio).
 */
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';
import type { CustomerSummary, Me } from '@macuxi/core/contracts';
import type { DiscountPolicy, Order, OrderDetail } from '../../contracts';
import type { MixSuggestion, Product } from '@macuxi/catalogo/contracts';
import type { OrderDisplay, Rascunho } from './pedidos';

export interface TabelaDePrecos {
  items: Product[];
  synced_at: string;
}

export interface DadosVendedor {
  me: Me | null;
  politica: DiscountPolicy | null;
  clientes: CustomerSummary[];
  /** tabela de preços do cliente (`price_table_id` ou `default`) → produtos */
  produtos: Record<string, TabelaDePrecos>;
  pedidos: Order[];
  detalhes: Record<string, OrderDetail>;
  rascunhos: Record<string, Rascunho>;
  exibicoes: Record<string, OrderDisplay>;
  /** cliente → sugestão de mix (cache da ficha; atualiza com sinal) */
  mix: Record<string, MixSuggestion[]>;
  /** cliente → últimos pedidos vindos do servidor (cache da ficha) */
  ultimos: Record<string, Order[]>;
  sincronizado_em: string | null;
}

export const DADOS_VAZIOS: DadosVendedor = { me: null, politica: null, clientes: [], produtos: {}, pedidos: [], detalhes: {}, rascunhos: {}, exibicoes: {}, mix: {}, ultimos: {}, sincronizado_em: null };

type Chave = keyof DadosVendedor;

export function criarRepositorio(arm: ArmazenamentoSync) {
  const ler = async <K extends Chave>(k: K): Promise<DadosVendedor[K]> => (await arm.ler<DadosVendedor[K]>(k)) ?? DADOS_VAZIOS[k];
  const gravar = async <K extends Chave>(k: K, v: DadosVendedor[K]) => arm.gravar(k, v);
  const alterar = async <K extends Chave>(k: K, fn: (atual: DadosVendedor[K]) => DadosVendedor[K]) => gravar(k, fn(await ler(k)));

  return {
    ler,
    gravar,
    alterar,
    async carregar(): Promise<DadosVendedor> {
      const [me, politica, clientes, produtos, pedidos, detalhes, rascunhos, exibicoes, mix, ultimos, sincronizado_em] = await Promise.all([
        ler('me'),
        ler('politica'),
        ler('clientes'),
        ler('produtos'),
        ler('pedidos'),
        ler('detalhes'),
        ler('rascunhos'),
        ler('exibicoes'),
        ler('mix'),
        ler('ultimos'),
        ler('sincronizado_em'),
      ]);
      return { me, politica, clientes, produtos, pedidos, detalhes, rascunhos, exibicoes, mix, ultimos, sincronizado_em };
    },
    /** Guarda o detalhe do pedido e atualiza o resumo na lista do mês. */
    async guardarPedido(detalhe: OrderDetail): Promise<void> {
      await alterar('detalhes', (d) => ({ ...d, [detalhe.id]: detalhe }));
      const { items: _itens, history: _historico, ...resumo } = detalhe;
      await alterar('pedidos', (lista) => {
        const idx = lista.findIndex((o) => o.id === detalhe.id);
        if (idx < 0) return [resumo as Order, ...lista];
        const next = [...lista];
        next[idx] = resumo as Order;
        return next;
      });
    },
    async guardarRascunho(chave: string, rascunho: Rascunho): Promise<void> {
      await alterar('rascunhos', (r) => ({ ...r, [chave]: rascunho }));
    },
    async limparRascunho(chave: string): Promise<void> {
      await alterar('rascunhos', (r) => {
        const { [chave]: _x, ...resto } = r;
        return resto;
      });
    },
    async guardarExibicao(id: string, exibicao: OrderDisplay): Promise<void> {
      await alterar('exibicoes', (e) => ({ ...e, [id]: exibicao }));
    },
    async removerExibicao(id: string): Promise<void> {
      await alterar('exibicoes', (e) => {
        const { [id]: _x, ...resto } = e;
        return resto;
      });
    },
  };
}

export type RepositorioVendedor = ReturnType<typeof criarRepositorio>;
