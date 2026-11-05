/**
 * "Adicionar ao pedido" do Catálogo (T-0052/T-0071): o produto escolhido fica pendente em memória e o editor do pedido o
 * consome uma vez só, fora da URL (sem setParams, que criaria entrada nova na pilha do shell, ADR 0026).
 * A regra de consumo é pura (testada); o estado do módulo só guarda o pendente.
 */
export interface ProdutoPendente {
  produtoId: string;
  /** cliente em contexto; null = ainda sem cliente (o seletor vem antes) */
  clienteId: string | null;
  /** pedido em edição que deve receber o item; ausente/null = pedido novo do cliente */
  editId?: string | null;
}

/** Editor de onde o Catálogo foi aberto (RF-CAT-04): "Adicionar ao pedido" volta para a mesma URL, sem abrir editor novo. */
export interface OrigemEditor {
  customerId: string;
  editId?: string;
  visitId?: string;
  stopId?: string;
}

/** Origem a usar: só vale se o cliente do produto for o do editor (ou o Catálogo estava sem cliente). Pura. */
export function origemParaProduto(origem: OrigemEditor | null, clienteId: string | null | undefined): OrigemEditor | null {
  if (!origem || !clienteId || origem.customerId !== clienteId) return null;
  return origem;
}

/** Devolve o produto a aplicar para este cliente e o que sobra pendente. Cliente diferente do pedido mantém o pendente. */
export function consumirProdutoPendente(pendente: ProdutoPendente | null, clienteId: string, editId: string | null = null): { produtoId: string | null; resto: ProdutoPendente | null } {
  if (!pendente) return { produtoId: null, resto: null };
  // sem cliente definido o editor nunca consome (o seletor fixa o cliente antes); pedido novo e edição não trocam item
  if (pendente.clienteId === null || pendente.clienteId !== clienteId || (pendente.editId ?? null) !== editId) return { produtoId: null, resto: pendente };
  return { produtoId: pendente.produtoId, resto: null };
}

let pendente: ProdutoPendente | null = null;

export function deixarProdutoPendente(p: ProdutoPendente): void {
  pendente = p;
}

/** O seletor de cliente fixa o cliente escolhido no pendente "sem cliente" antes de abrir o editor. */
export function fixarClienteDoPendente(clienteId: string): void {
  if (pendente && pendente.clienteId === null) pendente = { ...pendente, clienteId };
}

/** Só olha (sem consumir): o seletor de cliente mostra qual produto vai entrar. */
export function produtoPendente(): ProdutoPendente | null {
  return pendente;
}

/** Pega para este cliente e apaga; chamadas repetidas não aplicam de novo. */
export function pegarProdutoPendente(clienteId: string, editId: string | null = null): string | null {
  const r = consumirProdutoPendente(pendente, clienteId, editId);
  pendente = r.resto;
  return r.produtoId;
}

/** A pessoa desistiu (saiu do pedido sem escolher cliente): não sobra para o próximo pedido. */
export function descartarProdutoPendente(): void {
  pendente = null;
}

let origem: OrigemEditor | null = null;

/** Chamado ao abrir o Catálogo de dentro do editor. */
export function guardarOrigemEditor(o: OrigemEditor): void {
  origem = o;
}

/** Pega a origem para este cliente e apaga; origem de outro cliente é ignorada (e apagada). */
export function pegarOrigemEditor(clienteId: string | null | undefined): OrigemEditor | null {
  const r = origemParaProduto(origem, clienteId);
  origem = null;
  return r;
}

/** O editor montou (voltou do Catálogo sem escolher): a origem não sobra para outro fluxo. */
export function descartarOrigemEditor(): void {
  origem = null;
}
