import { describe, expect, it } from 'vitest';
import { decidirApagarFilial, filialDoClienteDoErp, filialEfetiva, podeEditarFilialDoCliente, rotuloDaFilial, validarFilial, type FilialLike } from './filial';

const F = (id: string, codigo: string, extra: Partial<FilialLike> = {}): FilialLike => ({ id, codigo, nome: `Filial ${codigo}`, cidade: 'Manaus', uf: 'AM', padrao: false, ativo: true, ...extra });
const MANAUS = F('a', '0001', { padrao: true });
const BV = F('b', '0002', { cidade: 'Boa Vista', uf: 'RR' });
const INATIVA = F('c', '0003', { ativo: false });

describe('RN-CORE-39: filial efetiva do cliente', () => {
  it('RN-CORE-39: filial do cliente viva e ativa vale; senão a padrão', () => {
    expect(filialEfetiva('b', [MANAUS, BV]).id).toBe('b');
    expect(filialEfetiva(null, [MANAUS, BV]).id).toBe('a');
    expect(filialEfetiva(undefined, [MANAUS, BV]).id).toBe('a');
  });
  it('RN-CORE-39: filial apagada (fora da lista) ou inativa cai na padrão', () => {
    expect(filialEfetiva('zzz', [MANAUS, BV]).id).toBe('a');
    expect(filialEfetiva('c', [MANAUS, INATIVA]).id).toBe('a');
  });
  it('RN-CORE-39: sem filial padrão na lista é erro de dado (nunca devolve vazio)', () => {
    expect(() => filialEfetiva(null, [BV])).toThrow(/padrão/);
  });
});

describe('RN-CORE-39: cadastro da filial', () => {
  const nova = { id: 'n', codigo: '0004', nome: 'Santarém', cidade: 'Santarém', uf: 'pa' };
  it('RN-CORE-39: código, nome, cidade e UF obrigatórios; UF vira maiúscula', () => {
    const r = validarFilial(nova, [MANAUS, BV]);
    expect(r).toMatchObject({ ok: true, filial: { codigo: '0004', uf: 'PA' } });
    for (const campo of ['codigo', 'nome', 'cidade'] as const) {
      expect(validarFilial({ ...nova, [campo]: '  ' }, [MANAUS]), campo).toMatchObject({ ok: false, codigo: 'FILIAL_INVALIDA' });
    }
    expect(validarFilial({ ...nova, uf: 'XX' }, [MANAUS])).toMatchObject({ ok: false, codigo: 'FILIAL_INVALIDA' });
    expect(validarFilial({ ...nova, uf: '' }, [MANAUS])).toMatchObject({ ok: false, codigo: 'FILIAL_INVALIDA' });
  });
  it('RN-CORE-39: limites de tamanho (código 20, nome 80, cidade 80)', () => {
    expect(validarFilial({ ...nova, codigo: 'x'.repeat(21) }, [MANAUS])).toMatchObject({ ok: false });
    expect(validarFilial({ ...nova, nome: 'x'.repeat(81) }, [MANAUS])).toMatchObject({ ok: false });
    expect(validarFilial({ ...nova, cidade: 'x'.repeat(81) }, [MANAUS])).toMatchObject({ ok: false });
    expect(validarFilial({ ...nova, codigo: 'x'.repeat(20) }, [MANAUS]).ok).toBe(true);
  });
  it('RN-CORE-39: código único entre as vivas (sem diferenciar maiúscula); editar a si mesma não conta', () => {
    expect(validarFilial({ ...nova, codigo: '0002' }, [MANAUS, BV])).toMatchObject({ ok: false, codigo: 'FILIAL_DUPLICADA' });
    expect(validarFilial({ ...nova, id: 'b', codigo: '0002' }, [MANAUS, BV]).ok).toBe(true);
    expect(validarFilial({ ...nova, codigo: 'ab' }, [MANAUS, F('x', 'AB')])).toMatchObject({ ok: false, codigo: 'FILIAL_DUPLICADA' });
  });
});

describe('RN-CORE-39: inativar e apagar a filial', () => {
  const edit = (id: string, ativo: boolean, clientesAtivos = 0) => validarFilial({ ...(id === 'a' ? MANAUS : BV), ativo }, [MANAUS, BV], { clientesAtivos });
  it('RN-CORE-39: a padrão não é inativada', () => {
    expect(edit('a', false)).toMatchObject({ ok: false, codigo: 'FILIAL_PADRAO' });
  });
  it('RN-CORE-39: filial com cliente ativo não é inativada ("Mude os clientes de filial antes de inativar.")', () => {
    expect(edit('b', false, 3)).toMatchObject({ ok: false, codigo: 'FILIAL_EM_USO', mensagem: 'Mude os clientes de filial antes de inativar.' });
    expect(edit('b', false, 0).ok).toBe(true);
    expect(edit('b', true, 3).ok).toBe(true);
  });
  it('RN-CORE-39: a padrão não se apaga; filial com cliente também não', () => {
    expect(decidirApagarFilial({ padrao: true }, 0)).toMatchObject({ ok: false, codigo: 'FILIAL_PADRAO' });
    expect(decidirApagarFilial({ padrao: false }, 2)).toMatchObject({ ok: false, codigo: 'FILIAL_EM_USO' });
    expect(decidirApagarFilial({ padrao: false }, 0)).toEqual({ ok: true });
  });
});

describe('RN-CORE-39: filial do cliente', () => {
  it('RN-CORE-39: cliente que veio do ERP (com external_id) não troca a filial no BKO; sem external_id troca', () => {
    expect(podeEditarFilialDoCliente({ external_id: 'C-1' })).toBe(false);
    expect(podeEditarFilialDoCliente({ external_id: null })).toBe(true);
    expect(podeEditarFilialDoCliente({ external_id: '' })).toBe(true);
  });
  it('RN-CORE-39: rótulo "0002 · Boa Vista/RR"; sem cidade, o código e o nome', () => {
    expect(rotuloDaFilial(BV)).toBe('0002 · Boa Vista/RR');
    expect(rotuloDaFilial(F('d', '0001', { cidade: null, uf: null, nome: 'Filial padrão' }))).toBe('0001 · Filial padrão');
  });
});

describe('RN-CORE-39: filial do cliente vinda do ERP', () => {
  it('RN-CORE-39: filial_external_id ausente não altera; nulo ou em branco = padrão; texto = a filial do ERP', () => {
    expect(filialDoClienteDoErp({})).toEqual({});
    expect(filialDoClienteDoErp({ filial_external_id: undefined })).toEqual({});
    expect(filialDoClienteDoErp({ filial_external_id: null })).toEqual({ filial_external_id: null });
    expect(filialDoClienteDoErp({ filial_external_id: '  ' })).toEqual({ filial_external_id: null });
    expect(filialDoClienteDoErp({ filial_external_id: ' F-02 ' })).toEqual({ filial_external_id: 'F-02' });
  });
});
