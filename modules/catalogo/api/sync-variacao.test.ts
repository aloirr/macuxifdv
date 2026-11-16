import type { ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { provedoresSyncCatalogo, sqlPullPreco, versaoDasFiliais } from './sync';

const MAO = '0f000000-0000-4000-8000-000000000001';
const BVB = '0f000000-0000-4000-8000-000000000002';
/** `core.filiais@1` simulada: `daCarteira` é o que o Core devolve para o usuário (T-0149). */
const ctxDe = (perfil: string, parametros: Record<string, unknown>, daCarteira: string[] | null = [MAO], proprias: string[] = [MAO]) =>
  ({
    usuario: { perfil, id: 'u1' },
    parametros: () => parametros,
    comTenant: async (fn: (db: unknown, tx: unknown) => unknown) =>
      fn({}, { consultar: async (def: { nome: string }) => (def.nome === 'core.filiais_do_usuario@1' ? { filial_cadastro_id: proprias[0] ?? null, filial_venda_ids: proprias, sem_filial: proprias.length === 0 } : { padrao_id: MAO, filiais: [], clientes: [], por_external_id: [], da_carteira: daCarteira }) }),
  }) as unknown as ContextoBase;
const PRECO_ESTOQUE = ['tabela_preco', 'tabela_preco_item', 'tabela_escalonada', 'cliente_tabela_preco', 'deposito', 'estoque_saldo'];
const nome = (p: (typeof provedoresSyncCatalogo)[number]) => p.entidade.nome.replace(/^catalogo\./, '');

describe('RN-CAT-05: variacaoEscopo dos provedores de preço e estoque (T-0121 N3)', () => {
  const provedores = provedoresSyncCatalogo.filter((p) => PRECO_ESTOQUE.includes(nome(p)));

  it('RN-CAT-05: as 6 entidades de preço e estoque declaram variacaoEscopo', () => {
    expect(provedores.map(nome).sort()).toEqual([...PRECO_ESTOQUE].sort());
    for (const p of provedores) expect(p.variacaoEscopo, nome(p)).toBeTypeOf('function');
  });

  it('RN-CAT-05: promotor com promotor_ve_preco_estoque de sim para não muda a variação (aparelho ressincroniza e apaga o preço)', async () => {
    for (const p of provedores) {
      const antes = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: true }));
      const depois = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: false }));
      expect(antes, nome(p)).not.toBe(depois);
    }
  });

  it('RN-CAT-05: vendedor não muda com o parâmetro do promotor; entidades de conteúdo não declaram variação', async () => {
    for (const p of provedores) {
      expect(await p.variacaoEscopo!(ctxDe('vendedor', { promotor_ve_preco_estoque: true }))).toBe(await p.variacaoEscopo!(ctxDe('vendedor', { promotor_ve_preco_estoque: false })));
    }
    for (const p of provedoresSyncCatalogo.filter((x) => !PRECO_ESTOQUE.includes(nome(x)))) expect(p.variacaoEscopo, nome(p)).toBeUndefined();
  });
});

describe('RN-CORE-39: pull de preço e estoque só das filiais da carteira (T-0149)', () => {
  const POR_FILIAL = ['tabela_preco_item', 'tabela_escalonada', 'deposito', 'estoque_saldo'];
  const provedores = provedoresSyncCatalogo.filter((p) => POR_FILIAL.includes(nome(p)));
  const pedido = { ate: '2026-11-10T12:00:00Z', desde: null, limite: 500 } as never;

  it('RN-CORE-39: a variacaoEscopo das 4 entidades por filial muda com a lista: carteira no preço, filiais de venda do usuário no estoque (RD-1708)', async () => {
    for (const p of provedores) {
      const doEstoque = ['deposito', 'estoque_saldo'].includes(nome(p));
      const ctx = (ids: string[]) => (doEstoque ? ctxDe('vendedor', {}, [MAO], ids) : ctxDe('vendedor', {}, ids));
      const so = await p.variacaoEscopo!(ctx([MAO]));
      const duas = await p.variacaoEscopo!(ctx([MAO, BVB]));
      const igual = await p.variacaoEscopo!(ctx([BVB, MAO]));
      expect(so, nome(p)).toContain(';filiais=');
      expect(so, nome(p)).not.toBe(duas);
      expect(duas, nome(p)).toBe(igual);
    }
  });

  it('RN-CORE-39: carteira do tenant (todas as filiais) tem versão própria; as demais entidades de preço não ganham a lista', async () => {
    expect(versaoDasFiliais(null)).toBe('todas');
    expect(await provedores[0]!.variacaoEscopo!(ctxDe('admin', {}, null))).toContain(';filiais=todas');
    const tabela = provedoresSyncCatalogo.find((p) => nome(p) === 'tabela_preco')!;
    expect(await tabela.variacaoEscopo!(ctxDe('vendedor', {}))).not.toContain('filiais');
  });

  it('RN-CAT-05 (revista): perfil sem direito a preço continua sem lista nas entidades de preço (variação oculta)', async () => {
    for (const p of provedores.filter((x) => !['deposito', 'estoque_saldo'].includes(nome(x)))) {
      expect(await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: false })), nome(p)).toBe('preco-estoque:oculto');
    }
  });

  it('RN-CAT-05 (revista) / catalogo-campo-v2 §4: o estoque do promotor vai com a lista das filiais DELE, mesmo sem direito a preço; muda quando elas mudam', async () => {
    for (const p of provedores.filter((x) => ['deposito', 'estoque_saldo'].includes(nome(x)))) {
      const uma = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: false }, [MAO, BVB], [MAO]));
      const duas = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: false }, [MAO, BVB], [MAO, BVB]));
      expect(uma, nome(p)).toMatch(/^preco-estoque:oculto;filiais=/);
      expect(uma, nome(p)).not.toBe(duas);
    }
  });

  it('RN-CORE-39: o SQL do item, da escalonada, do depósito e do saldo filtra pelas filiais (escalonada: nula = todas)', () => {
    const lista = [MAO, BVB];
    const item = sqlPullPreco('tabela_preco_item', pedido, null, lista);
    expect(item.sql).toContain('filial_id = any($5::uuid[])');
    expect(item.valores[4]).toEqual(lista);
    expect(sqlPullPreco('tabela_escalonada', pedido, null, lista).sql).toContain('filial_id is null or filial_id = any($5::uuid[])');
    expect(sqlPullPreco('deposito', pedido, null, lista).sql).toContain('filial_id = any($5::uuid[])');
    expect(sqlPullPreco('estoque_saldo', pedido, null, lista).sql).toContain('catalogo.deposito d where d.filial_id = any($5::uuid[])');
  });

  it('RN-CORE-39: carteira do tenant (filiais nulas) manda parâmetro nulo (todas) e tabelas sem filial não ganham parâmetro', () => {
    expect(sqlPullPreco('tabela_preco_item', pedido, null, null).valores[4]).toBeNull();
    expect(sqlPullPreco('tabela_preco', pedido, null, [MAO]).valores).toHaveLength(4);
    expect(sqlPullPreco('cliente_tabela_preco', pedido, ['c1'], [MAO]).valores[4]).toEqual(['c1']);
  });
});
