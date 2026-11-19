import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ALVO_TOQUE,
  folgaDeToque,
  formaDoBadge,
  leituraDoAtalho,
  lerQuantidade,
  limitarPasso,
  proximoPasso,
  RESPIRO_ABA_ROLAVEL,
  rolagemAteAba,
  rotuloComContador,
} from './componentes';
import { radius } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('componentes genéricos (T-0071, fatia 4): parte pura', () => {
  it('rotuloComContador monta "Itens (3)" e some sem contador', () => {
    expect(rotuloComContador('Itens', 3)).toBe('Itens (3)');
    expect(rotuloComContador('Itens', 0)).toBe('Itens (0)');
    expect(rotuloComContador('Detalhes')).toBe('Detalhes');
    expect(rotuloComContador('Detalhes', null)).toBe('Detalhes');
    expect(rotuloComContador('Itens', Number.NaN)).toBe('Itens');
  });

  it('limitarPasso trunca e respeita mínimo e máximo', () => {
    expect(limitarPasso(3.7)).toBe(3);
    expect(limitarPasso(-2)).toBe(0);
    expect(limitarPasso(12, 1, 10)).toBe(10);
    expect(limitarPasso(Number.NaN, 1)).toBe(1);
    expect(limitarPasso(5000)).toBe(5000);
  });

  it('proximoPasso anda de passo em passo sem passar dos limites', () => {
    expect(proximoPasso(3, 1)).toBe(4);
    expect(proximoPasso(0, -1)).toBe(0);
    expect(proximoPasso(10, 1, 5, 0, 12)).toBe(12);
    expect(proximoPasso(6, -1, 5, 1)).toBe(1);
  });

  it('lerQuantidade aceita só dígitos e devolve null sem número', () => {
    expect(lerQuantidade('12')).toBe(12);
    expect(lerQuantidade(' 3 ')).toBe(3);
    expect(lerQuantidade('1.000')).toBe(1000);
    expect(lerQuantidade('')).toBeNull();
    expect(lerQuantidade('abc')).toBeNull();
  });

  it('folgaDeToque leva qualquer visual menor ao alvo de 48 dp', () => {
    expect(ALVO_TOQUE).toBe(48);
    expect(folgaDeToque(36)).toBe(6);
    expect(folgaDeToque(40)).toBe(4);
    expect(folgaDeToque(27)).toBe(11);
    expect(folgaDeToque(56)).toBe(0);
    for (const v of [24, 28, 33, 36, 40, 48]) expect(v + 2 * folgaDeToque(v)).toBeGreaterThanOrEqual(ALVO_TOQUE);
  });
});

