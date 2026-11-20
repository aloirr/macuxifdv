/**
 * RN-VEN-35 (RF-GES-05, T-0101): seletor de clientes do pedido em nome do vendedor, no app Gestão. Puro, sem React.
 * O gestor enxerga no aparelho os clientes da equipe/área inteira (escopo RN-CORE-04), mas o pedido em nome é do vendedor
 * dono: sem busca a lista mostra só a carteira dele; com busca, o cliente de outra carteira aparece (não some) com
 * "Cliente da carteira de <vendedor>" e não pode ser escolhido. A API revalida (nunca confia no app).
 * Dados só do aparelho (offline-first): a entidade `carteira` do Core (cliente_id, usuario_id, papel, vigência) e os nomes
 * dos vendedores que vêm nos pedidos da equipe (`vendedor_nome`).
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import type { CarteiraSync, CustomerSummary } from '@macuxi/core/contracts';

import { filterCustomers } from './catalog';

/** Mesmo teto da lista do seletor do Campo. */
export const LIMITE_DO_SELETOR = 60;

type VinculoDaCarteira = Pick<CarteiraSync, 'cliente_id' | 'usuario_id' | 'papel' | 'inicio' | 'fim'> & { deleted_at?: string | null };

/** Vínculo de vendedor que vale hoje (RN-CORE-04: `fim` passado ou `inicio` futuro não contam; promotor não é dono de carteira de venda). */
export function vinculoVigente(c: VinculoDaCarteira, hoje: string): boolean {
  if (c.deleted_at) return false;
  if (c.papel !== 'vendedor') return false;
  if (c.inicio && c.inicio.slice(0, 10) > hoje) return false;
  if (c.fim && c.fim.slice(0, 10) < hoje) return false;
  return true;
}

/** cliente_id → vendedores (usuario_id) com vínculo vigente, na ordem em que chegaram. */
export function vendedoresPorCliente(carteiras: readonly VinculoDaCarteira[], hoje: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of carteiras) {
    if (!vinculoVigente(c, hoje)) continue;
    const l = m.get(c.cliente_id);
    if (!l) m.set(c.cliente_id, [c.usuario_id]);
    else if (!l.includes(c.usuario_id)) l.push(c.usuario_id);
  }
  return m;
}

/** Nomes dos vendedores que o aparelho conhece: o informado na rota e os dos pedidos da equipe (`seller_id`/`seller_name`). */
export function nomesDosVendedores(pedidos: ReadonlyArray<{ seller_id: string; seller_name: string }>, extra?: { id: string; nome: string | null | undefined } | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pedidos) {
    const nome = p.seller_name?.trim();
    if (p.seller_id && nome && !m.has(p.seller_id)) m.set(p.seller_id, nome);
  }
  const nomeExtra = extra?.nome?.trim();
  if (extra?.id && nomeExtra) m.set(extra.id, nomeExtra);
  return m;
}

/** Texto da linha do cliente de outra carteira. `nomes` = os conhecidos no aparelho; `vinculos` = quantos vendedores têm o cliente. */
export function textoOutraCarteira(nomes: readonly string[], vinculos: number): string {
  if (vinculos === 0) return 'Cliente sem vendedor na carteira';
  if (nomes.length === 0) return 'Cliente da carteira de outro vendedor';
  const restantes = vinculos - 1;
  if (restantes === 0) return `Cliente da carteira de ${nomes[0]}`;
  if (restantes === 1 && nomes.length >= 2) return `Cliente da carteira de ${nomes[0]} e ${nomes[1]}`;
  return `Cliente da carteira de ${nomes[0]} e mais ${restantes}`;
}

export interface OpcaoDoSeletor {
  cliente: CustomerSummary;
  /** `false` = de outra carteira: aparece na busca, mas não abre o pedido em nome deste vendedor. */
  selecionavel: boolean;
  /** "Cliente da carteira de <vendedor>" na linha de outra carteira; `null` na carteira do dono. */
  nota: string | null;
}

