import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classeDaPrioridade, indiceNoMenu, nomeLegivel, posicaoDoMenu } from './tabela-dados';
import { ordenarAcoes } from './menu-acoes';
import { iconeDoModulo, infoDoModulo, modulosContrataveis, nomeDoModulo, IDS_DOS_MODULOS } from './modulos';
import { IconCatalogo, IconCore, IconGestor, IconIntegracao, IconMais, IconPesquisa, IconPromotor, IconTreinamento, IconVendedor } from './icons';
import { CLASSE_CAMPO, CLASSE_CAMPO_BASE, EstadoVazio, rotuloComContagem, seloPrincipal } from './ui';

const fonte = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), 'utf8');

describe('Revisão do BKO §P2: tabela sem rolagem lateral', () => {
  it('prioridade 1 sempre; 2 a partir de @2xl (672 px de quadro); 3 a partir de @5xl (1024 px)', () => {
    expect(classeDaPrioridade()).toBe('');
    expect(classeDaPrioridade(1)).toBe('');
    expect(classeDaPrioridade(2)).toBe('hidden @2xl/tabela:table-cell');
    expect(classeDaPrioridade(3)).toBe('hidden @5xl/tabela:table-cell');
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
  it('frase de valor só nos contratáveis, sem texto de funcionamento; os nativos ficam sem frase', () => {
    expect(infoDoModulo('gestor').valor).toBe('Equipe, aprovações e indicadores.');
    expect(infoDoModulo('vendedor').valor).toBe('Pedidos e orçamentos no app.');
    for (const m of modulosContrataveis()) expect(m.valor).toBeTruthy();
    expect(infoDoModulo('core').valor).toBeUndefined();
    expect(infoDoModulo('catalogo').valor).toBeUndefined();
    expect(infoDoModulo('integracao').valor).toBeUndefined();
  });
  it('nome com maiúscula e acento, nunca o id', () => {
    expect(nomeDoModulo('catalogo')).toBe('Catálogo');
    expect(nomeDoModulo('integracao')).toBe('Integração com o ERP');
    expect(nomeDoModulo('novo_modulo')).toBe('novo_modulo');
  });
});

describe('Revisão do BKO §P6: a contagem aparece num lugar só', () => {
  it('com itens, rótulo e número; com mais páginas, o "+"', () => {
    expect(rotuloComContagem('Pedidos', 12)).toBe('Pedidos · 12');
    expect(rotuloComContagem('Pedidos', 50, true)).toBe('Pedidos · 50+');
    expect(rotuloComContagem('Clientes', 1234)).toBe('Clientes · 1.234');
  });
  it('com zero, só o rótulo: o vazio quem diz é o EstadoVazio', () => {
    expect(rotuloComContagem('Pedidos', 0)).toBe('Pedidos');
    expect(rotuloComContagem('Pedidos', 0, true)).toBe('Pedidos');
  });
});

describe('Ícones num lugar só (RD-0367)', () => {
  it('cada módulo usa o ícone de icons.tsx, um desenho por módulo', () => {
    const esperados = { vendedor: IconVendedor, gestor: IconGestor, promotor: IconPromotor, pesquisa: IconPesquisa, treinamento: IconTreinamento, core: IconCore, catalogo: IconCatalogo, integracao: IconIntegracao };
    for (const id of IDS_DOS_MODULOS) expect(iconeDoModulo(id)).toBe(esperados[id]);
    expect(new Set(IDS_DOS_MODULOS.map(iconeDoModulo)).size).toBe(IDS_DOS_MODULOS.length);
  });
  it('um traço só (1,9) nos ícones de módulo e no "⋯"', () => {
    for (const Icone of [IconVendedor, IconGestor, IconPromotor, IconPesquisa, IconTreinamento, IconCore, IconCatalogo, IconIntegracao, IconMais]) {
      expect(Icone({}).props.strokeWidth).toBe(1.9);
    }
  });
  it('modulos.tsx e menu-acoes.tsx só mapeiam: nenhum desenho de ícone fora de icons.tsx', () => {
    for (const arquivo of ['./modulos.tsx', './menu-acoes.tsx']) expect(fonte(arquivo)).not.toMatch(/<(svg|path|circle|rect)\b/);
  });
});

describe('Classe de campo num lugar só (RD-0368)', () => {
  it('o traço, a cor e o foco dos campos estão escritos uma vez em ui.tsx', () => {
    const ui = fonte('./ui.tsx');
    expect(ui.match(/rounded-\[10px\] border border-field bg-surface/g)).toHaveLength(1);
    expect(ui.match(/placeholder:text-ink-2/g)).toHaveLength(1);
  });
  it('o campo do formulário parte da classe-base', () => {
    for (const c of CLASSE_CAMPO_BASE.split(' ')) expect(CLASSE_CAMPO.split(' ')).toContain(c);
    expect(CLASSE_CAMPO).toContain('h-[42px]');
  });
});

describe('EstadoVazio: semBorda dentro do cartão (manual da marca §4, cartão; RD-0970)', () => {
  const classe = (semBorda?: boolean) => String(EstadoVazio({ titulo: 'Nenhum registro.', semBorda }).props.className);
  const titulo = (semBorda?: boolean) => EstadoVazio({ titulo: 'Nenhum registro.', semBorda }).props.children[0].props.className as string;
  it('padrão: borda tracejada e cantos próprios, solto no fundo', () => {
    expect(classe()).toMatch(/\bborder-dashed\b/);
    expect(classe()).toMatch(/\brounded-2xl\b/);
  });
  it('semBorda: sem borda, sem cantos e sem fundo próprios (o cartão já tem)', () => {
    expect(classe(true)).not.toMatch(/\bborder\b|border-dashed|border-field|rounded|\bbg-/);
    expect(classe(true)).toMatch(/\bpx-6\b.*\bpy-10\b/);
  });
  it('mesma tipografia com e sem borda', () => {
    expect(titulo(true)).toBe(titulo(false));
    expect(titulo(true)).toContain('text-[15px]');
  });
});