describe('componentes genéricos (T-0071, fatia 4): conferência estática', () => {
  const ARQUIVOS = ['./formulario.tsx', './folha.tsx', './valores.tsx', './base.tsx'];

  it('exporta todos os componentes no índice do kit mobile', () => {
    const indice = ler('./index.ts');
    for (const arq of ['./componentes', './formulario', './folha', './valores', './navegacao', './base', './movimento-rn']) expect(indice).toContain(`export * from '${arq}'`);
    const fonte = ARQUIVOS.map(ler).join('\n') + ler('./navegacao.tsx');
    for (const nome of ['Abas', 'Segmentado', 'Passo', 'CampoBusca', 'RotuloSecao', 'ChipMedida', 'BotaoIcone', 'Folha', 'OpcaoFolha', 'Dialogo', 'RodapeTotal', 'LinhaValor', 'BlocoTotais', 'Faixa', 'Selo', 'Trilha', 'LinhaAtalho', 'Botao', 'Cartao', 'ChipEstado', 'AvisoRodape', 'useAvisoRodape', 'BarraAbas', 'EstadoVazio']) {
      expect(fonte, nome).toMatch(new RegExp(`export function ${nome}\\b`));
    }
  });

  it('nenhum texto fixo: sem frase entre tags, nem rótulo, placeholder ou título literal', () => {
    for (const arq of ARQUIVOS) {
      const src = ler(arq);
      // texto literal como filho de <Text>…</Text> (ex.: >Voltar<)
      expect(src, arq).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
      // props de texto com literal (accessibilityLabel="Fechar", placeholder="Buscar")
      expect(src, arq).not.toMatch(/(accessibilityLabel|accessibilityHint|placeholder|title)=["'][^"']+["']/);
    }
  });

  it('rolagemAteAba (Abas rolavel): leva a aba ativa até ficar à vista', () => {
    const m = RESPIRO_ABA_ROLAVEL;
    // já visível: não mexe
    expect(rolagemAteAba({ x: 100, largura: 80 }, 0, 360)).toBe(0);
    // cortada à direita: rola o mínimo (fim + respiro encosta na borda)
    expect(rolagemAteAba({ x: 320, largura: 90 }, 0, 360)).toBe(320 + 90 + m - 360);
    // cortada à esquerda: volta até o início com respiro
    expect(rolagemAteAba({ x: 50, largura: 80 }, 200, 360)).toBe(50 - m);
    // nunca negativo
    expect(rolagemAteAba({ x: 0, largura: 80 }, 40, 360)).toBe(0);
    expect(rolagemAteAba({ x: 10, largura: 80 }, -5, 0)).toBe(0);
    // aba maior que a faixa: alinha o início
    expect(rolagemAteAba({ x: 400, largura: 500 }, 0, 360)).toBe(400 - m);
    // sem largura medida: mantém
    expect(rolagemAteAba({ x: 400, largura: 80 }, 30, 0)).toBe(30);
  });

  it('Abas tem o modo rolável (faixa horizontal) sem mudar o padrão', () => {
    const form = ler('./formulario.tsx');
    expect(form).toContain('rolavel?: boolean');
    expect(form).toContain('ScrollView');
    expect(form).toContain('rolagemAteAba(');
    expect(form).toMatch(/abaRolavel: \{[^}]*minWidth: ALVO_TOQUE/);
  });

  it('alvos de toque: nenhum height/minHeight/width fixo abaixo de 48 sem hitSlop no mesmo componente', () => {
    // As medidas visuais menores (36, 40, 28) só existem com hitSlop calculado por folgaDeToque, ou (T-0089, linha densa)
    // com o alvo de 44 dp no próprio botão e o visual desenhado dentro (no Android a folga não passa da borda do pai).
    const form = ler('./formulario.tsx');
    expect(form).toMatch(/segAlvoCompacto: \{[^}]*minWidth: ALVO_SEG_COMPACTO, height: ALVO_SEG_COMPACTO/);
    expect(form).toContain('const ALVO_SEG_COMPACTO = SEGMENTADO_COMPACTO.alvo;');
    expect(form).toContain('hitSlop={folga(LADO_PASSO)}');
    expect(form).toContain('hitSlop={folga(ALTURA_MEDIDA)}');
    expect(form).toContain('hitSlop={folga(tamanho)}');
  });

  it('Chip do kit com alvo de 48 dp (36 de altura + 6 em cima e embaixo)', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toContain('hitSlop={{ top: 6, bottom: 6 }}');
    expect(ui).toMatch(/chip: \{ height: 36,/);
  });

  it('Chip lê o rótulo completo quando o visível é abreviado ("28 d" → "28 dias")', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toMatch(/export function Chip\(\{[^}]*rotuloAcessivel[^}]*\}: \{[^}]*rotuloAcessivel\?: string/);
    expect(ui).toContain('accessibilityLabel={rotuloAcessivel ?? label}');
  });
});

