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

/** R-20261119-030234 (RN-VEN-42): a área "Alertas" só aparece na aba Resumo; Venda, Itens e Entrega não a desenham. Os alertas seguem os mesmos (e valem para a saída). */
export function alertasNaAba<A>(aba: AbaDoPedido, alertas: readonly A[]): readonly A[] {
  return aba === 'resumo' ? alertas : [];
}

/** "Transportadora do frete FOB" vira "Falta transportadora do frete FOB" (o "· aba X" a tela escreve). */
export function textoDaFalta(texto: string): string {
  const t = texto.trim();
  // acrônimo (CNPJ, CPF...) mantém a maiúscula: "Falta CNPJ da transportadora"
  const sigla = /^[A-ZÀ-Ý]{2,}(?=\s|$)/.test(t);
  return `Falta ${sigla ? t.charAt(0) : t.charAt(0).toLocaleLowerCase('pt-BR')}${t.slice(1)}`;
}

/**
 * RD-0170 (T-0166): falta de preenchimento não é alerta até o vendedor tentar. Só as pendências das abas já tentadas
 * (Avançar marcou a aba que ele deixou; salvar, enviar ou transformar marcam todas) entram em Alertas; as demais ficam no próprio campo.
 */
export function pendenciasDasAbasTentadas(pendencias: readonly PendenciaDoPedido[], tentadas: ReadonlySet<AbaDoPedido>): PendenciaDoPedido[] {
  return pendencias.filter((p) => tentadas.has(p.aba));
}

/** A 1ª aba (na ordem Venda, Itens, Entrega, Resumo) com falta de preenchimento, para onde o toque em Salvar leva. */
export function primeiraAbaComFalta(pendencias: readonly PendenciaDoPedido[]): AbaDoPedido | null {
  return (['venda', 'itens', 'entrega', 'resumo'] as const).find((a) => pendencias.some((p) => p.aba === a)) ?? null;
}

export function entradaDasPendencias(pendencias: readonly PendenciaDoPedido[]): { faltantes: Array<{ texto: string; aba: string }>; recusas: string[] } {
  const faltantes: Array<{ texto: string; aba: string }> = [];
  const recusas: string[] = [];
  for (const p of pendencias) {
    if (ACIMA_DA_ALCADA.test(p.texto)) recusas.push('Desconto do pedido acima do máximo');
    else if (p.id === 'frete' && p.texto === 'CNPJ da transportadora') faltantes.push({ texto: 'CNPJ da transportadora inválido', aba: NOMES_DA_ABA[p.aba] });
    else faltantes.push({ texto: textoDaFalta(p.texto), aba: NOMES_DA_ABA[p.aba] });
  }
  return { faltantes, recusas };
}

/** RN-VEN-20: itens cujo estoque (na unidade base) não cobre o pedido; um por produto, na ordem dos itens. */
export function itensSemEstoque(linhas: readonly LinhaDoPedido[], produto: (id: string) => { erp_code: string; stock_total: number; unit?: string } | undefined): ItemDoAlerta[] {
  const vistos = new Set<string>();
  const out: ItemDoAlerta[] = [];
  for (const l of linhas) {
    const p = produto(l.product_id);
    if (!p || vistos.has(l.product_id) || p.stock_total >= l.quantidade_base) continue;
    vistos.add(l.product_id);
    out.push({ item: l.product_id, codigo: p.erp_code, ...(p.unit ? { estoque: { quantidade: p.stock_total, unidade: p.unit } } : {}) });
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
  /** RN-VEN-10 (T-0165): desconto efetivo do pedido acima da alçada do autor */
  acima_da_alcada?: boolean;
  /** RN-VEN-11a (T-0168): limite do pedido em ‰ quando o efetivo passa dele */
  acima_do_limite?: number | null;
  /** RD-0174: as linhas "AGU-1500 fora da cópia: sem preço" (`linhasDaCopia`) */
  itens_fora_da_copia?: readonly string[];
  /** RD-0173: o cliente não aceita nenhuma forma ativa */
  sem_forma_para_o_cliente?: boolean;
  /** RD-0175 */
  sem_sinal_para_salvar?: boolean;
  /** RD-0189: a falta da aba aberta fica só no campo */
  aba_atual?: AbaDoPedido;
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
    ...(e.acima_da_alcada ? { acima_da_alcada: true } : {}),
    ...(e.acima_do_limite != null ? { acima_do_limite: e.acima_do_limite } : {}),
    ...(e.itens_fora_da_copia && e.itens_fora_da_copia.length > 0 ? { itens_fora_da_copia: e.itens_fora_da_copia } : {}),
    ...(e.sem_forma_para_o_cliente ? { sem_forma_para_o_cliente: true } : {}),
    ...(e.sem_sinal_para_salvar ? { sem_sinal_para_salvar: true } : {}),
    ...(e.aba_atual ? { aba_atual: NOMES_DA_ABA[e.aba_atual] } : {}),
  });
}
