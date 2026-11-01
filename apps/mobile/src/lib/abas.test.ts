/**
 * T-0034: abas da barra inferior a partir da visão do shell (módulo efetivo = manifesto + licença + perfil + ação).
 * Páginas de exemplo com os rótulos que os manifestos REAIS declaram (`apps.<variante>.abas`), montadas no
 * `criarShell` real: nenhuma aba sem licença ou perfil, o promotor nunca vê aba de pedido (RN-PRO-01) e,
 * passando de 5 posições, o excedente vai para "Mais".
 */
import { criarShell, definirModuloShell, modulosEfetivos, type ModuloId, type ModuloShell, type PaginaShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { abaAtiva, abasDoShell, HREF_MAIS, MAX_ABAS_BARRA } from './abas';
import { efetivosSemServidor } from './efetivos-locais';
import { MANIFESTOS_INSTALADOS } from './instalados';

type Pg = PaginaShell<string>;
const pg = (id: string, navegacao: string, extra: Partial<Pg> = {}): Pg => ({ id, caminho: id, titulo: navegacao, navegacao, componente: id, ...extra });

/** Telas de exemplo por módulo (os rótulos são os declarados nos manifestos reais). */
const PAGINAS: Partial<Record<ModuloId, Pg[]>> = {
  // ordem igual à de modules/core/app (Rota 20, Clientes 30, Metas 50); Pedidos sem ordem (100), como hoje
  core: [pg('rota', 'Rota', { apps: ['campo'], ordem: 20 }), pg('clientes', 'Clientes', { apps: ['campo', 'gestao'], ordem: 30 }), pg('metas', 'Metas', { apps: ['campo'], ordem: 50 })],
  catalogo: [pg('catalogo', 'Catálogo', { apps: ['campo', 'gestao'], acao: 'produto.consultar' })],
  vendedor: [pg('pedidos', 'Pedidos', { apps: ['campo', 'gestao'] })],
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
    expect(r.todas).toEqual(['Início', 'Rota', 'Clientes', 'Metas', 'Mais', 'Catálogo', 'Pedidos']);
    expect(r.barra).toHaveLength(MAX_ABAS_BARRA);
    const sem = rotulos('campo', 'vendedor', ['core', 'vendedor'], ['core', 'vendedor']);
    // sem o Catálogo licenciado o Vendedor sai em cascata (RN-CORE-03): nem Catálogo nem Pedidos
    expect(sem.barra).toEqual(['Início', 'Rota', 'Clientes', 'Metas']);
    expect(sem.mais).toEqual([]);
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

  it('"Mais" fica ativo nas telas que estão dentro dele; Início só na raiz', () => {
    const { barra, mais } = abasDoShell(criarShell('campo', MODULOS).montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'vendedor'] }).navegacao);
    const abaMais = barra.find((a) => a.href === HREF_MAIS)!;
    expect(abaMais.testID).toBe('tab-mais');
    expect(abaAtiva(abaMais, '/m/catalogo', mais)).toBe(true);
    expect(abaAtiva(abaMais, '/m/clientes', mais)).toBe(false);
    expect(abaAtiva(barra[0]!, '/', mais)).toBe(true);
    expect(abaAtiva(barra[0]!, '/m/rota', mais)).toBe(false);
    expect(barra.map((a) => a.testID)).toEqual(['tab-inicio', 'tab-core-rota', 'tab-core-clientes', 'tab-core-metas', 'tab-mais']);
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
