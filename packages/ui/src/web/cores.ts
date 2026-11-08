/**
 * Classes do destaque (laranja) no BKO e no portal (T-0094, contraste do laranja). Os valores ficam em
 * `apps/web/app/globals.css` (`--color-accent*`, do shell) e são os mesmos de `DESTAQUE` (`../comum/contraste`); o teste
 * confere que não divergem. Guia: docs/design/componentes.md §1.1.
 *
 * - texto laranja sobre claro (link, número em destaque, chip): `text-accent-ink`, nunca `text-accent` (4,17:1 no fundo);
 * - preenchimento laranja com texto: `bg-accent text-white` (4,60:1);
 * - gráfico (barra, borda, foco): `bg-accent`, `border-accent`, `outline-accent` (≥ 3:1 no fundo, no branco e no menu grafite).
 */
export const CLASSES_DESTAQUE = {
  texto: 'text-accent-ink',
  textoSobreDestaque: 'bg-accent text-white',
  chip: 'text-accent-ink bg-accent-soft',
  barra: 'bg-accent',
  foco: 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
} as const;

/** Classe proibida para texto sobre claro (a revisão de UX marca 🟡): `text-accent` sem o `-ink`. */
export const CLASSE_TEXTO_PROIBIDA = /(^|[\s:'"`])text-accent(?![-\w])/;

export * from '../comum/contraste';
