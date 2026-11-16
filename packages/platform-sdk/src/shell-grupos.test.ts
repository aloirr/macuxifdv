/**
 * Grupos do menu do BKO (ADR 0050; spec docs/design/telas/bko-revisao.md §M2/§M6; R-20261114-192700):
 * 9 grupos em ordem alfabética, itens em ordem alfabética, transição dos grupos antigos pela tabela do SDK.
 */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import {
  compararGrupoMenu,
  compararRotuloMenu,
  criarShell,
  definirModuloShell,
  grupoDoMenu,
  GRUPOS_MENU,
  ROTULO_GRUPO_MENU,
  ROTULO_SECAO_PARAMETROS,
  SECOES_PARAMETROS,
} from './shell';

describe('GRUPOS_MENU e rótulos (ADR 0050 revista pela 0060)', () => {
  it('11 grupos, cada um com o rótulo; saem Comercial e Conteúdo de campo', () => {
    expect(GRUPOS_MENU).toEqual(['acesso', 'analise', 'cadastros', 'comunicacao', 'operacao', 'parametros', 'pesquisa', 'produtos', 'sistema', 'trade', 'treinamento']);
    expect(GRUPOS_MENU.map((g) => ROTULO_GRUPO_MENU[g])).toEqual([
      'Acesso',
      'Análise',
      'Cadastros',
      'Comunicação',
      'Operação',
      'Parâmetros',
      'Pesquisa',
      'Produtos',
      'Sistema',
      'Trade',
      'Treinamento',
    ]);
  });

  it('D1: alfabético com Parâmetros e Sistema fixos no fim, nesta ordem (aceita o grupo "Mais" do shell)', () => {
    const grupos = [...GRUPOS_MENU.map((id) => ({ id: id as string, titulo: ROTULO_GRUPO_MENU[id] })), { id: 'mais', titulo: 'Mais' }];
    expect(grupos.sort(compararGrupoMenu).map((g) => g.titulo)).toEqual([
      'Acesso',
      'Análise',
      'Cadastros',
      'Comunicação',
      'Mais',
      'Operação',
      'Pesquisa',
      'Produtos',
      'Trade',
      'Treinamento',
      'Parâmetros',
      'Sistema',
    ]);
  });

  it('13 seções de Parâmetros com os rótulos da spec e a Integração (De-para, R-20261115-110600)', () => {
    expect(SECOES_PARAMETROS.map((s) => ROTULO_SECAO_PARAMETROS[s])).toEqual([
      'Acesso',
      'Alertas',
      'Calendário',
      'Clientes',
      'Início',
      'Integração',
      'Metas e RV',
      'Pedidos',
      'Pesquisa',
      'Produtos',
      'Trade',
      'Treinamento',
      'Visitas',
    ]);
  });
});

describe('grupoDoMenu: grupo final com a transição dos grupos antigos', () => {
  it('grupo novo declarado vale como está; sem grupo = operacao', () => {
    expect(grupoDoMenu('gestor', { id: 'painel', grupo: 'analise' })).toBe('analise');
    expect(grupoDoMenu('vendedor', { id: 'pedidos' })).toBe('operacao');
    expect(grupoDoMenu('core', { id: 'qualquer', grupo: 'trade' })).toBe('trade');
  });

  it('transição: o grupo de antes vira o grupo final (ADR 0060)', () => {
    expect(grupoDoMenu('core', { id: 'usuarios', grupo: 'administracao' })).toBe('acesso');
    expect(grupoDoMenu('core', { id: 'clientes', grupo: 'operacao' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'clientes' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'recados', grupo: 'operacao' })).toBe('comunicacao');
    expect(grupoDoMenu('core', { id: 'produtos', grupo: 'cadastros' })).toBe('produtos');
    expect(grupoDoMenu('vendedor', { id: 'formas-pagamento', grupo: 'administracao' })).toBe('cadastros');
    expect(grupoDoMenu('vendedor', { id: 'transportadoras', grupo: 'comercial' })).toBe('cadastros');
    expect(grupoDoMenu('vendedor', { id: 'transportadoras', grupo: 'cadastros' })).toBe('cadastros');
    expect(grupoDoMenu('promotor', { id: 'cadastros', grupo: 'conteudo_campo' })).toBe('trade');
    expect(grupoDoMenu('promotor', { id: 'trade', grupo: 'analise' })).toBe('trade');
    expect(grupoDoMenu('pesquisa', { id: 'pesquisas', grupo: 'cadastros' })).toBe('pesquisa');
    expect(grupoDoMenu('treinamento', { id: 'trilhas', grupo: 'conteudo_campo' })).toBe('treinamento');
    expect(grupoDoMenu('integracao', { id: 'monitor', grupo: 'administracao' })).toBe('sistema');
  });

  it('transição para Parâmetros: a página fica no grupo parametros (não vira item)', () => {
    expect(grupoDoMenu('core', { id: 'perfis', grupo: 'acesso' })).toBe('parametros');
    expect(grupoDoMenu('core', { id: 'plano-rv', grupo: 'comercial' })).toBe('parametros');
    expect(grupoDoMenu('vendedor', { id: 'alcadas', grupo: 'cadastros' })).toBe('parametros');
    expect(grupoDoMenu('gestor', { id: 'regras-alerta', grupo: 'administracao' })).toBe('parametros');
  });

  it('página que já declara o grupo final não passa pela tabela', () => {
    expect(grupoDoMenu('core', { id: 'clientes', grupo: 'cadastros' })).toBe('cadastros');
    expect(grupoDoMenu('core', { id: 'recados', grupo: 'comunicacao' })).toBe('comunicacao');
    // o módulo escolheu outro grupo que não um "de" da tabela: vale o declarado
    expect(grupoDoMenu('core', { id: 'usuarios', grupo: 'sistema' })).toBe('sistema');
  });

  it("fora da tabela: 'administracao' cai em Sistema; 'comercial' e 'conteudo_campo' em Cadastros", () => {
    expect(grupoDoMenu('gestor', { id: 'nova-config', grupo: 'administracao' })).toBe('sistema');
    expect(grupoDoMenu('gestor', { id: 'outra', grupo: 'comercial' })).toBe('cadastros');
    expect(grupoDoMenu('gestor', { id: 'outra', grupo: 'conteudo_campo' })).toBe('cadastros');
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
