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
export const ROTULO_CREDITO = 'Crédito do cliente';
export const TEXTO_SEM_DADOS_DE_CREDITO = 'Sem dados de crédito deste cliente.';
export const TEXTO_CREDITO_INDISPONIVEL = 'Crédito indisponível agora. Sincronize o aparelho.';
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
      return { id: a.tipo, tom, texto: 'Limite excedido', apoio: 'Vai para aprovação' };
  }
}

export interface LinhaDoCredito {
  id: 'limite' | 'disponivel' | 'prazo';
  rotulo: string;
  /** já formatado; "—" = sem dado */
  valor: string;
  tom?: 'erro';
}
export interface TabelaDoCredito {
  /** `carregando`: barras no lugar dos valores; `indisponivel`: sem tabela, só o apoio; `tabela`: as 3 linhas */
  estado: 'carregando' | 'indisponivel' | 'tabela';
  linhas: LinhaDoCredito[];
  /** frase de 12 `ink2` abaixo da tabela (ou no lugar dela) */
  apoio: string | null;
}

const SEM_DADO = '—';
/** Dinheiro com sinal "−" (U+2212) para o negativo: "−R$ 1.200,00". */
const dinheiroComSinal = (cents: number) => (cents < 0 ? `−${formatBRL(-cents)}` : formatBRL(cents));

/**
 * RN-VEN-12 / RF-VEN-11 (T-0141 A, docs/design/pedido-v3.md §A): o crédito da aba Venda em tabela. `credito`: `undefined` = lendo do
 * aparelho (barras, nunca "R$ 0,00"); `null` = consulta indisponível (sem tabela); `vazio` = Limite e Disponível com "—" e a
 * frase de apoio. O Prazo médio sem dado também fica com "—": a forma da tabela não muda de um cliente para outro.
 */
export function tabelaDoCredito(c: ModeloDoCredito | null | undefined, prazoMedioDias: number | null | undefined): TabelaDoCredito {
  const prazo = textoDoPrazoMedio(prazoMedioDias) ?? SEM_DADO;
  if (c === null) return { estado: 'indisponivel', linhas: [], apoio: TEXTO_CREDITO_INDISPONIVEL };
  const dados = c?.tipo === 'dados' ? c : null;
  const linhas: LinhaDoCredito[] = [
    { id: 'limite', rotulo: 'Limite', valor: dados ? formatBRL(dados.limite_cents) : SEM_DADO },
    { id: 'disponivel', rotulo: 'Disponível', valor: dados ? dinheiroComSinal(dados.disponivel_cents) : SEM_DADO, ...(dados && dados.disponivel_cents < 0 ? { tom: 'erro' as const } : {}) },
    { id: 'prazo', rotulo: 'Prazo médio', valor: prazo },
  ];
  if (c === undefined) return { estado: 'carregando', linhas, apoio: null };
  return { estado: 'tabela', linhas, apoio: dados ? null : TEXTO_SEM_DADOS_DE_CREDITO };
}

/** "45 dias" / "1 dia"; `null` = o cadastro não traz prazo médio (a linha some). */
export function textoDoPrazoMedio(dias: number | null | undefined): string | null {
  if (typeof dias !== 'number' || !Number.isFinite(dias) || dias < 0) return null;
  const d = Math.trunc(dias);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

// ---------- Resumo (RF-VEN-11, T-0137; docs/design/pedido-v2.md §2.1) ----------
export const ROTULOS_DO_RESUMO = { venda: 'Venda', itens: 'Itens', entrega: 'Entrega', obs: 'Obs.' } as const;
export const TEXTO_OBS_VAZIA = '—';

/**
 * Linha VENDA do Resumo: o alerta que muda o destino. Erro (RN-VEN-13: só orçamento) antes de aviso; aviso = "Vai para aprovação
 * (motivo)" quando o pedido vai ao supervisor por título vencido, limite excedido (RN-VEN-12); a alçada de desconto não entra aqui: só a pergunta ao salvar, RN-VEN-10, T-0151).
 */
export function alertaDaVendaNoResumo(e: { alertas: readonly AlertaDaVenda[]; vencido_aprova: boolean }): { tom: 'aviso' | 'erro'; texto: string } | null {
  // RD-0061: "só orçamento" fica na linha de cima dos botões (aviso do Resumo); a linha Venda não repete
  const motivos: string[] = [];
  if (e.vencido_aprova) motivos.push('título vencido');
  if (e.alertas.some((a) => a.tipo === 'credito_excedido')) motivos.push('limite excedido');
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
