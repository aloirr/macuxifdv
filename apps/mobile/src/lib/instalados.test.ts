/**
 * T-0004 critérios 2 e 3 no shell mobile, sem React Native: os 8 módulos instalados pelo manifesto, os módulos
 * possíveis de cada variante e a extensão de exemplo que só aparece com o módulo ativo (RN-CORE-03).
 */
import { criarShell, modulosEfetivos, type ModuloId, type ModuloShell } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS, modulosDaVariante } from './instalados';

/** Card de exemplo que o Treinamento registra no slot `inicio.cards` (oferecido pelo Core; o shell renderiza no Início). */
const CARD_EXEMPLO = { slot: 'inicio.cards', id: 'desafio-semana', payload: { rotulo: 'Desafio da semana', testID: 'card-treinamento-desafio' } };

const modulos = (comExemplo: boolean): ModuloShell<unknown>[] =>
  MANIFESTOS_INSTALADOS.map((m) => (comExemplo && m.id === 'treinamento' ? { manifesto: m, extensoes: [CARD_EXEMPLO] } : { manifesto: m }));

const efetivos = (ativosNoTenant: ModuloId[]) => modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant, doPerfil: ativosNoTenant });

describe('shell mobile com os 8 módulos (T-0004)', () => {
  it('instala os 8 e o conjunto é válido nas duas variantes', () => {
    expect(MANIFESTOS_INSTALADOS.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
    expect(() => criarShell('campo', modulos(true))).not.toThrow();
    expect(() => criarShell('gestao', modulos(true))).not.toThrow();
  });

  it('módulos possíveis por variante: Campo (vendedor/promotor) e Gestão (supervisor/gerente); Integração só no BKO', () => {
    expect(modulosDaVariante('campo')).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'pesquisa', 'treinamento']);
    expect(modulosDaVariante('gestao')).toEqual(['core', 'catalogo', 'promotor', 'gestor', 'pesquisa', 'treinamento']);
  });
});

describe('extensão de exemplo (critério 2): aparece só com o módulo ativo', () => {
  const shell = criarShell('campo', modulos(true));

  it('Treinamento efetivo → o card aparece no slot inicio.cards', () => {
    const visao = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(['vendedor', 'treinamento']) });
    expect(visao.extensoes('inicio.cards').map((i) => `${i.modulo}/${i.id}`)).toEqual(['treinamento/desafio-semana']);
  });

  it('RN-CORE-03: Treinamento desativado → o card some, sem erro', () => {
    const visao = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(['vendedor']) });
    expect(visao.extensoes('inicio.cards')).toEqual([]);
  });

  it('o mesmo vale na variante Gestão', () => {
    const gestao = criarShell('gestao', modulos(true));
    expect(gestao.montar({ perfil: 'supervisor', modulosAtivos: efetivos(['treinamento']) }).extensoes('inicio.cards')).toHaveLength(1);
    expect(gestao.montar({ perfil: 'supervisor', modulosAtivos: efetivos([]) }).extensoes('inicio.cards')).toHaveLength(0);
  });
});
