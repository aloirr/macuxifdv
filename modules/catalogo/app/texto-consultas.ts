/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` no aparelho (T-0084 C8/C9; RN-CAT-09, RN-CAT-12).
 * Mesmo núcleo puro da API (`domain/busca-consulta.ts`), sobre as linhas locais; funcionam sem sinal.
 *
 * LIMITE DO SDK (recado ao engenheiro-software, T-0084): o contexto da consulta no aparelho só lê entidades do PRÓPRIO módulo.
 * `produto` é do Core e `concorrente` (marca da referência) é do Promotor. Enquanto o SDK não liberar a leitura das entidades
 * de módulos em `depende`, `textos_produto` devolve a aplicação com `referencias: []` e `busca_produtos` lança
 * `ConsultaIndisponivel` (o Vendedor cai no plano B do seletor, como no desenho §7).
 */
import { ConsultaIndisponivel, implementarConsultaAparelho } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import { criarRelogio } from '@macuxi/comum/relogio';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO, type ProdutoAtributoSync, type ProdutoConteudoSync, type SinonimoSync } from '../contracts';
import { buscarParaConsulta, textosParaConsulta } from '../domain/busca-consulta';
import { parametrosDoTenant } from '../domain/parametros';
import type { ProdutoCatalogo } from '../domain/vitrine';

const vivas = <L extends { deleted_at: string | null }>(l: L[]) => l.filter((x) => !x.deleted_at);
const anoAtual = () => Number(criarRelogio().iso().slice(0, 4));

export const consultaTextosProdutoAparelho = implementarConsultaAparelho(CONSULTA_TEXTOS_PRODUTO, async (entrada, ctx) => {
  const conteudos = vivas(await ctx.linhas<ProdutoConteudoSync>('produto_conteudo'));
  const aplicacao = new Map(conteudos.filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!]));
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
    referencias: [],
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
    referencias: [],
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
