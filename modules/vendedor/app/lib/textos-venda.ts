/**
 * Textos da aba Venda e da aba Entrega do Novo pedido (RF-VEN-11, T-0136; spec docs/design/pedido-v2.md §1.2 e §1.4).
 * Cada frase sai de uma função com teste: a tela não escreve texto próprio. Quais alertas valem é do domain (`alertasDaVenda`).
 */
import { formatBRL } from '@macuxi/comum';
import { alertaInadimplencia, CONSEQUENCIA_VENCIDO, TEXTO_CLIENTE_LIBERADO } from '@macuxi/ui/mobile/puro';

import { tomDoAlerta, type AlertaDaVenda, type TomDoAlerta } from '../../domain/alertas-venda';
import type { ModeloDoCredito } from './credito-cliente';

/** Linha única da caixa Alertas quando não há alerta (sem o rótulo "Alertas"). */
export const TEXTO_SEM_ALERTA = TEXTO_CLIENTE_LIBERADO;
export const ROTULO_ALERTAS = 'Alertas';
export const ROTULO_LIMITE = 'Limite';
export const ROTULO_PRAZO_MEDIO = 'Prazo médio do cliente';
export const TEXTO_SEM_DADOS_DE_CREDITO = 'Sem dados de crédito deste cliente';
export const ROTULO_ENDERECO_ENTREGA = 'Endereço de entrega';
export const TEXTO_ENDERECO_DO_CADASTRO = 'Endereço do cadastro';

export interface TextoDoAlerta {
  id: AlertaDaVenda['tipo'];
  tom: TomDoAlerta;
  texto: string;
  apoio: string | null;
}

/** RN-VEN-12/13: o texto de cada alerta da aba Venda. */
export function textoDoAlerta(a: AlertaDaVenda): TextoDoAlerta {
  const tom = tomDoAlerta(a);
  switch (a.tipo) {
    case 'bloqueado':
      return { id: a.tipo, tom, texto: 'Cliente bloqueado · só orçamento', apoio: null };
    case 'inativo':
      return { id: a.tipo, tom, texto: 'Cliente inativo · só orçamento', apoio: null };
    case 'cadastro_incompleto':
      return { id: a.tipo, tom, texto: 'Cadastro incompleto · só orçamento', apoio: a.campos.length > 0 ? `Falta: ${a.campos.join(', ')}` : null };
    case 'vencido':
      return { id: a.tipo, tom, ...alertaInadimplencia({ titulos: a.titulos, valorCents: a.valor_cents, dias: a.dias, consequencia: CONSEQUENCIA_VENCIDO }) };
    case 'credito_excedido':
      return { id: a.tipo, tom, texto: `Limite excedido · disponível ${formatBRL(Math.max(0, a.disponivel_cents))}`, apoio: 'Vai para aprovação' };
  }
}

/** "R$ 10.000,00 · disponível R$ 4.000,00"; `null` quando o cliente não tem dados de crédito (a tela mostra a frase de aviso). */
export function linhaDoLimite(c: ModeloDoCredito | null | undefined): string | null {
  if (!c || c.tipo === 'vazio') return null;
  return `${formatBRL(c.limite_cents)} · disponível ${formatBRL(c.disponivel_cents)}`;
}

/** "45 dias" / "1 dia"; `null` = o cadastro não traz prazo médio (a linha some). */
export function textoDoPrazoMedio(dias: number | null | undefined): string | null {
  if (typeof dias !== 'number' || !Number.isFinite(dias) || dias < 0) return null;
  const d = Math.trunc(dias);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/** Frase única da modalidade de frete (RN-VEN-16; sem valor de frete). FOB mostra a transportadora escolhida ou digitada. */
export function fraseDoFrete(f: { modalidade: 'CIF' | 'FOB'; transportadora?: string | null }): string {
  if (f.modalidade === 'CIF') return 'CIF: frete incluso no preço';
  const nome = (f.transportadora ?? '').trim();
  return nome ? `FOB: transportadora ${nome}` : 'FOB: escolha a transportadora';
}

// ---------- Resumo (RF-VEN-11, T-0137; docs/design/pedido-v2.md §2.1) ----------
export const ROTULOS_DO_RESUMO = { venda: 'Venda', itens: 'Itens', entrega: 'Entrega', obs: 'Obs.' } as const;
export const TEXTO_OBS_VAZIA = '—';

/**
 * Linha VENDA do Resumo: o alerta que muda o destino. Erro (RN-VEN-13: só orçamento) antes de aviso; aviso = "Vai para aprovação
 * (motivo)" quando o pedido vai ao supervisor por título vencido, limite excedido (RN-VEN-12) ou desconto acima da alçada (RN-VEN-10).
 */
export function alertaDaVendaNoResumo(e: { alertas: readonly AlertaDaVenda[]; vencido_aprova: boolean; alcada: boolean }): { tom: 'aviso' | 'erro'; texto: string } | null {
  const erro = e.alertas.find((a) => tomDoAlerta(a) === 'erro');
  if (erro) return { tom: 'erro', texto: textoDoAlerta(erro).texto };
  const motivos: string[] = [];
  if (e.vencido_aprova) motivos.push('título vencido');
  if (e.alertas.some((a) => a.tipo === 'credito_excedido')) motivos.push('limite excedido');
  if (e.alcada) motivos.push('desconto acima da alçada');
  return motivos.length > 0 ? { tom: 'aviso', texto: `Vai para aprovação (${motivos.join(', ')})` } : null;
}

/** Linha ENTREGA do Resumo: "Rua Pará, 137 · Manaus/AM · CIF" ou "... · FOB · Rodonaves". Sem endereço, o do cadastro. */
export function linhaDaEntregaNoResumo(e: { endereco: string | null; modalidade: 'CIF' | 'FOB'; transportadora?: string | null }): string {
  const transp = e.modalidade === 'FOB' ? (e.transportadora ?? '').trim() : '';
  return [(e.endereco ?? '').trim() || TEXTO_ENDERECO_DO_CADASTRO, e.modalidade, transp].filter((x) => x.length > 0).join(' · ');
}

/** Linha VENDA: "Boleto · 28/56 dias" (a forma e o prazo escolhidos); vazia = "—". */
export function linhaDaVendaNoResumo(prazo: string): string {
  return prazo.trim() || TEXTO_OBS_VAZIA;
}

/** Linha OBS.: a observação; vazia = "—". */
export function linhaDaObsNoResumo(obs: string | undefined | null): string {
  return (obs ?? '').trim() || TEXTO_OBS_VAZIA;
}
