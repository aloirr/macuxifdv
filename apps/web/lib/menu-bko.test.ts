/**
 * Menu do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M3; ADR 0060, spec docs/design/menu-parametros/spec.md
 * §2–§3): ordem (alfabética, Parâmetros e Sistema fixos no fim), item direto (D9), vitrine sem licença (cadeado), Auditoria em
 * Sistema, grupo "Mais", grupo vazio, tela atual pela rota mais longa, a altura que decide entre "tudo aberto" e a sanfona e
 * os endereços antigos que viraram Parâmetros.
 */
import { ROTULO_GRUPO_MENU, type GrupoMenu } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import {
  alturaDoMenu,
  cabeTudoAberto,
  destinoComBusca,
  grupoDaTela,
  hrefAtivo,
  hrefsNavegaveis,
  montarGruposMenu,
  type EntradaNavegacao,
  type GrupoMenuBko,
} from './menu-bko';
import { montarMenuAdmin, TODOS_MODULOS } from './menu-bko.fixture';

const n = (grupoMenu: GrupoMenu, caminho: string, rotulo: string, modulo = 'core', bloqueado = false): EntradaNavegacao => ({
  grupoMenu,
  rotuloGrupo: ROTULO_GRUPO_MENU[grupoMenu],
  caminho,
  rotulo,
  testID: `nav-${modulo}-${caminho.replace(/\//g, '-')}`,
  ...(bloqueado ? { bloqueado: true } : {}),
});

/** Administrador com os 8 módulos: o menu final da spec (§2), 28 páginas de módulo (+ Auditoria e Parâmetros, da plataforma). */
const ADMIN: EntradaNavegacao[] = [
  n('acesso', 'usuarios', 'Usuários'),
  n('acesso', 'aparelhos', 'Aparelhos'),
  n('analise', 'metas', 'Metas'),
  n('analise', 'indicadores', 'Indicadores'),
  n('analise', 'ranking', 'Ranking', 'gestor'),
  n('analise', 'equipe', 'Painel da equipe', 'gestor'),
  n('cadastros', 'clientes', 'Clientes'),
  n('cadastros', 'carteira', 'Carteira'),
  n('cadastros', 'filiais', 'Filiais'),
  n('cadastros', 'coordenadas-sugeridas', 'Coordenadas sugeridas'),
  n('cadastros', 'transportadoras', 'Transportadoras', 'vendedor'),
  n('cadastros', 'formas-pagamento', 'Formas de pagamento e prazos', 'vendedor'),
  n('comunicacao', 'recados', 'Recados'),
  n('comunicacao', 'alertas', 'Alertas', 'gestor'),
  n('operacao', 'visitas', 'Visitas'),
  n('operacao', 'pedidos', 'Pedidos', 'vendedor'),
  n('operacao', 'rotas', 'Rotas'),
  n('operacao', 'aprovacoes', 'Aprovações', 'gestor'),
  n('pesquisa', 'pesquisas', 'Pesquisas', 'pesquisa'),
  n('produtos', 'tabelas-preco', 'Tabelas de preço', 'catalogo'),
  n('produtos', 'catalogo', 'Catálogo', 'catalogo'),
  n('produtos', 'catalogo/marcas', 'Marcas concorrentes', 'catalogo'),
  n('produtos', 'produtos', 'Preço e custo'),
  n('trade', 'trade-cadastros', 'Cadastros', 'promotor'),
  n('trade', 'trade', 'Indicadores', 'promotor'),
  n('treinamento', 'trilhas', 'Trilhas', 'treinamento'),
  n('sistema', 'integracao/carga-arquivo', 'Carga por arquivo', 'integracao'),
  n('sistema', 'integracao', 'Integração ERP', 'integracao'),
];

/** Assistente com Core + Vendedor: 9 páginas de módulo + Auditoria + Parâmetros. */
const ASSISTENTE: EntradaNavegacao[] = [
  n('operacao', 'pedidos', 'Pedidos', 'vendedor'),
  n('analise', 'indicadores', 'Indicadores'),
  n('analise', 'metas', 'Metas'),
  n('cadastros', 'carteira', 'Carteira'),
  n('cadastros', 'clientes', 'Clientes'),
  n('cadastros', 'filiais', 'Filiais'),
  n('cadastros', 'transportadoras', 'Transportadoras', 'vendedor'),
  n('operacao', 'rotas', 'Rotas'),
  n('operacao', 'visitas', 'Visitas'),
  n('produtos', 'catalogo', 'Catálogo', 'catalogo'),
];

