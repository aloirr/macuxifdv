/**
 * Decisão por motivo na Gestão (T-0184, P3 B): um cartão por aprovação pendente e as chamadas às rotas do Vendedor
 * (`aprovar`, `rejeitar` = devolver ao vendedor, `recusar` = rejeitar de vez; desenho §3 e §7.1). O Gestor nunca escreve
 * no pedido: só pede ao Vendedor, que revalida alçada, escopo e licença. Funções puras, sem React.
 */
import type { AprovacaoDoItem, DecisaoAprovacao, FilaAprovacao, ItemFilaAprovacao, MotivoAprovacao } from '../../contracts';

export type AcaoDeDecisao = DecisaoAprovacao['decisao'];

/** Mínimo do motivo na devolução e na rejeição (RN-GES-08), o mesmo `MOTIVO_REJEICAO_MIN` do Vendedor. */
export const MOTIVO_MIN = 3;

export interface CartaoDaFila {
  /** `<pedido_id>|<motivo>`: único na fila. */
  chave: string;
  item: ItemFilaAprovacao;
  aprovacao: AprovacaoDoItem;
}

/**
 * Um cartão por motivo pendente (P3 B). Cache gravado antes da v1.0.15 não traz `aprovacoes`: cada motivo vira um cartão
 * com o nível da raiz e o `pode_decidir` da raiz.
 */
export function cartoesDaFila(itens: readonly ItemFilaAprovacao[]): CartaoDaFila[] {
  return itens.flatMap((item) => {
    const aprovacoes: readonly AprovacaoDoItem[] = item.aprovacoes ?? item.motivos.map((motivo) => ({ motivo, nivel: item.nivel, estado: 'pendente' as const, pode_decidir: item.pode_decidir }));
    return aprovacoes.map((aprovacao) => ({ chave: `${item.pedido_id}|${aprovacao.motivo}`, item, aprovacao }));
  });
}

/** Quantos cartões, quantos vencidos e vencendo e quantos o usuário decide (a contagem que a tela mostra). */
export function resumoDosCartoes(cartoes: readonly CartaoDaFila[]): { total: number; para_mim: number; vencidos: number; vencendo: number } {
  return {
    total: cartoes.length,
    para_mim: cartoes.filter((c) => c.aprovacao.pode_decidir).length,
    vencidos: cartoes.filter((c) => c.item.situacao === 'vencido').length,
    vencendo: cartoes.filter((c) => c.item.situacao === 'vencendo').length,
  };
}

/** O motivo é obrigatório para devolver e rejeitar (RN-GES-08); aprovar segue em 1 toque. `null` = válido. */
export function erroDoMotivo(acao: AcaoDeDecisao, texto: string): string | null {
  if (acao === 'aprovar' || texto.trim().length >= MOTIVO_MIN) return null;
  return `Escreva o motivo com pelo menos ${MOTIVO_MIN} letras para ${acao === 'devolver' ? 'devolver' : 'rejeitar'}.`;
}

/** Rota e corpo do Vendedor para a decisão (desenho §3: `devolver` → `rejeitar`; `rejeitar` → `recusar`). */
export function requisicaoDaDecisao(pedidoId: string, acao: AcaoDeDecisao, motivo: MotivoAprovacao, texto: string): { caminho: string; corpo: { motivo: MotivoAprovacao; texto?: string } } {
  const base = `/vendedor/pedidos/${encodeURIComponent(pedidoId)}`;
  if (acao === 'aprovar') return { caminho: `${base}/aprovar`, corpo: { motivo } };
  return { caminho: `${base}/${acao === 'devolver' ? 'rejeitar' : 'recusar'}`, corpo: { motivo, texto: texto.trim() } };
}

/**
 * Fila do aparelho depois da decisão, sem esperar a sincronização: aprovar tira o motivo; devolver e rejeitar tiram o
 * pedido inteiro (a decisão encerra as outras aprovações pendentes, P8 A).
 */
export function filaAposDecisao(fila: FilaAprovacao, pedidoId: string, acao: AcaoDeDecisao, motivo: MotivoAprovacao): FilaAprovacao {
  const itens = fila.itens.flatMap((i): ItemFilaAprovacao[] => {
    if (i.pedido_id !== pedidoId) return [i];
    if (acao !== 'aprovar') return [];
    const restantes = cartoesDaFila([i])
      .filter((c) => c.aprovacao.motivo !== motivo)
      .map((c) => c.aprovacao);
    if (restantes.length === 0) return [];
    return [{ ...i, aprovacoes: restantes, motivos: restantes.map((a) => a.motivo), pode_decidir: restantes.some((a) => a.pode_decidir) }];
  });
  return {
    ...fila,
    itens,
    resumo: {
      ...fila.resumo,
      total: itens.length,
      para_mim: itens.filter((i) => i.pode_decidir).length,
      vencidos: itens.filter((i) => i.situacao === 'vencido').length,
      vencendo: itens.filter((i) => i.situacao === 'vencendo').length,
    },
  };
}
