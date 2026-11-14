/**
 * Menu do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M3): ordem alfabética, Auditoria em Sistema,
 * grupo "Mais", grupo vazio, tela atual pela rota mais longa e a altura que decide entre "tudo aberto" e a sanfona.
 */
import { GRUPOS_MENU, ROTULO_GRUPO_MENU, type GrupoMenu } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { alturaDoMenu, cabeTudoAberto, grupoDaTela, hrefAtivo, montarGruposMenu, type EntradaNavegacao } from './menu-bko';
import { SHELL_WEB } from './modulos';

const n = (grupoMenu: GrupoMenu, caminho: string, rotulo: string, modulo = 'core'): EntradaNavegacao => ({
  grupoMenu,
  rotuloGrupo: ROTULO_GRUPO_MENU[grupoMenu],
  caminho,
  rotulo,
  testID: `nav-${modulo}-${caminho.replace(/\//g, '-')}`,
});

/** Administrador com os 8 módulos: as 34 páginas de módulo do §M2 (a 35ª é a Auditoria, da plataforma). */
const ADMIN: EntradaNavegacao[] = [
  n('acesso', 'usuarios', 'Usuários'),
  n('acesso', 'aparelhos', 'Aparelhos'),
  n('acesso', 'perfis', 'Perfis de acesso'),
  n('analise', 'metas', 'Metas'),
  n('analise', 'indicadores', 'Indicadores'),
  n('analise', 'trade', 'Trade marketing', 'promotor'),
  n('analise', 'ranking', 'Ranking', 'gestor'),
  n('analise', 'equipe', 'Painel da equipe', 'gestor'),
  n('cadastros', 'motivos', 'Motivos'),
  n('cadastros', 'clientes', 'Clientes'),
  n('cadastros', 'carteira', 'Carteira'),
  n('cadastros', 'filiais', 'Filiais'),
  n('cadastros', 'fotos-pdv', 'Fotos do PDV'),
  n('cadastros', 'coordenadas-sugeridas', 'Coordenadas sugeridas'),
  n('comercial', 'transportadoras', 'Transportadoras', 'vendedor'),
  n('comercial', 'alcadas', 'Alçadas', 'vendedor'),
  n('comercial', 'plano-rv', 'Plano de RV'),
  n('comercial', 'formas-pagamento', 'Formas de pagamento e prazos', 'vendedor'),
  n('comunicacao', 'recados', 'Recados'),
  n('comunicacao', 'regras-alerta', 'Regras de alerta', 'gestor'),
  n('comunicacao', 'alertas', 'Alertas', 'gestor'),
  n('conteudo_campo', 'treinamento', 'Trilhas', 'treinamento'),
  n('conteudo_campo', 'pesquisas', 'Pesquisas', 'pesquisa'),
  n('conteudo_campo', 'trade-cadastros', 'Trade', 'promotor'),
  n('operacao', 'visitas', 'Visitas'),
  n('operacao', 'pedidos', 'Pedidos', 'vendedor'),
  n('operacao', 'rotas', 'Rotas'),
  n('operacao', 'aprovacoes', 'Aprovações', 'gestor'),
  n('produtos', 'tabelas-preco', 'Tabelas de preço', 'catalogo'),
  n('produtos', 'catalogo', 'Catálogo', 'catalogo'),
  n('produtos', 'catalogo/marcas', 'Marcas concorrentes', 'catalogo'),
  n('produtos', 'produtos', 'Preço e custo'),
  n('sistema', 'integracao/carga-arquivo', 'Carga por arquivo', 'integracao'),
  n('sistema', 'integracao', 'Integração ERP', 'integracao'),
];

