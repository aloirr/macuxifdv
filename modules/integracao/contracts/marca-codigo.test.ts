import { describe, expect, it } from 'vitest';
import { ProdutoPayload } from './entidades';

const base = { external_id: 'P1', alterado_em: '2026-11-01T12:00:00Z', sku: 'SKU-1', nome: 'Pastilha de freio', unidade: 'UN' };

describe('marca_codigo do produto (código da marca no ERP, aditivo no v1)', () => {
  it('RN-CAT-09: o produto sem marca_codigo continua válido (campo opcional e aditivo)', () => {
    expect(ProdutoPayload.safeParse(base).success).toBe(true);
  });
  it('RN-CAT-09: aceita o código (ex.: 980), apara o espaço e aceita null (limpa)', () => {
    const r = ProdutoPayload.safeParse({ ...base, marca: 'Cobreq', marca_codigo: ' 980 ' });
    expect(r.success && r.data.marca_codigo).toBe('980');
    expect(ProdutoPayload.safeParse({ ...base, marca_codigo: null }).success).toBe(true);
  });
  it('RN-CAT-09: código com mais de 30 caracteres é recusado', () => {
    expect(ProdutoPayload.safeParse({ ...base, marca_codigo: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('código da marca da referência cruzada = marca_external_id (um campo só)', () => {
  const ref = (r: Record<string, unknown>) => ProdutoPayload.safeParse({ ...base, referencias: [r] });
  it('RN-CAT-09: a referência leva o código da marca em marca_external_id, ao lado de marca_nome, e continua válida sem eles', () => {
    const r = ref({ marca_external_id: '980', marca_nome: 'Cobreq', codigo: 'N-1' });
    expect(r.success && r.data.referencias?.[0]).toMatchObject({ marca_external_id: '980', marca_nome: 'Cobreq', codigo: 'N-1' });
    expect(ref({ codigo: 'N-1' }).success).toBe(true);
  });
  it('RN-CAT-09: o contrato não tem um segundo campo marca_codigo na referência', () => {
    const r = ref({ marca_codigo: '980', codigo: 'N-1' });
    expect(r.success && r.data.referencias?.[0]).not.toHaveProperty('marca_codigo');
  });
});
