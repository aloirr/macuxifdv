/**
 * Tabela simples de Pedidos do BKO (R-20261116-143000, R-20261118-214740; simulação aprovada em 18/11, prancha 04):
 * colunas, ações do pendente e textos de célula como funções puras. O visual está em `components/orders/tabela-pedidos.tsx`.
 */
import type { MotivoAprovacao, Order } from '../../contracts';

/** 12 -> "12%"; 8,8 -> "8,8%" (a prancha mostra "Desconto 12%"). */
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export const SEM_VALOR = '—';

export function textoOuTraco(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : SEM_VALOR;
}

export interface ColunaPedido {
  id: string;
  titulo: string;
  /** fixa na borda quando a tabela rola na horizontal (prancha 04, opção A) */
  fixa?: 'esquerda' | 'direita';
  numero?: boolean;
  /** largura em px (soma 1610, como na prancha) */
  largura: number;
}

export const COLUNAS_DA_TABELA: readonly ColunaPedido[] = [
  { id: 'codigo', titulo: 'Código do cliente', fixa: 'esquerda', largura: 76 },
  { id: 'cliente', titulo: 'Cliente', fixa: 'esquerda', largura: 160 },
  { id: 'uf', titulo: 'UF', largura: 44 },
  { id: 'cidade', titulo: 'Cidade', largura: 92 },
  { id: 'numero', titulo: 'Nº', largura: 72 },
  { id: 'vendedor', titulo: 'Vendedor', largura: 100 },
  { id: 'supervisor', titulo: 'Supervisor', largura: 104 },
  { id: 'recebido', titulo: 'Recebido', largura: 100 },
  { id: 'valor', titulo: 'Valor', numero: true, largura: 104 },
  { id: 'motivo', titulo: 'Motivo', largura: 116 },
  { id: 'observacao', titulo: 'Observação do pedido', largura: 170 },
  { id: 'acoes', titulo: 'Ações', fixa: 'direita', largura: 300 },
  { id: 'situacao', titulo: 'Situação', fixa: 'direita', largura: 172 },
];

const ROTULO_MOTIVO: Record<MotivoAprovacao, string> = { desconto: 'Desconto', credito: 'Crédito', inadimplencia: 'Inadimplente', estoque: 'Estoque', preco_minimo: 'Preço mínimo' };

/** Motivo curto da coluna: "Crédito", "Desconto 12%"; vazio = traço. Sem o motivo do servidor, nada é inventado. */
export function motivoDoPedido(o: Pick<Order, 'approval_reasons' | 'effective_discount_pct'>): string {
  const partes = (o.approval_reasons ?? []).map((m) => (m === 'desconto' && o.effective_discount_pct && o.effective_discount_pct > 0 ? `Desconto ${pct(o.effective_discount_pct)}` : ROTULO_MOTIVO[m]));
  return partes.length > 0 ? partes.join(', ') : SEM_VALOR;
}

/**
 * P6 A: "Rejeitar" encerra o pedido como `cancelled` por decisão do aprovador. A decisão ainda NÃO existe no servidor
 * (aguarda o desenho do engenheiro-software, T-0184/P-6). Único ponto a religar: trocar `disponivel` para `true` e `rota`
 * pela rota nova. Enquanto isso a opção aparece desligada; nenhuma rota é inventada.
 */
export const DECISAO_REJEITAR_ENCERRA: { disponivel: boolean; rota: string | null } = { disponivel: false, rota: null };

export interface AcaoDoPendente {
  id: 'aprovar' | 'rejeitar' | 'devolver';
  rotulo: string;
  /** rota existente do servidor (`/pedidos/:id/<rota>`); `null` = decisão ainda sem rota */
  rota: string | null;
  /** RN-GES-08: devolver (rejeitar) exige motivo */
  exigeMotivo: boolean;
}

export const ACOES_DO_PENDENTE: readonly AcaoDoPendente[] = [
  { id: 'aprovar', rotulo: 'Aprovar', rota: 'aprovar', exigeMotivo: false },
  { id: 'rejeitar', rotulo: 'Rejeitar', rota: DECISAO_REJEITAR_ENCERRA.rota, exigeMotivo: true },
  // "Devolver ao vendedor" = status `rejected` pela rota que já existe (o pedido volta para o vendedor corrigir)
  { id: 'devolver', rotulo: 'Devolver ao vendedor', rota: 'rejeitar', exigeMotivo: true },
];

/** Ações da linha: só no pedido aguardando aprovação e só para quem decide o nível (`pode_decidir`, API). Demais = vazio. */
export function acoesDoPedido(o: Pick<Order, 'status' | 'pode_decidir'>): Array<AcaoDoPendente & { desligada: boolean }> {
  if (o.status !== 'pending_approval' || o.pode_decidir === false) return [];
  return ACOES_DO_PENDENTE.map((a) => ({ ...a, desligada: a.id === 'rejeitar' && !DECISAO_REJEITAR_ENCERRA.disponivel }));
}
