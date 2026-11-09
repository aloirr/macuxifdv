/**
 * RN-VEN-38 (T-0128): sair do Novo pedido. Função pura, sem React: a tela só liga as peças (folha "Sair do pedido?" do
 * `@macuxi/ui`). Nenhum pedido some sem escolha do vendedor (RN-VEN-30/31): o rascunho só é apagado por "Descartar" confirmado.
 */
import { avisoSoOrcamento, textoPrecoDe, type SituacaoCliente } from './orcamento';
import { botoesDoResumo, ROTULOS_DO_SALVAR } from './botoes-resumo';

export { avisoSoOrcamento };

/** O que a regra precisa do rascunho (o `Rascunho` do app satisfaz esta forma). */
export interface RascunhoAlteravel {
  lines: Readonly<Record<string, number>>;
  discount_pct: number;
  acrescimo_pct?: number;
  desconto_valor_cents?: number;
  acrescimo_valor_cents?: number;
  observacao?: string;
  frete?: { modalidade: 'CIF' | 'FOB'; transportadora_id?: string | null; transportadora_digitada?: unknown } | null;
  endereco_entrega_id?: string | null;
}

/**
 * RN-VEN-38: "alterado" = pelo menos 1 item ou 1 campo mudado desde que abriu. Forma e prazo preenchidos sozinhos pelo padrão do
 * cliente não contam (a pessoa não mexeu); frete FOB sem escolha tampouco.
 */
export function pedidoAlterado(r: RascunhoAlteravel): boolean {
  if (Object.values(r.lines).some((q) => q > 0)) return true;
  if ((r.observacao ?? '').trim() !== '') return true;
  if (r.discount_pct > 0 || (r.acrescimo_pct ?? 0) > 0 || (r.desconto_valor_cents ?? 0) > 0 || (r.acrescimo_valor_cents ?? 0) > 0) return true;
  if (r.endereco_entrega_id) return true;
  if (r.frete && (r.frete.transportadora_id || r.frete.transportadora_digitada)) return true;
  return false;
}

export const TITULO_SAIR_DO_PEDIDO = 'Sair do pedido?';
export const TEXTOS_DA_SAIDA = {
  salvar: { rotulo: ROTULOS_DO_SALVAR.enviar, subtitulo: 'Vai para a fila de envio' },
  apenasSalvar: { rotulo: ROTULOS_DO_SALVAR.apenasSalvar, subtitulo: 'Guarda sem enviar' },
  orcamento: { rotulo: ROTULOS_DO_SALVAR.orcamento },
  descartar: { rotulo: 'Descartar', subtitulo: 'Apaga este pedido' },
  continuar: 'Continuar editando',
  confirmacao: { titulo: 'Descartar este pedido?', mensagem: 'Os itens e os dados deste pedido serão apagados do aparelho.', voltar: 'Voltar', confirmar: 'Descartar' },
} as const;

/**
 * RN-VEN-38 (v1.0.1): a saída da EDIÇÃO de pedido ou orçamento salvo usa a mesma folha "Sair do pedido?", só com o que cabe:
 * salvar as alterações (com o destino), descartar as alterações (o documento fica como estava) e continuar editando.
 */
export const TEXTOS_DA_SAIDA_EDICAO = {
  salvarOrcamento: { rotulo: ROTULOS_DO_SALVAR.salvarOrcamento, subtitulo: 'Guarda as alterações' },
  descartar: { rotulo: 'Descartar alterações', subtitulo: 'Volta como estava' },
  confirmacao: { titulo: 'Descartar as alterações?', mensagem: 'O documento volta como estava antes desta edição.', voltar: 'Voltar', confirmar: 'Descartar' },
} as const;

export function opcoesDaSaidaEdicao(e: { tipo: 'pedido' | 'orcamento'; destino: string }): { salvar: { rotulo: string; subtitulo: string }; descartar: { rotulo: string; subtitulo: string }; confirmacao: typeof TEXTOS_DA_SAIDA_EDICAO.confirmacao } {
  const salvar = e.tipo === 'orcamento' ? TEXTOS_DA_SAIDA_EDICAO.salvarOrcamento : { rotulo: ROTULOS_DO_SALVAR.alteracoes, subtitulo: e.destino };
  return { salvar, descartar: TEXTOS_DA_SAIDA_EDICAO.descartar, confirmacao: TEXTOS_DA_SAIDA_EDICAO.confirmacao };
}

