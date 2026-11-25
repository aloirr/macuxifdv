/**
 * Folha da foto do PDV (spec docs/design/telas/cliente-documentacao-v1034.md §5): um jeito visível de sair, "Cancelar" no
 * rodapé, sem ✕; "Cancelar" devolve `null` ao Core depois da saída da folha.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  folha: null as null | Record<string, unknown>,
  respostas: [] as unknown[],
}));

vi.mock('@macuxi/ui/mobile', () => ({
  Folha: (p: Record<string, unknown> & { children?: ReactNode }) => {
    sim.folha = p;
    return createElement('div', null, p.children);
  },
  OpcaoFolha: (p: { titulo: string }) => createElement('span', null, p.titulo),
}));
vi.mock('@/lib/folha-foto-pdv', () => ({
  assinarFolhaFotoPdv: () => () => undefined,
  responderFolhaFotoPdv: (o: unknown) => sim.respostas.push(o),
  TEXTO_CAMERA_NEGADA: 'Permita o acesso à câmera nos ajustes.',
}));

import { ESPERA_SAIDA_FOLHA_MS, FolhaFotoPdv } from './folha-foto-pdv';

afterEach(() => {
  vi.useRealTimers();
  sim.folha = null;
  sim.respostas = [];
});

describe('FolhaFotoPdv', () => {
  it('só "Cancelar" no rodapé, sem ✕; as duas opções', () => {
    const html = renderToStaticMarkup(createElement(FolhaFotoPdv));
    expect(sim.folha?.fechar).toBeUndefined();
    expect(sim.folha?.rodape).toMatchObject({ rotulo: 'Cancelar', testID: 'folha-foto-pdv-cancelar' });
    expect(html).toContain('Tirar foto');
    expect(html).toContain('Escolher da galeria');
    expect(html).not.toContain('Voltar');
  });

  it('"Cancelar" devolve null depois da saída da folha', () => {
    vi.useFakeTimers();
    renderToStaticMarkup(createElement(FolhaFotoPdv));
    (sim.folha?.rodape as { onPress: () => void }).onPress();
    expect(sim.respostas).toEqual([]);
    vi.advanceTimersByTime(ESPERA_SAIDA_FOLHA_MS);
    expect(sim.respostas).toEqual([null]);
  });
});
