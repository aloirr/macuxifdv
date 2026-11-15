import { describe, expect, it } from 'vitest';
import { ordenarCarga, referenciasDoRegistro } from './ordem';
import { avisoVendedorSemFilial, verificarFilialDoVendedor } from './vendedor-filial';
import { contarDuplicadasNoLote, validarLinhas } from './idempotencia';
import { VendedorPayload } from '../contracts';

const base = { external_id: 'V1', alterado_em: '2026-11-01T12:00:00Z', nome: 'Maria' };

describe('vendedor com uma filial obrigatória (RN-CORE-39)', () => {
  it('RN-CORE-39: o contrato aceita filial_external_id (aditivo) e o vendedor antigo, sem o campo, continua válido', () => {
    expect(VendedorPayload.safeParse(base).success).toBe(true);
    expect(VendedorPayload.safeParse({ ...base, filial_external_id: 'FIL-1' }).success).toBe(true);
  });
  it('RN-CORE-39: vendedor sem filial (ausente, null ou vazio) entra com o aviso vendedor_sem_filial, sem recusar a linha', () => {
    const r = validarLinhas('vendedor', [base, { ...base, external_id: 'V2', filial_external_id: null }, { ...base, external_id: 'V3', filial_external_id: 'FIL-1' }]);
    expect(r.erros).toEqual([]);
    expect(r.validas).toHaveLength(3);
    expect(r.avisos.map((a) => [a.external_id, a.codigo])).toEqual([['V1', 'vendedor_sem_filial'], ['V2', 'vendedor_sem_filial']]);
    expect(avisoVendedorSemFilial({ external_id: 'V4', filial_external_id: '  ' })?.codigo).toBe('vendedor_sem_filial');
    expect(avisoVendedorSemFilial({ external_id: 'V4', filial_external_id: 'FIL-1' })).toBeNull();
  });
  it('RN-INT-03: o aviso vendedor_sem_filial não conta como linha duplicada (senão o lote viraria "falhou")', () => {
    const r = validarLinhas('vendedor', [base, { ...base, nome: 'Outra Maria' }]);
    expect(r.avisos.map((a) => a.codigo).sort()).toEqual(['duplicado_no_lote', 'vendedor_sem_filial']);
    expect(contarDuplicadasNoLote(r.avisos)).toBe(1);
  });
  it('RN-INT-04: a filial vai antes do vendedor e o vendedor referencia a filial', () => {
    const o = ordenarCarga(['vendedor', 'cliente', 'filial'] as const);
    expect(o.ok && o.ordem).toEqual(['filial', 'vendedor', 'cliente']);
    expect(referenciasDoRegistro('vendedor', { filial_external_id: 'FIL-1' })).toEqual([{ entidade: 'filial', campo: 'filial_external_id', external_id: 'FIL-1' }]);
  });
  it('RN-CORE-39: filial_external_id inexistente vira referencia_ausente reprocessável com o campo; existente, vazio ou sem conferência entra', () => {
    const l = (indice: number, f: string | null) => ({ indice, external_id: `V${indice}`, registro: { filial_external_id: f } });
    const r = verificarFilialDoVendedor([l(1, 'FIL-1'), l(2, 'FIL-X'), l(3, null)], new Set(['FIL-1']));
    expect(r.aceitas.map((x) => x.indice)).toEqual([1, 3]);
    expect(r.erros).toEqual([expect.objectContaining({ indice: 2, external_id: 'V2', codigo: 'referencia_ausente', campo: 'filial_external_id', reprocessavel: true })]);
    expect(verificarFilialDoVendedor([l(2, 'FIL-X')], null).aceitas).toHaveLength(1);
  });
});
