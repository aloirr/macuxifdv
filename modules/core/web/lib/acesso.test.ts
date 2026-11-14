import { describe, expect, it } from 'vitest';
import type { UsuarioItem } from '../../contracts';
import {
  alternarLinha,
  alternarModulo,
  baseDoNovoPerfil,
  contagemPorPerfil,
  edicaoDaGrade,
  linhasPorModulo,
  marcacaoDoModulo,
  modulosCoerentes,
  modulosDaGrade,
  modulosExibiveis,
  modulosForaDoPerfil,
  removidosDoFormulario,
  ROTULO_DA_PERMISSAO,
  rotuloDaPermissao,
  rotuloMarcarTodos,
  type ChaveDoCatalogo,
} from './acesso';

const todos = ['core', 'catalogo', 'vendedor', 'treinamento', 'pesquisa', 'promotor', 'gestor', 'integracao'];
const chave = (c: string, modulo: string, descricao = c): ChaveDoCatalogo => ({ chave: c, modulo, descricao, nivel: null, alvos: false });
const u = (perfil: UsuarioItem['perfil'], codigos: string[] = []): Pick<UsuarioItem, 'perfil' | 'perfis'> => ({ perfil, perfis: codigos.map((codigo) => ({ codigo, nome: codigo, base: perfil })) as UsuarioItem['perfis'] });

describe('Acesso: módulos exibíveis (R-20261114-144500)', () => {
  it('RN-CORE-01: Core, Catálogo e Integração não aparecem como módulos do usuário', () => {
    const ids = modulosExibiveis(todos).map((m) => m.id);
    expect(ids).not.toContain('core');
    expect(ids).not.toContain('catalogo');
    expect(ids).not.toContain('integracao');
  });

  it('lista em ordem alfabética e com a primeira letra maiúscula', () => {
    expect(modulosExibiveis(todos).map((m) => m.nome)).toEqual(['Gestor', 'Pesquisa', 'Promotor', 'Treinamento', 'Vendedor']);
    for (const m of modulosExibiveis(todos)) expect(m.nome[0]).toBe(m.nome[0]!.toUpperCase());
  });

  it('só os módulos licenciados entram, sem repetir', () => {
    expect(modulosExibiveis(['core', 'vendedor', 'vendedor', 'gestor']).map((m) => m.id)).toEqual(['gestor', 'vendedor']);
  });

  it('a grade do novo perfil começa por Geral e segue só com os licenciados', () => {
    expect(modulosDaGrade(['core', 'vendedor', 'pesquisa', 'catalogo']).map((m) => m.nome)).toEqual(['Geral', 'Pesquisa', 'Vendedor']);
  });
});

describe('Acesso: rótulos das permissões', () => {
  it('rótulos em português simples, como "Ver pedidos" e "Ver ranking das trilhas"', () => {
    expect(rotuloDaPermissao('pedido.ver')).toBe('Ver pedidos');
    expect(rotuloDaPermissao('pedido.criar')).toBe('Criar pedidos');
    expect(rotuloDaPermissao('pedido.aprovar')).toBe('Aprovar pedidos');
    expect(rotuloDaPermissao('ranking_equipe.ver')).toBe('Ver ranking da equipe');
    expect(rotuloDaPermissao('ranking.ver')).toBe('Ver ranking das trilhas');
  });

  it('chave sem rótulo no mapa cai na descrição do manifesto, cortada antes do parêntese', () => {
    expect(rotuloDaPermissao('nova.acao', 'Ver coisas novas (RF-X-01)')).toBe('Ver coisas novas');
  });

  it('sem rótulo repetido em cada módulo: chaves com o mesmo rótulo viram uma linha só', () => {
    const catalogo = [chave('pedido.ver', 'vendedor'), chave('pedido.criar', 'vendedor'), chave('pedido.editar', 'vendedor'), chave('pedido.aprovar', 'vendedor'), chave('ranking.ver', 'treinamento'), chave('ranking_equipe.ver', 'gestor')];
    const linhas = linhasPorModulo(catalogo, ['vendedor', 'treinamento', 'gestor']);
    expect(linhas.vendedor!.map((l) => l.rotulo)).toEqual(['Ver pedidos', 'Criar pedidos', 'Aprovar pedidos']);
    expect(linhas.vendedor!.find((l) => l.rotulo === 'Criar pedidos')!.chaves).toEqual(['pedido.criar', 'pedido.editar']);
    for (const ls of Object.values(linhas)) expect(new Set(ls.map((l) => l.rotulo)).size).toBe(ls.length);
  });

  it('todo rótulo do mapa tem uma só chave por linha: rótulos diferentes entre ações que não se fundem', () => {
    const porRotulo = new Map<string, string[]>();
    for (const [c, r] of Object.entries(ROTULO_DA_PERMISSAO)) porRotulo.set(r, [...(porRotulo.get(r) ?? []), c]);
    // só criar e editar pedido dividem rótulo, de propósito
    expect([...porRotulo.values()].filter((cs) => cs.length > 1)).toEqual([['pedido.criar', 'pedido.editar']]);
  });

  it('chaves com nível ou com alvos (escopo de dados, redefinir senha) não entram na grade de caixas', () => {
    const catalogo: ChaveDoCatalogo[] = [chave('acesso.bko', 'core'), { ...chave('dados.escopo', 'core'), nivel: 'escopo' }, { ...chave('senha.redefinir', 'core'), alvos: true }];
    expect(linhasPorModulo(catalogo, ['core']).core!.map((l) => l.rotulo)).toEqual(['Entrar no backoffice']);
  });

  it('a caixa "marcar todos" tem rótulo acessível com o nome do módulo e liga e desliga o módulo inteiro', () => {
    expect(rotuloMarcarTodos('Vendedor')).toBe('Marcar todos de Vendedor');
    const linhas = [
      { rotulo: 'Ver pedidos', chaves: ['pedido.ver'] },
      { rotulo: 'Criar pedidos', chaves: ['pedido.criar', 'pedido.editar'] },
    ];
    expect(marcacaoDoModulo(linhas, new Set())).toBe('nenhuma');
    const um = alternarLinha(linhas[0]!, new Set());
    expect(marcacaoDoModulo(linhas, um)).toBe('parte');
    const todas = alternarModulo(linhas, um, true);
    expect(marcacaoDoModulo(linhas, todas)).toBe('todas');
    expect([...todas].sort()).toEqual(['pedido.criar', 'pedido.editar', 'pedido.ver']);
    expect(alternarModulo(linhas, todas, false).size).toBe(0);
  });
});

