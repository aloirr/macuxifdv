/**
 * Detalhe do pedido/orçamento (RF-VEN-05, RN-VEN-30, T-0138; spec docs/design/pedido-v2.md §4 e §5). Parte PURA, sem React:
 * - o histórico em tags a partir dos eventos do pedido ou do orçamento (nunca o texto técnico "Recebido pelo servidor");
 * - as linhas do cabeçalho, dos itens e do total ("forma · prazo · frete");
 * - quem é a ação principal, quais vão em ícone + rótulo curto e quais vão para o menu ⋮ (quem decide se a ação EXISTE é o
 *   domain, `orderActions`/`estadoDasAcoes`, RN-VEN-31; aqui só se decide ONDE ela fica).
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import { ROTULO_CORRIGIR_PEDIDO } from './salvar-na-fila';
import { ROTULOS_DO_SALVAR } from '../../domain/botoes-resumo';
import type { SituacaoOrcamento } from '../../domain/orcamento';

// ---------- histórico em tags ----------
// As funções puras do histórico (`eventosDoPedido`, `eventosDoOrcamento`, `autorEhOVendedor`, `motivoDoEvento`) vivem no domain
// para o app e o BKO usarem as mesmas (RN-VEN-30).
export { autorEhOVendedor, eventosDoOrcamento, eventosDoPedido, motivoDoEvento } from '../../domain/historico-pedido';

// ---------- cabeçalho, itens e total ----------
/** "Mercadinho São Jorge · cód. C5002" (sem código, só o nome). */
export function clienteComCodigo(nome: string, codigo: string | null | undefined): string {
  const c = (codigo ?? '').trim();
  return c ? `${nome} · cód. ${c}` : nome;
}

/** "Vendedor: Lucas Andrade"; sem nome, vazio. */
export function linhaDoVendedor(nome: string | null | undefined): string {
  const n = (nome ?? '').trim();
  return n ? `Vendedor: ${n}` : '';
}

/** Itens visíveis no detalhe: os 8 primeiros e "Ver os 23 itens" (spec §4.1). */
export const MAX_ITENS_NO_DETALHE = 8;
export function itensVisiveis<T>(itens: ReadonlyArray<T>, mostrarTodos: boolean): { visiveis: T[]; rotuloVerTodos: string | null } {
  if (mostrarTodos || itens.length <= MAX_ITENS_NO_DETALHE) return { visiveis: [...itens], rotuloVerTodos: null };
  return { visiveis: itens.slice(0, MAX_ITENS_NO_DETALHE), rotuloVerTodos: `Ver os ${itens.length} itens` };
}

/** Sigla da medida: "CX c/ 12" vira "CX"; vazio vira "UN". */
export function siglaDaMedida(medida: string | null | undefined): string {
  return (medida ?? '').trim().split(/\s+/)[0] || 'UN';
}

/** 2ª linha do item com ajuste: "Desc 5,0% · −R$ 1,00/FD" (desconto) ou "Acrésc 3,0% · +R$ 0,60/FD"; sem ajuste, null. */
export function linhaDoAjusteDoItem(i: { discount_pct?: number; surcharge_pct?: number; unit_price_cents: number; unit_label?: string }): string | null {
  const medida = siglaDaMedida(i.unit_label);
  if ((i.surcharge_pct ?? 0) > 0) return `Acrésc ${formatPct(i.surcharge_pct!)} · +${formatBRL(Math.round((i.unit_price_cents * i.surcharge_pct!) / 100))}/${medida}`;
  if ((i.discount_pct ?? 0) > 0) return `Desc ${formatPct(i.discount_pct!)} · −${formatBRL(Math.round((i.unit_price_cents * i.discount_pct!) / 100))}/${medida}`;
  return null;
}

/** Linha abaixo do Total: "Pix · À vista · CIF"; FOB: "Boleto · 28/56 dias · FOB · Transportes Rio Negro". Parte vazia sai. */
export function linhaFormaPrazoFrete(e: { forma?: string | null; prazo?: string | null; modalidade?: 'CIF' | 'FOB' | null; transportadora?: string | null }): string {
  const frete = e.modalidade === 'FOB' ? ['FOB', e.transportadora?.trim()] : [e.modalidade];
  return [e.forma?.trim(), e.prazo?.trim(), ...frete].filter((x): x is string => Boolean(x)).join(' · ');
}

// ---------- ações ----------
export type IdAcaoDetalhe = 'transformar' | 'continuar' | 'corrigir' | 'editar' | 'pdf' | 'duplicar' | 'pedido' | 'cancelar';
export type IconeAcao = 'send' | 'edit' | 'file' | 'copy' | 'chevron' | 'trash';

export interface AcaoDoDetalhe {
  id: IdAcaoDetalhe;
  /** Texto na tela: 1 palavra e até 10 letras nos ícones (`rotuloCurtoOk`); o principal e o menu têm o rótulo inteiro. */
  rotulo: string;
  /** Leitura completa do TalkBack. */
  rotuloAcessivel: string;
  icone: IconeAcao;
  /** Texto de apoio abaixo do botão principal (12, ink2). */
  apoio?: string;
}
export interface AcoesDoDetalhe {
  principal: AcaoDoDetalhe | null;
  /** Ícone + rótulo curto, na ordem da spec (até 4). */
  icones: AcaoDoDetalhe[];
  /** Menu ⋮; a ação destrutiva pede confirmação. */
  menu: AcaoDoDetalhe[];
}