/** Assistente com Core + Vendedor (§M5, 3ª simulação): 11 páginas de módulo + Auditoria = 12 itens em 6 grupos. */
const ASSISTENTE: EntradaNavegacao[] = [
  n('operacao', 'pedidos', 'Pedidos', 'vendedor'),
  n('analise', 'indicadores', 'Indicadores'),
  n('analise', 'metas', 'Metas'),
  n('cadastros', 'carteira', 'Carteira'),
  n('cadastros', 'clientes', 'Clientes'),
  n('cadastros', 'filiais', 'Filiais'),
  n('comercial', 'alcadas', 'Alçadas', 'vendedor'),
  n('comercial', 'transportadoras', 'Transportadoras', 'vendedor'),
  n('operacao', 'rotas', 'Rotas'),
  n('operacao', 'visitas', 'Visitas'),
  n('produtos', 'catalogo', 'Catálogo', 'catalogo'),
];

/** Altura entre a marca e o rodapé no menu de 768 px (medida no BKO em 1366×768: 581 px; o shell mede a lista de verdade). */
const ALTURA_1366X768 = 581;

describe('menu do BKO: grupos e itens (§M2)', () => {
  const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true });

  it('9 grupos com título, em ordem alfabética pt-BR, e 35 itens', () => {
    expect(grupos.map((g) => g.titulo)).toEqual(['Acesso', 'Análise', 'Cadastros', 'Comercial', 'Comunicação', 'Conteúdo de campo', 'Operação', 'Produtos', 'Sistema']);
    expect(grupos.flatMap((g) => g.itens)).toHaveLength(35);
  });

  it('itens em ordem alfabética pt-BR, sem diferenciar acento e caixa', () => {
    const de = (id: string) => grupos.find((g) => g.id === id)?.itens.map((i) => i.label);
    expect(de('comercial')).toEqual(['Alçadas', 'Formas de pagamento e prazos', 'Plano de RV', 'Transportadoras']);
    expect(de('operacao')).toEqual(['Aprovações', 'Pedidos', 'Rotas', 'Visitas']);
    expect(de('produtos')).toEqual(['Catálogo', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço']);
  });

  it('Auditoria fica em Sistema, sem grupo "Plataforma"', () => {
    expect(grupos.find((g) => g.id === 'sistema')?.itens.map((i) => i.label)).toEqual(['Auditoria', 'Carga por arquivo', 'Integração ERP']);
    expect(grupos.find((g) => g.id === 'sistema')?.itens[0]).toEqual({ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' });
    expect(grupos.some((g) => g.titulo === 'Plataforma')).toBe(false);
  });

  it('sem acesso ao BKO não há Auditoria; grupo sem item não aparece', () => {
    const sem = montarGruposMenu({ navegacao: ADMIN.filter((e) => e.grupoMenu !== 'sistema'), plataforma: false });
    expect(sem.some((g) => g.id === 'sistema')).toBe(false);
    expect(montarGruposMenu({ navegacao: [], plataforma: false })).toEqual([]);
  });

  it('itens do slot menu.itens entram no grupo "Mais", na posição alfabética dele', () => {
    const com = montarGruposMenu({ navegacao: ADMIN, mais: [{ caminho: '/extra', rotulo: 'Extra', testID: 'nav-x-extra' }], plataforma: true });
    expect(com.map((g) => g.titulo)).toEqual(['Acesso', 'Análise', 'Cadastros', 'Comercial', 'Comunicação', 'Conteúdo de campo', 'Mais', 'Operação', 'Produtos', 'Sistema']);
    expect(com.find((g) => g.id === 'mais')?.itens).toEqual([{ href: '/extra', label: 'Extra', testId: 'nav-x-extra' }]);
  });

  it('o item do slot "Mais" ganha a barra inicial uma vez só', () => {
    const mais = montarGruposMenu({ navegacao: [], mais: [{ caminho: 'extra', rotulo: 'Extra', testID: 'nav-x-extra' }], plataforma: false });
    expect(mais[0]?.itens[0]?.href).toBe('/extra');
  });

  it('o título do grupo vem do rotuloGrupo do SDK', () => {
    expect(montarGruposMenu({ navegacao: [{ ...n('acesso', 'usuarios', 'Usuários'), rotuloGrupo: 'Acesso X' }], plataforma: false })[0]?.titulo).toBe('Acesso X');
  });
});

describe('menu do BKO: registro real dos 8 módulos (ADR 0050)', () => {
  const visao = SHELL_WEB.montar({ perfil: 'admin', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] });
  const grupos = montarGruposMenu({ navegacao: visao.navegacao, plataforma: true });
  const de = (id: GrupoMenu) => grupos.find((g) => g.id === id)?.itens.map((i) => i.testId) ?? [];

  it('só os grupos do §M2 (sem "Administração")', () => {
    const titulos = grupos.map((g) => g.titulo);
    expect(titulos.every((t) => Object.values(ROTULO_GRUPO_MENU).includes(t))).toBe(true);
    expect(grupos.map((g) => g.id)).toEqual(GRUPOS_MENU.filter((id) => grupos.some((g) => g.id === id)));
    expect(titulos).not.toContain('Administração');
  });

  it('Alertas e Recados em Comunicação; Clientes em Cadastros; Formas de pagamento em Comercial', () => {
    expect(de('comunicacao')).toEqual(expect.arrayContaining(['nav-gestor-alertas', 'nav-core-recados']));
    expect(de('operacao')).not.toEqual(expect.arrayContaining(['nav-gestor-alertas']));
    expect(de('cadastros')).toContain('nav-core-clientes');
    expect(de('comercial')).toContain('nav-vendedor-formas-pagamento');
  });
});

describe('menu do BKO: tela atual (§M3 item 4)', () => {
  const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true });
  const hrefs = grupos.flatMap((g) => g.itens.map((i) => i.href));

  it('vence a rota mais longa que casa', () => {
    expect(hrefAtivo('/catalogo/marcas', hrefs)).toBe('/catalogo/marcas');
    expect(hrefAtivo('/catalogo', hrefs)).toBe('/catalogo');
    expect(hrefAtivo('/catalogo/123', hrefs)).toBe('/catalogo');
    expect(hrefAtivo('/integracao/carga-arquivo', hrefs)).toBe('/integracao/carga-arquivo');
    expect(hrefAtivo('/pedidos/abc', hrefs)).toBe('/pedidos');
  });

  it('prefixo sem barra não casa; tela fora do menu não acende nada', () => {
    expect(hrefAtivo('/catalogos', hrefs)).toBeNull();
    expect(hrefAtivo('/usuarios-e-modulos', hrefs)).toBeNull();
    expect(grupoDaTela(grupos, null)).toBeNull();
  });

  it('o grupo da tela atual é o que contém o item', () => {
    expect(grupoDaTela(grupos, hrefAtivo('/catalogo/marcas', hrefs))).toBe('produtos');
    expect(grupoDaTela(grupos, hrefAtivo('/auditoria', hrefs))).toBe('sistema');
  });
});

