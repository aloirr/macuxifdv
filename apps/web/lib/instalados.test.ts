/** T-0004 critério 3 no BKO: os 8 módulos instalados pelo manifesto; o menu só traz módulos efetivos com páginas. */
import { criarShell, GRUPOS_MENU, type GrupoDeclarado, type ModuloShell, type PaginaShell, type PerfilDaRequisicao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';
import { montarGruposMenu } from './menu-bko';

describe('shell web com os 8 módulos (T-0004)', () => {
  it('instala os 8 e o conjunto é válido', () => {
    expect(MANIFESTOS_INSTALADOS.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
    expect(() => criarShell('web', MANIFESTOS_INSTALADOS.map((m) => ({ manifesto: m })))).not.toThrow();
  });

  it('módulo efetivo sem web/ entra sem página; a página de exemplo só aparece com o módulo ativo', () => {
    const integracao = MANIFESTOS_INSTALADOS.find((m) => m.id === 'integracao')!;
    const pagina = { id: 'monitor', caminho: 'integracao', titulo: 'Integração ERP', navegacao: 'Integração ERP', componente: 'Monitor' };
    const modulos: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) => (m === integracao ? { manifesto: m, paginas: [pagina] } : { manifesto: m }));
    const shell = criarShell('web', modulos);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core', 'integracao'] }).navegacao.map((n) => n.testID)).toEqual(['nav-integracao-monitor']);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core'] }).navegacao).toEqual([]);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core'] }).pagina('integracao')).toBeNull();
  });
});

/**
 * T-0173 (R-20261115-121000): Sistema → Integração ERP só com os lotes (`monitor`, caminho `integracao`) e o De-para em
 * Parâmetros → Integração (`de-para`, caminho `parametros/integracao`, grupo `parametros`). Módulo falso: a página do De-para
 * é registrada pelo modulo-integracao em outro branch; aqui só o que o shell faz com ela.
 */
describe('shell web: Integração ERP em Sistema e De-para em Parâmetros (T-0173)', () => {
  const integracao = MANIFESTOS_INSTALADOS.find((m) => m.id === 'integracao')!;
  const manifesto = { ...integracao, apps: { ...integracao.apps, web: { menus: [...(integracao.apps.web?.menus ?? []), 'Integração'] } } };
  // até o SDK aceitar 'parametros' em GrupoMenu (recado ao engenheiro-software), o tipo do grupo vem por conversão
  const grupoParametros = 'parametros' as string as GrupoDeclarado;
  const monitor: PaginaShell<string> = { id: 'monitor', caminho: 'integracao', titulo: 'Integração ERP', navegacao: 'Integração ERP', grupo: 'administracao', acao: 'monitor.ver', componente: 'Monitor' };
  const dePara: PaginaShell<string> = { id: 'de-para', caminho: 'parametros/integracao', titulo: 'Integração', navegacao: 'Integração', grupo: grupoParametros, acao: 'mapeamento.editar', componente: 'DePara' };
  const shellCom = (paginas: PaginaShell<string>[]) =>
    criarShell('web', MANIFESTOS_INSTALADOS.map((m): ModuloShell<string> => (m === integracao ? { manifesto, paginas } : { manifesto: m })));
  const TODOS = MANIFESTOS_INSTALADOS.map((m) => m.id);

  it('a rota /parametros/integracao monta com a licença, o perfil e a ação; sem um dos três, não monta', () => {
    const shell = shellCom([dePara]);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: TODOS }).pagina('parametros/integracao')?.id).toBe('de-para');
    expect(shell.montar({ perfil: 'admin', modulosAtivos: TODOS }).navegacao.map((n) => [n.testID, n.grupoMenu, n.caminho])).toEqual([['nav-integracao-de-para', 'parametros', 'parametros/integracao']]);
    // sem licença do módulo
    const semLicenca = shell.montar({ perfil: 'admin', modulosAtivos: TODOS.filter((id) => id !== 'integracao') });
    expect(semLicenca.pagina('parametros/integracao')).toBeNull();
    expect(semLicenca.navegacao).toEqual([]);
    // perfil fora da ação (mapeamento.editar: admin e analista)
    expect(shell.montar({ perfil: 'supervisor', modulosAtivos: TODOS }).pagina('parametros/integracao')).toBeNull();
    // perfil de acesso do tenant sem a ação (ADR 0033)
    const semAcao: PerfilDaRequisicao[] = [{ codigo: 'analista', base: 'analista', permissoes: { 'monitor.ver': {} } }];
    expect(shell.montar({ perfil: 'analista', modulosAtivos: TODOS, perfis: semAcao }).pagina('parametros/integracao')).toBeNull();
    expect(shell.montar({ perfil: 'analista', modulosAtivos: TODOS, perfis: semAcao }).navegacao).toEqual([]);
  });

  it('Integração ERP continua em Sistema (a tabela de lotes, em /integracao)', () => {
    const visao = shellCom([monitor]).montar({ perfil: 'admin', modulosAtivos: TODOS });
    expect(visao.navegacao.map((n) => [n.testID, n.grupoMenu, n.rotuloGrupo, n.caminho])).toEqual([['nav-integracao-monitor', 'sistema', 'Sistema', 'integracao']]);
    expect(visao.pagina('integracao')?.id).toBe('monitor');
  });

  // o rótulo "Parâmetros" vem do ROTULO_GRUPO_MENU do SDK; o teste liga sozinho quando o grupo entrar em GRUPOS_MENU
  it.skipIf(!(GRUPOS_MENU as readonly string[]).includes('parametros'))('menu: Parâmetros › Integração e Sistema › Integração ERP; sem licença os dois somem', () => {
    const shell = shellCom([monitor, dePara]);
    const menu = (modulosAtivos: typeof TODOS) => montarGruposMenu({ navegacao: shell.montar({ perfil: 'admin', modulosAtivos }).navegacao, plataforma: false });
    expect(menu(TODOS).map((g) => [g.titulo, g.itens.map((i) => [i.label, i.href])])).toEqual([
      ['Parâmetros', [['Integração', '/parametros/integracao']]],
      ['Sistema', [['Integração ERP', '/integracao']]],
    ]);
    expect(menu(TODOS.filter((id) => id !== 'integracao'))).toEqual([]);
  });
});
