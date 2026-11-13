/**
 * Detalhe do pedido/orçamento (RF-VEN-05, RN-VEN-30, T-0138; spec docs/design/pedido-v2.md §4 e §5). Parte PURA, sem React:
 * - o histórico em tags a partir dos eventos do pedido ou do orçamento (nunca o texto técnico "Recebido pelo servidor");
 * - as linhas do cabeçalho, dos itens e do total ("forma · prazo · frete");
 * - quem é a ação principal, quais vão em ícone + rótulo curto e quais vão para o menu ⋮ (quem decide se a ação EXISTE é o
 *   domain, `orderActions`/`estadoDasAcoes`, RN-VEN-31; aqui só se decide ONDE ela fica).
 */
import { TEXTOS_PRECOS_DE_HOJE } from './precos-de-hoje';
import { ROTULO_CORRIGIR_PEDIDO } from './salvar-na-fila';
import { ROTULOS_DO_SALVAR } from '../../domain/botoes-resumo';
import { alertasDoPedido, type AlertaDoPedido } from '../../domain/alertas-pedido';
import { ajusteDoItemEmPct, linhasDosTotais, semRs, siglaDaMedida } from '../../domain/apresentacao-totais';

export { linhasDosTotais, semRs, siglaDaMedida };
import type { MudancaNaConversao, SituacaoCliente, SituacaoOrcamento } from '../../domain/orcamento';

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

/** Itens visíveis no detalhe: os 8 primeiros e "Ver os 23 itens" (spec §4.1). */
export const MAX_ITENS_NO_DETALHE = 8;
export function itensVisiveis<T>(itens: ReadonlyArray<T>, mostrarTodos: boolean): { visiveis: T[]; rotuloVerTodos: string | null } {
  if (mostrarTodos || itens.length <= MAX_ITENS_NO_DETALHE) return { visiveis: [...itens], rotuloVerTodos: null };
  return { visiveis: itens.slice(0, MAX_ITENS_NO_DETALHE), rotuloVerTodos: `Ver os ${itens.length} itens` };
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
  /** T-0141 (RN-VEN-18): o preço congelado do orçamento passou dos 7 dias; Transformar entra pelos preços de hoje */
  precoVencido?: boolean;
  /** T-0150 (RN-VEN-42): o orçamento tem alerta que impede o pedido (acima do máximo, sem estoque, cliente): a principal é Editar, sem Transformar */
  alertaImpedeTransformar?: boolean;
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
    if (e.podeConverter && e.alertaImpedeTransformar && e.podeEditar) {
      return { principal: editar(true), icones: compactar([e.podePdf && pdf(true), e.podeDuplicar && duplicar(true)]), menu };
    }
    if (e.podeConverter) return { principal: e.precoVencido ? { ...TRANSFORMAR, apoio: TEXTOS_PRECOS_DE_HOJE.apoioDoBotao } : TRANSFORMAR, icones: compactar([e.podeEditar && editar(true), e.podePdf && pdf(true), e.podeDuplicar && duplicar(true)]), menu };
    return { principal: null, icones: compactar([e.podeEditar && editar(true), e.podePdf && pdf(true), e.podeDuplicar && duplicar(true), e.situacao === 'convertido' && e.pedidoGeradoId ? PEDIDO_GERADO : null]), menu };
  }
  const menu = compactar([e.podeCancelar && cancelar(false, e.status === 'draft')]);
  // pedido na fila e ainda não recusado: só leitura (RN-VEN-30); o "Enviar agora" fica na faixa
  if (e.naFila && !e.recusado) return { principal: null, icones: compactar([e.podePdf && pdf(false)]), menu: [] };
  if ((e.naFila && e.recusado) || e.status === 'rejected') return { principal: e.podeEditar ? CORRIGIR : null, icones: compactar([e.podePdf && pdf(false), e.podeDuplicar && duplicar(false)]), menu };
  if (e.status === 'draft') return { principal: e.podeEditar ? CONTINUAR : null, icones: [], menu };
  return { principal: null, icones: compactar([e.podeEditar && editar(false), e.podePdf && pdf(false), e.podeDuplicar && duplicar(false)]), menu };
}

