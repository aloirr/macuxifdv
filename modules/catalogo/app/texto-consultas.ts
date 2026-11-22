/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` no aparelho (T-0084 C8/C9; RN-CAT-09, RN-CAT-12).
 * Mesmo núcleo puro da API (`domain/busca-consulta.ts`), sobre as linhas locais; funcionam sem sinal.
 *
 * O contexto da consulta lê as entidades do Catálogo e as dos módulos em `depende` (o `produto` do Core). NÃO lê o Promotor
 * (nem a `concorrente` nem a `marca_concorrente`): o "Equivale a" usa o `marca_nome` da referência (retrato, `nomeMarcaDaReferencia`).
 * A montagem dos produtos é a da aba Catálogo (`lib/local.ts`), sem a leitura do concorrente.
 */
import { implementarConsultaAparelho, type ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO, textoDaBuscaComVeiculo, type ProdutoConteudoSync, type ProdutoReferenciaSync, type Referencia } from '../contracts';
import { interpretarConsulta } from '../domain/consulta';
import { nomeMarcaDaReferencia } from '../domain/marcas';
import { buscaPodeRodar, buscarComTotal, sugerirTermo, TETO_RANKING_BUSCA, textosParaConsulta } from '../domain/busca-consulta';
import { normalizarTexto } from '../domain/texto';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { parametrosDoTenant } from '../domain/parametros';
import { veiculosDe } from '../domain/veiculos';
import { produtosDoModelo } from '../domain/veiculo-filtro';
import { soVendaveisDoCliente } from './escopo-cliente';
import { indiceVeiculosLocal, lembrarVeiculo } from './veiculos-consulta';
import type { ProdutoCatalogo } from '../domain/vitrine';
import { cargaOnlineDoShell, consultaIndisponivel } from './lib/carga-online';
import { buscaProdutosOnline, portaDaCarga, textosProdutoOnline } from './lib/consultas-online';
import { comAplicacao, preselecionar, produtosLocais, sinonimosLocais, vocabularioMemorizado, type LeitorLocal } from './lib/local';

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
 * Referências cruzadas pelo retrato `marca_nome` (0034): a consulta não lê o cadastro de marcas (limite do SDK acima), então é
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
  // ADR 0054: catálogo ainda carregando = API; depois da carga, aparelho
  const online = portaDaCarga('catalogo.textos_produto@1', cargaOnlineDoShell());
  if (online) return textosProdutoOnline(online, entrada);
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

/** Vocabulário do catálogo (termo normalizado → ocorrências) para o "Você quis dizer…"; uma vez por catálogo montado. */
const vocabulariosDeTermos = new WeakMap<readonly ProdutoCatalogo[], Map<string, number>>();
function termosDoCatalogo(produtos: readonly ProdutoCatalogo[]): Map<string, number> {
  let m = vocabulariosDeTermos.get(produtos);
  if (!m) {
    m = new Map();
    for (const p of produtos) for (const t of normalizarTexto(`${p.nome} ${p.marca} ${p.categoria}`).split(' ')) if (t.length >= 3) m.set(t, (m.get(t) ?? 0) + 1);
    vocabulariosDeTermos.set(produtos, m);
  }
  return m;
}

/** RF-CAT-01 (T-0167): "Você quis dizer…" da busca da aba, do vocabulário do catálogo no aparelho; null sem termo parecido. */
export async function sugestaoDaBuscaLocal(leitor: LeitorLocal, q: string): Promise<string | null> {
  if (!buscaPodeRodar(q)) return null;
  return sugerirTermo(q, termosDoCatalogo(await produtosLocais(leitor, { lerConcorrente: false })));
}

export const consultaBuscaProdutosAparelho = implementarConsultaAparelho(CONSULTA_BUSCA_PRODUTOS, async (entrada, ctx) => {
  const q = textoDaBuscaComVeiculo(entrada.q, entrada.veiculo);
  // RF-CAT-01 (T-0167): abaixo de 3 caracteres a consulta não roda
  if (!entrada.veiculo && !buscaPodeRodar(q)) return { itens: [], total: 0, sugestao: null };
  // ADR 0054: catálogo ainda carregando = API (com o preço do cliente); depois da carga, aparelho. O veículo só existe no aparelho (spec §9)
  const online = portaDaCarga('catalogo.busca_produtos@1', cargaOnlineDoShell());
  if (online && entrada.veiculo) throw consultaIndisponivel('catalogo.busca_produtos@1');
  if (online) return buscaProdutosOnline(online, entrada);
  // dependência inativa lança ConsultaIndisponivel (o Vendedor cai no plano B do seletor); Error de programação sobe
  const leitor: LeitorLocal = ctx;
  const todos = await produtosLocais(leitor, { lerConcorrente: false });
  const sinonimos = await sinonimosLocais(leitor);
  const anoAtual = anoCivilNoFuso(ctx.agora(), ctx.usuario()?.fuso);
  const indiceVeiculos = entrada.veiculo ? await indiceVeiculosLocal(leitor, anoAtual) : undefined;
  if (entrada.veiculo) lembrarVeiculo(entrada.veiculo);
  // mesma pré-seleção da aba (FTS5, ≤ 400 candidatos); sem SQLite (`sem_busca`) ou catálogo pequeno = varredura, sem erro
  const vocabulario = vocabularioMemorizado(todos);
  const filtros = interpretarConsulta(q, vocabulario);
  const veiculos = veiculosDe(todos);
  const doVeiculo = entrada.veiculo && indiceVeiculos && q === '' ? produtosDoModelo(indiceVeiculos, entrada.veiculo) : null;
  const candidatos = entrada.produto_ids || doVeiculo ? null : await preselecionar(leitor, filtros.text, filtros.code?.value ?? null, sinonimos, todos.length, undefined, veiculos);
  const idsPedidos = entrada.produto_ids ? new Set(entrada.produto_ids) : null;
  let base = candidatos ? todos.filter((p) => candidatos.has(p.id)) : idsPedidos ? todos.filter((p) => idsPedidos.has(p.id)) : doVeiculo ? todos.filter((p) => doVeiculo.has(p.id)) : todos;
  // o filtro do que o cliente pode comprar corre sobre os candidatos (preço lido só deles), não sobre os 20 mil
  if (entrada.cliente_id && !idsPedidos) base = await soVendaveisDoCliente(ctx, entrada.cliente_id, base);
  const produtos = await comAplicacao(leitor, base);
  const { itens, total } = buscarComTotal({
    produtos,
    q,
    produtoIds: entrada.produto_ids,
    limite: entrada.lista_completa ? TETO_RANKING_BUSCA : entrada.limite,
    sinonimos,
    vocabulario,
    veiculos,
    parametros: parametrosDoTenant(ctx.parametros()),
    anoAtual,
    ...(entrada.veiculo && indiceVeiculos ? { veiculo: entrada.veiculo, indiceVeiculos } : {}),
  });
  return { itens, total, sugestao: total === 0 && q !== '' ? sugerirTermo(q, termosDoCatalogo(todos)) : null };
});
