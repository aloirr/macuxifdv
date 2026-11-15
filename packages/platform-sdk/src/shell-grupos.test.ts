/**
 * Grupos do menu do BKO (ADR 0050; spec docs/design/telas/bko-revisao.md §M2/§M6; R-20261114-192700):
 * 10 grupos em ordem alfabética, itens em ordem alfabética, transição dos grupos antigos pela tabela do SDK.
 */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { compararRotuloMenu, criarShell, definirModuloShell, grupoDoMenu, GRUPOS_MENU, ROTULO_GRUPO_MENU } from './shell';

describe('GRUPOS_MENU e rótulos (ADR 0050)', () => {
  it('10 grupos, cada um com o rótulo do M2 (Parâmetros: R-20261115-121000)', () => {
    expect(GRUPOS_MENU).toEqual(['acesso', 'analise', 'cadastros', 'comercial', 'comunicacao', 'conteudo_campo', 'operacao', 'parametros', 'produtos', 'sistema']);
    expect(GRUPOS_MENU.map((g) => ROTULO_GRUPO_MENU[g])).toEqual([
      'Acesso',
      'Análise',
      'Cadastros',
      'Comercial',
      'Comunicação',
      'Conteúdo de campo',
      'Operação',
      'Parâmetros',
      'Produtos',
      'Sistema',
    ]);
  });
});

describe('grupoDoMenu: grupo do M2 com a transição dos grupos antigos', () => {
  it('grupo novo declarado vale como está; sem grupo = operacao', () => {
    expect(grupoDoMenu('gestor', { id: 'painel', grupo: 'analise' })).toBe('analise');
    expect(grupoDoMenu('vendedor', { id: 'pedidos' })).toBe('operacao');
    expect(grupoDoMenu('core', { id: 'qualquer', grupo: 'conteudo_campo' })).toBe('conteudo_campo');
  });

  it('transição: o grupo de hoje vira o grupo do M2', () => {
    expect(grupoDoMenu('core', { id: 'usuarios', grupo: 'administracao' })).toBe('acesso');
    expect(grupoDoMenu('core', { id: 'clientes', grupo: 'operacao' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'clientes' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'recados', grupo: 'operacao' })).toBe('comunicacao');
    expect(grupoDoMenu('core', { id: 'produtos', grupo: 'cadastros' })).toBe('produtos');
    expect(grupoDoMenu('vendedor', { id: 'formas-pagamento', grupo: 'administracao' })).toBe('comercial');
    expect(grupoDoMenu('promotor', { id: 'cadastros', grupo: 'cadastros' })).toBe('conteudo_campo');
    expect(grupoDoMenu('integracao', { id: 'monitor', grupo: 'administracao' })).toBe('sistema');
  });

  it('página que já declara o grupo novo não passa pela tabela', () => {
    expect(grupoDoMenu('core', { id: 'clientes', grupo: 'cadastros' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'recados', grupo: 'comunicacao' })).toBe('comunicacao');
    // o módulo escolheu outro grupo que não o "de" da tabela: vale o declarado
    expect(grupoDoMenu('core', { id: 'usuarios', grupo: 'sistema' })).toBe('sistema');
  });

  it("'administracao' fora da tabela cai em Sistema", () => {
    expect(grupoDoMenu('gestor', { id: 'nova-config', grupo: 'administracao' })).toBe('sistema');
  });
});

const core = definirModuloShell({
  manifesto: defineModule({
    id: 'core',
    versao: '1.0.0',
    perfis: ['vendedor', 'analista'],
    apps: { campo: { abas: ['Rotas', 'Ácido', 'Início'] }, web: { menus: ['Rotas', 'Ácido', 'Indicadores', 'metas', 'Usuários'] } },
  }),
  paginas: [
    { id: 'rotas', caminho: 'rotas', titulo: 'Rotas', navegacao: 'Rotas', ordem: 1, componente: 'X' },
    { id: 'acido', caminho: 'acido', titulo: 'Ácido', navegacao: 'Ácido', ordem: 99, apps: ['web'], componente: 'X' },
    { id: 'metas', caminho: 'metas', titulo: 'Metas', navegacao: 'metas', grupo: 'analise', ordem: 1, apps: ['web'], componente: 'X' },
    { id: 'indicadores', caminho: 'indicadores', titulo: 'Indicadores', navegacao: 'Indicadores', grupo: 'analise', ordem: 50, apps: ['web'], componente: 'X' },
    { id: 'usuarios', caminho: 'usuarios', titulo: 'Usuários', navegacao: 'Usuários', grupo: 'administracao', apps: ['web'], componente: 'X' },
    { id: 'campo-acido', caminho: 'campo-acido', titulo: 'Ácido', navegacao: 'Ácido', ordem: 30, apps: ['campo'], componente: 'X' },
    { id: 'inicio', caminho: 'inicio', titulo: 'Início', navegacao: 'Início', ordem: 5, apps: ['campo'], componente: 'X' },
  ],
});

