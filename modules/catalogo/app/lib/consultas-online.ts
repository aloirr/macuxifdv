/**
 * As três consultas do Catálogo respondidas pela API enquanto o catálogo carrega (ADR 0054, solução 5). A API traz o preço do
 * cliente e revalida perfil e RN-CAT-05 (perfil sem preço recebe `price` nulo); aqui só se converte para o contrato da consulta.
 */
import { caminhoCatalogo, type BuscaProdutosEntrada, type BuscaProdutosSaida, type ItemVitrine, type PrecosClienteEntrada, type PrecosClienteSaida, type TextosProdutoEntrada, type TextosProdutoSaida } from '../../contracts';
import { TETO_RANKING_BUSCA } from '../../domain/busca-consulta';
import { consultaIndisponivel, fichasDaApi, paginasDaApi, soVendaveisNaCarga, usarApiNaCarga, type PortaCargaOnline } from './carga-online';

/** `null` = responder no aparelho (como hoje); `sem_sinal` já vira `ConsultaIndisponivel` com o texto de carregando. */
export function portaDaCarga(consulta: string, p: PortaCargaOnline | null): PortaCargaOnline | null {
  const modo = usarApiNaCarga(p);
  if (modo === 'local') return null;
  if (modo === 'sem_sinal') throw consultaIndisponivel(consulta);
  return p;
}


export async function buscaProdutosOnline(p: PortaCargaOnline, e: BuscaProdutosEntrada): Promise<BuscaProdutosSaida> {
  const limite = e.lista_completa ? TETO_RANKING_BUSCA : e.limite;
  let items: ItemVitrine[];
  let total: number;
  try {
    // com restrição por ids a API não filtra: busca o teto e recorta aqui
    const pedido = e.produto_ids ? TETO_RANKING_BUSCA : limite;
    const r = await paginasDaApi<ItemVitrine>(p.get, caminhoCatalogo('busca'), { q: e.q, ...(e.cliente_id ? { customer_id: e.cliente_id } : {}) }, pedido);
    items = r.items;
    total = r.total;
  } catch {
    throw consultaIndisponivel('catalogo.busca_produtos@1');
  }
  let filtrou = false;
  if (e.cliente_id && !e.produto_ids) {
    const antes = items.length;
    items = soVendaveisNaCarga(items); // RN-CAT-06
    filtrou = items.length !== antes;
  }
  if (e.produto_ids) {
    const ids = new Set(e.produto_ids);
    items = items.filter((i) => ids.has(i.id));
    filtrou = true;
  }
  return {
    itens: items.slice(0, limite).map((i) => ({ produto_id: i.id, nota: i.score ?? 0, so_aplicacao: false, serve_em: i.serve_em ?? null, equivale_a: i.equivale_a ?? null })),
    total: Math.min(TETO_RANKING_BUSCA, filtrou ? items.length : total),
    sugestao: null,
  };
}

export async function precosClienteOnline(p: PortaCargaOnline, e: PrecosClienteEntrada): Promise<PrecosClienteSaida> {
  const ids = [...new Set(e.produto_ids)];
  const fichas = await fichasDaApi(p.get, ids, e.cliente_id);
  let tabela: string | null = null;
  const itens = fichas.map((f, i) => {
    const preco = f.product.price; // nulo = perfil sem direito a preço (RN-CAT-05)
    tabela ??= preco?.price_table_id ?? null;
    return {
      produto_id: ids[i]!,
      preco_cents: preco?.price_cents ?? null,
      motivo_sem_preco: preco && preco.price_cents === null ? (preco.notice ?? 'Sem preço para este cliente.') : null,
    };
  });
  return { tabela_preco_id: tabela, itens };
}

export async function textosProdutoOnline(p: PortaCargaOnline, e: TextosProdutoEntrada): Promise<TextosProdutoSaida> {
  const fichas = await fichasDaApi(p.get, e.produto_ids, null);
  return { itens: fichas.map((f, i) => ({ produto_id: e.produto_ids[i]!, aplicacao: f.catalogo?.aplicacao ?? null, referencias: f.catalogo?.referencias ?? [] })) };
}
