/**
 * Contraste WCAG 2.x e a paleta do destaque (laranja), comuns ao kit web (BKO, portal) e ao kit mobile (Campo, Gestão).
 * Puro (roda em Node nos testes). Guia: docs/design/componentes.md §1.1 (T-0094, contraste do laranja).
 *
 * Regra do destaque (a mesma da referência de 03/11, `a{color:#8F3D06}` e aba ativa com rótulo #8F3D06 e ícone #C2540A):
 * - `accent` (#C2540A) é PREENCHIMENTO e GRÁFICO: fundo do botão principal, contador, barra, borda da aba, foco, ícone;
 * - TEXTO laranja sobre fundo claro é sempre `accentInk` (#8F3D06): link, rótulo de ação, chip, aba ativa;
 * - texto e ícone SOBRE o laranja cheio são `onAccent` (branco);
 * - sobre o grafite, o laranja de texto é `accentLight` (#F59A52).
 * Identidade mantida: nenhum valor da paleta mudou; só o uso de cada um ficou fixo e testado.
 */

function canal(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa de "#RRGGBB". */
export function luminancia(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`cor inválida: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => canal(Number.parseInt(x ?? '0', 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** Razão de contraste entre duas cores opacas (1 a 21). Texto normal pede ≥ 4,5. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Mínimos do WCAG 2.1 AA: texto normal 4,5:1; texto grande (≥ 18,66 px negrito ou 24 px) 3:1; ícone, borda e foco 3:1. */
export const MINIMO_CONTRASTE = { texto: 4.5, textoGrande: 3, grafico: 3 } as const;

export type TipoContraste = keyof typeof MINIMO_CONTRASTE;

/** Paleta do destaque (iguais no app e no BKO; `apps/web/app/globals.css` tem os mesmos valores em `--color-accent*`). */
export const DESTAQUE = {
  /** laranja da marca: preenchimento e gráfico, nunca texto sobre claro */
  accent: '#C2540A',
  /** texto laranja sobre claro (link, rótulo de ação, chip, aba ativa) */
  accentInk: '#8F3D06',
  /** texto e ícone sobre o laranja cheio */
  onAccent: '#FFFFFF',
  /** laranja de texto e ação sobre o grafite ("Desfazer") */
  accentLight: '#F59A52',
  /** fundo do chip e do cartão em destaque */
  accentSoft: '#FBE9DC',
  /** fundo do bloco em destaque mais leve */
  accentTint: '#FDF4EC',
} as const;

/** Fundos onde o destaque aparece (iguais no app e no BKO). */
export const FUNDOS = {
  ground: '#F3F4F1',
  surface: '#FFFFFF',
  ink: '#16202A',
} as const;

export interface ParContraste {
  /** onde aparece no kit */
  uso: string;
  fg: string;
  bg: string;
  tipo: TipoContraste;
}

/**
 * Todo uso do destaque no kit, com o mínimo que ele precisa atingir. O teste mede cada par; a tabela de
 * docs/design/componentes.md §1.1 traz os mesmos pares com a razão calculada.
 */
export const PARES_DO_DESTAQUE: readonly ParContraste[] = [
  // texto e ícone sobre o laranja cheio
  { uso: 'texto do botão principal sobre o laranja', fg: DESTAQUE.onAccent, bg: DESTAQUE.accent, tipo: 'texto' },
  { uso: 'número do contador e do selo sobre o laranja', fg: DESTAQUE.onAccent, bg: DESTAQUE.accent, tipo: 'texto' },
  // texto laranja sobre claro: sempre accentInk
  { uso: 'link e rótulo de ação no fundo', fg: DESTAQUE.accentInk, bg: FUNDOS.ground, tipo: 'texto' },
  { uso: 'link e rótulo de ação no cartão', fg: DESTAQUE.accentInk, bg: FUNDOS.surface, tipo: 'texto' },
  { uso: 'aba ativa (rótulo) no branco', fg: DESTAQUE.accentInk, bg: FUNDOS.surface, tipo: 'texto' },
  { uso: 'chip e cartão em destaque', fg: DESTAQUE.accentInk, bg: DESTAQUE.accentSoft, tipo: 'texto' },
  { uso: 'texto no bloco em destaque leve', fg: DESTAQUE.accentInk, bg: DESTAQUE.accentTint, tipo: 'texto' },
  // gráfico em laranja sobre claro: ícone, borda da aba, barra, foco
  { uso: 'ícone, borda e foco laranja no fundo', fg: DESTAQUE.accent, bg: FUNDOS.ground, tipo: 'grafico' },
  { uso: 'ícone, borda e foco laranja no cartão', fg: DESTAQUE.accent, bg: FUNDOS.surface, tipo: 'grafico' },
  { uso: 'ícone laranja no quadrado accentSoft (opção da folha)', fg: DESTAQUE.accent, bg: DESTAQUE.accentSoft, tipo: 'grafico' },
  { uso: 'ícone laranja no bloco accentTint', fg: DESTAQUE.accent, bg: DESTAQUE.accentTint, tipo: 'grafico' },
  // sobre o grafite
  { uso: 'botão principal laranja sobre o grafite (forma)', fg: DESTAQUE.accent, bg: FUNDOS.ink, tipo: 'grafico' },
  { uso: 'foco laranja no menu grafite do BKO', fg: DESTAQUE.accent, bg: FUNDOS.ink, tipo: 'grafico' },
  { uso: 'ação "Desfazer" e ícone de erro sobre o grafite', fg: DESTAQUE.accentLight, bg: FUNDOS.ink, tipo: 'texto' },
];

/**
 * Pares PROIBIDOS (abaixo de 4,5:1 para texto): o motivo de existir o `accentInk`. O teste garante que continuam abaixo,
 * para a regra não virar letra morta se alguém mexer na paleta.
 */
export const PARES_PROIBIDOS_PARA_TEXTO: readonly ParContraste[] = [
  { uso: 'texto accent no fundo (4,17:1)', fg: DESTAQUE.accent, bg: FUNDOS.ground, tipo: 'texto' },
  { uso: 'texto accent no accentSoft (3,90:1)', fg: DESTAQUE.accent, bg: DESTAQUE.accentSoft, tipo: 'texto' },
  { uso: 'texto accent no accentTint (4,23:1)', fg: DESTAQUE.accent, bg: DESTAQUE.accentTint, tipo: 'texto' },
  { uso: 'texto accent no grafite (3,58:1)', fg: DESTAQUE.accent, bg: FUNDOS.ink, tipo: 'texto' },
];

/** O par atinge o mínimo do seu tipo? */
export function atingeContraste(par: Pick<ParContraste, 'fg' | 'bg' | 'tipo'>): boolean {
  return contraste(par.fg, par.bg) >= MINIMO_CONTRASTE[par.tipo];
}

/** Razão arredondada em 2 casas, em pt-BR ("4,60:1"), para a tabela do guia. Passa ou não passa é sempre pelo valor exato. */
export function razaoTexto(fg: string, bg: string): string {
  return `${contraste(fg, bg).toFixed(2).replace('.', ',')}:1`;
}
