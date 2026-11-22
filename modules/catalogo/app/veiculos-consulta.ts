/**
 * `catalogo.veiculos@1` no aparelho (RN-CAT-22; desenho `docs/desenho/filtro-veiculo.md` §2 e §4): a cascata de veículo lida das
 * aplicações das linhas locais, com o mesmo domain da API, e os Recentes em memória (até 3; somem ao fechar o app e na troca de usuário).
 * O índice é montado uma vez por lista de produtos montada (muda com o sync) e por ano civil no fuso do tenant.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_VEICULOS, type ProdutoConteudoSync, type VeiculoEscolhido, type ItemVitrine, type VeiculoParcial, type VeiculoRecente, type VeiculosSaida } from '../contracts';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { apelidosDeMontadora, construirIndiceVeiculos, definirIndiceVeiculos, indiceTemVeiculo, indiceVeiculosDe, restringirIndice, type IndiceVeiculos } from '../domain/veiculo-indice';
import { filtrarPorVeiculo, navegarCascata, produtosDoModelo, rotulosDoVeiculo } from '../domain/veiculo-filtro';
import { TETO_RANKING_BUSCA } from '../domain/busca-consulta';
import type { ChipsVitrine } from '../domain/vitrine';
import { veiculosDe } from '../domain/veiculos';
import { cargaOnlineDoShell } from './lib/carga-online';
import { portaDaCarga } from './lib/consultas-online';
import { escopoLocal } from './escopo-cliente';
import { buscarLocal, comAplicacao, produtosLocais, vitrineLocal, type EntradaLocal, type LeitorLocal } from './lib/local';

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

/** O índice dos produtos ativos do aparelho (guardado enquanto a lista de produtos e o ano civil forem os mesmos). */
export async function indiceVeiculosLocal(leitor: LeitorLocal, anoAtual: number): Promise<IndiceVeiculos> {
  const produtos = await produtosLocais(leitor, { lerConcorrente: false });
  const guardado = indiceVeiculosDe(produtos, anoAtual);
  if (guardado) return guardado;
  const aplicacoes = new Map<string, string>();
  for (const c of await leitor.linhas<ProdutoConteudoSync & { deleted_at: string | null }>('produto_conteudo')) if (!c.deleted_at && c.aplicacao) aplicacoes.set(c.produto_id, c.aplicacao);
  const indice = construirIndiceVeiculos(
    produtos.filter((p) => p.ativo).map((p) => ({ id: p.id, aplicacao: aplicacoes.get(p.id) ?? p.aplicacao })),
    { anoAtual, veiculos: veiculosDe(produtos) },
  );
  definirIndiceVeiculos(produtos, indice);
  return indice;
}

const SEM_VEICULO: VeiculosSaida = { disponivel: false, trilha: [], nivel: null, opcoes: [], ultimo: false, escolha: {}, rotulos: null, busca: null, recentes: [] };

/**
 * A cascata sobre as linhas locais (a consulta e a folha do Catálogo usam a mesma). `escopo` (RN-CAT-22): só os produtos dele contam
 * para as opções, a busca e `disponivel`; os Recentes não são filtrados.
 */
export async function cascataLocal(leitor: LeitorLocal, entrada: { escolha?: VeiculoParcial | undefined; busca?: string | undefined; escopo?: ReadonlySet<string> | null | undefined }, anoAtual: number): Promise<VeiculosSaida> {
  const todo = await indiceVeiculosLocal(leitor, anoAtual);
  const indice = entrada.escopo ? restringirIndice(todo, entrada.escopo) : todo;
  if (!indiceTemVeiculo(indice)) return SEM_VEICULO;
  return { disponivel: true, ...navegarCascata(indice, entrada.escolha ?? {}, entrada.busca, apelidosDeMontadora()), recentes: recentesDeVeiculos() };
}

export const consultaVeiculosAparelho = implementarConsultaAparelho(CONSULTA_VEICULOS, async (entrada, ctx): Promise<VeiculosSaida> => {
  // catálogo ainda carregando (ADR 0054), com ou sem sinal: o botão Veículo só aparece com o catálogo no aparelho (spec §9)
  try {
    if (portaDaCarga('catalogo.veiculos@1', cargaOnlineDoShell())) return SEM_VEICULO;
  } catch {
    return SEM_VEICULO;
  }
  const escopo = await escopoLocal(ctx, entrada);
  return cascataLocal(ctx, { ...entrada, escopo }, anoCivilNoFuso(ctx.agora(), ctx.usuario()?.fuso));
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
  const naLista = new Set(r.items.map((i) => i.id));
  const produtos = await comAplicacao(leitor, (await produtosLocais(leitor)).filter((p) => naLista.has(p.id)));
  const aplicacao = new Map(produtos.map((p) => [p.id, p.aplicacao ?? null]));
  const filtrada = filtrarPorVeiculo(r.items.map((i) => ({ ...i, produto_id: i.id, aplicacao: aplicacao.get(i.id) ?? null })), indice, e.veiculo);
  return { items: filtrada.map(({ produto_id: _p, aplicacao: _a, ...item }) => item as ItemVitrine), total: filtrada.length, indexando: 'indexando' in r && r.indexando === true };
}
