import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CadastroResumoEntradaSchema, CadastroResumoSaidaSchema } from '../contracts';
import { consultaCadastroResumo } from './consultas';

const C1 = '0ea00000-0000-4000-8000-000000000001';
const cliente = (bloqueado: boolean) => ({ id: C1, razao_social: 'X', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null, inscricao_estadual: null, cep: null, cadastro_incompleto: false, cadastro_campos_faltantes: [], bloqueado });

describe('RN-VEN-13 e RN-CORE-16: core.cadastro_resumo@1 traz o bloqueio do cliente', () => {
  it('RN-VEN-13: lê o bloqueio de core.cliente_financeiro (do próprio Core), sem linha financeira = não bloqueado, e a saída respeita o contrato', async () => {
    const sqls: string[] = [];
    const db: ClienteBanco = { query: async (sql) => { sqls.push(sql); return { rows: /from core.cliente c/.test(sql) ? [cliente(true)] : [], rowCount: 1 } as never; } };
    const r = await consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse({ cliente_ids: [C1] }), { db } as unknown as ContextoConsulta);
    expect(CadastroResumoSaidaSchema.parse(r).clientes[0]).toMatchObject({ bloqueado: true, cadastro_incompleto: false });
    expect(sqls[0]).toMatch(/left join core\.cliente_financeiro f/);
    expect(sqls[0]).toMatch(/coalesce\(f\.bloqueado, false\) as bloqueado/);
    expect(sqls.join(' ')).not.toMatch(/vendedor\.|gestor\./);
  });
});

describe('RN-VEN-11: core.cadastro_resumo@1 traz preço de venda e desconto máximo efetivo do produto', () => {
  const P1 = '0ea00000-0000-4000-8000-0000000000a1';
  const P2 = '0ea00000-0000-4000-8000-0000000000a2';
  const prod = (id: string, preco: number | null, desc: number | null) => ({ id, sku: id.slice(-2), nome: 'P', unidade: 'UN', ativo: true, external_id: null, preco_venda_cents: preco, desconto_maximo_pct: desc });
  const rodar = async (padrao: unknown) => {
    const sqls: string[] = [];
    const db: ClienteBanco = {
      query: async (sql) => {
        sqls.push(sql);
        if (/from core\.produto where/.test(sql)) return { rows: [prod(P1, 10000, 5), prod(P2, null, null)], rowCount: 2 } as never;
        if (/plataforma\.parametro/.test(sql)) return { rows: padrao === undefined ? [] : [{ valor: padrao }], rowCount: 1 } as never;
        return { rows: [], rowCount: 0 } as never;
      },
    };
    const r = await consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse({ produto_ids: [P1, P2] }), { db } as unknown as ContextoConsulta);
    return { saida: CadastroResumoSaidaSchema.parse(r), sqls };
  };

  it('RN-VEN-11: desconto efetivo = próprio ?? parâmetro do tenant ?? 15; preço sem cadastro sai null', async () => {
    const { saida, sqls } = await rodar(20);
    expect(saida.produtos[0]).toMatchObject({ preco_venda_cents: 10000, desconto_maximo_pct: 5 });
    expect(saida.produtos[1]).toMatchObject({ preco_venda_cents: null, desconto_maximo_pct: 20 });
    expect(sqls.join(' ')).not.toMatch(/vendedor\.|gestor\./);
  });
  it('RN-VEN-11: sem parâmetro do tenant o padrão é 15%', async () => {
    const { saida } = await rodar(undefined);
    expect(saida.produtos[1]?.desconto_maximo_pct).toBe(15);
  });
  it('RN-VEN-11: contrato aditivo, emissor antigo (sem os campos) continua válido; valores inválidos são recusados', () => {
    const base = { clientes: [], usuarios: [], produtos: [{ id: P1, sku: 'S', nome: 'P', unidade: 'UN', ativo: true, external_id: null }] };
    expect(CadastroResumoSaidaSchema.safeParse(base).success).toBe(true);
    const com = (extra: object) => ({ ...base, produtos: [{ ...base.produtos[0], ...extra }] });
    expect(CadastroResumoSaidaSchema.safeParse(com({ preco_venda_cents: null, desconto_maximo_pct: 15 })).success).toBe(true);
    expect(CadastroResumoSaidaSchema.safeParse(com({ desconto_maximo_pct: 101 })).success).toBe(false);
    expect(CadastroResumoSaidaSchema.safeParse(com({ preco_venda_cents: 10.5 })).success).toBe(false);
  });
});

describe('RN-CAT-01: core.cadastro_resumo@1 seleciona marca, categoria e ean do produto (T-0119)', () => {
  const P1 = '0ea00000-0000-4000-8000-0000000000b1';
  it('RN-CAT-01: o select de core.produto inclui os três campos e a saída os repassa', async () => {
    const sqls: string[] = [];
    const db: ClienteBanco = {
      query: async (sql) => {
        sqls.push(sql);
        if (/from core\.produto where/.test(sql)) return { rows: [{ id: P1, sku: 'S', nome: 'P', unidade: 'UN', ativo: true, external_id: null, marca: 'Acme', categoria: 'Bebidas', ean: '7891234567895', preco_venda_cents: null, desconto_maximo_pct: null }], rowCount: 1 } as never;
        return { rows: [], rowCount: 0 } as never;
      },
    };
    const r = await consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse({ produto_ids: [P1] }), { db } as unknown as ContextoConsulta);
    expect(sqls.find((q) => /from core\.produto where/.test(q))).toMatch(/external_id, marca, categoria, ean,/);
    expect(CadastroResumoSaidaSchema.parse(r).produtos[0]).toMatchObject({ marca: 'Acme', categoria: 'Bebidas', ean: '7891234567895' });
  });
});
