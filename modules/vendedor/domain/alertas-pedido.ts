/**
 * RN-VEN-42 (T-0150, T-0148; spec docs/design/pedido-v4.md §0.1): a ÁREA ÚNICA "Alertas" do pedido. Reúne, numa lista ordenada,
 * tudo o que pede atenção: cliente (RN-VEN-13), informação faltante (RN-CORE-36), desconto acima do máximo (RN-VEN-11), sem
 * estoque (RN-VEN-20), crédito (RN-VEN-12), título vencido (RN-VEN-13), alçada (RN-VEN-10, T-0165: uma linha por pedido) e
 * recusa (RN-VEN-40). Função pura, sem React. A tela só desenha; os efeitos no salvar vêm de `so_orcamento` e `impede_enviar`.
 */
import { alertasDaVenda } from './alertas-venda';
import { exigeAprovacaoPorInadimplencia } from './credito-pedido';
import type { SituacaoCliente } from './orcamento';

export type TipoDoAlerta = 'cliente' | 'faltante' | 'maximo' | 'estoque' | 'credito' | 'titulo' | 'alcada' | 'limite_pedido' | 'recusa' | 'copia' | 'sinal';

export interface AlertaDoPedido {
  /** estável: tipo + item/aba, serve de chave na tela */
  id: string;
  tipo: TipoDoAlerta;
  /** a linha, sem ponto final e sem alçada */
  texto: string;
  /** aba onde se corrige ("Venda", "Entrega"); só no faltante */
  aba?: string;
  /** o toque leva a um item (popup) ou a uma aba; sem destino, a linha não tem chevron */
  vai_para?: { item: string } | { aba: string };
  /** só o orçamento sai com este alerta (máximo, estoque, cliente) */
  so_orcamento: boolean;
  /** "Salvar e enviar pedido" fica desligado (faltante); "Apenas salvar" continua */
  impede_enviar: boolean;
  /** só no máximo: o limite do produto, para o texto do popup */
  maximo_pct?: number;
  /** só no estoque: há estoque (maior que zero) e a quantidade passou dele; com zero o popup diz "Sem estoque" */
  estoque_positivo?: boolean;
  /** texto lido pelo TalkBack */
  leitura: string;
}

export interface ItemDoAlerta {
  item: string;
  codigo: string;
  maximo_pct?: number;
  /** só no sem estoque: o estoque na unidade base, para dizer "acima do estoque (5 UN)" em vez de "sem estoque" */
  estoque?: { quantidade: number; unidade: string };
}

export interface EntradaAlertasDoPedido {
  cliente: SituacaoCliente;
  faltantes?: ReadonlyArray<{ texto: string; aba: string }>;
  itens_acima_do_maximo?: readonly ItemDoAlerta[];
  itens_sem_estoque?: readonly ItemDoAlerta[];
  vencidos?: { titulos: number; valor_cents: number; dias: number } | null;
  disponivel_cents?: number | null;
  total_cents?: number;
  /** RN-VEN-10 (T-0165): o desconto efetivo do pedido passa da alçada do autor; uma linha só, venha do geral ou de um item */
  acima_da_alcada?: boolean;
  /** RN-VEN-11a (T-0168): limite do pedido em ‰ quando o desconto efetivo passa dele; uma linha só, só orçamento */
  acima_do_limite?: number | null;
  /** motivos de recusa (servidor ou supervisor), já em uma linha */
  recusas?: readonly string[];
  /** RD-0174: itens que a cópia deixou de fora ("AGU-1500 fora da cópia: sem preço"); uma linha por item, sem efeito no envio */
  itens_fora_da_copia?: readonly string[];
  /** RD-0173: o cliente não aceita nenhuma forma ativa (cadastro): alerta sempre visível, sem esperar a tentativa */
  /** RD-0189: a aba aberta agora; a falta dela fica só no campo (a tela mostra), não em Alertas */
  aba_atual?: string;
  sem_forma_para_o_cliente?: boolean;
  /** RD-0175: editar pedido já enviado sem sinal (não enfileira): vira a linha "Sem sinal para salvar a alteração" */
  sem_sinal_para_salvar?: boolean;
}

