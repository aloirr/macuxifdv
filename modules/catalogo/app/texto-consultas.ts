/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` no aparelho (T-0084 C8/C9; RN-CAT-09, RN-CAT-12).
 * Mesmo núcleo puro da API (`domain/busca-consulta.ts`), sobre as linhas locais; funcionam sem sinal.
 *
 * O contexto da consulta lê as entidades do Catálogo e as dos módulos em `depende` (o `produto` do Core). NÃO lê o Promotor
 * (`concorrente` lançaria Error): o "Equivale a" usa o `marca_nome` da referência (retrato, `nomeMarcaDaReferencia`).
 * A montagem dos produtos é a da aba Catálogo (`lib/local.ts`), sem a leitura do concorrente.
 */
import { implementarConsultaAparelho, type ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO, type ProdutoConteudoSync, type ProdutoReferenciaSync, type Referencia } from '../contracts';
import { nomeMarcaDaReferencia } from '../domain/marcas';
import { buscarParaConsulta, textosParaConsulta } from '../domain/busca-consulta';
import { parametrosDoTenant } from '../domain/parametros';
import type { ProdutoCatalogo } from '../domain/vitrine';
import { produtosLocais, sinonimosLocais, type LeitorLocal } from './lib/local';

const vivas = <L extends { deleted_at: string | null }>(l: L[]) => l.filter((x) => !x.deleted_at);

/** Memória por versão das linhas de `produto_conteudo` (única no processo): ids já lidos e a aplicação deles. */
const memoriaAplicacao = new Map<string, { versao: number; lidos: Set<string>; mapa: Map<string, string> }>();
/** Só para testes: esquece o mapa memorizado. */
export const esquecerMemoriaTextos = () => memoriaAplicacao.clear();

/** produto_id → aplicação, dos ids pedidos: lê só os pedidos ainda não lidos nesta versão das linhas (RN-CAT-11). */
export async function aplicacoesDosProdutos(ctx: ContextoConsultaAparelho, ids: readonly string[]): Promise<Map<string, string>> {
  const porCampo = typeof ctx.linhasPorCampo === 'function';
  const ler = async (pedidos: readonly string[]) =>
    porCampo
      ? ((await ctx.linhasPorCampo('produto_conteudo', 'produto_id', pedidos)) as ProdutoConteudoSync[])
      : await ctx.linhas<ProdutoConteudoSync>('produto_conteudo');
  const doConteudo = (conteudos: ProdutoConteudoSync[]) => vivas(conteudos).filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!] as const);
  if (typeof ctx.versaoLinhas !== 'function') return new Map(doConteudo(await ler(ids)));
  // a versão é lida ANTES das linhas: se o sync gravar durante a leitura, a próxima consulta relê
  const versao = ctx.versaoLinhas('produto_conteudo');
  let m = memoriaAplicacao.get('aplicacao');
  if (!m || m.versao !== versao) {
    m = { versao, lidos: new Set(), mapa: new Map() };
    memoriaAplicacao.set('aplicacao', m);
  }
  const faltam = ids.filter((id) => !m.lidos.has(id));
  if (faltam.length > 0) {
    for (const [id, ap] of doConteudo(await ler(faltam))) m.mapa.set(id, ap);
    for (const id of faltam) m.lidos.add(id);
  }
  return m.mapa;
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
  // dependência inativa lança ConsultaIndisponivel (o Vendedor cai no plano B do seletor); Error de programação sobe
  const leitor = ctx as unknown as LeitorLocal;
  const produtos = await produtosLocais(leitor, { lerConcorrente: false });
  const sinonimos = await sinonimosLocais(leitor);
  const itens = buscarParaConsulta({
    produtos,
    q: entrada.q,
    produtoIds: entrada.produto_ids,
    limite: entrada.limite,
    sinonimos,
    parametros: parametrosDoTenant(ctx.parametros()),
    anoAtual: Number(ctx.agora().toISOString().slice(0, 4)),
  });
  return { itens };
});
