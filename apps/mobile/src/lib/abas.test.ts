/**
 * T-0034: abas da barra inferior a partir da visão do shell (módulo efetivo = manifesto + licença + perfil + ação).
 * Páginas de exemplo com os rótulos que os manifestos REAIS declaram (`apps.<variante>.abas`), montadas no
 * `criarShell` real: nenhuma aba sem licença ou perfil, o promotor nunca vê aba de pedido (RN-PRO-01) e,
 * passando do limite, o excedente vai para "Mais" no Campo e para o menu do Perfil no Gestão (Mc161 A).
 */
import { criarShell, definirModuloShell, modulosEfetivos, type ItemNavegacao, type ModuloId, type ModuloShell, type PaginaShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { abaAcesa, abaAtiva, abasDaVariante, abasDoShell, HREF_MAIS, MAX_ABAS_BARRA, MAX_ABAS_POR_VARIANTE } from './abas';
import { efetivosSemServidor } from './efetivos-locais';
import { MANIFESTOS_INSTALADOS } from './instalados';

type Pg = PaginaShell<string>;
const pg = (id: string, navegacao: string, extra: Partial<Pg> = {}): Pg => ({ id, caminho: id, titulo: navegacao, navegacao, componente: id, ...extra });

/** Telas de exemplo por módulo (os rótulos são os declarados nos manifestos reais). */
const PAGINAS: Partial<Record<ModuloId, Pg[]>> = {
  // ordem igual à de modules/core/app (Rota 20, Clientes 30, Performance 50); Pedidos sem ordem (100), como hoje
  core: [pg('rota', 'Rota', { apps: ['campo'], ordem: 20 }), pg('clientes', 'Clientes', { apps: ['campo', 'gestao'], ordem: 30 }), pg('performance', 'Performance', { apps: ['campo'], ordem: 50 })],
  catalogo: [pg('catalogo', 'Catálogo', { apps: ['campo', 'gestao'], acao: 'produto.consultar' })],
  // como em modules/vendedor/app/index.ts: a página de pedidos declara os perfis do manifesto do Vendedor (sem promotor)
  vendedor: [pg('pedidos', 'Pedidos', { apps: ['campo', 'gestao'], perfis: MANIFESTOS_INSTALADOS.find((m) => m.id === 'vendedor')!.perfis })],
  promotor: [pg('loja', 'Loja', { apps: ['campo'], acao: 'coleta.registrar' }), pg('trade', 'Trade', { apps: ['gestao'] })],
  gestor: [pg('equipe', 'Equipe', { apps: ['gestao'], acao: 'painel_equipe.ver' }), pg('aprovacoes', 'Aprovações', { apps: ['gestao'], acao: 'fila_aprovacao.ver' }), pg('alertas', 'Alertas', { apps: ['gestao'], acao: 'alerta_equipe.ver' })],
};

const MODULOS: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) =>
  definirModuloShell<string>({ manifesto: m, paginas: PAGINAS[m.id] ?? [] }),
);

function rotulos(variante: 'campo' | 'gestao', perfil: Perfil, licenciados: ModuloId[], doPerfil: ModuloId[]) {
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant: licenciados, doPerfil });
  const { barra, mais } = abasDoShell(criarShell(variante, MODULOS).montar({ perfil, modulosAtivos: ativos }).navegacao);
  return { barra: barra.map((a) => a.label), mais: mais.map((a) => a.label), todas: [...barra, ...mais].map((a) => a.label) };
}

const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento'];

