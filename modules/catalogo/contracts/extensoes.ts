/**
 * Ponto de extensão de UI que o Catálogo OFERECE (ADR 0003; manifesto `ofereceExtensoes: ['produto.acoes']`).
 *
 * `produto.acoes` → botões no rodapé da ficha do produto e no cartão da vitrine (app Campo/Gestão). Exemplo: o Vendedor
 * registra "Adicionar ao orçamento" com `acao: 'pedido.criar'` — o shell esconde o item de quem não tem a ação (o
 * promotor nunca vê, RN-PRO-01; regra 7). O Catálogo não declara ação de pedido. `contracts` não depende de React.
 */

/** O que a ficha/vitrine entrega a quem registrou uma ação de produto. */
export interface ContextoProduto {
  /** Id do produto (= `core.produto.id`). */
  produtoId: string;
  /** SKU/código ERP, para mensagens. */
  sku: string;
  /** Nome do produto, para títulos e mensagens. */
  nomeProduto: string;
  /** Cliente em contexto (o catálogo foi aberto pela ficha do cliente ou pelo pedido), se houver. */
  clienteId: string | null;
  /** O item é vendável para o cliente em contexto (tem preço na tabela dele, RN-CAT-06). Nulo = sem cliente ou sem preço visível. */
  vendavel: boolean | null;
  /** Código opaco do pedido em curso (o catálogo foi aberto a partir do Novo pedido); só repassado, o Catálogo não o interpreta. */
  pedidoEmCurso?: string | null;
}

/** Slot `produto.acoes`: botão na ficha e no cartão do produto. */
export interface AcaoProduto {
  /** Texto do botão. */
  rotulo: string;
  testID: string;
  /** Nome de ícone do kit `@macuxi/ui/mobile` (opcional). */
  icone?: string;
  /** Destaque visual (padrão: botão secundário). */
  destaque?: boolean;
  /** Em que tela aparece: `consulta` (catálogo/ficha avulsos) ou `pedido` (catálogo aberto do pedido). Ausente = nas duas. */
  onde?: 'consulta' | 'pedido';
  /**
   * Se devolver um texto (direto ou ao resolver), o Catálogo o avisa; `void` não avisa.
   */
  abrir: (ctx: ContextoProduto) => void | string | Promise<void | string>;
}

export interface SlotsCatalogo {
  'produto.acoes': AcaoProduto;
}

export const SLOTS_CATALOGO = ['produto.acoes'] as const;

/** Ações visíveis na tela (regra em AcaoProduto.onde). */
export function acoesDaTela<T extends { payload: Pick<AcaoProduto, 'onde'> }>(acoes: readonly T[], dentroDoPedido: boolean): T[] {
  const alvo = dentroDoPedido ? 'pedido' : 'consulta';
  return acoes.filter((a) => a.payload.onde === undefined || a.payload.onde === alvo);
}

/**
 * Executa a ação e entrega o texto devolvido (se houver) a `avisar`. Erro da ação
 * não vira aviso aqui (fica com quem registrou a ação); texto vazio não avisa.
 */
export async function executarAcaoProduto(acao: Pick<AcaoProduto, 'abrir'>, ctx: ContextoProduto, avisar: (texto: string) => void): Promise<void> {
  const r = await acao.abrir(ctx);
  if (typeof r === 'string' && r.trim() !== '') avisar(r);
}
