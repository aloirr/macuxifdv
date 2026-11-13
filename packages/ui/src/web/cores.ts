/**
 * Classes da marca v1 no BKO e no portal (T-0172; contraste desde a T-0094). Os valores ficam em `apps/web/app/globals.css`
 * (`--color-accent*`, `--color-grafico*`, `--color-faixa*`, do shell) e são os mesmos de `DESTAQUE`, `GRAFICO` e `FAIXA`
 * (`../comum/contraste`); o teste confere que não divergem. Guia: docs/design/componentes.md §1.1.
 *
 * - ação em Azul noite: link e chip `text-accent-ink`; botão principal `bg-accent text-white` (12,77:1); foco `outline-accent`;
 * - gráfico (barra, contador, marcador): `bg-grafico` (laranja), nunca texto laranja sobre claro;
 * - faixa do cabeçalho: `bg-faixa` com título `text-white` e subtítulo `text-faixa-texto`.
 */
export const CLASSES_DESTAQUE = {
  texto: 'text-accent-ink',
  textoSobreDestaque: 'bg-accent text-white',
  chip: 'text-accent-ink bg-accent-soft',
  barra: 'bg-grafico',
  foco: 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  faixa: 'bg-faixa text-white',
  faixaSubtitulo: 'text-faixa-texto',
} as const;

/** Classe proibida para texto (a revisão de UX marca 🟡): `text-accent` sem o `-ink`, e o laranja de gráfico em texto. */
export const CLASSE_TEXTO_PROIBIDA = /(^|[\s:'"`])text-(accent|grafico)(?![-\w])/;

export * from '../comum/contraste';