describe('T-0034 — abas do shell mobile', () => {
  it('Campo do vendedor: até 5 posições na barra; com o Catálogo licenciado o excedente vai para "Mais"', () => {
    const r = rotulos('campo', 'vendedor', ['core', 'vendedor', 'catalogo'], ['core', 'vendedor', 'catalogo']);
    // Catálogo licenciado e com página ⇒ entra; 6 destinos ⇒ 3 na barra + "Mais"
    expect(r.todas).toEqual(['Início', 'Rota', 'Clientes', 'Performance', 'Mais', 'Catálogo', 'Pedidos']);
    expect(r.barra).toHaveLength(MAX_ABAS_BARRA);
    const sem = rotulos('campo', 'vendedor', ['core', 'vendedor'], ['core', 'vendedor']);
    // sem o Catálogo licenciado o Vendedor sai em cascata (RN-CORE-03): nem Catálogo nem Pedidos
    expect(sem.barra).toEqual(['Início', 'Rota', 'Clientes', 'Performance']);
    expect(sem.mais).toEqual([]);
  });

  it('T-0170: o Campo tem 6 posições (4 abas de módulo e o "Mais")', () => {
    const item = (id: string, rotulo: string) => ({ modulo: 'core', id, caminho: id, rotulo, icone: 'file' }) as unknown as ItemNavegacao<unknown>;
    const nav = [item('rota', 'Rota'), item('clientes', 'Clientes'), item('pedidos', 'Pedidos'), item('performance', 'Performance'), item('catalogo', 'Catálogo'), item('pesquisas', 'Pesquisas')];
    const { barra, mais } = abasDoShell(nav, MAX_ABAS_POR_VARIANTE.campo);
    expect(barra.map((a) => a.label)).toEqual(['Início', 'Rota', 'Clientes', 'Pedidos', 'Performance', 'Mais']);
    expect(mais.map((a) => a.label)).toEqual(['Catálogo', 'Pesquisas']);
    // até 5 destinos de módulo cabem sem o "Mais"
    expect(abasDoShell(nav.slice(0, 5), MAX_ABAS_POR_VARIANTE.campo).mais).toEqual([]);
  });

  it('T-0187 (P6 A): o Gestão tem 6 posições: Início · Equipe · Rota · Aprovações · Clientes · Alertas', () => {
    expect(MAX_ABAS_POR_VARIANTE).toEqual({ campo: 6, gestao: 6 });
    const item = (modulo: string, id: string, rotulo: string) => ({ modulo, id, caminho: id, rotulo, icone: 'file' }) as unknown as ItemNavegacao<unknown>;
    const nav = [item('gestor', 'equipe', 'Equipe'), item('core', 'rota-gestao', 'Rota'), item('gestor', 'aprovacoes', 'Aprovações'), item('core', 'clientes', 'Clientes'), item('gestor', 'alertas', 'Alertas')];
    const { barra, mais, perfil } = abasDaVariante(nav, 'gestao');
    expect(barra.map((a) => a.label)).toEqual(['Início', 'Equipe', 'Rota', 'Aprovações', 'Clientes', 'Alertas']);
    expect(mais).toEqual([]);
    expect(perfil).toEqual([]);
  });

  it('Mc161 A (R-20261119-212852): o Gestão nunca tem "Mais"; Alertas fica em 6º e o excedente vai para o menu do Perfil', () => {
    const item = (modulo: string, id: string, rotulo: string, icone = 'file') => ({ modulo, id, caminho: id, rotulo, icone }) as unknown as ItemNavegacao<unknown>;
    // a navegação do shell vem pela `ordem` das páginas: Equipe 10, Rota 20, Aprovações 20, Clientes 30, Pedidos 40,
    // Catálogo 60, Alertas sem ordem (100) e Pesquisas
    const nav = [
      item('gestor', 'equipe', 'Equipe'),
      item('core', 'rota-gestao', 'Rota'),
      item('gestor', 'aprovacoes', 'Aprovações'),
      item('core', 'clientes', 'Clientes'),
      item('vendedor', 'pedidos', 'Pedidos', 'clipboard'),
      item('catalogo', 'catalogo', 'Catálogo', 'search'),
      item('gestor', 'alertas', 'Alertas'),
      item('pesquisa', 'pesquisas', 'Pesquisas'),
    ];
    const { barra, mais, perfil } = abasDaVariante(nav, 'gestao');
    expect(barra.map((a) => a.label)).toEqual(['Início', 'Equipe', 'Rota', 'Aprovações', 'Clientes', 'Alertas']);
    expect(barra.map((a) => a.testID)).not.toContain('tab-mais');
    expect(mais).toEqual([]);
    // no Perfil, com o rótulo, o ícone e o endereço da página
    expect(perfil.map((a) => [a.label, a.icon, a.href])).toEqual([
      ['Pedidos', 'clipboard', '/m/pedidos'],
      ['Catálogo', 'search', '/m/catalogo'],
      ['Pesquisas', 'file', '/m/pesquisas'],
    ]);
    // sem a licença do Gestor, Equipe, Aprovações e Alertas saem e as vagas vão para as próximas pela `ordem`
    const semGestor = abasDaVariante(nav.filter((n) => n.modulo !== 'gestor'), 'gestao');
    expect(semGestor.barra.map((a) => a.label)).toEqual(['Início', 'Rota', 'Clientes', 'Pedidos', 'Catálogo', 'Pesquisas']);
    expect(semGestor.perfil).toEqual([]);
  });

  it('Mc161 A: o Campo segue com o "Mais" e sem itens no Perfil', () => {
    const item = (id: string, rotulo: string) => ({ modulo: 'core', id, caminho: id, rotulo, icone: 'file' }) as unknown as ItemNavegacao<unknown>;
    const nav = [item('rota', 'Rota'), item('clientes', 'Clientes'), item('pedidos', 'Pedidos'), item('performance', 'Performance'), item('catalogo', 'Catálogo'), item('pesquisas', 'Pesquisas')];
    const { barra, mais, perfil } = abasDaVariante(nav, 'campo');
    expect(barra.map((a) => a.label)).toEqual(['Início', 'Rota', 'Clientes', 'Pedidos', 'Performance', 'Mais']);
    expect(mais.map((a) => a.label)).toEqual(['Catálogo', 'Pesquisas']);
    expect(perfil).toEqual([]);
  });

  it('MC-0160 (R-20261119-201449): a aba usa o ícone `equipe` declarado pela página; Clientes segue com `users`', () => {
    const item = (modulo: string, id: string, rotulo: string, icone: string) => ({ modulo, id, caminho: id, rotulo, icone }) as unknown as ItemNavegacao<unknown>;
    const { barra } = abasDoShell([item('gestor', 'equipe', 'Equipe', 'equipe'), item('core', 'clientes', 'Clientes', 'users')], MAX_ABAS_POR_VARIANTE.gestao);
    expect(barra.map((a) => [a.label, a.icon])).toEqual([['Início', 'home'], ['Equipe', 'equipe'], ['Clientes', 'users']]);
  });

  it('RD-2447: ícone que o kit não desenha vira `file` na aba', () => {
    const item = (id: string, icone?: string) => ({ modulo: 'core', id, caminho: id, rotulo: id, icone }) as unknown as ItemNavegacao<unknown>;
    const { barra } = abasDoShell([item('foguete', 'foguete'), item('sem-icone')], MAX_ABAS_POR_VARIANTE.gestao);
    expect(barra.slice(1).map((a) => a.icon)).toEqual(['file', 'file']);
  });

  it('nenhuma aba sem licença: o Gestor não licenciado não monta Equipe nem Aprovações', () => {
    const r = rotulos('gestao', 'supervisor', ['core', 'catalogo', 'vendedor', 'promotor'], TODOS);
    expect(r.todas).not.toContain('Equipe');
    expect(r.todas).not.toContain('Aprovações');
    const comGestor = rotulos('gestao', 'supervisor', TODOS, TODOS);
    expect(comGestor.todas).toEqual(expect.arrayContaining(['Equipe', 'Aprovações', 'Alertas']));
  });

  it('nenhuma aba sem perfil: módulo licenciado fora do perfil não aparece; ação sem permissão esconde a aba', () => {
    const r = rotulos('campo', 'vendedor', TODOS, ['core', 'catalogo', 'vendedor']);
    expect(r.todas).not.toContain('Loja');
    // o supervisor tem o Promotor no perfil, mas a aba Loja exige `coleta.registrar` (só o promotor) e é só do Campo
    const g = rotulos('gestao', 'supervisor', TODOS, TODOS);
    expect(g.todas).not.toContain('Loja');
  });

  it('RN-PRO-01: o promotor nunca vê aba de pedido, nem na barra nem no "Mais"; vê Loja e Catálogo', () => {
    const p = rotulos('campo', 'promotor', TODOS, ['core', 'catalogo', 'promotor']);
    expect(p.todas).not.toContain('Pedidos');
    expect(p.todas).toEqual(expect.arrayContaining(['Loja', 'Catálogo']));
    // modo demonstração (mock-api sem /me/modulos): o padrão do perfil pelo manifesto também deixa o Vendedor de fora
    const ativos = efetivosSemServidor('demo', 'promotor');
    expect(ativos).not.toContain('vendedor');
    const nav = criarShell('campo', MODULOS).montar({ perfil: 'promotor', modulosAtivos: ativos }).navegacao;
    expect(nav.map((n) => n.rotulo)).not.toContain('Pedidos');
  });

  // Revisão T-0034 (R-20261101-161003): RN-PRO-01 vale pelo PERFIL, não pelo módulo (doc 03). A página `pedidos`
  // (modules/vendedor/app/index.ts) declara `perfis` sem o promotor desde o R-20261101-211304 (modulo-vendedor),
  // espelhado em PAGINAS acima.
  it('RN-PRO-01: promotor com o Vendedor efetivo (licenciado e no perfil) também não vê Pedidos', () => {
    const p = rotulos('campo', 'promotor', TODOS, TODOS);
    expect(p.todas).not.toContain('Pedidos');
  });

  it('"Mais" fica ativo nas telas que estão dentro dele; Início só na raiz', () => {
    const { barra, mais } = abasDoShell(criarShell('campo', MODULOS).montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'vendedor'] }).navegacao);
    const abaMais = barra.find((a) => a.href === HREF_MAIS)!;
    expect(abaMais.testID).toBe('tab-mais');
    expect(abaAtiva(abaMais, '/m/catalogo', mais)).toBe(true);
    expect(abaAtiva(abaMais, '/m/clientes', mais)).toBe(false);
    expect(abaAtiva(barra[0]!, '/', mais)).toBe(true);
    expect(abaAtiva(barra[0]!, '/m/rota', mais)).toBe(false);
    expect(barra.map((a) => a.testID)).toEqual(['tab-inicio', 'tab-core-rota', 'tab-core-clientes', 'tab-core-performance', 'tab-mais']);
  });

  // T-0072 (R-20261105-125027; docs/design/componentes.md §6.1): numa tela de módulo, acende a aba dona da pilha
  it('aba acesa = dona da pilha: detalhe e editor acendem a aba de onde vieram; pilha aberta pelo Início acende o Início', () => {
    const abas = abasDoShell(criarShell('campo', MODULOS).montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'vendedor'] }).navegacao);
    const acesa = (atual: string, aba: string | null, origem: 'aba' | 'inicio' | 'mais' | 'outra' = 'aba') => abaAcesa(abas, atual, { aba, origem })?.testID;
    // aba da barra: a ficha do cliente (/m/cliente) é da pilha de Clientes
    expect(acesa('/m/cliente', '/m/clientes')).toBe('tab-core-clientes');
    expect(abaAtiva(abas.barra[2]!, '/m/cliente', abas.mais)).toBe(false); // pelo caminho não acenderia
    // item do "Mais": Pedidos › detalhe e Pedidos › Novo pedido acendem o "Mais"
    expect(acesa('/m/pedido', '/m/pedidos')).toBe('tab-mais');
    expect(acesa('/m/novo-pedido', '/m/pedidos')).toBe('tab-mais');
    // pilha aberta de fora pelo Início, raiz que não é aba nem item do "Mais"
    expect(acesa('/m/pedido', '/m/pedido', 'inicio')).toBe('tab-inicio');
    expect(acesa('/m/pedido', '/m/pedido', 'mais')).toBe('tab-mais');
    // fora das telas de módulo, pelo caminho
    expect(acesa('/', '/m/clientes')).toBe('tab-inicio');
    expect(acesa(HREF_MAIS, '/m/clientes')).toBe('tab-mais');
    // uma aba só acende por vez
    expect(abas.barra.filter((a) => a === abaAcesa(abas, '/m/pedido', { aba: '/m/pedidos', origem: 'aba' }))).toHaveLength(1);
  });
});

describe('T-0034 — módulos efetivos sem resposta do servidor', () => {
  it('API real: só o Core (nenhuma aba de módulo licenciável sem a licença vinda do servidor)', () => {
    expect(efetivosSemServidor('v1', 'vendedor')).toEqual(['core']);
    expect(efetivosSemServidor('v1', 'supervisor')).toEqual(['core']);
    expect(efetivosSemServidor('demo', null)).toEqual(['core']);
  });

  it('demonstração (mock-api): padrão do perfil pelo manifesto', () => {
    expect(efetivosSemServidor('demo', 'vendedor')).toEqual(expect.arrayContaining(['core', 'catalogo', 'vendedor']));
  });
});
