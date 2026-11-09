/**
 * Consultas `catalogo.textos_produto@1` e `catalogo.busca_produtos@1` na API (T-0084 C8/C9; RN-CAT-09, RN-CAT-12). Só SQL em
 * `catalogo.*`, na transação de quem consulta (RLS do tenant); a decisão é do mesmo núcleo puro do aparelho.
 *
 * Premissas (recado ao engenheiro-software): o contexto da consulta na API não traz `tx.consultar`, então o cadastro do Core
 * (nome, marca) vem da cópia de leitura `catalogo.produto_busca` (T-0052). As referências cruzadas (código e marca do concorrente,
 * RN-CAT-09) vêm de `catalogo.produto_referencia` e o nome da marca do cadastro `catalogo.marca_concorrente` (ADR 0034), com o
 * retrato `marca_nome` quando a marca sumiu do cadastro: a API acha pelo código do concorrente como o aparelho e a vitrine (T-0119,
 * R-20261108-182924). Enquanto nada preencher `produto_busca`, `busca_produtos` devolve lista vazia.
 *
 * Fora de rota quente: nenhum código do servidor chama esta consulta (o seletor do Novo pedido usa a do aparelho). Quem ligar no
 * servidor precisa antes do índice e do cache da T-0119 (`indice-busca.ts` e o retrato do repositório): esta versão lê e ranqueia o
 * catálogo inteiro a cada chamada. A guarda disso está em tests/modulos/defeitos-corretor-r173739.test.ts (D3).
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO } from '../contracts';
import { buscarParaConsulta, textosParaConsulta } from '../domain/busca-consulta';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { nomeMarcaDaReferencia } from '../domain/marcas';
import { parametrosDoTenant } from '../domain/parametros';
import type { ProdutoCatalogo } from '../domain/vitrine';
import type { Referencia } from '../contracts';

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

/** RN-CAT-09: referências cruzadas por produto, na ordem do cadastro; marca ausente ou inativa no cadastro esconde a referência. */
async function referenciasDosProdutos(db: { query: (sql: string, valores?: unknown[]) => Promise<{ rows: unknown[] }> }, produtoIds: readonly string[] | undefined): Promise<Map<string, Referencia[]>> {
  const filtro = produtoIds ? 'and produto_id = any($1::uuid[])' : '';
  const r = await db.query(
    `select produto_id, marca_id, codigo, marca_nome from catalogo.produto_referencia where deleted_at is null ${filtro} order by ordem`,
    produtoIds ? [produtoIds] : [],
  );
  const m = await db.query('select id, nome, ativo from catalogo.marca_concorrente where deleted_at is null');
  const marcas = new Map((m.rows as Array<{ id: string; nome: string; ativo: boolean }>).map((x) => [x.id, { nome: x.nome, ativo: x.ativo }]));
  const saida = new Map<string, Referencia[]>();
  for (const x of r.rows as Array<{ produto_id: string; marca_id: string; codigo: string; marca_nome: string | null }>) {
    const nome = nomeMarcaDaReferencia(x.marca_id, x.marca_nome, marcas);
    if (nome === null) continue;
    saida.set(x.produto_id, [...(saida.get(x.produto_id) ?? []), { marca_id: x.marca_id, marca_nome: nome, codigo: x.codigo }]);
  }
  return saida;
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
  const referencias = await referenciasDosProdutos(ctx.db, entrada.produto_ids);
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
    referencias: referencias.get(x.produto_id) ?? [],
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
