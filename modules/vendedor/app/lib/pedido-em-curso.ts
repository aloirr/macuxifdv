/**
 * RN-VEN-49 (R-20261124-110151): o "+" do Catálogo grava direto no rascunho guardado no aparelho. O Novo pedido é desmontado
 * quando o Catálogo abre (rota única), então nada aqui usa estado de tela: o armazenamento do módulo (`mod:vendedor:`) é deixado
 * pelo Novo pedido antes de navegar e o rascunho é achado pelo código `pedidoEmCurso` (= chave do rascunho). Tudo local: sem sinal funciona.
 */
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';
import { produtoNoRascunho } from '../../domain/produto-no-rascunho';
import { criarRepositorio } from './repositorio';

export const AVISO_ADICIONADO_AO_PEDIDO = 'Adicionado ao pedido';
export const AVISO_VOLTE_AO_PEDIDO = 'Volte ao pedido';
export const AVISO_FALHA_AO_ADICIONAR = 'Não deu para adicionar. Tente de novo.';

let armazenamento: ArmazenamentoSync | null = null;
let fila: Promise<unknown> = Promise.resolve();

/** O Novo pedido chama antes de abrir o Catálogo; o valor sobrevive ao desmonte da tela. */
export function deixarArmazenamentoDoPedido(arm: ArmazenamentoSync): void {
  armazenamento = arm;
}

/** Devolve a fila de "+" pendentes: quem lê o rascunho do aparelho espera por ela (nenhum item some na ida e volta). */
export function aguardarPedidoEmCurso(): Promise<unknown> {
  return fila;
}

/** Adiciona o produto ao rascunho `pedidoEmCurso` e devolve o aviso curto (sucesso ou motivo da recusa). Em fila: toques seguidos somam. */
export function adicionarAoPedidoEmCurso(pedidoEmCurso: string | null | undefined, produtoId: string, arm: ArmazenamentoSync | null = armazenamento): Promise<string> {
  const rodar = async (): Promise<string> => {
    if (!pedidoEmCurso || !arm) return AVISO_VOLTE_AO_PEDIDO;
    const repo = criarRepositorio(arm);
    const dados = await repo.carregar();
    const rascunho = dados.rascunhos[pedidoEmCurso];
    const cliente = rascunho ? dados.clientes.find((c) => c.id === rascunho.customer_id) : undefined;
    if (!rascunho || !cliente) return AVISO_VOLTE_AO_PEDIDO;
    const r = produtoNoRascunho(rascunho, produtoId, dados.produtos[cliente.price_table_id ?? 'default']?.items ?? []);
    if (r.resultado === 'sem_preco' || r.resultado === 'nao_encontrado') return r.motivo;
    await repo.guardarRascunho(pedidoEmCurso, { ...r.rascunho, updated_at: new Date().toISOString() });
    return AVISO_ADICIONADO_AO_PEDIDO;
  };
  const p = fila.then(rodar, rodar).catch(() => AVISO_FALHA_AO_ADICIONAR);
  fila = p.catch(() => undefined);
  return p;
}
