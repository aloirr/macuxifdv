/**
 * Decisão por motivo na Gestão (T-0184, P3 B): um cartão por aprovação pendente e as chamadas às rotas do Vendedor
 * (rota e corpo vêm do `contracts` do Vendedor: `ROTA_DA_DECISAO`, `corpoDaDecisao`). O Gestor nunca escreve
 * no pedido: só pede ao Vendedor, que revalida alçada, escopo e licença. Funções puras, sem React.
 */
import { MOTIVO_REJEICAO_MIN, type AprovacaoDoItem, type DECISOES_APROVADOR, type FilaAprovacao, type ItemFilaAprovacao, type MotivoAprovacao } from '../../contracts';
import { resumirFila } from '../../domain/aprovacoes';

/** As decisões do Vendedor (`DECISOES_APROVADOR`): `devolver` volta ao vendedor; `recusar` é o botão "Rejeitar" (cancela, P6 A). */
export type AcaoDeDecisao = (typeof DECISOES_APROVADOR)[number];

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

/** O motivo é obrigatório para devolver e rejeitar (RN-GES-08); aprovar segue em 1 toque. `null` = válido. */
export function erroDoMotivo(acao: AcaoDeDecisao, texto: string): string | null {
  if (acao === 'aprovar' || texto.trim().length >= MOTIVO_REJEICAO_MIN) return null;
  return `Escreva o motivo com pelo menos ${MOTIVO_REJEICAO_MIN} letras para ${acao === 'devolver' ? 'devolver' : 'rejeitar'}.`;
}

/** Título do cartão: nome do cliente; sem nome no cadastro, o código dele; sem nenhum dos dois, "Cliente". */
export function tituloDoCliente(item: Pick<ItemFilaAprovacao, 'cliente_nome' | 'cliente_codigo'>): string {
  return item.cliente_nome?.trim() || item.cliente_codigo?.trim() || 'Cliente';
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
  return { ...fila, itens, resumo: resumirFila(itens) };
}
