import { describe, expect, it } from 'vitest';
import { planejarProdutoDoErp, type EventoProdutoAtualizado } from './produto';

const base = { lote_id: '0e000000-0000-4000-8000-000000000001', entidade: 'produto' as const, external_id: 'P-100', hash: 'h1', ocorrido_em: '2026-10-31T12:00:00Z' };
const registro = { external_id: 'P-100', alterado_em: '2026-10-31T11:00:00Z', ativo: true, sku: ' SKU-1 ', ean: '7891234567895', nome: ' Café 500g ', marca: 'Boa', categoria: '', unidade: 'un' };

describe('ADR-0005: produto do ERP vira core.produto (integracao.produto.atualizado@1)', () => {
  it('ADR-0005: criado e atualizado fazem upsert por external_id, com texto normalizado', () => {
    for (const acao of ['criado', 'atualizado'] as const) {
      const p = planejarProdutoDoErp({ ...base, acao, registro } as EventoProdutoAtualizado);
      expect(p).toEqual({
        tipo: 'upsert',
        linha: { external_id: 'P-100', sku: 'SKU-1', ean: '7891234567895', nome: 'Café 500g', marca: 'Boa', categoria: null, unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null, embalagem_descartada: false, ativo: true, alterado_em: '2026-10-31T11:00:00Z' },
      });
    }
  });

  it('RN-INT-06: inativado só marca ativo=false (nunca apaga) e não precisa de registro', () => {
    expect(planejarProdutoDoErp({ ...base, acao: 'inativado' } as EventoProdutoAtualizado)).toEqual({ tipo: 'inativar', external_id: 'P-100', alterado_em: null });
  });

  it('ADR-0005: registro com ativo=false inativa pelo upsert', () => {
    const p = planejarProdutoDoErp({ ...base, acao: 'atualizado', registro: { ...registro, ativo: false } } as EventoProdutoAtualizado);
    expect(p).toMatchObject({ tipo: 'upsert', linha: { ativo: false } });
  });

  it('ADR-0005: reentrega do mesmo evento é idempotente (mesmo plano)', () => {
    const e = { ...base, acao: 'atualizado', registro } as EventoProdutoAtualizado;
    expect(planejarProdutoDoErp(e)).toEqual(planejarProdutoDoErp(e));
  });

  it('ADR-0005: evento fora de ordem (mais antigo que o aplicado) não sobrescreve; criado sem registro é ignorado', () => {
    const e = { ...base, acao: 'atualizado', registro } as EventoProdutoAtualizado;
    expect(planejarProdutoDoErp(e, '2026-10-31T11:30:00Z')).toEqual({ tipo: 'ignorar', motivo: 'mais_antigo_que_o_aplicado' });
    expect(planejarProdutoDoErp(e, '2026-10-31T11:00:00Z')).toMatchObject({ tipo: 'upsert' });
    expect(planejarProdutoDoErp({ ...base, acao: 'criado' } as EventoProdutoAtualizado)).toEqual({ tipo: 'ignorar', motivo: 'sem_registro' });
  });

  it('RN-CORE-19: embalagem do ERP (medida + quantidade) entra normalizada; incompleta ou inválida é descartada sem derrubar o produto', () => {
    const plano = (extra: object) => planejarProdutoDoErp({ ...base, acao: 'atualizado', registro: { ...registro, ...extra } } as EventoProdutoAtualizado);
    expect(plano({ embalagem_medida: ' cx ', embalagem_quantidade: 12 })).toMatchObject({ tipo: 'upsert', linha: { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 } });
    for (const extra of [
      { embalagem_medida: 'CX' }, // sem quantidade
      { embalagem_quantidade: 12 }, // sem medida
      { embalagem_medida: 'CX', embalagem_quantidade: 1 }, // quantidade deve ser > 1
      { embalagem_medida: 'CX', embalagem_quantidade: 2.5 }, // inteira
      { embalagem_medida: 'UN', embalagem_quantidade: 6 }, // igual à unidade
      { embalagem_medida: '', embalagem_quantidade: null },
      { embalagem_medida: 'CX', embalagem_quantidade: 10000 }, // acima do teto de 9999
      { embalagem_medida: 'CX', embalagem_quantidade: 2147483648 },
    ]) {
      expect(plano(extra), JSON.stringify(extra)).toMatchObject({ tipo: 'upsert', linha: { embalagem_medida: null, embalagem_quantidade: null } });
    }
  });

  it('RN-CORE-19: embalagem informada mas descartada (fora de 2 a 9999, incompleta) é sinalizada para o log; sem embalagem ou válida, não', () => {
    const plano = (extra: object) => planejarProdutoDoErp({ ...base, acao: 'atualizado', registro: { ...registro, ...extra } } as EventoProdutoAtualizado);
    expect(plano({ embalagem_medida: 'CX', embalagem_quantidade: 10000 })).toMatchObject({ linha: { embalagem_descartada: true } });
    expect(plano({ embalagem_medida: 'CX' })).toMatchObject({ linha: { embalagem_descartada: true } });
    expect(plano({ embalagem_medida: 'CX', embalagem_quantidade: 9999 })).toMatchObject({ linha: { embalagem_descartada: false } });
    expect(plano({})).toMatchObject({ linha: { embalagem_descartada: false } });
  });
});
