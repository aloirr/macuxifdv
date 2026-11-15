/** RN-CAT-09 (marca da referência vem de Marcas concorrentes) e RN-CAT-11 (oferece junto por código). */
import { describe, expect, it } from 'vitest';
import { marcasDesconhecidasDaLinha, nomeMarcaDaReferencia, planejarMarcasDoErp, referenciaVisivel, resolverCodigosOfereceJunto, resolverReferenciasDoErp, textoDaReferencia, validarMarcasDaReferencia } from './marcas';

const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const M3 = '00000000-0000-4000-8000-0000000000a3';
const marcas = new Map([
  [M1, { nome: 'Freiomax', ativo: true }],
  [M2, { nome: 'Velha', ativo: false }],
]);

describe('validarMarcasDaReferencia', () => {
  it('RN-CAT-09: marca ativa do cadastro do Catálogo passa', () => {
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
  it('RN-CAT-09: cadastro sem nenhuma marca ativa (RN-CAT-13) recusa com mensagem clara e a ação seguinte', () => {
    const e = validarMarcasDaReferencia([{ marca_id: M1 }], new Map());
    expect(e).toHaveLength(1);
    expect(e[0]!.mensagem).toMatch(/Marcas concorrentes/);
  });
  it('RN-CAT-09: referência sem marca é válida, mesmo sem marcas cadastradas', () => {
    expect(validarMarcasDaReferencia([{ marca_id: null }, {}], new Map())).toEqual([]);
  });
  it('RN-CAT-09: sem referências nada é exigido, mesmo sem marcas', () => {
    expect(validarMarcasDaReferencia([], new Map())).toEqual([]);
  });
  it('RN-CAT-09: sem marcas ativas a mensagem manda escolher "Sem marca"', () => {
    const e = validarMarcasDaReferencia([{ marca_id: M1 }], new Map());
    expect(e[0]!.mensagem).toBe('Não há marcas concorrentes ativas. Cadastre a marca em Catálogo → Marcas concorrentes ou escolha "Sem marca".');
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
  it('RN-CAT-09: referência sem marca entra só com o código, sem descarte nem aviso', () => {
    const r = resolverReferenciasDoErp([{ codigo: 'W 712' }], lista);
    expect(r.referencias).toEqual([{ marca_id: null, marca_nome: null, codigo: 'W 712' }]);
    expect(r.descartadas).toEqual([]);
    expect(r.semMarca).toEqual([]);
  });
  it('RN-CAT-09: marca informada desconhecida ou inativa entra sem marca e fica marcada para o aviso', () => {
    const r = resolverReferenciasDoErp([{ marca_nome: 'Nenhuma', codigo: 'A1' }, { marca_external_id: 'VE', codigo: 'A2' }], lista);
    expect(r.referencias).toEqual([{ marca_id: null, marca_nome: null, codigo: 'A1' }, { marca_id: null, marca_nome: null, codigo: 'A2' }]);
    expect(r.descartadas).toEqual([]);
    expect(r.semMarca.map((d) => d.motivo)).toEqual(['marca_desconhecida', 'marca_inativa']);
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
  it('RN-CAT-09: consulta indisponível (lista vazia) grava só o código e avisa marca desconhecida', () => {
    const r = resolverReferenciasDoErp([{ marca_nome: 'Freiomax', codigo: 'A' }], []);
    expect(r.referencias).toEqual([{ marca_id: null, marca_nome: null, codigo: 'A' }]);
    expect(r.semMarca).toHaveLength(1);
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
  it('RN-CAT-09: com o cadastro de marcas do Catálogo disponível, vale o nome atual da marca ativa (renomeou, mostra o novo)', () => {
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

describe('marcasDesconhecidasDaLinha (T-0103: aviso de marca concorrente desconhecida no monitor)', () => {
  it('RN-CAT-09: só as descartadas por marca_desconhecida entram, com o nome como veio, sem repetir e até 3', () => {
    const entrada = [
      { marca_nome: 'Nenhuma', codigo: 'A1' },
      { marca_external_id: 'ZZ', codigo: 'A2' },
      { marca_nome: 'nenhuma', codigo: 'A3' },
      { marca_nome: 'Velha', codigo: 'A4' },
      { marca_nome: 'Outra', codigo: 'A5' },
    ];
    const semMarca = [
      { codigo: 'A1', motivo: 'marca_desconhecida' as const },
      { codigo: 'A2', motivo: 'marca_desconhecida' as const },
      { codigo: 'A3', motivo: 'marca_desconhecida' as const },
      { codigo: 'A4', motivo: 'marca_inativa' as const },
      { codigo: 'A5', motivo: 'marca_desconhecida' as const },
    ];
    expect(marcasDesconhecidasDaLinha(entrada, semMarca)).toEqual({ marcas: ['Nenhuma', 'ZZ', 'Outra'], marca_external_id: 'ZZ' });
  });
  it('RN-CAT-09: sem referência sem marca desconhecida devolve nada', () => {
    expect(marcasDesconhecidasDaLinha([{ marca_nome: 'X', codigo: 'A1' }], [{ codigo: 'A1', motivo: 'marca_inativa' }])).toBeNull();
  });
});

describe('referenciaVisivel e textoDaReferencia', () => {
  const marcas = new Map([[M1, { nome: 'Freiomax', ativo: true }], [M2, { nome: 'Velha', ativo: false }]]);
  it('RN-CAT-09: referência sem marca aparece só com o código', () => {
    expect(referenciaVisivel({ marca_id: null, marca_nome: null, codigo: 'CB 1' }, marcas)).toEqual({ marca_id: null, marca_nome: null, codigo: 'CB 1' });
  });
  it('RN-CAT-09: marca ativa aparece com o nome do cadastro; inativa ou ausente esconde a referência', () => {
    expect(referenciaVisivel({ marca_id: M1, marca_nome: 'Antigo', codigo: 'CB 1' }, marcas)?.marca_nome).toBe('Freiomax');
    expect(referenciaVisivel({ marca_id: M2, marca_nome: 'Velha', codigo: 'CB 1' }, marcas)).toBeNull();
    expect(referenciaVisivel({ marca_id: M3, marca_nome: 'X', codigo: 'CB 1' }, marcas)).toBeNull();
  });
  it('RN-CAT-09: texto "marca código", ou só o código sem marca', () => {
    expect(textoDaReferencia('Freiomax', 'CB 1')).toBe('Freiomax CB 1');
    expect(textoDaReferencia(null, 'CB 1')).toBe('CB 1');
    expect(textoDaReferencia('  ', 'CB 1')).toBe('CB 1');
  });
});

describe('planejarMarcasDoErp e marca_external_id (marca da referência pelo código do ERP)', () => {
  const lista = [
    { id: M1, nome: 'Freiomax', ativo: true, external_id: 'FM' },
    { id: M2, nome: 'Manual', ativo: true, external_id: null },
  ];
  it('RN-CAT-13: código e nome novos criam a marca pelo código', () => {
    const plano = planejarMarcasDoErp([{ marca_external_id: 'NV', marca_nome: 'Nova Marca', codigo: 'A1' }], lista);
    expect(plano).toEqual({ criar: [{ external_id: 'NV', nome: 'Nova Marca' }], adotar: [] });
  });
  it('RN-CAT-13: código já cadastrado não cria nem renomeia a marca', () => {
    expect(planejarMarcasDoErp([{ marca_external_id: 'FM', marca_nome: 'Outro nome', codigo: 'A1' }], lista)).toEqual({ criar: [], adotar: [] });
  });
  it('RN-CAT-13: nome igual ao de marca cadastrada sem código adota o código (sem criar duplicada)', () => {
    expect(planejarMarcasDoErp([{ marca_external_id: 'MN', marca_nome: 'manual', codigo: 'A1' }], lista)).toEqual({ criar: [], adotar: [{ id: M2, external_id: 'MN' }] });
  });
  it('RN-CAT-13: nome de marca que já tem outro código não cria nem adota', () => {
    expect(planejarMarcasDoErp([{ marca_external_id: 'ZZ', marca_nome: 'Freiomax', codigo: 'A1' }], lista)).toEqual({ criar: [], adotar: [] });
  });
  it('RN-CAT-09: sem código (ou sem nome) nada é criado e a referência entra só com o código', () => {
    expect(planejarMarcasDoErp([{ marca_nome: 'Nova', codigo: 'A1' }, { marca_external_id: 'NV', codigo: 'A2' }], lista)).toEqual({ criar: [], adotar: [] });
  });
  it('RN-CAT-13: o mesmo código ou o mesmo nome repetido na linha cria uma marca só', () => {
    const e = [{ marca_external_id: 'NV', marca_nome: 'Nova', codigo: 'A1' }, { marca_external_id: 'NV', marca_nome: 'Nova', codigo: 'A2' }, { marca_external_id: 'N2', marca_nome: 'NOVA', codigo: 'A3' }];
    expect(planejarMarcasDoErp(e, lista).criar).toEqual([{ external_id: 'NV', nome: 'Nova' }]);
  });
  it('RN-CAT-13: nome de marca sem código que aparece de novo com outro código é adotado uma vez só', () => {
    const e = [{ marca_external_id: 'MN', marca_nome: 'Manual', codigo: 'A1' }, { marca_external_id: 'MN2', marca_nome: 'manual', codigo: 'A2' }];
    expect(planejarMarcasDoErp(e, lista)).toEqual({ criar: [], adotar: [{ id: M2, external_id: 'MN' }] });
  });
});