type Parcial = Omit<AlertaDoPedido, 'leitura' | 'so_orcamento' | 'impede_enviar'> & Partial<Pick<AlertaDoPedido, 'so_orcamento' | 'impede_enviar'>>;

/** RD-0173 */
export const TEXTO_SEM_FORMA = 'Sem forma de pagamento para este cliente';

/** RD-0175: o salvar da edição de pedido enviado exige internet; a linha substitui a faixa vermelha. */
export const TEXTO_SEM_SINAL_PARA_SALVAR = 'Sem sinal para salvar a alteração';

/** RN-VEN-10 (T-0165, RD-0142): a linha única da alçada; o toque leva à aba Itens. */
export const TEXTO_ACIMA_DA_ALCADA = 'Desconto acima da sua alçada';

const semPonto = (t: string) => t.trim().replace(/\.+$/, '');
const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

/** RD-0177: o limite embaixo do campo Desc. na folha do item. */
export const textoDoMaximo = (maximo_pct: number): string => `Máx. ${pct(maximo_pct)}`;

function alerta(a: Parcial): AlertaDoPedido {
  const leitura = `${a.texto}${a.aba ? `, aba ${a.aba}` : ''}.${a.vai_para !== undefined ? ' Toque duas vezes para corrigir.' : ''}`;
  return { so_orcamento: false, impede_enviar: false, ...a, leitura };
}

/** RN-VEN-20: o rótulo diz o que é. Estoque zero = "<código> sem estoque"; quantidade acima de um estoque positivo = "<código> acima do estoque (5 UN)". */
function textoDoEstoqueInsuficiente(i: ItemDoAlerta): string {
  if (!i.estoque || i.estoque.quantidade <= 0) return `${i.codigo} sem estoque`;
  const un = i.estoque.unidade ? ` ${i.estoque.unidade}` : '';
  return `${i.codigo} acima do estoque (${Math.trunc(i.estoque.quantidade)}${un})`;
}

/**
 * RN-VEN-13 (RD-0172, P1 A de T-0184): o título vencido só é alerta quando muda o resultado: atraso ACIMA do limite (padrão 5 dias),
 * a prazo ou à vista (`exigeAprovacaoPorInadimplencia`; o prazo não entra na conta, o parâmetro fica só para as chamadas existentes). Fora disso devolve `null` e o Financeiro do cliente continua mostrando os vencidos.
 */
export function vencidosComEfeito<T extends { dias: number }>(vencidos: T | null, _prazo_medio_dias: number | undefined, limite_dias: number): T | null {
  if (!vencidos) return null;
  return exigeAprovacaoPorInadimplencia({ maior_atraso_dias: vencidos.dias, limite_dias }) ? vencidos : null;
}

