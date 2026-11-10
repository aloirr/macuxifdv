/**
 * RN-VEN-42 (T-0150, T-0148; spec docs/design/pedido-v4.md §0.1): a ÁREA ÚNICA "Alertas" do pedido. Reúne, numa lista ordenada,
 * tudo o que pede atenção: cliente (RN-VEN-13), informação faltante (RN-CORE-36), desconto acima do máximo (RN-VEN-11), sem
 * estoque (RN-VEN-20), crédito (RN-VEN-12), título vencido (RN-VEN-13) e recusa (RN-VEN-40). Função pura, sem React. A alçada
 * nunca é alerta (RN-VEN-10). A tela só desenha; os efeitos no salvar vêm de `so_orcamento` e `impede_enviar`.
 */
import { alertasDaVenda } from './alertas-venda';
import type { SituacaoCliente } from './orcamento';

export type TipoDoAlerta = 'cliente' | 'faltante' | 'maximo' | 'estoque' | 'credito' | 'titulo' | 'recusa';

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
  /** texto lido pelo TalkBack */
  leitura: string;
}

export interface ItemDoAlerta {
  item: string;
  codigo: string;
  maximo_pct?: number;
}

export interface EntradaAlertasDoPedido {
  cliente: SituacaoCliente;
  faltantes?: ReadonlyArray<{ texto: string; aba: string }>;
  itens_acima_do_maximo?: readonly ItemDoAlerta[];
  itens_sem_estoque?: readonly ItemDoAlerta[];
  vencidos?: { titulos: number; valor_cents: number; dias: number } | null;
  disponivel_cents?: number | null;
  total_cents?: number;
  /** motivos de recusa (servidor ou supervisor), já em uma linha */
  recusas?: readonly string[];
}

type Parcial = Omit<AlertaDoPedido, 'leitura' | 'so_orcamento' | 'impede_enviar'> & Partial<Pick<AlertaDoPedido, 'so_orcamento' | 'impede_enviar'>>;

const semPonto = (t: string) => t.trim().replace(/\.+$/, '');
const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

function alerta(a: Parcial): AlertaDoPedido {
  const leitura = `${a.texto}${a.aba ? `, aba ${a.aba}` : ''}.${a.vai_para !== undefined ? ' Toque duas vezes para corrigir.' : ''}`;
  return { so_orcamento: false, impede_enviar: false, ...a, leitura };
}

/** RN-VEN-42 §0.1: a lista de alertas na ordem da spec (cliente, faltante, máximo, estoque; depois crédito e título). A recusa abre a lista. */
export function alertasDoPedido(e: EntradaAlertasDoPedido): AlertaDoPedido[] {
  const r: AlertaDoPedido[] = [];
  (e.recusas ?? []).forEach((m, i) => r.push(alerta({ id: `recusa-${i}`, tipo: 'recusa', texto: semPonto(m) })));

  const venda = alertasDaVenda({ cliente: e.cliente, vencidos: e.vencidos ?? null, disponivel_cents: e.disponivel_cents ?? null, total_cents: e.total_cents ?? 0 });
  for (const a of venda) {
    const texto = a.tipo === 'bloqueado' ? 'Cliente bloqueado' : a.tipo === 'inativo' ? 'Cliente inativo' : a.tipo === 'cadastro_incompleto' ? 'Cadastro do cliente incompleto' : null;
    if (texto) r.push(alerta({ id: `cliente-${a.tipo}`, tipo: 'cliente', texto, so_orcamento: true }));
  }
  (e.faltantes ?? []).forEach((f) => r.push(alerta({ id: `faltante-${f.aba}-${f.texto}`, tipo: 'faltante', texto: semPonto(f.texto), aba: f.aba, vai_para: { aba: f.aba }, impede_enviar: true })));
  (e.itens_acima_do_maximo ?? []).forEach((i) => r.push(alerta({ id: `maximo-${i.item}`, tipo: 'maximo', texto: `${i.codigo} acima do desconto máximo`, vai_para: { item: i.item }, so_orcamento: true, ...(i.maximo_pct !== undefined ? { maximo_pct: i.maximo_pct } : {}) })));
  (e.itens_sem_estoque ?? []).forEach((i) => r.push(alerta({ id: `estoque-${i.item}`, tipo: 'estoque', texto: `${i.codigo} sem estoque`, vai_para: { item: i.item }, so_orcamento: true })));

  if (venda.some((a) => a.tipo === 'credito_excedido')) r.push(alerta({ id: 'credito', tipo: 'credito', texto: 'Limite de crédito excedido' }));
  if (venda.some((a) => a.tipo === 'vencido')) r.push(alerta({ id: 'titulo', tipo: 'titulo', texto: 'Título vencido' }));
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

/** §0.1: dentro do popup do item o código sai ("Sem estoque", "Acima do desconto máximo de 10,0%"). */
export function textoDoAlertaNoItem(a: AlertaDoPedido): string {
  if (a.tipo === 'estoque') return 'Sem estoque';
  if (a.tipo === 'maximo') return a.maximo_pct !== undefined ? `Acima do desconto máximo de ${pct(a.maximo_pct)}` : 'Acima do desconto máximo';
  return a.texto;
}
