/**
 * T-0088: telas do shell em volta da abertura do armazenamento (renderizadas com `react-dom/server`, `react-native` e o
 * kit simulados): "Atualizando os dados do aparelho…" com a barra e a frase do passo, sem nome técnico; a de erro com
 * "Tentar de novo", "Sair" e o detalhe para o suporte.
 */
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type Props = {
  children?: ReactNode;
  testID?: string;
  importantForAccessibility?: string;
  accessibilityLiveRegion?: string;
};
const host = (tag: string) =>
  function Host({ children, testID, importantForAccessibility, accessibilityLiveRegion }: Props) {
    return createElement(
      tag,
      {
        ...(testID ? { 'data-testid': testID } : {}),
        ...(importantForAccessibility ? { 'data-a11y': importantForAccessibility } : {}),
        ...(accessibilityLiveRegion ? { 'data-viva': accessibilityLiveRegion } : {}),
      },
      children,
    );
  };

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: () => {} },
  Share: { share: () => Promise.resolve({}) },
  View: host('div'),
  Text: host('span'),
  ScrollView: host('main'),
  StyleSheet: { create: <T,>(s: T) => s, absoluteFill: {} },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 48, left: 0, right: 0 }),
}));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'mono' }),
  type: new Proxy({}, { get: () => ({}) }),
  Banner: ({ children, testID, anunciar }: { children?: ReactNode; testID?: string; anunciar?: boolean }) =>
    createElement('p', { 'data-testid': testID, 'data-anunciar': String(Boolean(anunciar)) }, children),
  ProgressBar: ({ pct, rotulo }: { pct: number; rotulo?: string }) =>
    createElement('progress', { value: pct, max: 100, 'aria-label': rotulo }),
  Button: ({ label, testID, loading }: { label: string; testID?: string; loading?: boolean }) =>
    createElement('button', { 'data-testid': testID, 'data-carregando': String(Boolean(loading)) }, label),
}));

const { TelaErroArmazenamento, TelaPreparoAparelho } = await import('./preparo-aparelho');

describe('T-0088: tela de preparo e tela de erro do armazenamento', () => {
  it('preparo: título, frase do passo e a barra pelo progresso da passagem', () => {
    const html = renderToStaticMarkup(
      createElement(TelaPreparoAparelho, { progresso: { grupo: 'C', feitos: 1, total: 2 } }),
    );
    expect(html).toContain('Atualizando os dados do aparelho…');
    expect(html).toContain('Copiando produtos e clientes');
    // TalkBack: a barra tem rótulo (papel e valor no kit) e o número ao lado fica fora do leitor (não lê duas vezes)
    expect(html).toContain('<progress value="60" max="100" aria-label="Progresso da atualização">');
    expect(html).toMatch(/data-testid="preparo-pct" data-a11y="no">60%/);
    expect(html).toContain(
      'data-anunciar="true">Deixe o app aberto até terminar. Se ele fechar, nada se perde',
    );
    expect(html).not.toMatch(/pedido/i);
    expect(html).not.toMatch(/sync:|ent_|AsyncStorage|SQLite|macuxi-u-/);
  });

  it('preparo antes do 1º progresso: 0 % e a frase da fila', () => {
    const html = renderToStaticMarkup(createElement(TelaPreparoAparelho, { progresso: null }));
    expect(html).toContain('Copiando o que você registrou no aparelho');
    expect(html).toContain('0%');
  });

  it('erro: "Tentar de novo", "Sair / trocar usuário" e o detalhe técnico para o suporte', () => {
    const html = renderToStaticMarkup(
      createElement(TelaErroArmazenamento, {
        detalhe: 'os dados deste usuário estão no SQLite, indisponível neste APK',
        onTentar: () => {},
        onSair: () => {},
      }),
    );
    expect(html).toContain('Não foi possível abrir os dados do aparelho');
    expect(html).toContain('data-testid="armazenamento-tentar" data-carregando="false">Tentar de novo');
    expect(html).toContain('data-testid="armazenamento-sair" data-carregando="false">Sair / trocar usuário');
    expect(html).toContain(
      'data-testid="armazenamento-enviar" data-carregando="false">Enviar o detalhe ao suporte',
    );
    expect(html).toContain('indisponível neste APK');
    expect(html).not.toContain('Ainda não abriu');
    expect(html).not.toMatch(/pedido/i);
  });

  it('erro durante "Tentar de novo": a tela fica com o botão carregando; na 2ª falha, "Ainda não abriu…" como região viva', () => {
    const props = { detalhe: 'x', onTentar: () => {}, onSair: () => {} };
    const tentando = renderToStaticMarkup(
      createElement(TelaErroArmazenamento, { ...props, falhouDeNovo: true, tentando: true }),
    );
    expect(tentando).toContain('data-testid="armazenamento-tentar" data-carregando="true">Tentar de novo');
    expect(tentando).not.toContain('Ainda não abriu');
    const deNovo = renderToStaticMarkup(
      createElement(TelaErroArmazenamento, { ...props, falhouDeNovo: true }),
    );
    expect(deNovo).toContain(
      'data-testid="armazenamento-de-novo" data-viva="polite">Ainda não abriu. Tente de novo em instantes ou envie o detalhe ao suporte.',
    );
    expect(deNovo).toContain('data-testid="armazenamento-tentar" data-carregando="false">');
  });

  it('o layout raiz esconde do TalkBack o que fica por baixo da tela de preparo ou de erro', () => {
    const src = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
    expect(src).toContain("importantForAccessibility={sobre ? 'no-hide-descendants' : 'auto'}");
    const envolve = src.slice(src.indexOf("'no-hide-descendants'"), src.indexOf('{sobre}'));
    expect(envolve).toContain('<AreaSeguraSuperior>');
    expect(envolve).toContain('</AreaSeguraSuperior>');
  });
});
