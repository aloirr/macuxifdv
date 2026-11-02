import { describe, expect, it } from 'vitest';
import { CONSULTA_MEDIDAS, MedidaCriarSchema, MedidaEditarSchema, MedidasEntradaSchema, MedidasSaidaSchema, MedidaSyncSchema, ProdutoMedidasPutSchema, ProdutoPrecoSchema, ProdutoSyncSchema } from './index';

const base = { id: '0e630000-0000-4000-8000-000000000001', updated_at: '2026-11-02T10:00:00.000000Z', deleted_at: null, external_id: null };

describe('RN-CORE-19: contratos das medidas', () => {
  it('RN-CORE-19: a consulta pública se chama core.medidas@1 e aceita até 500 siglas, normalizadas', () => {
    expect(CONSULTA_MEDIDAS.nome).toBe('core.medidas@1');
    expect(MedidasEntradaSchema.parse({ siglas: [' cx ', 'un'] })).toEqual({ siglas: ['CX', 'UN'] });
    expect(MedidasEntradaSchema.safeParse({ siglas: Array.from({ length: 501 }, () => 'UN') }).success).toBe(false);
    expect(MedidasEntradaSchema.safeParse({ siglas: ['UN'], extra: 1 }).success).toBe(false);
    expect(MedidasSaidaSchema.parse({ medidas: [{ sigla: 'UN', descricao: 'Unidade', ativo: true }] }).medidas[0]!.sigla).toBe('UN');
  });
  it('RN-CORE-19: criar exige o UUID do cliente (escrita idempotente); editar exige ao menos um campo', () => {
    expect(MedidaCriarSchema.safeParse({ sigla: 'CX', descricao: 'Caixa' }).success).toBe(false);
    expect(MedidaCriarSchema.safeParse({ id: base.id, sigla: 'CX', descricao: 'Caixa' }).success).toBe(true);
    expect(MedidaEditarSchema.safeParse({}).success).toBe(false);
    expect(MedidaEditarSchema.safeParse({ ativo: false }).success).toBe(true);
  });
  it('RN-CORE-19: o pull leva a medida; produto ganha embalagem opcional sem quebrar o contrato anterior', () => {
    expect(MedidaSyncSchema.safeParse({ ...base, sigla: 'CX', descricao: 'Caixa', ativo: true }).success).toBe(true);
    const produto = { ...base, sku: 'A1', ean: null, nome: 'Café', marca: null, categoria: null, unidade: 'UN', ativo: true };
    expect(ProdutoSyncSchema.safeParse(produto).success).toBe(true);
    expect(ProdutoSyncSchema.safeParse({ ...produto, embalagem_medida: 'CX', embalagem_quantidade: 12 }).success).toBe(true);
    expect(ProdutoSyncSchema.safeParse({ ...produto, embalagem_medida: null, embalagem_quantidade: null }).success).toBe(true);
  });
  it('RN-CORE-19: produto no BKO e o corpo de medidas do produto', () => {
    expect(ProdutoMedidasPutSchema.safeParse({ unidade: 'UN' }).success).toBe(true);
    expect(ProdutoMedidasPutSchema.safeParse({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }).success).toBe(true);
    expect(Object.keys(ProdutoPrecoSchema.shape)).toEqual(expect.arrayContaining(['unidade', 'embalagem_medida', 'embalagem_quantidade']));
  });
});
