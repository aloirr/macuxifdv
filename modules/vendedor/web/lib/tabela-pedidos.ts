/**
 * Tabela simples de Pedidos do BKO (R-20261116-143000, R-20261118-214740; simulação aprovada em 18/11, prancha 04):
 * colunas, ações do pendente e textos de célula como funções puras. O visual está em `components/orders/tabela-pedidos.tsx`.
 */
import { ROTULO_MOTIVO_APROVACAO, type DecisaoAprovador, type MotivoAprovacao, type Order } from '../../contracts';

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
  { id: 'situacao', titulo: 'Situação', fixa: 'direita', largura: 172 },
  { id: 'acoes', titulo: 'Ações', fixa: 'direita', largura: 300 },
];

export interface AcaoDoPendente {
  id: 'aprovar' | 'rejeitar' | 'devolver';
  rotulo: string;
  /** decisão do contrato; a rota e o corpo vêm de `ROTA_DA_DECISAO` e `corpoDaDecisao` */
  decisao: DecisaoAprovador;
  /** RN-GES-08: devolver e rejeitar exigem motivo */
}

/**
 * Motivo curto da coluna: "Crédito", "Desconto 12%"; vazio = traço. Com uma aprovação por motivo (T-0184, P3 B) a coluna lista os motivos
 * do ciclo ("Crédito, Inadimplente"); a Situação já diz o estado (prancha 04), então a coluna não repete "(aprovada)". Sem o motivo do
 * servidor, nada é inventado.
 */
export function motivoDoPedido(o: Pick<Order, 'approval_reasons' | 'effective_discount_pct' | 'aprovacoes'>): string {
  const nome = (m: MotivoAprovacao) => (m === 'desconto' && o.effective_discount_pct && o.effective_discount_pct > 0 ? `Desconto ${pct(o.effective_discount_pct)}` : ROTULO_MOTIVO_APROVACAO[m]);
  const motivos = o.aprovacoes && o.aprovacoes.length > 0 ? o.aprovacoes.map((a) => a.motivo) : (o.approval_reasons ?? []);
  return motivos.length > 0 ? motivos.map(nome).join(', ') : SEM_VALOR;
}

/** P6 A (T-0184): "Rejeitar" encerra o pedido como `cancelled` (decisão `recusar`); "Devolver ao vendedor" leva a `rejected` (decisão `devolver`). */
export const ACOES_DO_PENDENTE: readonly AcaoDoPendente[] = [
  { id: 'aprovar', rotulo: 'Aprovar', decisao: 'aprovar' },
  { id: 'rejeitar', rotulo: 'Rejeitar', decisao: 'recusar' },
  { id: 'devolver', rotulo: 'Devolver ao vendedor', decisao: 'devolver' },
];

/** Ações da linha: só no pedido aguardando aprovação e só para quem decide o nível (`pode_decidir`, API). Demais = vazio. */
export function acoesDoPedido(o: Pick<Order, 'status' | 'pode_decidir'>): readonly AcaoDoPendente[] {
  return o.status !== 'pending_approval' || o.pode_decidir === false ? [] : ACOES_DO_PENDENTE;
}