// ---------- T-0150 (RN-VEN-42): Alertas, tabela de itens e totais do detalhe ----------
export interface LinhaDeItemEmTabela {
  /** nome - marca (balão do código) */
  nomeComMarca: string;
  codigo: string;
  /** a sigla da embalagem: "FD", "UN" */
  emb: string;
  /** "c/ 6" embaixo da sigla; vazio na UN */
  fator: string;
  /** só o número */
  qtd: string;
  /** valor de tabela da linha = quantidade × preço de tabela da embalagem, sem "R$" */
  valorTabela: string;
  /** sempre em %: "−5,0%", "+10,0%", "0,0%" */
  ajuste: string;
  total: string;
}

/** "Água mineral 1,5 L - Fonte Clara": o nome sempre seguido da marca, depois de um hífen (R-20261112-031456, regra 1); sem marca, só o nome. */
export function nomeComMarca(descricao: string, marca: string | null | undefined): string {
  const m = (marca ?? '').trim();
  return m ? `${descricao} - ${m}` : descricao;
}

/** §5.4: uma linha da tabela Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total (números sem "R$"). `unit_label` = "FD c/ 6" ou "UN". */
export function linhaDeItemEmTabela(l: { description: string; brand?: string | null; erp_code: string; quantity: number; unit_label?: string; unit_price_cents: number; total_cents: number; discount_pct?: number; surcharge_pct?: number }): LinhaDeItemEmTabela {
  const rotulo = (l.unit_label ?? '').trim();
  return {
    nomeComMarca: nomeComMarca(l.description, l.brand),
    codigo: l.erp_code,
    emb: siglaDaMedida(rotulo),
    fator: rotulo.split(/\s+/).slice(1).join(' '),
    qtd: String(l.quantity),
    valorTabela: semRs(l.unit_price_cents * l.quantity),
    ajuste: ajusteDoItemEmPct(l),
    total: semRs(l.total_cents),
  };
}

/** RN-VEN-30/42: o detalhe da recusa do servidor na fila vira alerta; a do supervisor e o motivo do cancelamento também (T-0150, pedido-v4 §0.1); a etapa do Histórico leva só o nome. */
export interface EntradaAlertasDoDetalhe {
  /** motivo curto devolvido pelo servidor para o pedido que está na fila (RN-VEN-40); vazio = sem recusa */
  recusaDoServidor?: string | null;
  /** motivo escrito pelo supervisor ao rejeitar (ou ao cancelar): uma linha nos Alertas */
  recusaDoSupervisor?: string | null;
  /** orçamento: o que a reconferência local achou (preço mínimo, estoque, cliente) */
  mudancas?: readonly MudancaNaConversao[];
  /** produto_id → código do ERP */
  codigoDoProduto?: (produtoId: string) => string;
}

export function alertasDoDetalhe(e: EntradaAlertasDoDetalhe): AlertaDoPedido[] {
  const ms = e.mudancas ?? [];
  const cod = e.codigoDoProduto ?? ((id: string) => id);
  const cliente: SituacaoCliente = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] };
  for (const m of ms) {
    if (m.tipo !== 'cliente') continue;
    if (m.motivo === 'bloqueado') cliente.bloqueado = true;
    else if (m.motivo === 'inativo') cliente.ativo = false;
    else {
      cliente.cadastro_incompleto = true;
      cliente.campos_faltantes = m.campos;
    }
  }
  const unicos = (tipo: 'abaixo_minimo' | 'estoque') => [...new Set(ms.filter((m): m is Extract<MudancaNaConversao, { tipo: typeof tipo }> => m.tipo === tipo).map((m) => m.produto_id))].map((id) => ({ item: id, codigo: cod(id) }));
  return alertasDoPedido({
    cliente,
    recusas: [e.recusaDoServidor, e.recusaDoSupervisor].filter((x): x is string => Boolean(x)),
    itens_acima_do_maximo: unicos('abaixo_minimo'),
    itens_sem_estoque: unicos('estoque'),
  });
}