/** RN-VEN-42 §0.1: a lista de alertas na ordem da spec (cliente, faltante, máximo, estoque; depois crédito e título). A recusa abre a lista. */
export function alertasDoPedido(e: EntradaAlertasDoPedido): AlertaDoPedido[] {
  const r: AlertaDoPedido[] = [];
  (e.recusas ?? []).forEach((m, i) => r.push(alerta({ id: `recusa-${i}`, tipo: 'recusa', texto: semPonto(m) })));

  if (e.sem_sinal_para_salvar) r.push(alerta({ id: 'sinal', tipo: 'sinal', texto: TEXTO_SEM_SINAL_PARA_SALVAR, impede_enviar: true }));
  (e.itens_fora_da_copia ?? []).forEach((m, i) => r.push(alerta({ id: `copia-${i}`, tipo: 'copia', texto: semPonto(m) })));

  const venda = alertasDaVenda({ cliente: e.cliente, vencidos: e.vencidos ?? null, disponivel_cents: e.disponivel_cents ?? null, total_cents: e.total_cents ?? 0 });
  // RD-0171: bloqueado, inativo e cadastro incompleto têm o mesmo efeito (só orçamento): uma linha, a primeira que vale
  const motivoDoCliente = venda.find((a) => a.tipo === 'bloqueado') ?? venda.find((a) => a.tipo === 'inativo') ?? venda.find((a) => a.tipo === 'cadastro_incompleto');
  if (motivoDoCliente) {
    const texto = motivoDoCliente.tipo === 'bloqueado' ? 'Cliente bloqueado' : motivoDoCliente.tipo === 'inativo' ? 'Cliente inativo' : 'Cadastro do cliente incompleto';
    r.push(alerta({ id: `cliente-${motivoDoCliente.tipo}`, tipo: 'cliente', texto, so_orcamento: true }));
  }
  if (e.sem_forma_para_o_cliente) r.push(alerta({ id: 'sem-forma', tipo: 'faltante', texto: TEXTO_SEM_FORMA, aba: 'Venda', vai_para: { aba: 'Venda' }, impede_enviar: true }));
  (e.faltantes ?? []).filter((f) => f.aba !== e.aba_atual).forEach((f) => r.push(alerta({ id: `faltante-${f.aba}-${f.texto}`, tipo: 'faltante', texto: semPonto(f.texto), aba: f.aba, vai_para: { aba: f.aba }, impede_enviar: true })));
  (e.itens_acima_do_maximo ?? []).forEach((i) => r.push(alerta({ id: `maximo-${i.item}`, tipo: 'maximo', texto: `${i.codigo} acima do desconto máximo`, vai_para: { item: i.item }, so_orcamento: true, ...(i.maximo_pct !== undefined ? { maximo_pct: i.maximo_pct } : {}) })));
  if (e.acima_do_limite != null) r.push(alerta({ id: 'limite-pedido', tipo: 'limite_pedido', texto: `Pedido acima do desconto máximo (${Math.floor(e.acima_do_limite / 10)},${e.acima_do_limite % 10}%)`, vai_para: { aba: 'Resumo' }, so_orcamento: true }));
  (e.itens_sem_estoque ?? []).forEach((i) => r.push(alerta({ id: `estoque-${i.item}`, tipo: 'estoque', texto: textoDoEstoqueInsuficiente(i), vai_para: { item: i.item }, so_orcamento: true, ...(i.estoque && i.estoque.quantidade > 0 ? { estoque_positivo: true } : {}) })));

  if (venda.some((a) => a.tipo === 'credito_excedido')) r.push(alerta({ id: 'credito', tipo: 'credito', texto: 'Limite de crédito excedido' }));
  if (venda.some((a) => a.tipo === 'vencido')) r.push(alerta({ id: 'titulo', tipo: 'titulo', texto: 'Título vencido' }));
  if (e.acima_da_alcada) r.push(alerta({ id: 'alcada', tipo: 'alcada', texto: TEXTO_ACIMA_DA_ALCADA, vai_para: { aba: 'Itens' } }));
  return r;
}

/** RN-VEN-11/20/13: algum alerta só permite orçamento (a tela mostra "Salvar como orçamento" como principal). */
export function soOrcamentoPorAlertas(a: readonly AlertaDoPedido[]): boolean {
  return a.some((x) => x.so_orcamento);
}

/** RN-CORE-36: algum alerta desliga o "Salvar e enviar pedido". */
export function impedeEnviarPorAlertas(a: readonly AlertaDoPedido[]): boolean {
  return a.some((x) => x.impede_enviar);
}

/** §0.1: dentro do popup do item o código sai ("Sem estoque", "Acima do desconto máximo de 10,0%"); o estoque positivo ultrapassado vira "Acima do estoque" (RD-0087; a área Alertas do pedido mantém "BIS-400 acima do estoque (5 UN)"). */
export function textoDoAlertaNoItem(a: AlertaDoPedido): string {
  if (a.tipo === 'estoque') return a.estoque_positivo ? 'Acima do estoque' : 'Sem estoque';
  if (a.tipo === 'maximo') return a.maximo_pct !== undefined ? `Acima do desconto máximo de ${pct(a.maximo_pct)}` : 'Acima do desconto máximo';
  return a.texto;
}
