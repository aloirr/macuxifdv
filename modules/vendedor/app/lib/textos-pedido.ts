/**
 * Textos da referência enxuta do novo pedido (T-0071, desenho §6.1). Cada texto sai de uma função com teste: a tela não escreve
 * frase própria. Rótulo curto, número em destaque, nada de explicação na tela.
 */
import { formatBRL, formatPct } from '@macuxi/comum';

import { textoPrecoDe, type SituacaoCliente, type SituacaoOrcamento } from '../../domain/orcamento';
import { ROTULOS_DO_SALVAR } from '../../domain/botoes-resumo';
import type { NivelDePreco } from '../../domain/preco-pedido';

export type AbaNovoPedido = 'venda' | 'itens' | 'entrega' | 'resumo';

/** Aba que abre o Novo pedido (RF-VEN-11). */
export const ABA_INICIAL_DO_PEDIDO: AbaNovoPedido = 'venda';

/**
 * T-0137: o pedido guardado por "Apenas salvar" reabre no Resumo, onde está o bloco "Falta para salvar".
 * T-0141 (RN-VEN-39): o rascunho retomado pela lista Rascunhos abre na aba em que o vendedor parou (`aba`); o novo abre em Venda.
 */
export function abaInicialDoRascunho(r: { salvo_em?: string | null; aba?: AbaNovoPedido }): AbaNovoPedido {
  return r.salvo_em ? 'resumo' : (r.aba ?? ABA_INICIAL_DO_PEDIDO);
}

/** Aviso ao fechar a tela depois de "Apenas salvar" (sem Desfazer). */
export const AVISO_PEDIDO_SALVO = 'Pedido salvo';

/** Próxima aba do "Avançar": Venda → Itens → Entrega → Resumo. */
export function proximaAbaDoPedido(aba: AbaNovoPedido): AbaNovoPedido {
  return aba === 'venda' ? 'itens' : aba === 'itens' ? 'entrega' : 'resumo';
}

/** Aba anterior (voltar do Android): Resumo → Entrega → Itens → Venda; da Venda não há anterior. */
export function abaAnteriorDoPedido(aba: AbaNovoPedido): AbaNovoPedido | null {
  return aba === 'resumo' ? 'entrega' : aba === 'entrega' ? 'itens' : aba === 'itens' ? 'venda' : null;
}

/**
 * Abas do novo pedido (RF-VEN-11): Venda · Itens (n) · Entrega · Resumo. O contador de Itens aparece sempre ("Itens (0)").
 * A bolinha (RN-CORE-36) fica na aba da correção; o Resumo nunca a recebe (o bloco "Falta para salvar" está nele).
 */
