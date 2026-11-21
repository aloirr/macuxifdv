import { defineModule, PERFIS, type ModuloId } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { calcularModulosEfetivos, dependentesDe, efetivosPelasDependencias, moduloEstaAtivo, modulosRemovidos, podeBaixarApp, podeDesativarModulo } from './licencas';

const todos = [...PERFIS];
const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: todos }),
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], opcionais: ['catalogo'], perfis: ['vendedor'] }),
  defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core', 'vendedor'], perfis: ['supervisor'] }),
  defineModule({ id: 'pesquisa', versao: '1.0.0', depende: ['core'], perfis: ['vendedor', 'promotor'] }),
];
const base = { manifestos, ativosNoTenant: ['catalogo', 'vendedor', 'gestor', 'pesquisa'] as ModuloId[], doPerfil: ['catalogo', 'vendedor', 'gestor', 'pesquisa'] as ModuloId[] };

describe('licenças: módulos efetivos (S0-040)', () => {
  it('RN-CORE-01: efetivos = ativos do tenant ∩ módulos do perfil', () => {
    expect(calcularModulosEfetivos({ ...base, ativosNoTenant: ['vendedor', 'pesquisa'], doPerfil: ['vendedor', 'catalogo'] })).toEqual(['core', 'vendedor']);
  });

  it('RN-CORE-01: tenant desligado vence perfil ligado; perfil sem o módulo = usuário não tem', () => {
    expect(calcularModulosEfetivos({ ...base, ativosNoTenant: [] })).toEqual(['core']);
    expect(calcularModulosEfetivos({ ...base, doPerfil: [] })).toEqual(['core']);
  });

  it('RN-CORE-01: o core está sempre ativo, mesmo com tenant e perfil vazios', () => {
    expect(calcularModulosEfetivos({ manifestos, ativosNoTenant: [], doPerfil: [] })).toEqual(['core']);
  });

  it('RN-CORE-01: a exceção do usuário só remove, e só dele', () => {
    const efetivos = (removidos: ModuloId[]) => calcularModulosEfetivos({ ...base, ativosNoTenant: ['pesquisa'], doPerfil: ['pesquisa'], removidosDoUsuario: removidos });
    expect(efetivos(['pesquisa'])).toEqual(['core']);
    expect(efetivos([])).toEqual(['core', 'pesquisa']);
  });

  it('RN-CORE-01: exceção nunca acrescenta módulo que o perfil não tem (esclarecimento da Sprint 0)', () => {
    // remover um módulo que o perfil não tem não muda nada; não existe entrada para acrescentar
    const r = calcularModulosEfetivos({ ...base, ativosNoTenant: ['vendedor'], doPerfil: ['pesquisa'], removidosDoUsuario: ['vendedor'] });
    expect(r).toEqual(['core']);
  });

  it('RN-CORE-01: remover o core por exceção não tem efeito', () => {
    expect(calcularModulosEfetivos({ ...base, removidosDoUsuario: ['core'] })).toContain('core');
  });

  it('RN-CORE-03: dependência inativa remove o dependente, em cascata', () => {
    expect(calcularModulosEfetivos({ ...base, ativosNoTenant: ['gestor'], doPerfil: ['gestor'] })).toEqual(['core']);
    expect(calcularModulosEfetivos({ ...base, removidosDoUsuario: ['vendedor'] })).not.toContain('gestor');
  });

  it('RN-CORE-03: dependência opcional ausente não derruba o módulo', () => {
    expect(calcularModulosEfetivos({ ...base, ativosNoTenant: ['vendedor'], doPerfil: ['vendedor'] })).toEqual(['core', 'vendedor']);
  });

  it('RN-CORE-03: desligar o módulo base remove os dois sem erro (S0-044)', () => {
    expect(calcularModulosEfetivos(base)).toEqual(expect.arrayContaining(['vendedor', 'gestor']));
    const sem = calcularModulosEfetivos({ ...base, ativosNoTenant: ['catalogo', 'gestor', 'pesquisa'] });
    expect(sem).not.toContain('vendedor');
    expect(sem).not.toContain('gestor');
  });

  it('RN-CORE-01: a licença é recalculada a cada chamada, sem estado guardado (S0-055)', () => {
    const antes = calcularModulosEfetivos(base);
    const depois = calcularModulosEfetivos({ ...base, ativosNoTenant: ['catalogo'] });
    expect(antes).toContain('vendedor');
    expect(depois).not.toContain('vendedor');
  });
});

