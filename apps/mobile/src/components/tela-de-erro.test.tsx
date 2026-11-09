/**
 * T-0140 (relato de 08/11: o Novo pedido fechava o app): as telas de erro do shell, renderizadas com `react-dom/server`.
 * O `TelaDeErro` do kit é simulado (guarda as props); textos REAIS do kit (`TEXTOS_TELA_DE_ERRO`).
 * - tela de módulo: grava o erro com a rota, "Tentar de novo" chama o `retry`, "Ir para o Início" volta à raiz;
 * - raiz: grava como 'raiz' e não oferece saída (não há para onde ir dentro do app);
 * - as duas oferecem o envio do detalhe ao suporte (compartilhar do sistema).
 */
import { TEXTOS_TELA_DE_ERRO } from '@macuxi/ui/mobile/puro';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Acao = { rotulo: string; onPress: () => void };
type PropsTela = { titulo: string; texto: string; tentar: Acao; saida?: Acao; suporte?: Acao; nota?: string; testID?: string };

const sim = vi.hoisted(() => ({
  props: null as PropsTela | null,
  gravados: [] as { origem: string; onde: string | null }[],
  replace: (_: string): void => undefined,
  compartilhado: [] as string[],
}));

vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useEffect: (f: () => void) => f() }));
vi.mock('react-native', () => ({ Share: { share: (c: { message: string }) => (sim.compartilhado.push(c.message), Promise.resolve()) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { name: 'Macuxi Campo', version: '1.0.1' } } }));
vi.mock('expo-router', () => ({ router: { replace: (h: string) => sim.replace(h) }, usePathname: () => '/m/novo-pedido' }));
vi.mock('@macuxi/ui/mobile', async () => ({
  ...(await import('@macuxi/ui/mobile/puro')),
  TelaDeErro: (p: PropsTela) => {
    sim.props = p;
    return createElement('section', { 'data-testid': p.testID }, p.titulo);
  },
}));
vi.mock('@/services/erros', () => ({
  gravarErro: (_e: unknown, origem: string, onde: string | null = null) => {
    sim.gravados.push({ origem, onde });
    return Promise.resolve();
  },
}));

const { TelaDeErroDaRaiz, TelaDeErroDoModulo } = await import('./tela-de-erro');

beforeEach(() => {
  sim.props = null;
  sim.gravados = [];
  sim.compartilhado = [];
});

describe('tela de erro do shell (T-0140)', () => {
  it('tela de módulo: textos do kit, grava com a rota, Tentar de novo e Ir para o Início', () => {
    const retry = vi.fn(() => Promise.resolve());
    const replace = vi.fn();
    sim.replace = replace;
    const html = renderToStaticMarkup(createElement(TelaDeErroDoModulo, { error: new Error('Rendered more hooks'), retry }));
    expect(html).toContain('data-testid="tela-erro"');
    expect(sim.props).toMatchObject({ titulo: TEXTOS_TELA_DE_ERRO.tela.titulo, texto: TEXTOS_TELA_DE_ERRO.tela.texto, nota: TEXTOS_TELA_DE_ERRO.tela.nota });
    expect(sim.gravados).toEqual([{ origem: 'tela', onde: '/m/novo-pedido' }]);
    sim.props!.tentar.onPress();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(sim.props!.saida?.rotulo).toBe('Ir para o Início');
    sim.props!.saida!.onPress();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('raiz: grava como raiz, sem saída; o suporte recebe app, versão, título e o detalhe técnico sem dado pessoal', () => {
    renderToStaticMarkup(createElement(TelaDeErroDaRaiz, { error: new TypeError('cliente ana@x.com.br 12.345.678/0001-90 sem endereço'), retry: () => Promise.resolve() }));
    expect(sim.props).toMatchObject({ titulo: TEXTOS_TELA_DE_ERRO.app.titulo, testID: 'tela-erro-raiz' });
    expect(sim.props!.saida).toBeUndefined();
    expect(sim.gravados).toEqual([{ origem: 'raiz', onde: null }]);
    sim.props!.suporte!.onPress();
    expect(sim.compartilhado).toHaveLength(1);
    const [linha1, , mensagem] = sim.compartilhado[0]!.split('\n');
    expect(linha1).toBe(`Macuxi Campo 1.0.1 · ${TEXTOS_TELA_DE_ERRO.app.titulo}`);
    expect(mensagem).toBe('TypeError: cliente [e-mail] [cnpj] sem endereço');
  });
});