export interface EntradaAcoesDoDetalhe {
  tipo: 'pedido' | 'orcamento';
  status: string;
  situacao: SituacaoOrcamento | null;
  naFila: boolean;
  /** pedido da fila que a API recusou: reabre para correção */
  recusado: boolean;
  /** sem permissão de escrita (promotor: regra 7) */
  somenteLeitura: boolean;
  /** o que o domain/`estadoDasAcoes` já liberou (RN-VEN-31) */
  podeEditar: boolean;
  podeCancelar: boolean;
  podeDuplicar: boolean;
  podePdf: boolean;
  podeConverter: boolean;
  /** orçamento transformado: id do pedido gerado (liga o ícone "Pedido") */
  pedidoGeradoId: string | null;
}

const TRANSFORMAR: AcaoDoDetalhe = { id: 'transformar', rotulo: ROTULOS_DO_SALVAR.transformar, rotuloAcessivel: 'Transformar o orçamento em pedido', icone: 'send' };
const CONTINUAR: AcaoDoDetalhe = { id: 'continuar', rotulo: 'Continuar pedido', rotuloAcessivel: 'Continuar o pedido salvo', icone: 'edit' };
const CORRIGIR: AcaoDoDetalhe = { id: 'corrigir', rotulo: ROTULO_CORRIGIR_PEDIDO, rotuloAcessivel: 'Corrigir o pedido', icone: 'edit' };
const PEDIDO_GERADO: AcaoDoDetalhe = { id: 'pedido', rotulo: 'Pedido', rotuloAcessivel: 'Abrir o pedido gerado', icone: 'chevron' };

const sufixo = (orc: boolean) => (orc ? 'orçamento' : 'pedido');
const editar = (orc: boolean): AcaoDoDetalhe => ({ id: 'editar', rotulo: 'Editar', rotuloAcessivel: `Editar ${sufixo(orc)}`, icone: 'edit' });
const pdf = (orc: boolean): AcaoDoDetalhe => ({ id: 'pdf', rotulo: 'PDF', rotuloAcessivel: `Baixar o PDF do ${sufixo(orc)}`, icone: 'file' });
const duplicar = (orc: boolean): AcaoDoDetalhe => ({ id: 'duplicar', rotulo: 'Duplicar', rotuloAcessivel: `Duplicar ${sufixo(orc)}`, icone: 'copy' });
const cancelar = (orc: boolean, rascunho = false): AcaoDoDetalhe => {
  const rotulo = orc ? 'Cancelar orçamento' : rascunho ? 'Descartar pedido' : 'Cancelar pedido';
  return { id: 'cancelar', rotulo, rotuloAcessivel: rotulo, icone: 'trash' };
};

const SEM_ACOES: AcoesDoDetalhe = { principal: null, icones: [], menu: [] };
const compactar = (xs: Array<AcaoDoDetalhe | null | false>): AcaoDoDetalhe[] => xs.filter((x): x is AcaoDoDetalhe => Boolean(x));

/**
 * Tabela do pedido-v2.md §4.3. Promotor (somente leitura) nunca vê ação de pedido (regra 7). Sem ação, o rodapé nem aparece.
 * Cancelar é sempre do menu ⋮ (nunca botão no rodapé).
 */
export function acoesDoDetalhe(e: EntradaAcoesDoDetalhe): AcoesDoDetalhe {
  if (e.somenteLeitura) return SEM_ACOES;
  if (e.tipo === 'orcamento') {
    const menu = compactar([e.podeCancelar && cancelar(true)]);
    if (e.podeConverter) return { principal: TRANSFORMAR, icones: compactar([e.podeEditar && editar(true), e.podePdf && pdf(true), e.podeDuplicar && duplicar(true)]), menu };
    return { principal: null, icones: compactar([e.podeEditar && editar(true), e.podePdf && pdf(true), e.podeDuplicar && duplicar(true), e.situacao === 'convertido' && e.pedidoGeradoId ? PEDIDO_GERADO : null]), menu };
  }
  const menu = compactar([e.podeCancelar && cancelar(false, e.status === 'draft')]);
  // pedido na fila e ainda não recusado: só leitura (RN-VEN-30); o "Enviar agora" fica na faixa
  if (e.naFila && !e.recusado) return { principal: null, icones: compactar([e.podePdf && pdf(false)]), menu: [] };
  if ((e.naFila && e.recusado) || e.status === 'rejected') return { principal: e.podeEditar ? CORRIGIR : null, icones: compactar([e.podePdf && pdf(false), e.podeDuplicar && duplicar(false)]), menu };
  if (e.status === 'draft') return { principal: e.podeEditar ? CONTINUAR : null, icones: [], menu };
  return { principal: null, icones: compactar([e.podeEditar && editar(false), e.podePdf && pdf(false), e.podeDuplicar && duplicar(false)]), menu };
}
