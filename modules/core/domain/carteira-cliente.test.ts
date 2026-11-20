import { describe, expect, it } from 'vitest';
import { montarCarteiraDoCliente, perfilVeCarteiraDoCliente, rotuloColunaCarteira } from './carteira-cliente';

const A = '0ea00000-0000-4000-8000-0000000000a1';
const B = '0ea00000-0000-4000-8000-0000000000a2';

describe('RN-CORE-04 / T-0168: carteira do cliente na ficha do Gestão', () => {
  it('RN-CORE-04: só perfis de gestão veem a tabela; vendedor e promotor não', () => {
    for (const p of ['supervisor', 'gerente', 'analista', 'assistente', 'admin']) expect(perfilVeCarteiraDoCliente(p), p).toBe(true);
    for (const p of ['vendedor', 'promotor', 'outro']) expect(perfilVeCarteiraDoCliente(p), p).toBe(false);
  });
  it('RN-CORE-04: uma pessoa mantém o cabeçalho "Vendedora"; mais de uma vira "Pessoa"', () => {
    expect(rotuloColunaCarteira(0)).toBe('Vendedora');
    expect(rotuloColunaCarteira(1)).toBe('Vendedora');
    expect(rotuloColunaCarteira(2)).toBe('Pessoa');
  });
  it('RN-CORE-04: uma linha por pessoa, ordenada pelo nome, com tel: e wa.me com DDI 55', () => {
    const r = montarCarteiraDoCliente([
      { usuario_id: B, nome: 'Zuleica', telefone: '(92) 98237-3437' },
      { usuario_id: A, nome: 'Ana', telefone: null },
      { usuario_id: B, nome: 'Zuleica', telefone: '(92) 98237-3437' },
    ]);
    expect(r.rotulo_coluna).toBe('Pessoa');
    expect(r.itens.map((i) => i.nome)).toEqual(['Ana', 'Zuleica']);
    expect(r.itens[0]).toMatchObject({ tel: null, whatsapp: null });
    expect(r.itens[1]).toMatchObject({ tel: 'tel:+5592982373437', whatsapp: 'https://wa.me/5592982373437' });
  });
  it('RN-CORE-04: cliente sem ninguém na carteira devolve lista vazia com "Vendedora"', () => {
    expect(montarCarteiraDoCliente([])).toEqual({ rotulo_coluna: 'Vendedora', itens: [] });
  });
});