/** Altura entre a marca e o rodapé no menu de 768 px (medida no BKO em 1366×768: 581 px; o shell mede a lista de verdade). */
const ALTURA_1366X768 = 581;

const de = (grupos: readonly GrupoMenuBko[], id: string) => grupos.find((g) => g.id === id);

describe('menu do BKO: entradas de 1º nível (spec §2, ADR 0060)', () => {
  const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true, parametros: true });

  it('11 entradas: alfabéticas, com Parâmetros e Sistema fixos no fim (D1); sem Comercial nem Conteúdo de campo', () => {
    expect(grupos.map((g) => g.titulo)).toEqual(['Acesso', 'Análise', 'Cadastros', 'Comunicação', 'Operação', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Parâmetros', 'Sistema']);
    expect(grupos.flatMap((g) => g.itens)).toHaveLength(30);
  });

  it('D9: grupo de um item só vira item direto, com o testID do item; os demais continuam grupos', () => {
    expect(grupos.filter((g) => g.direto).map((g) => g.id)).toEqual(['pesquisa', 'treinamento', 'parametros']);
    expect(de(grupos, 'pesquisa')).toMatchObject({ titulo: 'Pesquisa', testId: 'nav-pesquisa-pesquisas', itens: [{ href: '/pesquisas' }] });
    expect(de(grupos, 'parametros')).toMatchObject({ titulo: 'Parâmetros', direto: true, testId: 'nav-plataforma-parametros', itens: [{ href: '/parametros' }] });
    expect(de(grupos, 'trade')).toMatchObject({ direto: false, testId: 'nav-grupo-trade' });
    // item direto que ganha a segunda página volta a ser grupo
    const dois = montarGruposMenu({ navegacao: [...ADMIN, n('pesquisa', 'pesquisa-resultados', 'Resultados', 'pesquisa')], plataforma: true, parametros: true });
    expect(de(dois, 'pesquisa')).toMatchObject({ direto: false, testId: 'nav-grupo-pesquisa' });
  });

  it('itens em ordem alfabética pt-BR, sem diferenciar acento e caixa', () => {
    const itens = (id: string) => de(grupos, id)?.itens.map((i) => i.label);
    expect(itens('cadastros')).toEqual(['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras']);
    expect(itens('operacao')).toEqual(['Aprovações', 'Pedidos', 'Rotas', 'Visitas']);
    expect(itens('produtos')).toEqual(['Catálogo', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço']);
    expect(itens('trade')).toEqual(['Cadastros', 'Indicadores']);
  });

  it('sem seção de Parâmetros não há o item Parâmetros', () => {
    expect(de(montarGruposMenu({ navegacao: ADMIN, plataforma: true }), 'parametros')).toBeUndefined();
  });

  it('página de módulo no grupo Parâmetros em parametros/<secao> não vira item (é seção da página Parâmetros)', () => {
    const com = montarGruposMenu({ navegacao: [...ADMIN, n('parametros', 'parametros/integracao', 'Integração', 'integracao')], plataforma: true, parametros: true });
    expect(de(com, 'parametros')).toMatchObject({ direto: true, itens: [{ href: '/parametros' }] });
  });

  it('Auditoria fica em Sistema, sem grupo "Plataforma"', () => {
    expect(de(grupos, 'sistema')?.itens.map((i) => i.label)).toEqual(['Auditoria', 'Carga por arquivo', 'Integração ERP']);
    expect(de(grupos, 'sistema')?.itens[0]).toEqual({ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' });
    expect(grupos.some((g) => g.titulo === 'Plataforma')).toBe(false);
  });

  it('sem acesso ao BKO não há Auditoria; grupo sem item não aparece', () => {
    const sem = montarGruposMenu({ navegacao: ADMIN.filter((e) => e.grupoMenu !== 'sistema'), plataforma: false });
    expect(sem.some((g) => g.id === 'sistema')).toBe(false);
    expect(montarGruposMenu({ navegacao: [], plataforma: false })).toEqual([]);
  });

  it('itens do slot menu.itens entram no grupo "Mais", na posição alfabética dele (antes dos fixos do fim)', () => {
    const extra = [
      { caminho: '/extra', rotulo: 'Extra', testID: 'nav-x-extra' },
      { caminho: 'outro', rotulo: 'Outro', testID: 'nav-x-outro' },
    ];
    const com = montarGruposMenu({ navegacao: ADMIN, mais: extra, plataforma: true, parametros: true });
    expect(com.map((g) => g.titulo).slice(-5)).toEqual(['Produtos', 'Trade', 'Treinamento', 'Parâmetros', 'Sistema']);
    expect(com.map((g) => g.titulo).indexOf('Mais')).toBe(4);
    expect(de(com, 'mais')?.itens).toEqual([
      { href: '/extra', label: 'Extra', testId: 'nav-x-extra' },
      { href: '/outro', label: 'Outro', testId: 'nav-x-outro' },
    ]);
  });

  it('o título do grupo vem do rotuloGrupo do SDK', () => {
    expect(montarGruposMenu({ navegacao: [{ ...n('acesso', 'usuarios', 'Usuários'), rotuloGrupo: 'Acesso X' }], plataforma: false })[0]?.titulo).toBe('Acesso X');
  });
});

describe('menu do BKO: vitrine sem licença (ADR 0060, spec §3)', () => {
  const navegacao = [
    ...ADMIN.filter((e) => !['pesquisa', 'treinamento'].includes(e.grupoMenu)),
    n('pesquisa', 'pesquisas', 'Pesquisas', 'pesquisa', true),
    n('treinamento', 'trilhas', 'Trilhas', 'treinamento', true),
  ];
  const grupos = montarGruposMenu({ navegacao, plataforma: true, parametros: true });

  it('grupo com todos os itens bloqueados fica na posição dele, bloqueado; os outros não', () => {
    expect(grupos.filter((g) => g.bloqueado).map((g) => g.id)).toEqual(['pesquisa', 'treinamento']);
    expect(grupos.map((g) => g.id).indexOf('pesquisa')).toBe(5);
  });

  it('a tela atual nunca acende entrada bloqueada', () => {
    const hrefs = hrefsNavegaveis(grupos);
    expect(hrefs).not.toContain('/pesquisas');
    expect(hrefAtivo('/pesquisas', hrefs)).toBeNull();
    expect(grupoDaTela(grupos, '/pesquisas')).toBeNull();
  });

  it('grupo misto: o item bloqueado não aparece', () => {
    const misto = montarGruposMenu({ navegacao: [n('trade', 'trade', 'Indicadores', 'promotor'), n('trade', 'x', 'X', 'pesquisa', true)], plataforma: false });
    expect(misto).toEqual([{ id: 'trade', titulo: 'Trade', itens: [{ href: '/trade', label: 'Indicadores', testId: 'nav-promotor-trade' }], direto: true, bloqueado: false, testId: 'nav-promotor-trade' }]);
  });

  it('o balão da entrada bloqueada fica fora da lista: a altura é a mesma de uma entrada só com o título', () => {
    const semBloqueio = grupos.map((g) => ({ ...g, bloqueado: false, direto: true }));
    expect(alturaDoMenu(grupos, new Set())).toBe(alturaDoMenu(semBloqueio, new Set()));
  });
});

describe('menu do BKO: registro real dos 8 módulos com menuParametros (ADRs 0050 e 0060)', () => {
  const { visao, secoes, grupos } = montarMenuAdmin();
  const testIds = (id: GrupoMenu) => de(grupos, id)?.itens.map((i) => i.testId) ?? [];

  it('a árvore da spec §2: 11 entradas, Parâmetros e Sistema no fim, sem Administração, Comercial e Conteúdo de campo', () => {
    expect(grupos.map((g) => g.titulo)).toEqual(['Acesso', 'Análise', 'Cadastros', 'Comunicação', 'Operação', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Parâmetros', 'Sistema']);
    expect(grupos.filter((g) => g.direto).map((g) => g.id)).toEqual(['pesquisa', 'treinamento', 'parametros']);
  });

  it('Alertas e Recados em Comunicação; Clientes, Formas de pagamento e Transportadoras em Cadastros; Trade com Cadastros e Indicadores', () => {
    expect(testIds('comunicacao')).toEqual(['nav-gestor-alertas', 'nav-core-recados']);
    expect(testIds('cadastros')).toEqual(expect.arrayContaining(['nav-core-clientes', 'nav-vendedor-formas-pagamento', 'nav-vendedor-transportadoras']));
    expect(de(grupos, 'trade')?.itens.map((i) => i.label)).toEqual(['Cadastros', 'Indicadores']);
  });

  it('as páginas que viraram Parâmetros saem do menu e os endereços antigos têm destino', () => {
    const todos = grupos.flatMap((g) => g.itens.map((i) => i.testId));
    for (const t of ['nav-core-perfis', 'nav-core-motivos', 'nav-core-fotos-pdv', 'nav-core-plano-rv', 'nav-vendedor-alcadas', 'nav-integracao-de-para'])
      expect(todos).not.toContain(t);
    expect(visao.destinoParametros('/perfis')).toBe('/parametros/acesso#core-perfis');
    expect(visao.destinoParametros('usuarios-e-modulos')).toBe('/parametros/acesso#core-usuarios-e-modulos');
    expect(visao.destinoParametros('motivos')).toBe('/parametros/visitas#core-motivos');
    expect(visao.destinoParametros('fotos-pdv')).toBe('/parametros/visitas#core-fotos-pdv');
    expect(visao.destinoParametros('plano-rv')).toBe('/parametros/metas-e-rv#core-plano-rv');
    expect(visao.destinoParametros('alcadas')).toBe('/parametros/pedidos#vendedor-alcadas');
    expect(visao.destinoParametros('/clientes')).toBeNull();
    expect(visao.destinoParametros('formas-pagamento')).toBeNull();
  });

  it('página Parâmetros: 13 seções em ordem alfabética; de-para da Integração como página e Alertas com os 2 painéis do gestor (RD-1988)', () => {
    expect(secoes.map((s) => s.rotulo)).toEqual(['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Início', 'Integração', 'Metas e RV', 'Pedidos', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Visitas']);
    const paineis = (secao: string) => secoes.find((s) => s.secao === secao)?.paineis.map((p) => `${p.ancora}:${p.origem}`);
    expect(paineis('integracao')).toEqual(['integracao-de-para:pagina']);
    expect(paineis('alertas')).toEqual(['gestor-regras-alerta:painel', 'gestor-produtividade:painel']);
    expect(paineis('acesso')).toEqual(['core-perfis:painel', 'core-usuarios-e-modulos:painel', 'core-promotor-pedidos:painel']);
    expect(paineis('pedidos')).toEqual(['vendedor-alcadas:painel']);
  });

  it('sem modulosContratados nada fica bloqueado; com a empresa sem Pesquisa e Treinamento, os dois aparecem com cadeado', () => {
    expect(grupos.some((g) => g.bloqueado)).toBe(false);
    const ativos = TODOS_MODULOS.filter((m) => m !== 'pesquisa' && m !== 'treinamento');
    const r = montarMenuAdmin(ativos, ativos);
    expect(r.grupos.filter((x) => x.bloqueado).map((x) => x.id)).toEqual(['pesquisa', 'treinamento']);
    expect(r.secoes.filter((s) => s.bloqueado).map((s) => s.secao)).toEqual(['pesquisa', 'treinamento']);
    expect(r.visao.pagina('pesquisas')).toBeNull();
  });

  it('empresa com o módulo e o perfil sem ele: some (é permissão, não contratação)', () => {
    const r = montarMenuAdmin(
      TODOS_MODULOS.filter((m) => m !== 'pesquisa'),
      TODOS_MODULOS,
    );
    expect(de(r.grupos, 'pesquisa')).toBeUndefined();
    expect(r.secoes.some((s) => s.secao === 'pesquisa')).toBe(false);
  });

  it('sem barra de rolagem em 1366×768 (spec §3 e §5): pior caso Cadastros (6 itens) cabe mesmo com um rótulo em 2 linhas', () => {
    /** Rótulo que quebra a linha ("Formas de pagamento e prazos"): +20 px (linha de 20 px). */
    const QUEBRA = 20;
    const pior = Math.max(...grupos.map((g) => alturaDoMenu(grupos, new Set([g.id]))));
    expect(pior).toBe(alturaDoMenu(grupos, new Set(['cadastros'])));
    expect(pior).toBe(11 * 30 + 6 * 32 + 10 * 2);
    expect(pior + QUEBRA).toBeLessThanOrEqual(ALTURA_1366X768);
  });
});

describe('menu do BKO: tela atual (§M3 item 4)', () => {
  const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true, parametros: true });
  const hrefs = hrefsNavegaveis(grupos);

  it('vence a rota mais longa que casa', () => {
    expect(hrefAtivo('/catalogo/marcas', hrefs)).toBe('/catalogo/marcas');
    expect(hrefAtivo('/catalogo', hrefs)).toBe('/catalogo');
    expect(hrefAtivo('/catalogo/123', hrefs)).toBe('/catalogo');
    expect(hrefAtivo('/integracao/carga-arquivo', hrefs)).toBe('/integracao/carga-arquivo');
    expect(hrefAtivo('/pedidos/abc', hrefs)).toBe('/pedidos');
    expect(hrefAtivo('/parametros/clientes', hrefs)).toBe('/parametros');
  });

  it('prefixo sem barra não casa; tela fora do menu não acende nada', () => {
    expect(hrefAtivo('/catalogos', hrefs)).toBeNull();
    expect(hrefAtivo('/usuarios-e-modulos', hrefs)).toBeNull();
    expect(grupoDaTela(grupos, null)).toBeNull();
  });

  it('o grupo da tela atual é o que contém o item', () => {
    expect(grupoDaTela(grupos, hrefAtivo('/catalogo/marcas', hrefs))).toBe('produtos');
    expect(grupoDaTela(grupos, hrefAtivo('/auditoria', hrefs))).toBe('sistema');
    expect(grupoDaTela(grupos, hrefAtivo('/parametros/acesso', hrefs))).toBe('parametros');
  });
});

describe('menu do BKO: altura e sanfona (§M3 itens 1–3)', () => {
  it('altura = 30 por entrada + 32 por item aberto (item direto e bloqueado não abrem) + 2 entre entradas', () => {
    const grupos = montarGruposMenu({ navegacao: ASSISTENTE, plataforma: true, parametros: true });
    expect(grupos.map((g) => g.titulo)).toEqual(['Análise', 'Cadastros', 'Operação', 'Produtos', 'Parâmetros', 'Sistema']);
    expect(grupos.filter((g) => g.direto).map((g) => g.id)).toEqual(['produtos', 'parametros', 'sistema']);
    expect(alturaDoMenu(grupos, 'todos')).toBe(6 * 30 + (2 + 4 + 3) * 32 + 5 * 2);
    expect(alturaDoMenu(grupos, new Set(['operacao', 'parametros']))).toBe(6 * 30 + 3 * 32 + 5 * 2);
    expect(alturaDoMenu([], 'todos')).toBe(0);
  });

  it('Assistente cabe todo aberto em 1366×768', () => {
    expect(cabeTudoAberto(montarGruposMenu({ navegacao: ASSISTENTE, plataforma: true, parametros: true }), ALTURA_1366X768)).toBe(true);
  });

  it('Administrador não cabe todo aberto: sanfona; com o maior grupo (Cadastros, 6) aberto cabe (spec §2)', () => {
    const grupos = montarGruposMenu({ navegacao: ADMIN, plataforma: true, parametros: true });
    expect(alturaDoMenu(grupos, new Set())).toBe(11 * 30 + 10 * 2);
    expect(cabeTudoAberto(grupos, ALTURA_1366X768)).toBe(false);
    expect(alturaDoMenu(grupos, new Set(['cadastros']))).toBeLessThanOrEqual(ALTURA_1366X768);
  });
});

describe('destinoComBusca (endereço antigo → Parâmetros, ADR 0060)', () => {
  it('acrescenta a query atual antes da âncora e não mexe no destino sem query', () => {
    expect(destinoComBusca('/parametros/acesso#core-usuarios-e-modulos', '?modulos_perfil=promotor')).toBe('/parametros/acesso?modulos_perfil=promotor#core-usuarios-e-modulos');
    expect(destinoComBusca('/parametros/acesso', 'novo=1')).toBe('/parametros/acesso?novo=1');
    expect(destinoComBusca('/parametros/acesso?a=1#x', '?b=2')).toBe('/parametros/acesso?a=1&b=2#x');
    expect(destinoComBusca('/parametros/acesso#core-perfis', '')).toBe('/parametros/acesso#core-perfis');
    expect(destinoComBusca('/parametros/acesso#core-perfis', '?')).toBe('/parametros/acesso#core-perfis');
  });
});
