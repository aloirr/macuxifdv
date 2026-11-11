import { describe, expect, it } from 'vitest';
import { depositosDaFilial, saldoPorProdutoDaFilial } from '@macuxi/catalogo/contracts';
import { saldoPorProduto } from './pull';
import { produtosSemEstoqueNaFilial } from '../../domain/reserva-filial';

const MAO = 'aaaaaaaa-0000-4000-8000-000000000001';
const BVB = 'aaaaaaaa-0000-4000-8000-000000000002';
const SEM = 'aaaaaaaa-0000-4000-8000-000000000003';
const D1 = 'dddddddd-0000-4000-8000-000000000001';
const D2 = 'dddddddd-0000-4000-8000-000000000002';
const P1 = 'pppppppp-0000-4000-8000-000000000001';
const P2 = 'pppppppp-0000-4000-8000-000000000002';
const P3 = 'pppppppp-0000-4000-8000-000000000003';
const base = { tenant_id: 't', created_at: '', updated_at: '', deleted_at: null, external_id: null, atualizado_em: null };
const saldos = [
  { ...base, id: 's1', produto_id: P1, deposito_id: D1, quantidade: 100 },
  { ...base, id: 's2', produto_id: P1, deposito_id: D2, quantidade: 60 },
  { ...base, id: 's3', produto_id: P2, deposito_id: D1, quantidade: 5 },
] as never;
const comFilial = [
  { ...base, id: D1, codigo: '1', nome: 'A', ativo: true, filial_id: MAO },
  { ...base, id: D2, codigo: '2', nome: 'B', ativo: true, filial_id: BVB },
] as never;
const legado = [
  { ...base, id: D1, codigo: '1', nome: 'A', ativo: true },
  { ...base, id: D2, codigo: '2', nome: 'B', ativo: true },
] as never;

/** Resposta da API (`catalogo.estoque_filial@1`) para os mesmos dados: mesma função do contrato. */
const api = (deps: Array<{ id: string; filial_id?: string }>, filial: string | null) =>
  new Map(
    saldoPorProdutoDaFilial([P1, P2, P3], depositosDaFilial(deps.map((d) => ({ id: d.id, filial_id: d.filial_id })), filial), [
      { produto_id: P1, deposito_id: D1, quantidade: 100 },
      { produto_id: P1, deposito_id: D2, quantidade: 60 },
      { produto_id: P2, deposito_id: D1, quantidade: 5 },
    ]).map((x) => [x.produto_id, x.quantidade_base]),
  );
const depsApi = [
  { id: D1, filial_id: MAO },
  { id: D2, filial_id: BVB },
];

describe('RN-VEN-20: os 4 casos da decisão, app e API iguais', () => {
  it('RN-VEN-20: tenant legado (sem depósito ligado a filial) soma todos os depósitos', () => {
    const app = saldoPorProduto(saldos, legado, BVB);
    expect(app).toEqual(api([{ id: D1 }, { id: D2 }], BVB));
    expect(app.get(P1)).toBe(160);
  });
  it('RN-VEN-20: filial sem depósito = disponível 0, e o pedido do produto controlado falta', () => {
    const app = saldoPorProduto(saldos, comFilial, SEM);
    expect(app).toEqual(api(depsApi, SEM));
    expect(app.get(P1)).toBe(0);
    expect(produtosSemEstoqueNaFilial([{ produto_id: P1, quantidade_base: 1 }], app, new Map())).toHaveLength(1);
  });
  it('RN-VEN-20: produto com saldo só em outra filial fica com 0 e bloqueia; o da filial conta só os depósitos dela', () => {
    const app = saldoPorProduto(saldos, comFilial, BVB);
    expect(app).toEqual(api(depsApi, BVB));
    expect(app.get(P2)).toBe(0);
    expect(app.get(P1)).toBe(60);
    expect(produtosSemEstoqueNaFilial([{ produto_id: P2, quantidade_base: 1 }], app, new Map())).toHaveLength(1);
  });
  it('RN-VEN-20: produto sem nenhuma linha de saldo é sem controle e não bloqueia; pedido sem filial soma tudo', () => {
    const app = saldoPorProduto(saldos, comFilial, BVB);
    expect(app.has(P3)).toBe(false);
    expect(produtosSemEstoqueNaFilial([{ produto_id: P3, quantidade_base: 999 }], app, new Map())).toEqual([]);
    expect(saldoPorProduto(saldos, comFilial, null)).toEqual(api(depsApi, null));
    expect(saldoPorProduto(saldos, comFilial, null).get(P1)).toBe(160);
  });
});
