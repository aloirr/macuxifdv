import { describe, expect, it } from 'vitest';
import type { UsuarioItem } from '../../contracts';
import { contagemPorPerfil, modulosCoerentes, modulosExibiveis, modulosForaDoPerfil, mudancasDeExcecoes, removidosDoFormulario, ROTULO_DA_PERMISSAO, rotuloDaPermissao } from './acesso';

const todos = ['core', 'catalogo', 'vendedor', 'treinamento', 'pesquisa', 'promotor', 'gestor', 'integracao'];
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

  it('todo rótulo do mapa tem uma só chave: nenhuma permissão se funde com outra (criar e editar pedido separados)', () => {
    const porRotulo = new Map<string, string[]>();
    for (const [c, r] of Object.entries(ROTULO_DA_PERMISSAO)) porRotulo.set(r, [...(porRotulo.get(r) ?? []), c]);
    expect([...porRotulo.values()].filter((cs) => cs.length > 1)).toEqual([]);
    expect(rotuloDaPermissao('pedido.criar')).toBe('Criar pedidos');
    expect(rotuloDaPermissao('pedido.editar')).toBe('Editar pedidos');
  });

  it('RD-0267: rótulos de RV curtos; parâmetro do promotor no presente', () => {
    expect(rotuloDaPermissao('rv.ver')).toBe('Ver RV');
    expect(rotuloDaPermissao('plano_rv.ver')).toBe('Ver plano de RV');
    expect(rotuloDaPermissao('plano_rv.editar')).toBe('Editar plano de RV');
    expect(rotuloDaPermissao('parametro.promotor_ve_pedidos')).toBe('Promotor vê pedidos');
  });

  it('A2: a linha de Dados tem o rótulo "Quais clientes e números vê", sem repetir os botões', () => {
    expect(rotuloDaPermissao('dados.escopo', 'Escopo de dados: carteira própria, equipe, equipes abaixo ou toda a empresa')).toBe('Quais clientes e números vê');
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

  it('RN-CORE-01: editar usuário com exceção "remover" sem mexer nos módulos não a reativa (perfil personalizado incluído)', () => {
    const doPerfilPersonalizado = ['vendedor', 'pesquisa', 'core'];
    const marcados = new Set(['vendedor']); // pesquisa já estava removida e segue desmarcada
    const depois = removidosDoFormulario(doPerfilPersonalizado, marcados);
    expect(mudancasDeExcecoes(['pesquisa'], depois)).toEqual([]);
    expect(mudancasDeExcecoes(['pesquisa'], removidosDoFormulario(doPerfilPersonalizado, new Set(['vendedor', 'pesquisa'])))).toEqual([{ modulo: 'pesquisa', ativo: true }]);
    expect(mudancasDeExcecoes([], depois)).toEqual([{ modulo: 'pesquisa', ativo: false }]);
  });
});
