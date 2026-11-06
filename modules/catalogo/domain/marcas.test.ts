/** RN-CAT-09 (marca da referência vem do cadastro de concorrentes do Promotor) e RN-CAT-11 (oferece junto por código). */
import { describe, expect, it } from 'vitest';
import { nomeMarcaDaReferencia, resolverCodigosOfereceJunto, resolverReferenciasDoErp, validarMarcasDaReferencia } from './marcas';

const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const M3 = '00000000-0000-4000-8000-0000000000a3';
const marcas = new Map([
  [M1, { nome: 'Freiomax', ativo: true }],
  [M2, { nome: 'Velha', ativo: false }],
]);

describe('validarMarcasDaReferencia', () => {
  it('RN-CAT-09: marca ativa do Promotor passa', () => {
    expect(validarMarcasDaReferencia([{ marca_id: M1 }], marcas)).toEqual([]);
  });
  it('RN-CAT-09: marca desconhecida e marca inativa são recusadas no campo referencias', () => {
    const e = validarMarcasDaReferencia([{ marca_id: M3 }, { marca_id: M2 }], marcas);
    expect(e.map((x) => [x.regra, x.campo])).toEqual([
      ['RN-CAT-09', 'referencias'],
      ['RN-CAT-09', 'referencias'],
    ]);
    expect(e[1]!.mensagem).toMatch(/inativa/);
  });
  it('RN-CAT-09: consulta sem nenhuma marca (Promotor indisponível) recusa com mensagem clara e a ação seguinte', () => {
    const e = validarMarcasDaReferencia([{ marca_id: M1 }], new Map());
    expect(e).toHaveLength(1);
    expect(e[0]!.mensagem).toMatch(/Promotor/);
  });
  it('RN-CAT-09: sem referências nada é exigido, mesmo sem marcas', () => {
    expect(validarMarcasDaReferencia([], new Map())).toEqual([]);
  });
});

describe('resolverReferenciasDoErp', () => {
  const lista = [
    { id: M1, nome: 'Freiomax', ativo: true, external_id: 'FM' },
    { id: M2, nome: 'Velha', ativo: false, external_id: 'VE' },
  ];
  it('RN-CAT-09: resolve pelo external_id e pelo nome (sem caixa nem acento)', () => {
    const r = resolverReferenciasDoErp([{ marca_external_id: 'FM', codigo: 'CB 3401' }, { marca_nome: ' freiomáx ', codigo: 'X9' }], lista);
    expect(r.referencias).toEqual([
      { marca_id: M1, marca_nome: 'Freiomax', codigo: 'CB 3401' },
      { marca_id: M1, marca_nome: 'Freiomax', codigo: 'X9' },
    ]);
    expect(r.descartadas).toEqual([]);
  });
  it('RN-CAT-09: marca desconhecida ou inativa é descartada com o motivo', () => {
    const r = resolverReferenciasDoErp([{ marca_nome: 'Nenhuma', codigo: 'A1' }, { marca_external_id: 'VE', codigo: 'A2' }], lista);
    expect(r.referencias).toEqual([]);
    expect(r.descartadas.map((d) => d.motivo)).toEqual(['marca_desconhecida', 'marca_inativa']);
  });
  it('RN-CAT-09: código vazio ou acima de 30, repetido e o excedente de 3 são descartados', () => {
    const r = resolverReferenciasDoErp(
      [
        { marca_external_id: 'FM', codigo: '' },
        { marca_external_id: 'FM', codigo: 'x'.repeat(31) },
        { marca_external_id: 'FM', codigo: 'A-1' },
        { marca_external_id: 'FM', codigo: 'a 1' },
        { marca_external_id: 'FM', codigo: 'B' },
        { marca_external_id: 'FM', codigo: 'C' },
        { marca_external_id: 'FM', codigo: 'D' },
      ],
      lista,
    );
    expect(r.referencias.map((x) => x.codigo)).toEqual(['A-1', 'B', 'C']);
    expect(r.descartadas.map((d) => d.motivo)).toEqual(['codigo_invalido', 'codigo_invalido', 'repetida', 'excede_limite']);
  });
  it('RN-CAT-09: consulta indisponível (lista vazia) descarta tudo como marca desconhecida', () => {
    expect(resolverReferenciasDoErp([{ marca_nome: 'Freiomax', codigo: 'A' }], []).descartadas).toHaveLength(1);
  });
});

describe('resolverCodigosOfereceJunto', () => {
  const produtos = [
    { id: 'p1', sku: 'DIS-1', ativo: true },
    { id: 'p2', sku: 'Pas-2', ativo: true },
    { id: 'p3', sku: 'OFF', ativo: false },
  ];
  it('RN-CAT-09: resolve o código sem diferenciar maiúsculas nem espaços nas pontas', () => {
    expect(resolverCodigosOfereceJunto([' dis-1', 'PAS-2'], produtos)).toEqual({ ids: ['p1', 'p2'], naoEncontrados: [] });
  });
  it('RN-CAT-09: código inexistente ou de produto inativo volta em naoEncontrados', () => {
    expect(resolverCodigosOfereceJunto(['x', 'off'], produtos)).toEqual({ ids: [], naoEncontrados: ['x', 'off'] });
  });
});

describe('RN-CAT-09: nome da marca da referência (retrato marca_nome da 0034)', () => {
  it('RN-CAT-09: com o cadastro do Promotor disponível, vale o nome atual da marca ativa (renomeou, mostra o novo)', () => {
    expect(nomeMarcaDaReferencia(M1, 'Nome antigo', marcas)).toBe('Freiomax');
  });
  it('RN-CAT-09: com o cadastro disponível, marca inativa ou ausente esconde a referência, mesmo com retrato', () => {
    expect(nomeMarcaDaReferencia(M2, 'Velha', marcas)).toBeNull();
    expect(nomeMarcaDaReferencia(M3, 'Fantasma', marcas)).toBeNull();
  });
  it('RN-CAT-09: sem o cadastro (mapa vazio, vendedor sem o Promotor), usa o retrato gravado', () => {
    expect(nomeMarcaDaReferencia(M1, 'Freiomax', new Map())).toBe('Freiomax');
  });
  it('RN-CAT-09: sem o cadastro e sem retrato (linha anterior à 0034), não mostra a marca daquela referência', () => {
    expect(nomeMarcaDaReferencia(M1, null, new Map())).toBeNull();
    expect(nomeMarcaDaReferencia(M1, undefined, new Map())).toBeNull();
    expect(nomeMarcaDaReferencia(M1, '   ', new Map())).toBeNull();
  });
});
