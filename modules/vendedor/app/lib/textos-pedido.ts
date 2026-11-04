/**
 * Textos da referência enxuta do novo pedido (T-0071, desenho §6.1). Cada texto sai de uma função com teste: a tela não escreve
 * frase própria. Rótulo curto, número em destaque, nada de explicação na tela.
 */
import { formatBRL, formatPct } from '@macuxi/comum';

import { opcoesDoSalvar, type SituacaoCliente, type SituacaoOrcamento } from '../../domain/orcamento';
import type { NivelDePreco } from '../../domain/preco-pedido';
import type { CalculoPedido } from './novo-pedido';

export type AbaNovoPedido = 'itens' | 'detalhes' | 'resumo';

/** Abas do novo pedido: Itens (com a contagem), Detalhes e Resumo. */
export function abasDoPedido(itens: number, itensPendente?: boolean): Array<{ id: AbaNovoPedido; rotulo: string; contador?: number | null; pendente?: boolean }> {
  return [
    { id: 'itens', rotulo: 'Itens', contador: itens > 0 ? itens : null, ...(itensPendente === undefined ? {} : { pendente: itensPendente }) },
    { id: 'detalhes', rotulo: 'Detalhes' },
    { id: 'resumo', rotulo: 'Resumo' },
  ];
}

/** RN-VEN-14: "28 dias" → "28 d"; "28/56 dias" → "28/56"; "À vista" e o que não segue o padrão ficam como estão. */
export function rotuloCurtoDaCondicao(descricao: string): string {
  const d = descricao.trim();
  const um = /^(\d+)\s*dias?$/i.exec(d);
  if (um) return `${um[1]} d`;
  const varios = /^(\d+(?:\/\d+)+)(?:\s*dias?)?$/i.exec(d);
  if (varios) return varios[1]!;
  return d;
}

export interface FaixaDaAlcada {
  texto: string;
  tom: 'ok' | 'aviso' | 'erro';
  /** o ícone do tom (a `Faixa` do ui desenha o ✓); null = sem ícone */
  icone: 'check' | 'alert' | null;
}

/** RN-VEN-10 / RN-VEN-03: a faixa da aba Resumo. Zero = sem faixa (null). */
export function textoDaFaixa(c: Pick<CalculoPedido, 'desconto_efetivo_pct' | 'nivel' | 'bloqueado'> & Partial<Pick<CalculoPedido, 'desconto_efetivo_exibicao_pct'>>, _limiteVendedor: number): FaixaDaAlcada | null {
  // RN-VEN-03: o que a tela mostra é o % de 1 casa calculado dos inteiros (4,647 → 4,6), não o de 2 casas arredondado de novo
  const pct = c.desconto_efetivo_pct === 0 ? 0 : (c.desconto_efetivo_exibicao_pct ?? c.desconto_efetivo_pct);
  if (pct === 0) return null;
  if (pct < 0) return { texto: `Acréscimo ${formatPct(-pct)}`, tom: 'ok', icone: null };
  if (c.bloqueado) return { texto: `${formatPct(pct)} · acima da alçada`, tom: 'erro', icone: 'alert' };
  if (c.nivel) return { texto: `${formatPct(pct)} · vai para o ${c.nivel}`, tom: 'aviso', icone: 'alert' };
  return { texto: `${formatPct(pct)} · dentro da alçada`, tom: 'ok', icone: 'check' };
}

export function tituloDaFolhaSalvar(): string {
  return 'Salvar pedido';
}

