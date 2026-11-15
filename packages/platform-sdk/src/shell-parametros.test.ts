/**
 * ADR 0058 (R-20261115-113500, -121000, -122000; spec docs/design/menu-parametros/spec.md): página Parâmetros montada
 * pelas seções declaradas pelos módulos, transição das páginas de parâmetro e módulos de vitrine desativados sem a
 * licença da empresa (a API continua revalidando: RN-CORE-01).
 */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarShell, definirModuloShell } from './shell';

const core = definirModuloShell({
  manifesto: defineModule({
    id: 'core',
    versao: '1.0.0',
    perfis: ['admin', 'analista', 'supervisor'],
    apps: { web: { menus: ['Clientes', 'Perfis de acesso', 'Motivos', 'Plano de RV'] } },
    acoes: { 'acesso.gerir_perfis': { perfis: ['admin'] }, 'parametro.farol': { perfis: ['admin', 'analista'] } },
  }),
  paginas: [
    { id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', grupo: 'cadastros', componente: 'Clientes' },
    { id: 'perfis', caminho: 'perfis', titulo: 'Perfis de acesso', navegacao: 'Perfis de acesso', grupo: 'acesso', acao: 'acesso.gerir_perfis', componente: 'Perfis' },
    { id: 'motivos', caminho: 'motivos', titulo: 'Motivos de não venda', navegacao: 'Motivos', grupo: 'cadastros', componente: 'Motivos' },
    { id: 'plano-rv', caminho: 'plano-rv', titulo: 'Plano de RV', navegacao: 'Plano de RV', grupo: 'comercial', componente: 'PlanoRv' },
  ],
  paineisParametros: [
    { id: 'farol', secao: 'clientes', titulo: 'Farol', ordem: 10, acao: 'parametro.farol', componente: 'Farol' },
    { id: 'curvas-abc', secao: 'clientes', titulo: 'Curvas ABC', ordem: 20, componente: 'Curvas' },
    { id: 'desconto', secao: 'produtos', titulo: 'Desconto máximo padrão', ordem: 10, componente: 'Desconto' },
    // painel declarado com o id da página em transição: substitui a página inteira
    { id: 'motivos', secao: 'visitas', titulo: 'Motivos de não venda', ordem: 10, caminhosAntigos: ['motivos-antigo'], componente: 'PainelMotivos' },
  ],
});

const catalogo = definirModuloShell({
  manifesto: defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista'], apps: { web: { menus: [] } } }),
  paineisParametros: [{ id: 'catalogo', secao: 'produtos', titulo: 'Catálogo', componente: 'Catalogo' }],
});

const promotor = definirModuloShell({
  manifesto: defineModule({ id: 'promotor', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista', 'promotor'], apps: { web: { menus: ['Trade', 'Trade marketing'] } } }),
  paginas: [
    { id: 'cadastros', caminho: 'trade-cadastros', titulo: 'Cadastros de trade', navegacao: 'Trade', grupo: 'conteudo_campo', componente: 'TradeCad' },
    { id: 'trade', caminho: 'trade', titulo: 'Trade marketing', navegacao: 'Trade marketing', grupo: 'analise', componente: 'TradeInd' },
  ],
  paineisParametros: [{ id: 'validade', secao: 'trade', titulo: 'Validade', componente: 'Validade' }],
});

const pesquisa = definirModuloShell({
  manifesto: defineModule({ id: 'pesquisa', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista'], apps: { web: { menus: ['Pesquisas'] } } }),
  paginas: [{ id: 'pesquisas', caminho: 'pesquisas', titulo: 'Pesquisas', navegacao: 'Pesquisas', grupo: 'cadastros', componente: 'Pesquisas' }],
});

const shell = criarShell('web', [core, catalogo, promotor, pesquisa]);
const TODOS = ['core', 'catalogo', 'promotor', 'pesquisa'] as const;

describe('página Parâmetros (ADR 0058)', () => {
  const visao = shell.montar({ perfil: 'admin', modulosAtivos: [...TODOS], modulosContratados: [...TODOS] });
  const secao = (s: string) => visao.parametros.find((x) => x.secao === s);

  it('seções com painel visível, em ordem alfabética do rótulo; caminho parametros/<secao>', () => {
    expect(visao.parametros.map((s) => s.rotulo)).toEqual(['Acesso', 'Clientes', 'Metas e RV', 'Produtos', 'Trade', 'Visitas']);
    expect(secao('clientes')).toMatchObject({ caminho: 'parametros/clientes', bloqueado: false });
  });

  it('painéis empilhados por `ordem`, depois pela ordem de dependência do módulo (core antes do catálogo)', () => {
    expect(secao('clientes')?.paineis.map((p) => p.titulo)).toEqual(['Farol', 'Curvas ABC']);
    expect(secao('produtos')?.paineis.map((p) => `${p.modulo}:${p.titulo}`)).toEqual(['core:Desconto máximo padrão', 'catalogo:Catálogo']);
    expect(secao('produtos')?.paineis[1]).toMatchObject({ ancora: 'catalogo-catalogo', testID: 'parametros-catalogo-catalogo', origem: 'painel' });
  });

  it('transição: a página de parâmetro vira painel (origem "pagina") e sai do menu', () => {
    expect(secao('acesso')?.paineis).toEqual([expect.objectContaining({ modulo: 'core', id: 'perfis', titulo: 'Perfis de acesso', origem: 'pagina', componente: 'Perfis' })]);
    expect(secao('metas-e-rv')?.paineis.map((p) => p.id)).toEqual(['plano-rv']);
    const ids = visao.navegacao.map((n) => n.testID);
    expect(ids).not.toContain('nav-core-perfis');
    expect(ids).not.toContain('nav-core-plano-rv');
    expect(ids).not.toContain('nav-core-motivos');
    expect(visao.navegacao.some((n) => n.grupoMenu === 'parametros')).toBe(false);
  });

  it('painel declarado com o id da página em transição substitui a página', () => {
    expect(secao('visitas')?.paineis).toEqual([expect.objectContaining({ id: 'motivos', origem: 'painel', componente: 'PainelMotivos' })]);
  });

  it('links antigos levam à seção com a âncora do painel', () => {
    expect(visao.destinoParametros('/perfis')).toBe('/parametros/acesso#core-perfis');
    expect(visao.destinoParametros('plano-rv')).toBe('/parametros/metas-e-rv#core-plano-rv');
    expect(visao.destinoParametros('motivos')).toBe('/parametros/visitas#core-motivos');
    expect(visao.destinoParametros('motivos-antigo')).toBe('/parametros/visitas#core-motivos');
    expect(visao.destinoParametros('clientes')).toBeNull();
  });

  it('painel e página respeitam a ação do perfil; seção sem painel visível some', () => {
    const sup = shell.montar({ perfil: 'supervisor', modulosAtivos: ['core'], modulosContratados: ['core'] });
    expect(sup.parametros.find((s) => s.secao === 'clientes')?.paineis.map((p) => p.titulo)).toEqual(['Curvas ABC']);
    expect(sup.parametros.some((s) => s.secao === 'acesso')).toBe(false);
    expect(sup.destinoParametros('perfis')).toBeNull();
  });

  it('D8: o grupo Trade com Cadastros e Indicadores (rótulo da transição)', () => {
    expect(visao.navegacao.filter((n) => n.grupoMenu === 'trade').map((n) => n.rotulo)).toEqual(['Cadastros', 'Indicadores']);
    expect(visao.navegacao.find((n) => n.id === 'pesquisas')).toMatchObject({ grupoMenu: 'pesquisa', rotuloGrupo: 'Pesquisa' });
  });

  it('o app ignora os painéis de Parâmetros', () => {
    const app = criarShell('campo', [definirModuloShell({ ...core, manifesto: defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], apps: { campo: { abas: [] } } }), paginas: [] })]);
    expect(app.montar({ perfil: 'vendedor', modulosAtivos: ['core'] }).parametros).toEqual([]);
  });
});

describe('módulo de vitrine sem a licença da empresa (ADR 0058)', () => {
  const semTrade = shell.montar({ perfil: 'admin', modulosAtivos: ['core', 'catalogo'], modulosContratados: ['core', 'catalogo'] });

  it('itens aparecem bloqueados, no grupo final, e a página não abre', () => {
    const bloqueados = semTrade.navegacao.filter((n) => n.bloqueado).map((n) => `${n.rotuloGrupo}:${n.rotulo}`);
    expect(bloqueados).toEqual(['Pesquisa:Pesquisas', 'Trade:Cadastros', 'Trade:Indicadores']);
    expect(semTrade.pagina('trade')).toBeNull();
    expect(semTrade.pagina('pesquisas')).toBeNull();
    expect(semTrade.navegacao.find((n) => n.id === 'clientes')?.bloqueado).toBeUndefined();
  });

  it('a seção de Parâmetros do módulo aparece bloqueada e sem painéis', () => {
    expect(semTrade.parametros.find((s) => s.secao === 'trade')).toMatchObject({ bloqueado: true, paineis: [] });
    expect(semTrade.parametros.find((s) => s.secao === 'pesquisa')).toMatchObject({ bloqueado: true, paineis: [] });
  });

  it('empresa contratou e o perfil não tem o módulo: some, como antes (RN-CORE-01)', () => {
    const v = shell.montar({ perfil: 'admin', modulosAtivos: ['core'], modulosContratados: [...TODOS] });
    expect(v.navegacao.some((n) => n.modulo === 'promotor' || n.modulo === 'pesquisa')).toBe(false);
    expect(v.parametros.some((s) => s.secao === 'trade' || s.secao === 'pesquisa')).toBe(false);
  });

  it('módulo fora da vitrine (catálogo) some sem licença, como antes', () => {
    const v = shell.montar({ perfil: 'admin', modulosAtivos: ['core'], modulosContratados: ['core'] });
    expect(v.parametros.find((s) => s.secao === 'produtos')?.paineis.map((p) => p.modulo)).toEqual(['core']);
  });

  it('perfil que o módulo não atende não vê o cadeado', () => {
    const v = shell.montar({ perfil: 'supervisor', modulosAtivos: ['core'], modulosContratados: ['core'] });
    expect(v.navegacao.some((n) => n.bloqueado)).toBe(false);
    expect(v.parametros.some((s) => s.bloqueado)).toBe(false);
  });

  it('sem modulosContratados nada fica bloqueado (compatível)', () => {
    const v = shell.montar({ perfil: 'admin', modulosAtivos: ['core'] });
    expect(v.navegacao.some((n) => n.bloqueado)).toBe(false);
    expect(v.parametros.some((s) => s.bloqueado)).toBe(false);
  });
});

describe('validação dos painéis (ADR 0058)', () => {
  it('painel repetido e ação desconhecida estouram na montagem', () => {
    const ruim = definirModuloShell({
      manifesto: defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], apps: { web: { menus: [] } } }),
      paineisParametros: [
        { id: 'x', secao: 'acesso', titulo: 'X', componente: 'X' },
        { id: 'x', secao: 'acesso', titulo: 'X', acao: 'nao.existe', caminhosAntigos: ['/barra'], componente: 'X' },
      ],
    });
    expect(() => criarShell('web', [ruim])).toThrow(/painel de parâmetros core\/x repetido.*ação nao\.existe.*caminho antigo sem barra inicial/);
  });
});
