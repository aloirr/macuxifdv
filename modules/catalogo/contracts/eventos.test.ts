import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import * as contracts from './index';
import { MarcaConcorrenteDesconhecidaSchema, BuscaRealizadaSchema, EVENTO_BUSCA_REALIZADA, EVENTO_PRODUTO_VISUALIZADO, ProdutoVisualizadoSchema } from './index';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const AGORA = '2026-11-05T12:00:00.000Z';

describe('T-0024: definições dos eventos catalogo.* no contracts', () => {
  it('RF-CAT-07: todo evento publicado no manifest tem definição exportada e nenhuma é de evento alheio', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
  });

  it('RF-CAT-01: catalogo.produto.visualizado@1 aceita produto, usuário, instante e origem opcional', () => {
    expect(EVENTO_PRODUTO_VISUALIZADO.nome).toBe('catalogo.produto.visualizado@1');
    expect(ProdutoVisualizadoSchema.safeParse({ produto_id: U1, usuario_id: U2, ocorrido_em: AGORA }).success).toBe(true);
    expect(ProdutoVisualizadoSchema.safeParse({ produto_id: U1, usuario_id: U2, origem: 'busca', ocorrido_em: AGORA }).success).toBe(true);
  });

  it('RF-CAT-01: catalogo.produto.visualizado@1 rejeita id inválido, origem desconhecida e chave a mais (saída strict)', () => {
    expect(ProdutoVisualizadoSchema.safeParse({ produto_id: 'x', usuario_id: U2, ocorrido_em: AGORA }).success).toBe(false);
    expect(ProdutoVisualizadoSchema.safeParse({ produto_id: U1, usuario_id: U2, origem: 'outra', ocorrido_em: AGORA }).success).toBe(false);
    expect(ProdutoVisualizadoSchema.safeParse({ produto_id: U1, usuario_id: U2, ocorrido_em: AGORA, nome: 'x' }).success).toBe(false);
  });

  it('RF-CAT-07: catalogo.busca.realizada@1 aceita o resumo da busca e não carrega o texto digitado', () => {
    expect(EVENTO_BUSCA_REALIZADA.nome).toBe('catalogo.busca.realizada@1');
    const ok = { usuario_id: U1, resultados: 0, interpretado_por: 'regras', degradada: true, com_cliente: false, ocorrido_em: AGORA };
    expect(BuscaRealizadaSchema.safeParse(ok).success).toBe(true);
    expect(BuscaRealizadaSchema.safeParse({ ...ok, texto: 'filtro de óleo' }).success).toBe(false);
  });

  it('RF-CAT-07: catalogo.busca.realizada@1 rejeita contagem negativa e modo desconhecido', () => {
    const ok = { usuario_id: U1, resultados: 1, interpretado_por: 'llm', degradada: false, com_cliente: true, ocorrido_em: AGORA };
    expect(BuscaRealizadaSchema.safeParse({ ...ok, resultados: -1 }).success).toBe(false);
    expect(BuscaRealizadaSchema.safeParse({ ...ok, interpretado_por: 'gpt' }).success).toBe(false);
  });
});

describe('T-0103: catalogo.referencia.marca_desconhecida@1', () => {
  const base = { produto_external_id: 'P-1', produto_codigo: 'SKU-1', marcas: ['Nenhuma'], lote_id: U1, entidade: 'produto', ocorrido_em: AGORA };
  it('RN-CAT-09: aceita o formato combinado com o Hub (marca_external_id opcional, até 3 marcas)', () => {
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse(base).success).toBe(true);
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, marcas: ['a', 'b', 'c'], marca_external_id: 'X' }).success).toBe(true);
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, produto_codigo: null }).success).toBe(true);
  });
  it('RN-CAT-09: recusa 4 marcas, lista vazia, outra entidade e campo extra', () => {
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, marcas: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, marcas: [] }).success).toBe(false);
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, entidade: 'cliente' }).success).toBe(false);
    expect(MarcaConcorrenteDesconhecidaSchema.safeParse({ ...base, nome_cliente: 'x' }).success).toBe(false);
  });
});