/** Selo do orçamento (tela 5 e lista): "Orçamento · até 10/11", "Vencido", "Cancelado", "Virou pedido 000015". */
export function seloDoOrcamento(e: { situacao: SituacaoOrcamento; validade_data: string; pedido_numero?: string | null }): { texto: string; tom: 'roxo' | 'neutro' | 'sucesso' } {
  const [, m, d] = e.validade_data.split('-');
  switch (e.situacao) {
    case 'aberto':
      return { texto: `Orçamento · até ${d}/${m}`, tom: 'roxo' };
    case 'expirado':
      return { texto: 'Vencido', tom: 'neutro' };
    case 'cancelado':
      return { texto: 'Cancelado', tom: 'neutro' };
    case 'convertido':
      return { texto: e.pedido_numero ? `Virou pedido ${e.pedido_numero}` : 'Virou pedido', tom: 'sucesso' };
  }
}

/** RN-VEN-13 / RN-CORE-17: situação do cliente (linha do sync) para a folha do Salvar. Não achou no aparelho = só orçamento. */
export function situacaoDoClienteSync(c: { ativo?: boolean; cadastro_incompleto?: boolean; cadastro_campos_faltantes?: readonly string[] } | null | undefined): SituacaoCliente {
  if (!c) return { ativo: false, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
  return { ativo: c.ativo !== false, bloqueado: false, cadastro_incompleto: c.cadastro_incompleto === true, campos_faltantes: c.cadastro_campos_faltantes ?? [] };
}

/** Item compacto do Resumo: "Água mineral 500 ml · 3 FD". */
export function itemCompacto(nome: string, quantidade: number, medida: string): string {
  return `${nome} · ${quantidade} ${medida}`;
}

/** Linha de entrega do Resumo: "CIF · 28 dias · Av. Ajuricaba, 1200" (o que falta fica de fora). */
export function linhaDeEntrega(e: { modalidade: 'CIF' | 'FOB'; prazo: string; endereco: string | null }): string {
  return [e.modalidade, e.prazo.trim(), e.endereco?.trim()].filter((x) => x && x.length > 0).join(' · ');
}

/** Totais do Resumo em até 3 linhas (Tabela, Descontos ou Acréscimos) mais o Total à parte. */
export function linhasDeTotais(c: Pick<CalculoPedido, 'total_tabela_cents' | 'desconto_cents' | 'acrescimo_cents' | 'total_cents'>): { linhas: Array<{ id: string; rotulo: string; valor: string }>; total: { rotulo: string; valor: string } } {
  const linhas = [{ id: 'tabela', rotulo: 'Tabela', valor: formatBRL(c.total_tabela_cents) }];
  if (c.desconto_cents > 0) linhas.push({ id: 'descontos', rotulo: 'Descontos', valor: `− ${formatBRL(c.desconto_cents)}` });
  if (c.acrescimo_cents > 0) linhas.push({ id: 'acrescimos', rotulo: 'Acréscimos', valor: `+ ${formatBRL(c.acrescimo_cents)}` });
  return { linhas, total: { rotulo: 'Total', valor: formatBRL(c.total_cents) } };
}

// ---------- item da aba Itens (T-0071, referência enxuta) ----------
/** "R$ 17,90 → 17,01" (com ajuste) ou "R$ 17,90" (sem). A segunda moeda vem sem o símbolo, como na referência. */
export function textoPrecoDaLinha(l: { preco_tabela_cents: number; preco_unitario_cents: number }): string {
  if (l.preco_unitario_cents === l.preco_tabela_cents) return formatBRL(l.preco_tabela_cents);
  return `${formatBRL(l.preco_tabela_cents)} → ${formatBRL(l.preco_unitario_cents).replace(/^R\$\s?/, '')}`;
}

/** O que o ajuste vale na outra moeda: "−R$ 0,89" (digitou %) ou "= 5,3%" (digitou R$); acréscimo com "+". Sem ajuste, vazio. */
export function textoEquivalente(l: { ajuste_em: 'pct' | 'valor'; equivalente: { sentido: 'desconto' | 'acrescimo'; cents: number; pct_exibicao: number } | null }): string {
  const e = l.equivalente;
  if (!e) return '';
  const sinal = e.sentido === 'desconto' ? '−' : '+';
  if (l.ajuste_em === 'valor') return `= ${formatPct(e.pct_exibicao)}`;
  return `${sinal}${formatBRL(e.cents)}`;
}

/** Trilha do catálogo do item: "Mercearia › Bebidas" (linha e marca do cadastro). Vazio quando o produto não traz nenhuma. */
export function trilhaDoProduto(p: { line?: string | null; brand?: string | null }): string {
  return [p.line, p.brand].map((x) => x?.trim()).filter((x): x is string => Boolean(x)).join(' › ');
}

/** Rótulo do ajuste do pedido, ex.: "Desconto do pedido" / "Acréscimo do pedido". */
export function rotuloDoAjusteDoPedido(sentido: 'desconto' | 'acrescimo'): string {
  return sentido === 'acrescimo' ? 'Acréscimo do pedido' : 'Desconto do pedido';
}

// ---------- sugestões da aba Detalhes ----------
export const TITULO_COMBINA = 'Combina com o pedido';
export const TITULO_LEVE_MAIS = 'Leve mais';

/** Nome da sugestão: o produto; na troca de embalagem, "Café 500 g em CX c/ 12". */
export function nomeDaSugestao(nome: string, s: { origem: string; para_unidade?: string; para_fator?: number }): string {
  if (s.origem === 'embalagem_maior' && s.para_unidade) return `${nome} em ${s.para_fator && s.para_fator > 1 ? `${s.para_unidade} c/ ${s.para_fator}` : s.para_unidade}`;
  return nome;
}

/** Selo da troca de embalagem ("−5%" quando a economia é de 1% ou mais); sem economia mostra o preço. */
export function seloDaSugestao(s: { origem: string; economia_pct?: number; preco_cents: number }): { tipo: 'selo' | 'preco'; texto: string } {
  if (s.origem === 'embalagem_maior' && (s.economia_pct ?? 0) >= 1) return { tipo: 'selo', texto: `−${s.economia_pct}%` };
  return { tipo: 'preco', texto: formatBRL(s.preco_cents) };
}

// ---------- revisão de UX da fatia 6 (T-0071) ----------
const ROTULO_IR_PARA_PEDIDOS = 'Ir para Pedidos';

/** Confirmação depois de enviar: orçamento é "salvo" (com a validade), pedido é "recebido" (com o status e a nota da alçada). */
export function confirmacaoDoEnvio(e: { tipo: 'pedido' | 'orcamento'; numero: string; status: string; validade_data?: string | null; pending_reason?: string | null; rejection_reason?: string | null }): { titulo: string; nota: string; mostrarStatus: boolean; rodape: string } {
  if (e.tipo === 'orcamento') {
    const [, m, d] = (e.validade_data ?? '').split('-');
    return { titulo: `Orçamento ${e.numero} salvo`, nota: m && d ? `Válido até ${d}/${m}.` : '', mostrarStatus: false, rodape: ROTULO_IR_PARA_PEDIDOS };
  }
  const nota = e.status === 'pending_approval' ? (e.pending_reason ?? '') : e.status === 'rejected' ? (e.rejection_reason ?? '') : e.status === 'approved' ? 'Dentro da alçada: aprovado na hora.' : 'Recebido.';
  return { titulo: `Pedido ${e.numero} recebido`, nota, mostrarStatus: true, rodape: ROTULO_IR_PARA_PEDIDOS };
}

/** Sem sinal: o documento ficou na fila do aparelho. */
export function avisoSalvoNoAparelho(tipo: 'pedido' | 'orcamento'): { titulo: string; nota: string } {
  return { titulo: tipo === 'orcamento' ? 'Orçamento salvo no aparelho.' : 'Pedido salvo no aparelho.', nota: 'Envia quando o sinal voltar.' };
}

export const ROTULO_IR_PARA_PEDIDOS_RODAPE = ROTULO_IR_PARA_PEDIDOS;

/**
 * RN-VEN-18 / desenho §1.5: a folha do Transformar abre SEMPRE (toque 1), com a alçada e o "Enviar pedido" (toque 2). Sem mudança
 * o título é "Transformar em pedido"; com mudança ou bloqueio, "Mudou desde o orçamento" (com o total novo).
 * `null` = sem tabela no aparelho para conferir (a plataforma confere ao receber).
 */
export function folhaDoTransformar(c: { mudancas: readonly string[]; bloqueio: string | null; nivel: NivelDePreco | null; total_cents: number | null } | null): { titulo: string; subtitulo: string; podeEnviar: boolean; mostrarTotal: boolean } {
  if (!c) return { titulo: 'Transformar em pedido', subtitulo: 'Confere preço e alçada ao enviar.', podeEnviar: true, mostrarTotal: false };
  const mudou = c.mudancas.length > 0 || c.bloqueio !== null;
  const subtitulo = opcoesDoSalvar({ cliente: { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] }, calculo: { nivel: c.nivel }, frete_erro: null, validade_data: '2000-01-01' }).enviar.subtitulo;
  return { titulo: mudou ? 'Mudou desde o orçamento' : 'Transformar em pedido', subtitulo, podeEnviar: c.bloqueio === null, mostrarTotal: mudou && c.total_cents !== null };
}