export interface SeletorEmNome {
  opcoes: OpcaoDoSeletor[];
  /** `false` = o aparelho ainda não tem a carteira (nenhum vínculo vigente): mostra todos, como antes, e a API revalida. */
  carteiraConhecida: boolean;
  /** Clientes ativos da carteira do dono no aparelho. */
  totalDaCarteira: number;
  /** Nome do dono, se o aparelho conhece; `null` = "do vendedor". */
  nomeDoDono: string | null;
}

export interface EntradaSeletorEmNome {
  clientes: readonly CustomerSummary[];
  carteiras: readonly VinculoDaCarteira[];
  vendedorId: string;
  nomes: ReadonlyMap<string, string>;
  busca: string;
  agora: Date;
  tz: string;
  limite?: number;
}

/**
 * RN-VEN-35: sem busca, só a carteira do dono; com busca, primeiro os da carteira dele e depois os das outras carteiras,
 * marcados e não selecionáveis (em vez de escondidos, para o gestor entender por que o cliente não abre).
 */
export function seletorEmNome(e: EntradaSeletorEmNome): SeletorEmNome {
  const hoje = localIsoDate(e.agora, e.tz);
  const porCliente = vendedoresPorCliente(e.carteiras, hoje);
  const limite = e.limite ?? LIMITE_DO_SELETOR;
  const nomeDoDono = e.nomes.get(e.vendedorId) ?? null;
  if (porCliente.size === 0) {
    const todos = filterCustomers([...e.clientes], e.busca, []);
    return { opcoes: todos.slice(0, limite).map((cliente) => ({ cliente, selecionavel: true, nota: null })), carteiraConhecida: false, totalDaCarteira: e.clientes.length, nomeDoDono };
  }
  const doDono = (id: string) => porCliente.get(id)?.includes(e.vendedorId) ?? false;
  const totalDaCarteira = e.clientes.filter((c) => doDono(c.id)).length;
  const achados = filterCustomers([...e.clientes], e.busca, []);
  const buscando = e.busca.trim() !== '';
  const daCarteira: OpcaoDoSeletor[] = [];
  const outras: OpcaoDoSeletor[] = [];
  for (const cliente of achados) {
    if (doDono(cliente.id)) daCarteira.push({ cliente, selecionavel: true, nota: null });
    else if (buscando) {
      const donos = porCliente.get(cliente.id) ?? [];
      const nomes = donos.map((id) => e.nomes.get(id)).filter((n): n is string => Boolean(n));
      outras.push({ cliente, selecionavel: false, nota: textoOutraCarteira(nomes, donos.length) });
    }
  }
  return { opcoes: [...daCarteira, ...outras].slice(0, limite), carteiraConhecida: true, totalDaCarteira, nomeDoDono };
}

/** Subtítulo do seletor: de quem é a carteira mostrada. */
export function subtituloDoSeletor(nomeDoDono: string | null): string {
  return nomeDoDono ? `Clientes da carteira de ${nomeDoDono}` : 'Clientes da carteira do vendedor';
}

/** Texto de apoio da busca de cliente sem resultado (R-20261120-062210: só código, CNPJ e nome). */
export const VAZIO_DA_BUSCA_DE_CLIENTE = 'Confira o código, o CNPJ ou o nome.';

/**
 * Lista vazia do seletor: busca sem resultado ou carteira sem cliente no aparelho. Sem busca a lista traz a carteira toda, então
 * lista vazia sem busca só ocorre com a carteira vazia. `nomeDoDono`: nome (em nome), null (nome desconhecido) ou undefined (Campo).
 */
export function vazioDoSeletor(nomeDoDono: string | null | undefined, buscando: boolean): string {
  if (buscando) return VAZIO_DA_BUSCA_DE_CLIENTE;
  const de = nomeDoDono === undefined ? '' : nomeDoDono ? ` de ${nomeDoDono}` : ' do vendedor';
  return `Nenhum cliente na carteira${de} neste aparelho. Sincronize com sinal e tente de novo.`;
}

/** Leitura completa da linha de outra carteira (o leitor de tela diz por que não abre). */
export function rotuloAcessivelDaOpcao(o: OpcaoDoSeletor): string {
  return o.nota ? `${o.cliente.trade_name}. ${o.nota}. Não pode ser escolhido neste pedido.` : o.cliente.trade_name;
}
