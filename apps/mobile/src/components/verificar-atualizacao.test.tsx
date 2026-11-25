/**
 * Item 19 — `BotaoVerificarAtualizacao`, renderizado com `react-dom/server` (`react-native`, o kit e o Expo simulados):
 * ao abrir, só o botão "Verificar atualização", sem mensagem; o toque consulta a rota com a variante e a versão do app.
 * T-0195: com versão nova, "Versão X.Y.Z disponível" abre a folha `/atualizar-app` (sem texto próprio de instrução).
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type Props = { children?: ReactNode; testID?: string };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, { 'data-testid': testID }, children);
  };

const sim = vi.hoisted(() => ({
  toques: [] as Array<() => void>,
  pedidos: [] as Array<[string, unknown]>,
  recebidas: [] as unknown[],
  rotas: [] as string[],
  /** Resultado com que o botão já abre (simula a verificação concluída). */
  resultado: null as unknown,
}));

vi.mock('react', async (original) => {
  const r = await original<typeof import('react')>();
  return { ...r, useState: (inicial: unknown) => (inicial === null && sim.resultado ? [sim.resultado, () => undefined] : r.useState(inicial)) };
});
vi.mock('expo-router', () => ({ router: { push: (rota: string) => sim.rotas.push(rota) } }));
vi.mock('@/state/plataforma', () => ({ usePlataforma: () => ({ receberVersaoPublicada: (c: unknown) => sim.recebidas.push(c) }) }));

vi.mock('react-native', () => ({ Text: host('span'), View: host('div') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.16' } } }));
vi.mock('@/lib/variante', () => ({ varianteAtual: () => 'campo' }));
vi.mock('@macuxi/platform-sdk/react', () => ({
  useHttp: () => ({
    get: async (caminho: string, query: unknown) => {
      sim.pedidos.push([caminho, query]);
      return { variante: 'campo', versao: '1.0.17', publicada_em: null, fracao_liberada: true };
    },
  }),
}));
vi.mock('@macuxi/ui/mobile', () => ({
  type: { sub: {} },
  Button: ({ label, testID, onPress, disabled }: { label: string; testID?: string; onPress?: () => void; disabled?: boolean }) => {
    if (onPress) sim.toques.push(onPress);
    return createElement('button', { 'data-testid': testID, disabled }, label);
  },
}));

const { BotaoVerificarAtualizacao } = await import('./verificar-atualizacao');

describe('BotaoVerificarAtualizacao (item 19)', () => {
  it('ao abrir: só "Verificar atualização", sem mensagem', () => {
    const html = renderToStaticMarkup(createElement(BotaoVerificarAtualizacao));
    expect(html).toContain('data-testid="verificar-atualizacao-botao"');
    expect(html).toContain('>Verificar atualização</button>');
    expect(html).not.toContain('verificar-atualizacao-mensagem');
    expect(html).not.toContain('verificar-atualizacao-nova');
  });

  it('o toque pergunta a versão publicada da variante do app', async () => {
    sim.toques = [];
    renderToStaticMarkup(createElement(BotaoVerificarAtualizacao));
    sim.toques.at(-1)!();
    await new Promise((r) => setTimeout(r, 0));
    expect(sim.pedidos).toEqual([['/app/versao', { variante: 'campo', contrato: '3' }]]);
    // a resposta vai para a versão guardada do app (a folha mostra a mesma versão)
    expect(sim.recebidas).toEqual([{ variante: 'campo', versao: '1.0.17', publicada_em: null, fracao_liberada: true }]);
  });

  it('T-0195: versão nova = "Versão 1.0.17 disponível", sem linha de instrução, e o toque abre a folha /atualizar-app', () => {
    sim.toques = [];
    sim.resultado = { tipo: 'nova', versao: '1.0.17' };
    try {
      const html = renderToStaticMarkup(createElement(BotaoVerificarAtualizacao));
      expect(html).toContain('data-testid="verificar-atualizacao-nova"');
      expect(html).toContain('>Versão 1.0.17 disponível</button>');
      expect(html).not.toContain('verificar-atualizacao-mensagem');
      expect(html).not.toContain('administrador');
      sim.toques.at(-1)!();
      expect(sim.rotas).toEqual(['/atualizar-app']);
    } finally {
      sim.resultado = null;
    }
  });
});

describe('BotaoVerificarAtualizacao no Perfil (RD-1324)', () => {
  it('montado em app/profile.tsx logo abaixo da linha da versão, fora de qualquer condição de variante', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../app/profile.tsx', import.meta.url), 'utf8');
    const versao = src.lastIndexOf('testID="versao-app"');
    const botao = src.indexOf('<BotaoVerificarAtualizacao />');
    expect(botao).toBeGreaterThan(versao);
    expect(src.indexOf('</Screen>', botao)).toBeGreaterThan(botao);
    expect(src.slice(versao, botao)).not.toMatch(/varianteAtual|gestao|campo/);
  });
});
