import { describe, expect, it } from 'vitest';
import { fatoDaEscritaMarca, mensagemInativarMarca, nomeMarcaIgual, validarNomeMarca } from './marcas-cadastro';

describe('RN-CAT-13: validação do nome da marca concorrente', () => {
  it('RN-CAT-13: o nome é aparado e vai de 1 a 120 caracteres', () => {
    expect(validarNomeMarca('  Freiomax ')).toEqual({ ok: true, nome: 'Freiomax' });
    expect(validarNomeMarca('   ').ok).toBe(false);
    expect(validarNomeMarca('a'.repeat(120)).ok).toBe(true);
    const longo = validarNomeMarca('a'.repeat(121));
    expect(longo.ok).toBe(false);
    if (!longo.ok) expect(longo.erro.regra).toBe('RN-CAT-13');
  });
  it('RN-CAT-13: nome único no tenant sem diferenciar maiúsculas nem acento', () => {
    expect(nomeMarcaIgual('FREIOMAX', ' freiomax ')).toBe(true);
    expect(nomeMarcaIgual('Cofap', 'Cófap')).toBe(true);
    expect(nomeMarcaIgual('Cofap', 'Nakata')).toBe(false);
  });
});

describe('RN-CAT-13: fato da escrita (evento catalogo.marca_concorrente.alterada@1)', () => {
  const base = { nome: 'A', ativo: true };
  it('RN-CAT-13: sem marca anterior = criada', () => {
    expect(fatoDaEscritaMarca(null, base)).toBe('criada');
  });
  it('RN-CAT-13: ativo vira falso = inativada; vira verdadeiro = reativada', () => {
    expect(fatoDaEscritaMarca(base, { ...base, ativo: false })).toBe('inativada');
    expect(fatoDaEscritaMarca({ ...base, ativo: false }, base)).toBe('reativada');
  });
  it('RN-CAT-13: renomear ou mudar o external_id = alterada', () => {
    expect(fatoDaEscritaMarca(base, { ...base, nome: 'B' })).toBe('alterada');
    expect(fatoDaEscritaMarca(base, { ...base, external_id: 'X1' })).toBe('alterada');
  });
  it('RN-CAT-13: nada mudou = nenhum fato (não publica evento)', () => {
    expect(fatoDaEscritaMarca(base, { ...base })).toBeNull();
  });
});

describe('RN-CAT-13: confirmação ao inativar', () => {
  it('RN-CAT-13: diz quantas referências saem da busca, no singular e no plural', () => {
    expect(mensagemInativarMarca(0)).toBeNull();
    expect(mensagemInativarMarca(1)).toBe('1 referência sai da busca.');
    expect(mensagemInativarMarca(7)).toBe('7 referências saem da busca.');
  });
});