describe('navegação do BKO em ordem alfabética (ADR 0050)', () => {
  const web = criarShell('web', [core]).montar({ perfil: 'analista', modulosAtivos: ['core'] });

  it('grupos pelo rótulo e itens pelo rótulo (pt-BR, sem acento e caixa), ignorando `ordem`', () => {
    expect(web.navegacao.map((n) => `${n.rotuloGrupo}:${n.rotulo}`)).toEqual([
      'Acesso:Usuários',
      'Análise:Indicadores',
      'Análise:metas',
      'Operação:Ácido',
      'Operação:Rotas',
    ]);
  });

  it('compararRotuloMenu ignora acento e caixa (pt-BR)', () => {
    expect(['Rotas', 'ácido', 'Análise'].sort(compararRotuloMenu)).toEqual(['ácido', 'Análise', 'Rotas']);
    expect(compararRotuloMenu('Operação', 'operacao')).toBe(0);
  });

  it('o item mantém o grupo declarado (transição) e traz grupoMenu/rotuloGrupo', () => {
    const usuarios = web.navegacao.find((n) => n.id === 'usuarios');
    expect(usuarios).toMatchObject({ grupo: 'administracao', grupoMenu: 'acesso', rotuloGrupo: 'Acesso' });
    expect(web.navegacao.find((n) => n.id === 'rotas')).toMatchObject({ grupo: 'operacao', grupoMenu: 'operacao', rotuloGrupo: 'Operação' });
  });

  it('app Campo continua pela `ordem` (nenhuma página do app declara grupo)', () => {
    const campo = criarShell('campo', [core]).montar({ perfil: 'vendedor', modulosAtivos: ['core'] });
    expect(campo.navegacao.map((n) => n.rotulo)).toEqual(['Rotas', 'Início', 'Ácido']);
  });
});

describe('grupo Parâmetros (R-20261115-121000; docs/design/menu-parametros/spec.md)', () => {
  it('página que declara parametros fica em Parâmetros, entre Operação e Produtos', () => {
    expect(grupoDoMenu('integracao', { id: 'de-para', grupo: 'parametros' })).toBe('parametros');
    const integracao = definirModuloShell({
      manifesto: defineModule({
        id: 'integracao',
        versao: '1.0.0',
        depende: ['core'],
        perfis: ['analista'],
        apps: { web: { menus: ['Integração', 'Pedidos', 'Tabelas de preço'] } },
      }),
      paginas: [
        {
          id: 'tabelas',
          caminho: 'tabelas',
          titulo: 'Tabelas de preço',
          navegacao: 'Tabelas de preço',
          grupo: 'produtos',
          apps: ['web'],
          componente: 'X',
        },
        {
          id: 'de-para',
          caminho: 'de-para',
          titulo: 'Integração',
          navegacao: 'Integração',
          grupo: 'parametros',
          apps: ['web'],
          componente: 'X',
        },
        {
          id: 'pedidos',
          caminho: 'pedidos',
          titulo: 'Pedidos',
          navegacao: 'Pedidos',
          grupo: 'operacao',
          apps: ['web'],
          componente: 'X',
        },
      ],
    });
    const web = criarShell('web', [core, integracao]).montar({
      perfil: 'analista',
      modulosAtivos: ['core', 'integracao'],
    });
    expect(
      web.navegacao.filter((n) => n.modulo === 'integracao').map((n) => `${n.rotuloGrupo}:${n.rotulo}`),
    ).toEqual(['Operação:Pedidos', 'Parâmetros:Integração', 'Produtos:Tabelas de preço']);
  });
});
