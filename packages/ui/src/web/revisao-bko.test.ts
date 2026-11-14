import { describe, expect, it } from 'vitest';
import { colunasVisiveis, classeDaPrioridade, indiceNoMenu, nomeLegivel, posicaoDoMenu, LARGURA_MINIMA_DA_PRIORIDADE } from './tabela-dados';
import { ordenarAcoes } from './menu-acoes';
import { infoDoModulo, modulosContrataveis, nomeDoModulo, IDS_DOS_MODULOS } from './modulos';
import { seloPrincipal } from './ui';

describe('Revisão do BKO §P2: tabela sem rolagem lateral', () => {
  const cols = [{ id: 'nome' }, { id: 'perfil', prioridade: 2 as const }, { id: 'erp', prioridade: 3 as const }];

  it('prioridade 1 sempre; 2 a partir de 672 px de quadro; 3 a partir de 1024 px', () => {
    expect(colunasVisiveis(cols, 480).map((c) => c.id)).toEqual(['nome']);
    expect(colunasVisiveis(cols, 672).map((c) => c.id)).toEqual(['nome', 'perfil']);
    expect(colunasVisiveis(cols, 1023).map((c) => c.id)).toEqual(['nome', 'perfil']);
    expect(colunasVisiveis(cols, 1024).map((c) => c.id)).toEqual(['nome', 'perfil', 'erp']);
  });

  it('as classes batem com os tamanhos de contêiner do Tailwind (@2xl = 42rem, @5xl = 64rem)', () => {
    expect(classeDaPrioridade(1)).toBe('');
    expect(classeDaPrioridade(2)).toBe('hidden @2xl/tabela:table-cell');
    expect(classeDaPrioridade(3)).toBe('hidden @5xl/tabela:table-cell');
    expect(LARGURA_MINIMA_DA_PRIORIDADE[2]).toBe(42 * 16);
    expect(LARGURA_MINIMA_DA_PRIORIDADE[3]).toBe(64 * 16);
  });
});

describe('nomeLegivel: nome todo em maiúsculas vira nome próprio', () => {
  it('maiúsculas com partículas e acentos', () => {
    expect(nomeLegivel('JOSÉ CARLOS DA SILVA PEREIRA')).toBe('José Carlos da Silva Pereira');
    expect(nomeLegivel('MARIA APARECIDA DOS SANTOS')).toBe('Maria Aparecida dos Santos');
    expect(nomeLegivel("JOANA D'ARC SANTANA-LIMA")).toBe("Joana D'Arc Santana-Lima");
  });
  it('siglas ficam; nome já escrito com minúsculas fica como está', () => {
    expect(nomeLegivel('AUTO PEÇAS BOA VISTA LTDA')).toBe('Auto Peças Boa Vista LTDA');
    expect(nomeLegivel('Ana de Souza')).toBe('Ana de Souza');
    expect(nomeLegivel('ana')).toBe('ana');
    expect(nomeLegivel('123')).toBe('123');
    expect(nomeLegivel('')).toBe('');
  });
});

describe('Menu "⋯"', () => {
  it('setas andam com volta nas pontas e pulam o desligado; Home/End vão às pontas; outra tecla não anda', () => {
    const d = [false, true, false];
    expect(indiceNoMenu('ArrowDown', 0, d)).toBe(2);
    expect(indiceNoMenu('ArrowDown', 2, d)).toBe(0);
    expect(indiceNoMenu('ArrowUp', 0, d)).toBe(2);
    expect(indiceNoMenu('Home', 2, d)).toBe(0);
    expect(indiceNoMenu('End', 0, d)).toBe(2);
    expect(indiceNoMenu('ArrowRight', 0, d)).toBeNull();
    expect(indiceNoMenu('a', 0, d)).toBeNull();
  });

  it('abre embaixo, alinhado à direita do botão; sem espaço embaixo e com espaço em cima, abre para cima', () => {
    const janela = { largura: 1366, altura: 768 };
    expect(posicaoDoMenu({ top: 100, bottom: 136, right: 1300 }, janela, 130)).toEqual({ top: 140, right: 66 });
    expect(posicaoDoMenu({ top: 700, bottom: 736, right: 1300 }, janela, 130)).toEqual({ bottom: 72, right: 66 });
    expect(posicaoDoMenu({ top: 50, bottom: 86, right: 1366 }, { largura: 1366, altura: 120 }, 130)).toEqual({ top: 90, right: 8 });
  });

  it('ação de perigo vai por último, a ordem da tela fica', () => {
    const f = () => undefined;
    const r = ordenarAcoes([
      { id: 'desativar', rotulo: 'Desativar', perigo: true, aoEscolher: f },
      { id: 'editar', rotulo: 'Editar', aoEscolher: f },
      { id: 'senha', rotulo: 'Redefinir senha', aoEscolher: f },
    ]);
    expect(r.map((a) => a.id)).toEqual(['editar', 'senha', 'desativar']);
  });
});

describe('Selo único da Situação', () => {
  it('mostra o primeiro selo presente; nenhum = nada', () => {
    expect(seloPrincipal([null, { tom: 'warning', texto: 'Senha vence 17/11' }, { tom: 'success', texto: 'Ativo' }])).toEqual({ tom: 'warning', texto: 'Senha vence 17/11' });
    expect(seloPrincipal([undefined, null])).toBeNull();
  });
});

describe('Mapa único dos módulos (R-20261114-143500)', () => {
  it('os 8 ids da plataforma', () => {
    expect([...IDS_DOS_MODULOS].sort()).toEqual(['catalogo', 'core', 'gestor', 'integracao', 'pesquisa', 'promotor', 'treinamento', 'vendedor']);
  });
  it('Core, Integração e Catálogo são nativos e somem da lista; os outros em ordem alfabética', () => {
    expect(modulosContrataveis().map((m) => m.nome)).toEqual(['Gestor', 'Pesquisa', 'Promotor', 'Treinamento', 'Vendedor']);
    expect(modulosContrataveis(['core', 'vendedor', 'integracao', 'catalogo']).map((m) => m.id)).toEqual(['vendedor']);
    expect(infoDoModulo('integracao').nativo).toBe(true);
    expect(infoDoModulo('pesquisa').nativo).toBe(false);
  });
  it('nome com maiúscula e acento, nunca o id', () => {
    expect(nomeDoModulo('catalogo')).toBe('Catálogo');
    expect(nomeDoModulo('integracao')).toBe('Integração com o ERP');
    expect(nomeDoModulo('novo_modulo')).toBe('novo_modulo');
  });
});