describe('LinhaAtalho (atalho para outra vista da mesma aba: Rascunhos em Pedidos, T-0141 §F.1)', () => {
  it('leitura no TalkBack: rótulo, ponto e apoio com o "›" lido como vírgula', () => {
    expect(leituraDoAtalho('Rascunhos (2)', 'Somem 24 h após a última alteração')).toBe('Rascunhos (2). Somem 24 h após a última alteração');
    expect(leituraDoAtalho('Pedidos', 'Hoje › Atrasados')).toBe('Pedidos. Hoje, Atrasados');
    expect(leituraDoAtalho(' Rascunhos (2) ')).toBe('Rascunhos (2)');
    expect(leituraDoAtalho('Rascunhos (2)', '  ')).toBe('Rascunhos (2)');
  });

  it('alvo de 48 dp (56 com apoio), toque do kit, sem texto fixo e cores com contraste do guia', () => {
    const nav = ler('./navegacao.tsx');
    const bloco = /export function LinhaAtalho[\s\S]*?\n}\n/.exec(nav)?.[0] ?? '';
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).toContain('<Pressionavel');
    expect(bloco).toContain('accessibilityRole="button"');
    expect(bloco).toContain('leituraDoAtalho(rotulo, apoio)');
    expect(bloco).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
    expect(nav).toMatch(/atalho: \{[^}]*minHeight: ALVO[^}]*backgroundColor: colors\.accentSoft/);
    expect(nav).toMatch(/atalhoComApoio: \{ minHeight: 56 \}/);
    expect(nav).toMatch(/atalhoRotulo: \{[^}]*fontSize: 16, color: colors\.ink \}/);
    expect(nav).toMatch(/atalhoApoio: \{[^}]*fontSize: 14, color: colors\.ink2 \}/);
  });

  it('o ícone "arvore" saiu com o atalho "Ver por linha" (T-0142: Catálogo pela hierarquia, sem tela "Por linha")', () => {
    expect(ler('./icon.tsx')).not.toContain("'arvore'");
  });
});

describe('Novo pedido v3 (T-0141): ✕ da Folha', () => {
  it('Folha ganha o ✕ opcional à direita do título (48 dp, fora da rolagem, mesmo onFechar); sem a prop, o título de antes', () => {
    const f = ler('./folha.tsx');
    expect(f).toContain('fechar?: { rotulo: string; testID?: string };');
    expect(f).toContain('accessibilityLabel={fechar.rotulo} onPress={onFechar} style={s.fechar}');
    expect(f).toMatch(/fechar: \{ width: ALVO_TOQUE, height: ALVO_TOQUE,/);
    // o cabeçalho vem antes da área rolável (o ✕ não rola com o conteúdo)
    expect(f.indexOf('<View style={s.cabecalho}>')).toBeLessThan(f.indexOf('ref={teclado.area}'));
    expect(f).toContain(') : titulo ? (');
  });
});

describe('Badge com linhas?: 1 | 2 (MC-1790, T-0186)', () => {
  it('padrão 1 linha inalterado: pílula, numberOfLines 1, sem lineHeight nem padding vertical', () => {
    expect(formaDoBadge()).toEqual({ numberOfLines: 1, borderRadius: radius.pilula });
    expect(formaDoBadge(1)).toEqual(formaDoBadge());
  });

  it('2 linhas: numberOfLines 2, texto centralizado, lineHeight 16, paddingVertical 3 e raio não-pílula (radius.sm)', () => {
    const f = formaDoBadge(2);
    expect(f.numberOfLines).toBe(2);
    expect(f.textAlign).toBe('center');
    expect(f.lineHeight).toBe(16);
    expect(f.paddingVertical).toBe(3);
    expect(f.borderRadius).toBe(radius.sm);
    expect(f.borderRadius).not.toBe(radius.pilula);
  });

  it('o Badge usa formaDoBadge, tem linhas = 1 por padrão e mantém minHeight 24', () => {
    const src = ler('./ui.tsx');
    expect(src).toMatch(/export function Badge\(\{[^}]*linhas = 1[^}]*\}/);
    expect(src).toMatch(/const f = formaDoBadge\(linhas\)/);
    expect(src).toMatch(/numberOfLines=\{f\.numberOfLines\}/);
    expect(src).not.toMatch(/badgeText[^\n]*numberOfLines=\{1\}/);
    expect(src).toMatch(/badge: \{[^}]*minHeight: 24/);
  });
});