describe('Acesso: novo perfil', () => {
  it('RN-PRO-01: a base é a mais enxuta cujas travas aceitam todas as chaves marcadas', () => {
    expect(baseDoNovoPerfil(['pedido.ver'])).toBe('vendedor');
    expect(baseDoNovoPerfil(['pedido.ver', 'acesso.bko'])).toBe('gerente');
    expect(baseDoNovoPerfil(['acesso.portal'])).toBe('admin');
  });

  it('a edição parte do que a base devolveu e só as chaves da grade seguem as caixas', () => {
    const inicial = { 'dados.escopo': { concedida: true, nivel: 'carteira' as const, alvos: null }, 'pedido.ver': { concedida: true, nivel: null, alvos: null } };
    const e = edicaoDaGrade(inicial, ['pedido.ver', 'pedido.criar'], new Set(['pedido.criar']));
    expect(e['dados.escopo']!.nivel).toBe('carteira');
    expect(e['pedido.ver']!.concedida).toBe(false);
    expect(e['pedido.criar']!.concedida).toBe(true);
  });
});

describe('Acesso: usuários, perfis e módulos', () => {
  it('RF-CORE-02: a contagem de usuários por perfil é a da lista de usuários (principal e perfis extras)', () => {
    const lista = [u('vendedor', ['vendedor']), u('vendedor', ['vendedor']), u('gerente', ['gerente', 'vendedor']), u('analista')];
    const c = contagemPorPerfil(lista);
    expect(c).toEqual({ vendedor: 3, gerente: 1, analista: 1 });
    // o que a tela de Usuários mostra ao filtrar por perfil tem de dar o mesmo número
    for (const [codigo, n] of Object.entries(c)) expect(lista.filter((x) => (x.perfis.length ? x.perfis.map((p) => p.codigo) : [x.perfil]).includes(codigo)).length).toBe(n);
  });

  it('RN-CORE-01: módulo do usuário fora do perfil é contradição; módulos coerentes ficam só os do perfil', () => {
    expect(modulosForaDoPerfil(['vendedor', 'pesquisa'], ['vendedor', 'gestor'])).toEqual(['gestor']);
    expect(modulosForaDoPerfil(['vendedor'], ['vendedor'])).toEqual([]);
    expect(modulosCoerentes(['vendedor', 'pesquisa', 'core'], ['vendedor', 'gestor', 'core']).map((m) => m.id)).toEqual(['vendedor']);
  });

  it('RN-CORE-01: a exceção do usuário só remove, dentro do que o perfil tem', () => {
    expect(removidosDoFormulario(['vendedor', 'pesquisa', 'core'], new Set(['vendedor']))).toEqual(['pesquisa']);
    expect(removidosDoFormulario(['vendedor'], new Set(['vendedor']))).toEqual([]);
  });
});