export interface OpcoesDaSaida {
  /** `false` = cliente da RN-VEN-13 (só orçamento) */
  salvar: boolean;
  /** T-0137: "Apenas salvar" (rascunho que aceita pendências) vale em toda saída de Novo pedido, inclusive na RN-VEN-13 */
  apenasSalvar: boolean;
  /** `false` = tenant sem pré-venda (sem orçamento) */
  orcamento: boolean;
  /** "Preço de dd/mm" */
  subtituloOrcamento: string;
  aviso: string | null;
}

/** RN-VEN-38 (T-0137): opções da folha. Cliente da RN-VEN-13 vê só Apenas salvar, Salvar como orçamento e Descartar; sem pré-venda, Salvar e enviar pedido, Apenas salvar e Descartar. */
export function opcoesDaSaida(e: { cliente: SituacaoCliente; pre_venda_ligada: boolean; preco_data: string }): OpcoesDaSaida {
  const b = botoesDoResumo({ cliente: e.cliente, pre_venda_ligada: e.pre_venda_ligada, editando: null, pendencias: 0, nivel: null, preco_data: e.preco_data });
  return { salvar: b.enviar.visivel, apenasSalvar: b.apenasSalvar.visivel, orcamento: b.orcamento.visivel, subtituloOrcamento: textoPrecoDe(e.preco_data), aviso: b.aviso };
}

export type DestinoDoSalvarDaSaida = 'salvar_agora' | 'mostrar_pendencias';

/** RN-VEN-38 / RN-CORE-36: salvar pela folha valida tudo; com pendência, fecha a folha e abre o Resumo no bloco "Falta para salvar". */
export function destinoDoSalvarDaSaida(pendencias: number): DestinoDoSalvarDaSaida {
  return pendencias > 0 ? 'mostrar_pendencias' : 'salvar_agora';
}

export interface RascunhoGuardado extends RascunhoAlteravel {
  customer_id: string;
  /** T-0137: guardado de propósito por "Apenas salvar" */
  salvo_em?: string | null;
  updated_at: string;
  edit_order_id?: string | null;
}

/**
 * RN-VEN-38: depois que o sistema fechou o app, oferece o rascunho alterado mais recente de um Novo pedido (edição e "Apenas salvar" não contam).
 * Os outros vêm nas aberturas seguintes, um de cada vez.
 */
export function rascunhoParaRetomar<T extends RascunhoGuardado>(rascunhos: Readonly<Record<string, T>>): { chave: string; rascunho: T } | null {
  let melhor: { chave: string; rascunho: T } | null = null;
  for (const [chave, rascunho] of Object.entries(rascunhos)) {
    if (chave.startsWith('edit:') || rascunho.edit_order_id) continue;
    // T-0137: o vendedor guardou de propósito (Apenas salvar); não é pedido esquecido
    if (rascunho.salvo_em) continue;
    if (!pedidoAlterado(rascunho)) continue;
    if (!melhor || rascunho.updated_at > melhor.rascunho.updated_at) melhor = { chave, rascunho };
  }
  return melhor;
}

/** "2 itens" / "1 item" */
export function textoDeItens(r: RascunhoAlteravel): string | null {
  const n = Object.values(r.lines).filter((q) => q > 0).length;
  return n === 0 ? null : n === 1 ? '1 item' : `${n} itens`;
}

function diaNoFuso(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "alterado às 10h34" (hoje) / "alterado ontem às 18h10" / "alterado em 05/11 às 09h02", no fuso do tenant. */
export function textoAlteradoEm(iso: string, agora: Date, tz: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '';
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(quando).replace(':', 'h');
  const dia = diaNoFuso(quando, tz);
  if (dia === diaNoFuso(agora, tz)) return `alterado às ${hora}`;
  if (dia === diaNoFuso(new Date(agora.getTime() - 24 * 3600 * 1000), tz)) return `alterado ontem às ${hora}`;
  const [, m, d] = dia.split('-');
  return `alterado em ${d}/${m} às ${hora}`;
}
