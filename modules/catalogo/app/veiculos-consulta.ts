/**
 * `catalogo.veiculos@1` no aparelho (RN-CAT-22; desenho `docs/desenho/filtro-veiculo.md` §2 e §4): a cascata de veículo lida das
 * aplicações das linhas locais, com o mesmo domain da API, e os Recentes em memória (até 3; somem ao fechar o app e na troca de usuário).
 * O índice é montado uma vez por lista de produtos montada (muda com o sync) e por ano civil no fuso do tenant, em pedaços, sem travar a tela.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_VEICULOS, type ProdutoConteudoSync, type VeiculoEscolhido, type ItemVitrine, type VeiculoParcial, type VeiculoRecente, type VeiculosSaida } from '../contracts';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { construirIndiceVeiculosEmLotes, definirIndiceVeiculos, indiceVeiculosDe, restringirIndice, type IndiceVeiculos } from '../domain/veiculo-indice';
import { filtrarPorVeiculo, produtosDoModelo, rotulosDoVeiculo, saidaDaCascata, SEM_VEICULO } from '../domain/veiculo-filtro';
import { TETO_RANKING_BUSCA } from '../domain/busca-consulta';
import type { ChipsVitrine } from '../domain/vitrine';
import { veiculosDe } from '../domain/veiculos';
import type { ProdutoCatalogo } from '../domain/vitrine';
import { cargaOnlineDoShell } from './lib/carga-online';
import { portaDaCarga } from './lib/consultas-online';
import { escopoLocal } from './escopo-cliente';
import { buscarLocal, produtosLocais, vitrineLocal, type EntradaLocal, type LeitorLocal } from './lib/local';

export const MAXIMO_RECENTES = 3;
let recentes: VeiculoRecente[] = [];

/** O veículo aplicado vai ao topo dos Recentes (sem repetir, até 3). Chamado pelo Catálogo e pela busca do pedido com veículo. */
export function lembrarVeiculo(v: VeiculoEscolhido): void {
  const rotulos = rotulosDoVeiculo(v);
  if (!rotulos) return;
  const igual = (a: VeiculoEscolhido) => a.montadora === v.montadora && a.modelo === v.modelo && a.ano === v.ano && a.motor === v.motor && a.versao === v.versao;
  recentes = [{ veiculo: v, rotulos }, ...recentes.filter((r) => !igual(r.veiculo))].slice(0, MAXIMO_RECENTES);
}
export const recentesDeVeiculos = (): VeiculoRecente[] => [...recentes];
/** Troca de usuário e testes. */
export const esquecerVeiculosRecentes = (): void => {
  recentes = [];
};

/** A montagem em andamento por lista de produtos e ano civil (uma só por vez: quem chega junto espera a mesma). */
const EM_MONTAGEM = new WeakMap<readonly object[], Map<number, Promise<IndiceVeiculos>>>();

async function montarIndice(leitor: LeitorLocal, produtos: readonly ProdutoCatalogo[], anoAtual: number): Promise<IndiceVeiculos> {
  const aplicacoes = new Map<string, string>();
  for (const c of await leitor.linhas<ProdutoConteudoSync & { deleted_at: string | null }>('produto_conteudo')) if (!c.deleted_at && c.aplicacao) aplicacoes.set(c.produto_id, c.aplicacao);
  // em pedaços, cedendo o laço entre eles: com 20 mil produtos a montagem leva cerca de 2 s e não pode travar a tela
  const indice = await construirIndiceVeiculosEmLotes(
    produtos.filter((p) => p.ativo).map((p) => ({ id: p.id, aplicacao: aplicacoes.get(p.id) ?? p.aplicacao })),
    { anoAtual, veiculos: veiculosDe(produtos) },
  );
  definirIndiceVeiculos(produtos, indice);
  return indice;
}

/**
 * O índice dos produtos ativos do aparelho, esperando a montagem se ainda não terminou (guardado enquanto a lista de produtos e o ano civil
 * forem os mesmos). Quem não precisa esperar (abrir o Catálogo, a ficha, o pedido) usa `indiceVeiculosPronto`.
 */
