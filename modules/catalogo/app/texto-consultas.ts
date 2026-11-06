/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` no aparelho (T-0084 C8/C9; RN-CAT-09, RN-CAT-12).
 * Mesmo núcleo puro da API (`domain/busca-consulta.ts`), sobre as linhas locais; funcionam sem sinal.
 *
 * LIMITE DO SDK (recado ao engenheiro-software, T-0084): o contexto da consulta no aparelho só lê entidades do PRÓPRIO módulo.
 * `produto` é do Core e `concorrente` (marca da referência) é do Promotor. Enquanto o SDK não liberar a leitura das entidades
 * de módulos em `depende`, `textos_produto` devolve a aplicação com as referências pelo retrato `marca_nome` e `busca_produtos` lança
 * `ConsultaIndisponivel` (o Vendedor cai no plano B do seletor, como no desenho §7).
 */
import { ConsultaIndisponivel, implementarConsultaAparelho, type ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import { criarRelogio } from '@macuxi/comum/relogio';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO, type ProdutoAtributoSync, type ProdutoConteudoSync, type ProdutoReferenciaSync, type Referencia, type SinonimoSync } from '../contracts';
import { nomeMarcaDaReferencia } from '../domain/marcas';
import { buscarParaConsulta, textosParaConsulta } from '../domain/busca-consulta';
import { parametrosDoTenant } from '../domain/parametros';
import type { ProdutoCatalogo } from '../domain/vitrine';

const vivas = <L extends { deleted_at: string | null }>(l: L[]) => l.filter((x) => !x.deleted_at);
const anoAtual = () => Number(criarRelogio().iso().slice(0, 4));

/**
 * Leituras opcionais do motor de sync (T-0052-B4, ver `lib/local.ts`): ainda fora do `ContextoConsultaAparelho`; se o SDK
 * passar a entregá-las, a aplicação é lida só dos itens pedidos e o mapa fica memorizado pela versão das linhas (T-0085,
 * revisão R-20261106-000506 🟡 1). Sem elas, lê o `produto_conteudo` inteiro, como antes (correto, só mais lento).
 */
interface LeiturasOpcionais {
  linhasPorCampo?<L extends { id: string }>(entidade: string, campo: string, valores: readonly string[]): Promise<L[]>;
  versaoLinhas?(entidade: string): number;
}

const memoriaAplicacao = new Map<string, { versao: number; mapa: Map<string, string> }>();
/** Só para testes: esquece o mapa memorizado. */
export const esquecerMemoriaTextos = () => memoriaAplicacao.clear();

/** produto_id → aplicação, dos ids pedidos. */
export async function aplicacoesDosProdutos(ctx: ContextoConsultaAparelho, ids: readonly string[]): Promise<Map<string, string>> {
  const { linhasPorCampo, versaoLinhas } = ctx as ContextoConsultaAparelho & LeiturasOpcionais;
  const doConteudo = (conteudos: ProdutoConteudoSync[]) => new Map(vivas(conteudos).filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!]));
  if (linhasPorCampo) return doConteudo((await linhasPorCampo.call(ctx, 'produto_conteudo', 'produto_id', ids)) as ProdutoConteudoSync[]);
  if (versaoLinhas) {
    // a versão é lida ANTES das linhas: se o sync gravar durante a leitura, a próxima consulta relê
    const versao = versaoLinhas.call(ctx, 'produto_conteudo');
    const guardado = memoriaAplicacao.get('aplicacao');
    if (guardado && guardado.versao === versao) return guardado.mapa;
    const mapa = doConteudo(await ctx.linhas<ProdutoConteudoSync>('produto_conteudo'));
    memoriaAplicacao.set('aplicacao', { versao, mapa });
    return mapa;
  }
  return doConteudo(await ctx.linhas<ProdutoConteudoSync>('produto_conteudo'));
}

/**
 * Referências cruzadas pelo retrato `marca_nome` (0034): a consulta não lê o cadastro do Promotor (limite do SDK acima), então é
 * o caso "cadastro indisponível" da RN-CAT-09. Sem retrato, a marca daquela referência não aparece (sem quebrar).
 */
export async function referenciasDoRetrato(ctx: ContextoConsultaAparelho, ids?: ReadonlySet<string>): Promise<Map<string, Referencia[]>> {
  const saida = new Map<string, Referencia[]>();
  let linhas: (ProdutoReferenciaSync & { deleted_at: string | null })[];
  try {
    linhas = vivas(await ctx.linhas<ProdutoReferenciaSync & { deleted_at: string | null }>('produto_referencia'));
  } catch {
    return saida;
  }
  for (const x of linhas.sort((a, b) => a.ordem - b.ordem)) {
    if (ids && !ids.has(x.produto_id)) continue;
    const nome = nomeMarcaDaReferencia(x.marca_id, x.marca_nome, new Map());
    if (nome === null) continue;
    saida.set(x.produto_id, [...(saida.get(x.produto_id) ?? []), { marca_id: x.marca_id, marca_nome: nome, codigo: x.codigo }]);
  }
  return saida;
}

export const consultaTextosProdutoAparelho = implementarConsultaAparelho(CONSULTA_TEXTOS_PRODUTO, async (entrada, ctx) => {
  const aplicacao = await aplicacoesDosProdutos(ctx, entrada.produto_ids);
  const referencias = await referenciasDoRetrato(ctx, new Set(entrada.produto_ids));
  const produtos = entrada.produto_ids.map((id): ProdutoCatalogo => ({
    id,
    sku: '',
    ean: null,
    nome: '',
    marca: '',
    categoria: '',
    unidade: '',
    ativo: true,
    atributos: [],
    aplicacao: aplicacao.get(id) ?? '',
    referencias: referencias.get(id) ?? [],
    thumbnail_url: null,
    campanha: false,
    vendas: 0,
  }));
  return { itens: textosParaConsulta(produtos, entrada.produto_ids) };
});

export const consultaBuscaProdutosAparelho = implementarConsultaAparelho(CONSULTA_BUSCA_PRODUTOS, async (entrada, ctx) => {
  let produtosCore: ProdutoSync[];
  try {
    produtosCore = vivas(await ctx.linhas<ProdutoSync>('produto'));
  } catch {
    throw new ConsultaIndisponivel(CONSULTA_BUSCA_PRODUTOS.nome, 'catalogo', 'A busca do catálogo não está disponível neste aparelho agora. Use a busca simples do pedido.');
  }
  const atributos = new Map<string, { name: string; value: string }[]>();
  for (const a of vivas(await ctx.linhas<ProdutoAtributoSync>('produto_atributo'))) atributos.set(a.produto_id, [...(atributos.get(a.produto_id) ?? []), { name: a.nome, value: a.valor }]);
  const conteudos = vivas(await ctx.linhas<ProdutoConteudoSync>('produto_conteudo'));
  const aplicacao = new Map(conteudos.filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!]));
  const campanha = new Set(conteudos.filter((c) => c.campanha).map((c) => c.produto_id));
  const referencias = await referenciasDoRetrato(ctx);
  const produtos = produtosCore.map((p): ProdutoCatalogo => ({
    id: p.id,
    sku: p.sku,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca ?? '',
    categoria: p.categoria ?? '',
    unidade: p.unidade,
    ativo: p.ativo,
    atributos: atributos.get(p.id) ?? [],
    aplicacao: aplicacao.get(p.id) ?? '',
    referencias: referencias.get(p.id) ?? [],
    thumbnail_url: null,
    campanha: campanha.has(p.id),
    vendas: 0,
  }));
  const sinonimos = vivas(await ctx.linhas<SinonimoSync>('sinonimo')).map((s) => ({ term: s.termo, synonyms: s.sinonimos, active: s.ativo }));
  const itens = buscarParaConsulta({
    produtos,
    q: entrada.q,
    produtoIds: entrada.produto_ids,
    limite: entrada.limite,
    sinonimos,
    parametros: parametrosDoTenant(ctx.parametros()),
    anoAtual: anoAtual(),
  });
  return { itens };
});
