import { describe, expect, it } from 'vitest';
import type { ChaveDoPerfil, PerfilDetalhe } from '../../contracts';
import { corpoDoPerfil, edicaoInicial, erroDeAlvos, escolherNivel, frasesDaRecusa, ligarLinha, montarLinhas, mudancasDaEdicao, mudancasPorSecao, rotuloDaChave } from './perfis';

const v = (concedida: boolean, nivel: ChaveDoPerfil['atual']['nivel'] = null, alvos: string[] | null = null) => ({ concedida, nivel, alvos });
const chave = (c: string, area: string, extra: Partial<ChaveDoPerfil> = {}): ChaveDoPerfil => ({
  chave: c,
  area,
  modulo: 'core',
  descricao: `Descrição de ${c} (RN-X)`,
  nivel: null,
  alvos: false,
  fabrica: v(true),
  atual: v(true),
  trava: null,
  ...extra,
});

const detalhe = (base: 'vendedor' | 'gerente' = 'vendedor', chaves: ChaveDoPerfil[] = []): PerfilDetalhe => ({
  perfil: { codigo: base, nome: 'Vendedor', descricao: null, base, fabrica: true, ativo: true, usuarios: 3, onde_entra: ['campo'] },
  chaves: [
    chave('acesso.bko', 'acesso', { fabrica: v(false), atual: v(false), trava: { regra: 'RN-CORE-33', mensagem: 'Vendedor nunca entra no BKO (RN-CORE-33).' } }),
    chave('dados.escopo', 'dados', { nivel: 'escopo', fabrica: v(true, 'carteira'), atual: v(true, 'carteira') }),
    chave('senha.redefinir', 'usuarios', { alvos: true, fabrica: v(false), atual: v(false) }),
    chave('farol.ver', 'administracao'),
    ...chaves,
  ],
  alvos_possiveis: [],
  escopo_maximo: 'carteira',
  modulos: ['core'],
});

describe('página Perfis de acesso (RN-CORE-35, RN-CORE-33, RN-CORE-04)', () => {
  it('RN-CORE-33: a linha do BKO do vendedor nasce travada com o texto do cadeado', () => {
    const { linhas } = montarLinhas(detalhe());
    expect(linhas.find((l) => l.id === 'acesso-bko')?.trava).toBe('Vendedor nunca entra no BKO (RN-CORE-33).');
  });

  it('RN-CORE-04: níveis acima do escopo da base vêm desabilitados com o cadeado; "Equipes abaixo" só no gerente', () => {
    const l = montarLinhas(detalhe()).linhas.find((x) => x.id === 'dados-escopo')!;
    expect(l.opcoes?.map((o) => o.valor)).toEqual(['proprio', 'carteira', 'equipe', 'tenant']);
    expect(l.opcoes?.find((o) => o.valor === 'tenant')).toMatchObject({ desabilitada: true, motivo: 'Acima do perfil base Vendedor (RN-CORE-04).' });
    expect(l.opcoes?.find((o) => o.valor === 'carteira')?.desabilitada).toBe(false);
    const g = montarLinhas(detalhe('gerente')).linhas.find((x) => x.id === 'dados-escopo')!;
    expect(g.opcoes?.map((o) => o.valor)).toContain('equipes_abaixo');
  });

  it('spec §13: linha cuja chave não existe no catálogo some; chave sem linha cai em "Outras permissões"', () => {
    const { linhas, outras } = montarLinhas(detalhe());
    expect(linhas.some((l) => l.id === 'pedido-excluir')).toBe(false);
    expect(outras.flatMap((g) => g.linhas.map((l) => l.rotulo))).toContain('Ver o farol de clientes');
  });

  it('spec §5.13: chave nova sem rótulo usa a descrição do manifesto até o primeiro " ("', () => {
    expect(rotuloDaChave('x.y', 'Fazer algo bonito (RN-X); mais')).toBe('Fazer algo bonito');
    expect(rotuloDaChave('farol.ver', 'qualquer')).toBe('Ver o farol de clientes');
  });

  it('só entra no resumo o que mudou, agrupado por seção, e o corpo envia as concedidas', () => {
    const d = detalhe();
    const { linhas, outras } = montarLinhas(d);
    const inicial = edicaoInicial(d);
    const nivel = linhas.find((l) => l.id === 'dados-escopo')!;
    const atual = escolherNivel(nivel, inicial, 'proprio');
    const m = mudancasDaEdicao({ linhas, outras: outras.flatMap((g) => g.linhas), inicial, atual, identInicial: { nome: 'A', descricao: '', ativo: true }, identAtual: { nome: 'B', descricao: '', ativo: true }, rotulosDosPerfis: {} });
    expect(m).toEqual([
      { secao: 'identificacao', rotulo: 'Nome', antes: 'A', depois: 'B' },
      { secao: 'escopo', rotulo: 'Quais clientes e números vê', antes: 'Carteira própria', depois: 'Só o que é dele' },
    ]);
    expect(mudancasPorSecao(m)).toEqual({ identificacao: 1, escopo: 1 });
    const corpo = corpoDoPerfil(atual, { nome: 'B', descricao: ' ', ativo: true }, false);
    expect(corpo.permissoes.map((p) => p.chave)).toEqual(['dados.escopo', 'farol.ver']);
    expect(corpo.descricao).toBeNull();
  });

  it('RN-CORE-35: perfil padrão não envia nome nem situação', () => {
    const corpo = corpoDoPerfil(edicaoInicial(detalhe()), { nome: 'Vendedor', descricao: '', ativo: true }, true);
    expect(corpo).not.toHaveProperty('nome');
    expect(corpo).not.toHaveProperty('ativo');
  });

  it('spec §5.5: redefinir senha ligada sem perfil marcado não salva', () => {
    const d = detalhe();
    const l = montarLinhas(d).linhas.find((x) => x.id === 'senha-redefinir')!;
    const e = ligarLinha(l, edicaoInicial(d), true);
    expect(erroDeAlvos(l, e)).toBe('Marque pelo menos um perfil ou desligue a redefinição de senha.');
    expect(erroDeAlvos(l, { ...e, 'senha.redefinir': v(true, null, ['gerente']) })).toBeNull();
  });

  it('spec §7.2: a recusa mostra no máximo 3 frases e "e mais N", sem JSON', () => {
    const viol = ['a', 'b', 'c', 'd', 'e'].map((mensagem) => ({ mensagem }));
    expect(frasesDaRecusa({ violacoes: viol }, 'x')).toEqual(['a', 'b', 'c', 'e mais 2']);
    expect(frasesDaRecusa(null, 'só a mensagem')).toEqual(['só a mensagem']);
  });
});
