/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` na API (T-0084 C8/C9; RN-CAT-09, RN-CAT-12). Só SQL em
 * `catalogo.*`, na transação de quem consulta (RLS do tenant); a decisão é do mesmo núcleo puro do aparelho.
 *
 * Premissas (recado ao engenheiro-software): o contexto da consulta na API não traz `tx.consultar`, então o cadastro do Core
 * (nome, marca) vem da cópia de leitura `catalogo.produto_busca` (T-0052), e o nome da marca concorrente não está ao alcance
 * (vem do Promotor): `referencias` e `equivale_a` saem vazios até o SDK dar `consultar` ao contexto. Enquanto nada preencher
 * `produto_busca`, `busca_produtos` devolve lista vazia.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO } from '../contracts';
import { buscarParaConsulta, textosParaConsulta } from '../domain/busca-consulta';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { parametrosDoTenant } from '../domain/parametros';
import type { ProdutoCatalogo } from '../domain/vitrine';

interface LinhaBusca {
  produto_id: string;
  sku: string | null;
  ean: string | null;
  nome: string;
  marca: string | null;
  categoria: string | null;
  atributos: string | null;
  aplicacao: string | null;
  ativo: boolean;
}

export const consultaTextosProduto = implementarConsulta(CONSULTA_TEXTOS_PRODUTO, async (entrada, ctx) => {
  const r = await ctx.db.query(`select produto_id, aplicacoes as aplicacao from catalogo.produto_conteudo where produto_id = any($1::uuid[]) and deleted_at is null`, [entrada.produto_ids]);
  const aplicacao = new Map((r.rows as Array<{ produto_id: string; aplicacao: string | null }>).map((x) => [x.produto_id, x.aplicacao ?? '']));
  const produtos = entrada.produto_ids.map((id): ProdutoCatalogo => ({ id, sku: '', ean: null, nome: '', marca: '', categoria: '', unidade: '', ativo: true, atributos: [], aplicacao: aplicacao.get(id) ?? '', referencias: [], thumbnail_url: null, campanha: false, vendas: 0 }));
  return { itens: textosParaConsulta(produtos, entrada.produto_ids) };
});

export const consultaBuscaProdutos = implementarConsulta(CONSULTA_BUSCA_PRODUTOS, async (entrada, ctx) => {
  const r = await ctx.db.query(
    `select produto_id, sku, ean, nome, marca, categoria, atributos, aplicacao, ativo
       from catalogo.produto_busca
      where deleted_at is null and ativo ${entrada.produto_ids ? 'and produto_id = any($1::uuid[])' : ''}`,
    entrada.produto_ids ? [entrada.produto_ids] : [],
  );
  const s = await ctx.db.query(`select termo, sinonimos, ativo from catalogo.sinonimo where deleted_at is null`);
  const produtos = (r.rows as unknown as LinhaBusca[]).map((x): ProdutoCatalogo => ({
    id: x.produto_id,
    sku: x.sku ?? '',
    ean: x.ean,
    nome: x.nome,
    marca: x.marca ?? '',
    categoria: x.categoria ?? '',
    unidade: '',
    ativo: x.ativo,
    atributos: x.atributos ? [{ name: '', value: x.atributos }] : [],
    aplicacao: x.aplicacao ?? '',
    referencias: [],
    thumbnail_url: null,
    campanha: false,
    vendas: 0,
  }));
  const sinonimos = (s.rows as Array<{ termo: string; sinonimos: string[]; ativo: boolean }>).map((x) => ({ term: x.termo, synonyms: x.sinonimos, active: x.ativo }));
  return {
    itens: buscarParaConsulta({
      produtos,
      q: entrada.q,
      produtoIds: entrada.produto_ids,
      limite: entrada.limite,
      sinonimos,
      parametros: parametrosDoTenant(ctx.parametros()),
      anoAtual: anoCivilNoFuso(ctx.agora(), ctx.fuso?.()),
    }),
  };
});
