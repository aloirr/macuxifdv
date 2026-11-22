/**
 * Filtro de veículo (spec docs/design/filtro-veiculo/spec.md §3, §4 e §11; desenho técnico docs/desenho/filtro-veiculo.md §6.2):
 * FolhaCascata, GradeOpcoes, Chip com contagem, BotaoFiltro com ícone e `ativo`, linha de etiquetas e o ícone `carro`.
 * Parte pura testada aqui; o desenho (react-native) é conferido pelo texto do arquivo, como nos outros testes do kit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  conteudoDaFolhaCascata,
  deslocamentoDoNivel,
  FOLHA_CASCATA,
  leituraDaOpcaoCascata,
  linhasDaGrade,
  mostrarRecentes,
  profundidadeDaCascata,
} from './cascata';
import { leituraDoChip, UNIDADE_CONTAGEM_CHIP } from './componentes';
import { destaqueDoBotaoFiltro, LINHA_ETIQUETAS } from './periodo';
import { ALTURA, colors, contraste, radius } from './tokens';
import { duracaoMovimento, MOVIMENTO } from './movimento';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('FolhaCascata: medidas e cores (spec §4.2, §11)', () => {
  it('linhas de 48 dp num cartão branco com traço lineSoft; nome 16 ink, apoio 14 ink2, chevron ink3', () => {
    expect(FOLHA_CASCATA.linha.alturaMinima).toBe(ALTURA.toque);
    expect(FOLHA_CASCATA.linha.nome).toEqual({ tamanho: 16, cor: colors.ink });
    expect(FOLHA_CASCATA.linha.apoio).toEqual({ tamanho: 14, cor: colors.ink2 });
    expect(FOLHA_CASCATA.linha.seta).toEqual({ tamanho: 16, cor: colors.ink3 });
    expect(FOLHA_CASCATA.cartao).toEqual({ fundo: colors.surface, borda: colors.line, traco: colors.lineSoft, raio: radius.lg });
  });

  it('grade do Ano: 4 colunas, 48 dp, branco, borda lineStrong, raio 12, 16/600 tabular', () => {
    expect(FOLHA_CASCATA.grade).toEqual({ colunas: 4, vao: 8, altura: ALTURA.toque, raio: radius.md, fundo: colors.surface, borda: colors.lineStrong, texto: { tamanho: 16, cor: colors.ink } });
    expect(radius.md).toBe(12);
  });

  it('texto sem resultado da busca: 14 ink2', () => {
    expect(FOLHA_CASCATA.vazio).toEqual({ tamanho: 14, cor: colors.ink2 });
  });

  it('contraste ≥ 4,5:1 de nome, apoio, chevron e texto da grade no branco', () => {
    for (const cor of [FOLHA_CASCATA.linha.nome.cor, FOLHA_CASCATA.linha.apoio.cor, FOLHA_CASCATA.linha.seta.cor, FOLHA_CASCATA.grade.texto.cor, FOLHA_CASCATA.vazio.cor]) {
      expect(contraste(cor, colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('GradeOpcoes: linhas de 4 colunas, sem rolagem lateral', () => {
  it('reparte em linhas de 4 e completa a última com vazios (a célula não estica)', () => {
    const anos = ['2021', '2020', '2019', '2018', '2017', '2016'];
    expect(linhasDaGrade(anos)).toEqual([
      ['2021', '2020', '2019', '2018'],
      ['2017', '2016', null, null],
    ]);
  });

  it('lista vazia não tem linha; número de colunas explícito vale', () => {
    expect(linhasDaGrade([])).toEqual([]);
    expect(linhasDaGrade(['a', 'b', 'c'], 2)).toEqual([
      ['a', 'b'],
      ['c', null],
    ]);
    expect(linhasDaGrade(['a'], 0)).toEqual([['a']]);
  });
});

describe('FolhaCascata: o que aparece (spec §4.1, §4.2 e §9)', () => {
  it('com texto na busca, os resultados; sem resultado, a frase do vazio', () => {
    expect(conteudoDaFolhaCascata({ textoBusca: 'gol', resultados: 2, carregando: false, grade: false })).toBe('busca');
    expect(conteudoDaFolhaCascata({ textoBusca: 'xyz', resultados: 0, carregando: true, grade: false })).toBe('buscaVazia');
  });

  it('sem texto: carregando no lugar das opções, a grade do Ano ou a lista', () => {
    expect(conteudoDaFolhaCascata({ textoBusca: '  ', resultados: 0, carregando: true, grade: true })).toBe('carregando');
    expect(conteudoDaFolhaCascata({ textoBusca: '', resultados: 0, carregando: false, grade: true })).toBe('grade');
    expect(conteudoDaFolhaCascata({ textoBusca: undefined, resultados: 0, carregando: false, grade: false })).toBe('lista');
  });

  it('Recentes só sem texto na busca e com ao menos um', () => {
    expect(mostrarRecentes('', 1)).toBe(true);
    expect(mostrarRecentes(undefined, 3)).toBe(true);
    expect(mostrarRecentes('', 0)).toBe(false);
    expect(mostrarRecentes('go', 2)).toBe(false);
  });
});

describe('FolhaCascata: leitor de tela (spec §4.2)', () => {
  it('opção: o nome; com apoio, "Gol, Volkswagen"', () => {
    expect(leituraDaOpcaoCascata({ rotulo: '1.0' })).toBe('1.0');
    expect(leituraDaOpcaoCascata({ rotulo: 'Gol', apoio: 'Volkswagen' })).toBe('Gol, Volkswagen');
    expect(leituraDaOpcaoCascata({ rotulo: 'Gol', apoio: ' ' })).toBe('Gol');
  });
});

describe('FolhaCascata: movimento avançar (240 ms; reduzir movimento só troca)', () => {
  it('avançar entra pela direita, voltar pela esquerda, mesmo nível não anda', () => {
    expect(deslocamentoDoNivel(1, 2, false)).toBe(FOLHA_CASCATA.avanco.deslocamento);
    expect(deslocamentoDoNivel(3, 1, false)).toBe(-FOLHA_CASCATA.avanco.deslocamento);
    expect(deslocamentoDoNivel(2, 2, false)).toBe(0);
  });

  it('com "reduzir movimento", nenhum deslocamento e duração 0', () => {
    expect(deslocamentoDoNivel(1, 2, true)).toBe(0);
    expect(duracaoMovimento('avancar', true)).toBe(0);
    expect(MOVIMENTO.avancar.duracaoMs).toBe(240);
  });

  it('profundidade = passos da trilha (o nível atual fica no rótulo, não na trilha)', () => {
    expect(profundidadeDaCascata([])).toBe(0);
    expect(profundidadeDaCascata([{ rotulo: 'Volkswagen' }, { rotulo: 'Gol' }])).toBe(2);
  });
});

describe('Chip com contagem (spec §6)', () => {
  it('leitor: "Suspensão, 3 peças" / "Freio, 1 peça"; sem contagem, o rótulo', () => {
    expect(leituraDoChip('Suspensão', 3)).toBe('Suspensão, 3 peças');
    expect(leituraDoChip('Freio', 1)).toBe('Freio, 1 peça');
    expect(leituraDoChip('Freio', 1200)).toBe('Freio, 1.200 peças');
    expect(leituraDoChip('Todos')).toBe('Todos');
    expect(UNIDADE_CONTAGEM_CHIP).toEqual({ singular: 'peça', plural: 'peças' });
  });

  it('desenho: nome 600 e número 400 tabular, sem cor solta', () => {
    const ui = ler('./ui.tsx');
    const chip = ui.slice(ui.indexOf('export function Chip('), ui.indexOf('export function Banner'));
    expect(chip).toContain('contagem');
    expect(chip).toContain('leituraDoChip(label, contagem)');
    expect(chip).toContain('textoDaContagem(contagem)');
    expect(ui).toMatch(/chipContagem: \{ \.\.\.fonte\.body, fontSize: 14, fontVariant: \['tabular-nums'\] \}/);
    expect(ui).toMatch(/chipText: \{ \.\.\.fonte\.semibold, fontSize: 14 \}/);
    expect(chip).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('BotaoFiltro com ícone e ativo (spec §3)', () => {
  it('destaque (borda ink 1,5) com selo ou com `ativo`; selo só com contagem', () => {
    expect(destaqueDoBotaoFiltro(0, false)).toEqual({ destacado: false, selo: null });
    expect(destaqueDoBotaoFiltro(2, false)).toEqual({ destacado: true, selo: '2' });
    expect(destaqueDoBotaoFiltro(0, true)).toEqual({ destacado: true, selo: null });
    expect(destaqueDoBotaoFiltro(undefined, undefined)).toEqual({ destacado: false, selo: null });
  });

  it('desenho: ícone por prop (padrão funil), contagem opcional e borda ink 1,5', () => {
    const f = ler('./filtro.tsx');
    const botao = /export function BotaoFiltro[\s\S]*?\n}\n/.exec(f)?.[0] ?? '';
    expect(botao).toContain("icone = 'filtro'");
    expect(botao).toContain('contagem?: number');
    expect(botao).toContain('ativo?: boolean');
    expect(botao).toContain('<Icon name={icone} size={20} color={colors.ink} strokeWidth={2} />');
    expect(botao).toContain('destaqueDoBotaoFiltro(contagem, ativo)');
    expect(f).toMatch(/botaoAtivo: \{ borderColor: colors\.ink, borderWidth: 1\.5 \}/);
  });
});

describe('Linha de etiquetas (spec §3): quebra linha, 8 dp entre as linhas', () => {
  it('medidas', () => {
    expect(LINHA_ETIQUETAS).toEqual({ vaoColuna: 8, vaoLinha: 8 });
  });

  it('desenho: flexWrap, sem ScrollView horizontal', () => {
    const f = ler('./filtro.tsx');
    const linha = /export function LinhaEtiquetas[\s\S]*?\n}\n/.exec(f)?.[0] ?? '';
    expect(linha).not.toBe('');
    expect(linha).not.toContain('ScrollView');
    expect(f).toMatch(/linhaEtiquetas: \{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: LINHA_ETIQUETAS\.vaoColuna, rowGap: LINHA_ETIQUETAS\.vaoLinha \}/);
  });
});

describe('cascata-rn.tsx: conferência estática', () => {
  const f = ler('./cascata-rn.tsx');

  it('usa as peças do kit: Folha, Trilha compacta, RotuloSecao, CampoBusca e Botao principal', () => {
    expect(f).toContain('<Folha');
    expect(f).toMatch(/<Trilha[\s\S]*?compacta/);
    expect(f).toContain('semAtual');
    expect(f).toContain('<RotuloSecao');
    expect(f).toContain('<CampoBusca');
    expect(f).toContain('nivel="principal"');
    expect(f).toContain('<Loading embutido');
  });

  it('nenhum texto fixo, nenhuma cor solta e nenhuma rolagem lateral', () => {
    expect(f).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
    expect(f).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(f).not.toContain('horizontal');
  });

  it('movimento avançar pela regra pura, respeitando "reduzir movimento"', () => {
    expect(f).toContain("duracaoMovimento('avancar', reduzir)");
    expect(f).toContain('deslocamentoDoNivel(');
    expect(f).toContain('useReduzirMovimento()');
  });

  it('Voltar do Android volta um nível; o foco vai para o rótulo do nível', () => {
    expect(f).toContain('onVoltar={onVoltar}');
    expect(f).toContain("AccessibilityInfo.sendAccessibilityEvent(");
    expect(f).toContain("accessibilityRole=\"header\"");
  });

  it('linhas de opção com a altura de toque; chevron só com próximo nível', () => {
    expect(f).toMatch(/opcao: \{[^}]*minHeight: FOLHA_CASCATA\.linha\.alturaMinima/);
    expect(f).toContain('o.temProximo ?');
  });
});

describe('Folha: rodapé fixo e Voltar do Android (aditivos)', () => {
  const f = ler('./folha.tsx');
  it('rodapeFixo fica fora da rolagem; onVoltar substitui o fechar no Voltar do Android', () => {
    expect(f).toContain('rodapeFixo?: ReactNode');
    expect(f).toContain('onRequestClose={onVoltar ?? onFechar}');
    expect(f).toMatch(/rodapeFixo \? <View style=\{s\.rodapeFixo\}/);
  });
});

describe('Trilha: semAtual (todos os passos são links)', () => {
  it('sem "você está aqui" quando o nível atual fica fora da trilha', () => {
    const f = ler('./navegacao.tsx');
    expect(f).toContain('semAtual?: boolean');
    expect(f).toContain('const atual = !semAtual && i === itens.length - 1;');
  });
});

describe('ícone carro (spec §11)', () => {
  it('existe, no traço comum, sem cor nem espessura própria', () => {
    expect(ler('./nomes-de-icone.ts')).toContain("'carro'");
    const fonte = ler('./icon.tsx');
    const bloco = /case 'carro':([\s\S]*?)\);\n/.exec(fonte)?.[1] ?? '';
    expect(bloco).toContain('{...c}');
    expect(bloco).not.toMatch(/stroke=|strokeWidth=|fill=|#[0-9A-Fa-f]{3,6}/);
  });
});