/** Resumo depois do envio (só leitura): o ajuste do pedido vira uma linha de valor. Zero = sem linha. */
export function linhaDoAjusteSomenteLeitura(a: { sentido: 'desconto' | 'acrescimo'; cents: number; pct_exibicao: number } | null): { rotulo: string; valor: string } | null {
  if (!a || a.cents <= 0) return null;
  return { rotulo: `${rotuloDoAjusteDoPedido(a.sentido)} (${formatPct(a.pct_exibicao)})`, valor: `${a.sentido === 'acrescimo' ? '+' : '−'} ${formatBRL(a.cents)}` };
}

/** Folha de cancelar: o orçamento é "cancelado", o pedido é "excluído" (RF-VEN-03/04). */
export function textoCancelarDocumento(e: { ehOrcamento: boolean; naFila: boolean; titulo: string }): { rotuloAcessivel: string; titulo: string; descricao: string; confirmar: string; ocupado: string } {
  if (e.ehOrcamento) {
    return { rotuloAcessivel: 'Cancelar orçamento', titulo: 'Cancelar este orçamento?', descricao: e.naFila ? 'O orçamento sai da fila do aparelho e não será enviado.' : 'O orçamento fica como Cancelado no histórico; não é apagado.', confirmar: 'Cancelar orçamento', ocupado: 'Cancelando…' };
  }
  return {
    rotuloAcessivel: 'Excluir pedido',
    titulo: `Excluir ${e.titulo.toLowerCase()}?`,
    descricao: e.naFila ? 'O pedido sai da fila do aparelho e não será enviado.' : 'O pedido fica como Excluído no histórico; não é apagado.',
    confirmar: 'Excluir pedido',
    ocupado: 'Excluindo…',
  };
}

export function textoNaoFoiAceito(motivo: string): string {
  return `Não foi aceito: ${motivo}`;
}

export const TEXTO_PEDIDO_FORA_DO_APARELHO = { titulo: 'Este pedido não está no aparelho', texto: 'Conecte-se e puxe a tela para baixo para sincronizar.' } as const;
export const TEXTO_SEM_ITEM_NO_RESUMO = 'Adicione um item na aba Itens.';

export function textoBuscaSemResultado(busca: string): { titulo: string; texto: string } {
  return { titulo: `Nenhum produto com “${busca.trim()}”`, texto: 'Confira o código ou a descrição.' };
}

/** Aviso do rodapé depois de tocar numa sugestão (com Desfazer). */
export function avisoSugestaoAdicionada(nome: string, troca: boolean): string {
  return troca ? `Trocado por ${nome}` : `${nome} adicionado`;
}