export function abasDoPedido(itens: number, pendentes?: { venda?: boolean; itens?: boolean; entrega?: boolean }): Array<{ id: AbaNovoPedido; rotulo: string; contador?: number | null; pendente?: boolean }> {
  const marca = (v: boolean | undefined) => (v === undefined ? {} : { pendente: v });
  return [
    { id: 'venda', rotulo: 'Venda', ...marca(pendentes?.venda) },
    { id: 'itens', rotulo: 'Itens', contador: Math.max(0, Math.trunc(itens)), ...marca(pendentes?.itens) },
    { id: 'entrega', rotulo: 'Entrega', ...marca(pendentes?.entrega) },
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

/** Selo do orçamento (tela 5 e lista): "Orçamento · preço de 10/11", "Cancelado", "Virou pedido 000015". Não há "Vencido" nem "até" (RN-VEN-18, 09/11). */
export function seloDoOrcamento(e: { situacao: SituacaoOrcamento; preco_data: string; pedido_numero?: string | null }): { texto: string; tom: 'destaque' | 'neutro' | 'sucesso' } {
  const [, m, d] = e.preco_data.split('-');
  switch (e.situacao) {
    case 'aberto':
      return { texto: `Orçamento · preço de ${d}/${m}`, tom: 'destaque' };
    case 'cancelado':
      return { texto: 'Cancelado', tom: 'neutro' };
    case 'convertido':
      return { texto: e.pedido_numero ? `Virou pedido ${e.pedido_numero}` : 'Virou pedido', tom: 'sucesso' };
  }
}

/** RN-VEN-13 / RN-CORE-17: situação do cliente (linha do sync) para a folha do Salvar. Não achou no aparelho = só orçamento. */
export function situacaoDoClienteSync(c: { ativo?: boolean; cadastro_incompleto?: boolean; cadastro_campos_faltantes?: readonly string[] } | null | undefined, financeiro?: { bloqueado?: boolean } | null): SituacaoCliente {
  if (!c) return { ativo: false, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
  return { ativo: c.ativo !== false, bloqueado: financeiro?.bloqueado === true, cadastro_incompleto: c.cadastro_incompleto === true, campos_faltantes: c.cadastro_campos_faltantes ?? [] };
}

/** Item compacto do Resumo: "Água mineral 500 ml · 3 FD". */
export function itemCompacto(nome: string, quantidade: number, medida: string): string {
  return `${nome} · ${quantidade} ${medida}`;
}

/** Linha de entrega do Resumo: "CIF · 28 dias · Av. Ajuricaba, 1200" (o que falta fica de fora). */
export function linhaDeEntrega(e: { modalidade: 'CIF' | 'FOB'; prazo: string; endereco: string | null }): string {
  return [e.modalidade, e.prazo.trim(), e.endereco?.trim()].filter((x) => x && x.length > 0).join(' · ');
}

// ---------- item da aba Itens (T-0071, referência enxuta) ----------
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

// ---------- sugestões do fim da aba Itens ----------
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

/** Confirmação depois de enviar: orçamento é "salvo" (com o dia do preço), pedido é "recebido" (com o status e o motivo, quando há). */
export function confirmacaoDoEnvio(e: { tipo: 'pedido' | 'orcamento'; numero: string; status: string; preco_data?: string | null; pending_reason?: string | null; rejection_reason?: string | null }): { titulo: string; nota: string; mostrarStatus: boolean; rodape: string } {
  if (e.tipo === 'orcamento') {
    return { titulo: `Orçamento ${e.numero} salvo`, nota: e.preco_data ? `${textoPrecoDe(e.preco_data)}.` : '', mostrarStatus: false, rodape: ROTULO_IR_PARA_PEDIDOS };
  }
  const nota = e.status === 'rejected' ? (e.rejection_reason ?? '') : '';
  return { titulo: `Pedido ${e.numero} recebido`, nota, mostrarStatus: true, rodape: ROTULO_IR_PARA_PEDIDOS };
}

/** Sem sinal: o documento ficou na fila do aparelho (RD-0178: sem a nota "Envia quando o sinal voltar"). */
export function avisoSalvoNoAparelho(tipo: 'pedido' | 'orcamento'): { titulo: string } {
  return { titulo: tipo === 'orcamento' ? 'Orçamento salvo no aparelho.' : 'Pedido salvo no aparelho.' };
}

export const ROTULO_IR_PARA_PEDIDOS_RODAPE = ROTULO_IR_PARA_PEDIDOS;

/**
 * RN-VEN-18 / desenho §1.5: a folha do Transformar abre SEMPRE (toque 1), com o "Enviar pedido" (toque 2); a alçada vira a pergunta ao enviar (RN-VEN-10, T-0151). Sem mudança
 * o título é "Transformar em pedido"; com mudança ou bloqueio, "Mudou desde o orçamento" (com o total novo).
 * `null` = sem tabela no aparelho para conferir (a plataforma confere ao receber).
 */
export function folhaDoTransformar(c: { mudancas: readonly string[]; bloqueio: string | null; nivel: NivelDePreco | null; total_cents: number | null } | null): { titulo: string; podeEnviar: boolean; mostrarTotal: boolean } {
  if (!c) return { titulo: ROTULOS_DO_SALVAR.transformar, podeEnviar: true, mostrarTotal: false };
  const mudou = c.mudancas.length > 0 || c.bloqueio !== null;
  return { titulo: mudou ? 'Mudou desde o orçamento' : ROTULOS_DO_SALVAR.transformar, podeEnviar: c.bloqueio === null, mostrarTotal: mudou && c.total_cents !== null };
}

/**
 * Confirmação de cancelar (spec pedido-v2.md §4.4, T-0138): "Cancelar este orçamento?" / "Cancelar este pedido?". Com o aceite do
 * conector (RN-VEN-31, T-0114) e o pedido já enviado, o texto diz que o cancelamento é pedido ao ERP (`solicitaAoErp`).
 */
export function textoCancelarDocumento(e: { ehOrcamento: boolean; naFila: boolean; titulo: string; solicitaAoErp?: boolean }): { rotuloAcessivel: string; titulo: string; descricao: string; confirmar: string; ocupado: string } {
  if (e.ehOrcamento) {
    return { rotuloAcessivel: 'Cancelar orçamento', titulo: 'Cancelar este orçamento?', descricao: e.naFila ? 'O orçamento sai da fila do aparelho e não será enviado.' : 'Não pode mais virar pedido.', confirmar: 'Cancelar orçamento', ocupado: 'Cancelando…' };
  }
  return {
    rotuloAcessivel: 'Cancelar pedido',
    titulo: 'Cancelar este pedido?',
    descricao: e.naFila ? 'O pedido sai da fila do aparelho e não será enviado.' : e.solicitaAoErp ? 'O cancelamento será pedido ao ERP.' : 'O pedido não será enviado ao ERP.',
    confirmar: 'Cancelar pedido',
    ocupado: 'Cancelando…',
  };
}

export const TEXTO_PEDIDO_FORA_DO_APARELHO = { titulo: 'Este pedido não está no aparelho', texto: 'Conecte-se e puxe a tela para baixo para sincronizar.' } as const;
export const ROTULO_TENTAR_DE_NOVO = 'Tentar de novo';

/** Pedido ausente no detalhe: carregando enquanto a leitura roda; terminada sem achar, vazio (offline: pede sinal; com sinal: pede nova tentativa). */
export function estadoDoDetalheAusente(e: { offline: boolean; carregando: boolean }): { tipo: 'carregando' } | { tipo: 'vazio'; titulo: string; texto: string; tentarDeNovo: boolean } {
  if (e.offline) return { tipo: 'vazio', ...TEXTO_PEDIDO_FORA_DO_APARELHO, tentarDeNovo: false };
  if (e.carregando) return { tipo: 'carregando' };
  return { tipo: 'vazio', titulo: 'Não achamos este pedido', texto: 'Toque em Tentar de novo ou volte para Pedidos.', tentarDeNovo: true };
}

/** Aviso de rodapé não leva ponto final (guia de UX); pontos no meio do texto ficam. */
export function textoDoAviso(texto: string): string {
  return texto.trim().replace(/\.+$/, '');
}

export function textoBuscaSemResultado(busca: string): { titulo: string; texto: string } {
  return { titulo: `Nenhum produto com “${busca.trim()}”`, texto: 'Confira o código ou a descrição.' };
}

/** T-0167 (pedido-v4 §5.3): nada encontrado; "Você quis dizer…?" só quando o índice tem um termo parecido. */
export function semResultadoDaBusca(busca: string, sugestao: string | null): { frase: string; sugestao: string | null; rotuloSugestao: string | null } {
  const sug = sugestao?.trim() || null;
  return { frase: `Nenhum produto com “${busca.trim()}”.`, sugestao: sug, rotuloSugestao: sug ? `Você quis dizer “${sug}”?` : null };
}

/** Aviso do rodapé depois de tocar numa sugestão (com Desfazer). */
export function avisoSugestaoAdicionada(nome: string, troca: boolean): string {
  return troca ? `Trocado por ${nome}` : `${nome} adicionado`;
}


/** Aviso do rodapé no detalhe, depois de salvar um orçamento (V8): com sinal o número; sem sinal, que ficou no aparelho. */
export function avisoDoOrcamentoSalvo(numero: string | null): string {
  return numero ? `Orçamento ${numero} salvo` : textoDoAviso(avisoSalvoNoAparelho('orcamento').titulo);
}
