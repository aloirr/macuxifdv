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
