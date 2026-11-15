/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §1 item 5; ajuste R-20261115-080500, item 3) — estilo do aviso da
 * tela de carga: sem destaque. Fonte do sistema, regular (`body`), 14/20 em `textoClaro` (MC-1203), à esquerda; sem negrito, sem caixa, sem borda,
 * sem fundo, sem ícone e sem corte. Renderizado com `react-dom/server`; o estilo de cada elemento vai para o HTML.
 */
import { MEDIDAS_FRASE_CARGA } from '@macuxi/ui/mobile/puro';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type Estilo = Record<string, unknown> | false | null | undefined | Estilo[];
const achatar = (s: Estilo): Record<string, unknown> =>
  Array.isArray(s) ? Object.assign({}, ...s.map(achatar)) : s ? (s as Record<string, unknown>) : {};
type Props = { children?: ReactNode; testID?: string; style?: Estilo; numberOfLines?: number };
const host = (tag: string) =>
  function Host({ children, testID, style, numberOfLines }: Props) {
    return createElement(
      tag,
      { 'data-testid': testID, 'data-estilo': JSON.stringify(achatar(style ?? null)), 'data-linhas': numberOfLines },
      children,
    );
  };

vi.mock('react-native', () => ({ Text: host('span'), View: host('div'), StyleSheet: { create: <T,>(s: T) => s } }));
vi.mock('@macuxi/ui/mobile', () => ({
  // a fonte e a cor viram o nome do token: o teste lê qual token o aviso usa
  fonts: new Proxy({}, { get: (_, k) => `fonte:${String(k)}` }),
  temaDaEntrada: () => new Proxy({}, { get: (_, k) => `tema:${String(k)}` }),
}));

const { AvisoCarga, TEXTO_AVISO_CARGA } = await import('./aviso-carga');

function avisoDa(variante: 'campo' | 'gestao') {
  const html = renderToStaticMarkup(createElement(AvisoCarga, { variante }));
  const m = /^<span data-testid="carga-aviso" data-estilo="([^"]*)">([^<]*)<\/span>$/.exec(html);
  return { html, estilo: m ? (JSON.parse(m[1]!.replaceAll('&quot;', '"')) as Record<string, unknown>) : null, texto: m?.[2] };
}

describe('Aviso da carga — estilo sem destaque (T-0181, ajuste R-20261115-080500)', () => {
  it('um texto só, sem caixa em volta, sem ícone e sem trecho em negrito', () => {
    for (const variante of ['campo', 'gestao'] as const) {
      const { html, estilo, texto } = avisoDa(variante);
      // nada além do <span> do aviso: sem <div> (caixa), sem <i> (ícone), sem <span> dentro (trecho com outro peso)
      expect(estilo, html).not.toBeNull();
      expect(texto).toBe(TEXTO_AVISO_CARGA);
      // nunca cortado: sem limite de linhas
      expect(html).not.toContain('data-linhas');
    }
  });

  it('fonte do sistema regular 14/20 em textoClaro, à esquerda; nenhuma outra chave (negrito, borda, fundo, respiro de caixa)', () => {
    const { aviso } = MEDIDAS_FRASE_CARGA;
    expect(aviso).toMatchObject({ fonte: 'body', tamanho: 14, linha: 20 });
    for (const variante of ['campo', 'gestao'] as const) {
      const { estilo } = avisoDa(variante);
      // igualdade exata: fontWeight, border*, backgroundColor e padding ficariam como chaves a mais
      expect(estilo).toEqual({
        fontFamily: 'fonte:body',
        fontSize: aviso.tamanho,
        lineHeight: aviso.linha,
        textAlign: 'left',
        color: 'tema:textoClaro',
      });
    }
  });
});