export async function indiceVeiculosLocal(leitor: LeitorLocal, anoAtual: number): Promise<IndiceVeiculos> {
  const produtos = await produtosLocais(leitor, { lerConcorrente: false });
  const guardado = indiceVeiculosDe(produtos, anoAtual);
  if (guardado) return guardado;
  let porAno = EM_MONTAGEM.get(produtos);
  if (!porAno) EM_MONTAGEM.set(produtos, (porAno = new Map()));
  let andando = porAno.get(anoAtual);
  if (!andando) {
    andando = montarIndice(leitor, produtos, anoAtual).finally(() => porAno.delete(anoAtual));
    porAno.set(anoAtual, andando);
  }
  return andando;
}

/** O índice se já está montado; senão `null` e a montagem segue em segundo plano (a tela não espera: o botão Veículo aparece quando ela termina). */
export async function indiceVeiculosPronto(leitor: LeitorLocal, anoAtual: number): Promise<IndiceVeiculos | null> {
  const produtos = await produtosLocais(leitor, { lerConcorrente: false });
  const guardado = indiceVeiculosDe(produtos, anoAtual);
  if (guardado) return guardado;
  void indiceVeiculosLocal(leitor, anoAtual).catch(() => undefined);
  return null;
}

type EntradaCascata = { escolha?: VeiculoParcial | undefined; busca?: string | undefined; escopo?: ReadonlySet<string> | null | undefined };

/** `escopo` (RN-CAT-22): só os produtos dele contam para as opções, a busca e `disponivel`; os Recentes não são filtrados. */
const cascataSobre = (todo: IndiceVeiculos, entrada: EntradaCascata): VeiculosSaida => saidaDaCascata(entrada.escopo ? restringirIndice(todo, entrada.escopo) : todo, entrada, recentesDeVeiculos());

/** A cascata sobre as linhas locais (a folha do Catálogo usa; espera o índice, que já está pronto quando o botão aparece). */
export async function cascataLocal(leitor: LeitorLocal, entrada: EntradaCascata, anoAtual: number): Promise<VeiculosSaida> {
  return cascataSobre(await indiceVeiculosLocal(leitor, anoAtual), entrada);
}

export const consultaVeiculosAparelho = implementarConsultaAparelho(CONSULTA_VEICULOS, async (entrada, ctx): Promise<VeiculosSaida> => {
  // catálogo ainda carregando (ADR 0054), com ou sem sinal: o botão Veículo só aparece com o catálogo no aparelho (spec §9)
  try {
    if (portaDaCarga('catalogo.veiculos@1', cargaOnlineDoShell())) return SEM_VEICULO;
  } catch {
    return SEM_VEICULO;
  }
  // índice ainda em montagem: sem botão por enquanto (a consulta não espera, não trava a tela)
  const todo = await indiceVeiculosPronto(ctx, anoCivilNoFuso(ctx.agora(), ctx.usuario()?.fuso));
  if (!todo) return SEM_VEICULO;
  return cascataSobre(todo, { ...entrada, escopo: await escopoLocal(ctx, entrada) });
});

/**
 * A lista do Catálogo com veículo (RN-CAT-22), sobre as linhas locais: a vitrine ou a busca por texto restrita aos produtos que citam o
 * modelo, depois o `filtrarPorVeiculo` (RN-CAT-22, D4). Até o teto de 400, como a busca; a tela pagina nela.
 */
export async function listaComVeiculo(
  leitor: LeitorLocal,
  e: EntradaLocal & { chips?: ChipsVitrine; q: string; veiculo: VeiculoEscolhido; offline: boolean },
): Promise<{ items: ItemVitrine[]; total: number; indexando: boolean }> {
  const indice = await indiceVeiculosLocal(leitor, anoCivilNoFuso(new Date(e.agora), e.fuso));
  const doModelo = produtosDoModelo(indice, e.veiculo);
  const antes = e.chips?.only_product_ids;
  const ids = antes ? new Set([...doModelo].filter((id) => antes.has(id))) : doModelo;
  const chips: ChipsVitrine = { ...e.chips, only_product_ids: ids };
  const pagina = { limit: TETO_RANKING_BUSCA, offset: 0 };
  const r = e.q ? await buscarLocal(leitor, { ...e, ...pagina, chips }) : await vitrineLocal(leitor, { ...e, ...pagina, chips });
  // o filtro só usa o `produto_id` (RN-CAT-22): não lê a aplicação
  const filtrada = filtrarPorVeiculo(r.items.map((i) => ({ ...i, produto_id: i.id })), indice, e.veiculo);
  return { items: filtrada.map(({ produto_id: _p, ...item }) => item as ItemVitrine), total: filtrada.length, indexando: 'indexando' in r && r.indexando === true };
}
