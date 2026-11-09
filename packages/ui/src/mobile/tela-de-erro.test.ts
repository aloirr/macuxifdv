import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contraste, MINIMO_CONTRASTE } from '../comum/contraste';
import {
  cabecalhoDoUltimoErro,
  EFEITO_DO_ERRO,
  leituraDaTelaDeErro,
  TEXTO_SEM_ERRO_REGISTRADO,
  TEXTOS_TELA_DE_ERRO,
  type AlcanceDoErro,
} from './tela-de-erro';
import { colors } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('tela de erro (T-0140): textos', () => {
  const alcances: AlcanceDoErro[] = ['tela', 'app'];

  it('diz o que houve e o que fazer, sem jargão nem culpa', () => {
    for (const a of alcances) {
      const t = TEXTOS_TELA_DE_ERRO[a];
      expect(t.titulo).toMatch(/^Não foi possível mostrar /);
      expect(t.texto).toMatch(/^O que você registrou continua guardado neste aparelho\./);
      expect(t.texto).toContain('avise o suporte');
      for (const frase of [t.titulo, t.texto, t.nota]) {
        expect(frase, frase).not.toMatch(/problema|render|exce[cç]|fatal|crash|erro inesperado|você (errou|fez)/i);
      }
      // título cabe em 2 linhas de 20 dp numa tela de 360 dp
      expect(t.titulo.length).toBeLessThanOrEqual(40);
      // botões sem ponto final (§7)
      for (const b of [t.tentar, t.inicio, t.suporte]) if (b) expect(b.endsWith('.')).toBe(false);
    }
  });

  it('a tela de módulo tem saída para o Início; a raiz manda fechar e abrir o app', () => {
    expect(TEXTOS_TELA_DE_ERRO.tela).toMatchObject({ titulo: 'Não foi possível mostrar esta tela', tentar: 'Tentar de novo', inicio: 'Ir para o Início' });
    expect(TEXTOS_TELA_DE_ERRO.app).toMatchObject({ titulo: 'Não foi possível mostrar o app', tentar: 'Tentar de novo', inicio: null });
    expect(TEXTOS_TELA_DE_ERRO.app.texto).toContain('feche e abra o app');
    expect(TEXTOS_TELA_DE_ERRO.tela.nota).toBe('O detalhe do erro fica em Perfil › Diagnóstico.');
  });

  it('o leitor de tela ouve o título e o que fazer', () => {
    expect(leituraDaTelaDeErro(TEXTOS_TELA_DE_ERRO.tela)).toBe(
      'Não foi possível mostrar esta tela. O que você registrou continua guardado neste aparelho. Tente de novo; se continuar, avise o suporte.',
    );
  });
});

describe('Diagnóstico do Perfil (T-0140): linha "Último erro do app"', () => {
  it('diz quando, o efeito e onde', () => {
    expect(cabecalhoDoUltimoErro('fatal', 'hoje 17:15')).toBe('Último erro do app: hoje 17:15 · o app fechou');
    expect(cabecalhoDoUltimoErro('tela', 'hoje 17:15', '/m/novo-pedido')).toBe('Último erro do app: hoje 17:15 · mostrou a tela de erro · /m/novo-pedido');
    expect(cabecalhoDoUltimoErro('raiz', 'ontem 9:02')).toBe('Último erro do app: ontem 9:02 · mostrou a tela de erro do app');
    expect(cabecalhoDoUltimoErro('nao-fatal', 'hoje 8:00', null)).toBe('Último erro do app: hoje 8:00 · o app seguiu aberto');
    expect(Object.keys(EFEITO_DO_ERRO).sort()).toEqual(['fatal', 'nao-fatal', 'raiz', 'tela']);
    expect(TEXTO_SEM_ERRO_REGISTRADO).toBe('Nenhum erro do app registrado neste aparelho.');
  });
});

describe('TelaDeErro (T-0140): conferência estática', () => {
  const fonte = ler('./tela-de-erro-rn.tsx');

  it('exportada pelo kit (componente) e pela parte pura (textos)', () => {
    expect(fonte).toMatch(/export function TelaDeErro\b/);
    expect(ler('./index.ts')).toContain("export * from './tela-de-erro-rn'");
    expect(ler('./index.ts')).toContain("export * from './tela-de-erro'");
    expect(ler('./puro.ts')).toContain("export * from './tela-de-erro'");
  });

  it('funciona fora dos provedores do shell: sem área segura, roteador nem contexto', () => {
    const importacoes = fonte.split('\n').filter((l) => l.startsWith('import ')).join('\n');
    expect(importacoes).not.toMatch(/react-native-safe-area-context|expo-router|useContext|from '\.\/ui'|from '\.\/voltar'/);
    expect(fonte).not.toMatch(/useSafeAreaInsets|useContext\(|router\./);
  });

  it('um só principal; título é cabeçalho e a tela é anunciada ao aparecer', () => {
    expect(fonte.match(/nivel="principal"/g)).toHaveLength(1);
    expect(fonte).toContain('nivel="secundario"');
    expect(fonte).toContain('nivel="neutro"');
    expect(fonte).toContain('accessibilityRole="header"');
    expect(fonte).toContain('AccessibilityInfo.announceForAccessibility(leituraDaTelaDeErro');
    // o ícone é decorativo: o título já diz o que houve
    expect(fonte).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('texto legível ao sol: título, texto e nota ≥ 4,5:1 no fundo; ícone âmbar ≥ 3:1 no círculo', () => {
    expect(contraste(colors.ink, colors.ground)).toBeGreaterThanOrEqual(MINIMO_CONTRASTE.texto);
    expect(contraste(colors.ink2, colors.ground)).toBeGreaterThanOrEqual(MINIMO_CONTRASTE.texto);
    expect(contraste(colors.warning, colors.warningBg)).toBeGreaterThanOrEqual(MINIMO_CONTRASTE.grafico);
    expect(fonte).toMatch(/titulo: \{[^}]*color: colors\.ink,/);
    expect(fonte).toMatch(/texto: \{[^}]*color: colors\.ink2,/);
    expect(fonte).toMatch(/nota: \{[^}]*color: colors\.ink2,/);
  });
});
