/**
 * RN-VEN-42 / RN-CORE-36 (T-0150, docs/design/pedido-v4.md §0.1): as pendências de preenchimento e os itens do Novo pedido viram a
 * entrada da área única Alertas. Partes puras: a tela só chama e desenha. A alçada nunca é alerta (RN-VEN-10).
 */
import { alertasDoPedido, type AlertaDoPedido, type ItemDoAlerta } from '../../domain/alertas-pedido';
import type { SituacaoCliente } from '../../domain/orcamento';
import type { AbaDoPedido, PendenciaDoPedido } from '../../domain/pendencias-preenchimento';
import type { LinhaDoPedido } from './novo-pedido';

const NOMES_DA_ABA: Record<AbaDoPedido, string> = { venda: 'Venda', itens: 'Itens', entrega: 'Entrega', resumo: 'Resumo' };
/** o erro do cálculo do pedido inteiro acima da alçada máxima: o texto da pendência cita a alçada, que nunca aparece em tela */
const ACIMA_DA_ALCADA = /^Desconto acima da alçada máxima/;

export function idDaAba(nome: string): AbaDoPedido {
  const achada = (Object.keys(NOMES_DA_ABA) as AbaDoPedido[]).find((k) => NOMES_DA_ABA[k] === nome);
  return achada ?? 'resumo';
}

/** "Transportadora do frete FOB" vira "Falta transportadora do frete FOB" (o "· aba X" a tela escreve). */
export function textoDaFalta(texto: string): string {
  const t = texto.trim();
  return `Falta ${t.charAt(0).toLocaleLowerCase('pt-BR')}${t.slice(1)}`;
}

export function entradaDasPendencias(pendencias: readonly PendenciaDoPedido[]): { faltantes: Array<{ texto: string; aba: string }>; recusas: string[] } {
  const faltantes: Array<{ texto: string; aba: string }> = [];
  const recusas: string[] = [];
  for (const p of pendencias) {
    if (ACIMA_DA_ALCADA.test(p.texto)) recusas.push('Desconto do pedido acima do máximo');
    else faltantes.push({ texto: textoDaFalta(p.texto), aba: NOMES_DA_ABA[p.aba] });
  }
  return { faltantes, recusas };
}

/** RN-VEN-20: itens cujo estoque (na unidade base) não cobre o pedido; um por produto, na ordem dos itens. */
export function itensSemEstoque(linhas: readonly LinhaDoPedido[], produto: (id: string) => { erp_code: string; stock_total: number } | undefined): ItemDoAlerta[] {
  const vistos = new Set<string>();
  const out: ItemDoAlerta[] = [];
  for (const l of linhas) {
    const p = produto(l.product_id);
    if (!p || vistos.has(l.product_id) || p.stock_total >= l.quantidade_base) continue;
    vistos.add(l.product_id);
    out.push({ item: l.product_id, codigo: p.erp_code });
  }
  return out;
}

export function alertasDoNovoPedido(e: {
  cliente: SituacaoCliente;
  pendencias: readonly PendenciaDoPedido[];
  /** códigos do ERP dos itens acima do desconto máximo (`CalculoPedido.acima_do_maximo`) */
  acima_do_maximo: readonly string[];
  /** erp_code para produto_id (o toque leva ao item) */
  produtoDoCodigo: (codigo: string) => string | undefined;
  sem_estoque: readonly ItemDoAlerta[];
  vencidos: { titulos: number; valor_cents: number; dias: number } | null;
  disponivel_cents: number | null;
  total_cents: number;
}): AlertaDoPedido[] {
  const { faltantes, recusas } = entradaDasPendencias(e.pendencias);
  return alertasDoPedido({
    cliente: e.cliente,
    faltantes,
    recusas,
    itens_acima_do_maximo: e.acima_do_maximo.map((codigo) => ({ item: e.produtoDoCodigo(codigo) ?? codigo, codigo })),
    itens_sem_estoque: e.sem_estoque,
    vencidos: e.vencidos,
    disponivel_cents: e.disponivel_cents,
    total_cents: e.total_cents,
  });
}