describe('menu do BKO: altura e sanfona (§M3 itens 1–3)', () => {
  it('altura = 30 por título + 32 por item aberto + 2 entre grupos', () => {
    const grupos = montarGruposMenu({ navegacao: ASSISTENTE, plataforma: true });
    expect(grupos.map((g) => g.titulo)).toEqual(['Análise', 'Cadastros', 'Comercial', 'Operação', 'Produtos', 'Sistema']);
    expect(grupos.flatMap((g) => g.itens)).toHaveLength(12);
    expect(alturaDoMenu(grupos, 'todos')).toBe(6 * 30 + 12 * 32 + 5 * 2);
    expect(alturaDoMenu(grupos, new Set(['operacao']))).toBe(6 * 30 + 3 * 32 + 5 * 2);
    expect(alturaDoMenu([], 'todos')).toBe(0);
  });

  it('Assistente (12 itens em 6 grupos) cabe todo aberto em 1366×768', () => {
    expect(cabeTudoAberto(montarGruposMenu({ navegacao: ASSISTENTE, plataforma: true }), ALTURA_1366X768)).toBe(true);
  });

  it('Administrador (35 itens) não cabe: sanfona; com o maior grupo aberto ainda cabe', () => {
    const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true });
    expect(cabeTudoAberto(grupos, ALTURA_1366X768)).toBe(false);
    expect(alturaDoMenu(grupos, new Set(['cadastros']))).toBeLessThanOrEqual(ALTURA_1366X768);
  });
});
