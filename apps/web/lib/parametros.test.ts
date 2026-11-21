/**
 * Página Parâmetros do BKO (ADR 0060): seção do endereço, rota que não redireciona, seções (painéis + páginas de módulo em
 * `parametros/<secao>`) e a seção que `/parametros` abre.
 */
import type { SecaoParametros } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { ehRotaParametros, secaoDaPagina, secaoDoCaminho, secaoInicialParametros, secoesParametros } from './parametros';

const s = (secao: SecaoParametros, rotulo: string, bloqueado = false) => ({ secao, rotulo, caminho: `parametros/${secao}`, bloqueado, paineis: [] as never[] });
const pagina = (modulo: 'integracao' | 'core', id: string, caminho: string, grupoMenu: 'parametros' | 'cadastros' = 'parametros') => ({
  modulo,
  id,
  caminho,
  grupoMenu,
  pagina: { id, caminho, titulo: `Título ${id}`, componente: 'C' as never },
});

describe('página Parâmetros (ADR 0060)', () => {
  it('secaoDoCaminho: só parametros/<secao> da lista fixa', () => {
    expect(secaoDoCaminho('parametros/integracao')).toBe('integracao');
    expect(secaoDoCaminho('/parametros/alertas')).toBe('alertas');
    expect(secaoDoCaminho('parametros/nao-existe')).toBeNull();
    expect(secaoDoCaminho('parametros/integracao/x')).toBeNull();
    expect(secaoDoCaminho('integracao')).toBeNull();
  });

  it('secaoDaPagina: só página do grupo Parâmetros em parametros/<secao>', () => {
    expect(secaoDaPagina({ grupoMenu: 'parametros', caminho: 'parametros/integracao' })).toBe('integracao');
    expect(secaoDaPagina({ grupoMenu: 'cadastros', caminho: 'parametros/integracao' })).toBeNull();
    expect(secaoDaPagina({ grupoMenu: 'parametros', caminho: 'de-para' })).toBeNull();
  });

  it('ehRotaParametros: /parametros e /parametros/... nunca redirecionam', () => {
    expect(ehRotaParametros('/parametros')).toBe(true);
    expect(ehRotaParametros('/parametros/alertas')).toBe(true);
    expect(ehRotaParametros('/parametros-x')).toBe(false);
    expect(ehRotaParametros('/perfis')).toBe(false);
  });

  it('secoesParametros: página de módulo do grupo Parâmetros vira painel `pagina` da seção, em ordem alfabética', () => {
    const secoes = secoesParametros({
      parametros: [s('visitas', 'Visitas'), s('acesso', 'Acesso')],
      navegacao: [pagina('integracao', 'de-para', 'parametros/integracao'), pagina('core', 'clientes', 'clientes', 'cadastros')],
    });
    expect(secoes.map((x) => x.secao)).toEqual(['acesso', 'integracao', 'visitas']);
    expect(secoes[1]).toMatchObject({ rotulo: 'Integração', caminho: 'parametros/integracao', bloqueado: false });
    expect(secoes[1]?.paineis).toEqual([
      { modulo: 'integracao', id: 'de-para', titulo: 'Título de-para', ancora: 'integracao-de-para', testID: 'parametros-integracao-de-para', origem: 'pagina', componente: 'C' },
    ]);
  });

  it('secaoInicialParametros: a primeira não bloqueada; todas bloqueadas, a primeira; sem seção, null', () => {
    expect(secaoInicialParametros([s('pesquisa', 'Pesquisa', true), s('trade', 'Trade')])?.secao).toBe('trade');
    expect(secaoInicialParametros([s('pesquisa', 'Pesquisa', true)])?.secao).toBe('pesquisa');
    expect(secaoInicialParametros([])).toBeNull();
  });
});