describe('licenças: apoio à API e à tela', () => {
  it('RN-CORE-02: módulo fora dos efetivos é inativo (a API responde 403 MODULO_INATIVO); core é sempre ativo', () => {
    expect(moduloEstaAtivo(['core', 'vendedor'], 'vendedor')).toBe(true);
    expect(moduloEstaAtivo(['core', 'vendedor'], 'pesquisa')).toBe(false);
    expect(moduloEstaAtivo([], 'core')).toBe(true);
  });

  it('RN-CORE-01: só o core não pode ser desativado (S0-045: controle desabilitado na tela)', () => {
    expect(podeDesativarModulo('core')).toBe(false);
    expect(podeDesativarModulo('vendedor')).toBe(true);
  });

  it('RN-CORE-02: módulos removidos entre dois cálculos são os que perdem dados locais', () => {
    expect(modulosRemovidos(['core', 'vendedor', 'pesquisa'], ['core', 'pesquisa'])).toEqual(['vendedor']);
    expect(modulosRemovidos(['core'], ['core', 'vendedor'])).toEqual([]);
  });
});


describe('RN-CORE-01/03: efetivos e dependentes na tela de licenças (sem manifestos)', () => {
  const modulos = ['core', 'catalogo', 'vendedor', 'promotor', 'treinamento'] as const;
  const dependencias = { catalogo: ['core'], vendedor: ['core', 'catalogo'], promotor: ['core'], treinamento: ['core'] } as const;
  const base = { modulos, dependencias, ativosNoTenant: ['core', 'catalogo', 'vendedor', 'promotor'] as const, doPerfil: ['core', 'catalogo', 'vendedor'] as const, removidosDoUsuario: [] as const };

  it('RN-CORE-01: tenant ∩ perfil − exceções; core sempre', () => {
    expect(efetivosPelasDependencias(base)).toEqual(['core', 'catalogo', 'vendedor']);
    expect(efetivosPelasDependencias({ ...base, removidosDoUsuario: ['vendedor'] })).toEqual(['core', 'catalogo']);
    expect(efetivosPelasDependencias({ ...base, ativosNoTenant: [], doPerfil: [] })).toEqual(['core']);
  });

  it('RN-CORE-03: tirar o Catálogo derruba o Vendedor (dependência inativa derruba o dependente)', () => {
    expect(efetivosPelasDependencias({ ...base, removidosDoUsuario: ['catalogo'] })).toEqual(['core']);
  });

  it('RN-CORE-03: dependentes diretos e indiretos que também desligam', () => {
    expect(dependentesDe('catalogo', modulos, dependencias)).toEqual(['vendedor']);
    expect(dependentesDe('core', modulos, dependencias)).toEqual(['catalogo', 'vendedor', 'promotor', 'treinamento']);
    expect(dependentesDe('vendedor', modulos, dependencias)).toEqual([]);
  });
});


describe('RN-CORE-67: licença do link de download do app', () => {
  it('RN-CORE-67: Campo exige vendedor ou promotor entre os módulos efetivos', () => {
    expect(podeBaixarApp('campo', ['core', 'vendedor'])).toBe(true);
    expect(podeBaixarApp('campo', ['core', 'promotor'])).toBe(true);
    expect(podeBaixarApp('campo', ['core', 'gestor', 'catalogo'])).toBe(false);
    expect(podeBaixarApp('campo', ['core'])).toBe(false);
  });
  it('RN-CORE-67: Gestão exige o módulo gestor', () => {
    expect(podeBaixarApp('gestao', ['core', 'gestor'])).toBe(true);
    expect(podeBaixarApp('gestao', ['core', 'vendedor', 'promotor'])).toBe(false);
  });
});
