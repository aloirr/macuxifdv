/**
 * Contraste WCAG 2.x e a paleta da marca, comuns ao kit web (BKO, portal) e ao kit mobile (Campo, Gestão).
 * Puro (roda em Node nos testes). Guia: docs/design/componentes.md §1 e §1.1; marca: docs/marca/manual.md §3 e §4 (T-0172).
 *
 * Regra da marca v1 (aprovada pelo dono do produto em 12/11/2026):
 * - `accent` é o Azul noite: botão principal, link, aba ativa, seleção, foco; texto de ação sobre claro é `accentInk` (o mesmo azul);
 * - texto e ícone sobre o Azul noite são `onAccent` (branco);
 * - o laranja (`GRAFICO.cor`) é só gráfico: barra de meta e de share, contador, marcador. Nunca texto sobre claro;
 * - sobre o escuro (grafite e Azul noite), o laranja é o sol claro (`accentLight` / `GRAFICO.sobreEscuro`);
 * - o cabeçalho das telas é a faixa Azul noite (`FAIXA`), com título branco e subtítulo `#C9CED5`;
 * - Azul noite nunca encosta no grafite.
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

/**
 * Paleta da marca v1 (docs/marca/manual.md §3), com os nomes do manual. Os papéis (destaque, gráfico, faixa, fundos) ficam nos
 * objetos abaixo, que são o que o kit usa.
 */
export const MARCA = {
  /** a cor da marca: faixa do cabeçalho, botão principal, link, aba ativa */
  azulNoite: '#1E3350',
  /** fundo das telas (app, BKO e portal) */
  perola: '#F8F6F1',
  branco: '#FFFFFF',
  /** sol do logo e gráficos sobre claro (barra de meta e de share, contador, marcador). Nunca texto sobre claro */
  sol: '#C2540A',
  /** o sol e os gráficos sobre o escuro (Azul noite e grafite) */
  solClaro: '#F59A52',
  /** texto principal, botão Sincronizar, menu lateral do BKO */
  grafite: '#16202A',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  /** fundo do chip e do cartão em destaque; linha (divisória e borda do cartão) */
  azulSuave: '#DFE2E6',
  /** Névoa (MC-0004 B, 14/11/2026): linha suave, chip neutro, botão desabilitado, avatar, fundo do mapa */
  nevoa: '#ECEEF1',
  /** subtítulo dentro do cabeçalho Azul noite; borda forte (campo, linha forte, borda do mapa) */
  claroNaFaixa: '#C9CED5',
  /** azul sobre o grafite (menu do BKO) */
  azulClaro: '#9AA3B0',
} as const;

/**
 * Destaque = a cor de AÇÃO (marca v1: Azul noite; até a v1.0.4 era o laranja). Iguais no app e no BKO; `apps/web/app/globals.css`
 * tem os mesmos valores em `--color-accent*`. Os nomes `accent*` ficaram para não mexer nas telas.
 */
export const DESTAQUE = {
  /** preenchimento da ação: botão principal, aba ativa (ícone e borda), seleção, foco */
  accent: MARCA.azulNoite,
  /** texto de ação sobre claro: link, rótulo de ação, chip, aba ativa (o Azul noite já passa em texto: 11,82:1 no Pérola) */
  accentInk: MARCA.azulNoite,
  /** texto e ícone sobre o Azul noite */
  onAccent: MARCA.branco,
  /** ação e gráfico sobre o escuro (grafite e Azul noite): "Desfazer", sol do logo negativo */
  accentLight: MARCA.solClaro,
  /** fundo do chip e do cartão em destaque */
  accentSoft: MARCA.azulSuave,
  /** fundo do bloco em destaque leve (opção marcada, atalho): o mesmo Azul suave, sem cor "quase igual" (manual §3) */
  accentTint: MARCA.azulSuave,
} as const;

/** Gráfico (barra de meta e de share, contador, marcador): o laranja da marca. Nunca texto sobre claro. */
export const GRAFICO = {
  /** sobre claro (Pérola, branco) */
  cor: MARCA.sol,
  /** sobre o escuro (Azul noite, grafite) */
  sobreEscuro: MARCA.solClaro,
} as const;

/**
 * Faixa Azul noite do cabeçalho (manual §4) e da tela de entrada (docs/design/entrada-sync.md). `trilho`, `feito` e `erro` só
 * valem na tela de entrada (barra de sincronização e etapas).
 */
export const FAIXA = {
  fundo: MARCA.azulNoite,
  titulo: MARCA.branco,
  subtitulo: MARCA.claroNaFaixa,
  /** trilho da barra de sincronização (só fundo; a informação está no preenchimento `GRAFICO.sobreEscuro`) */
  trilho: '#3A4D68',
  /** ✓ das etapas feitas */
  feito: '#7FD1A8',
  /** erro ("Sem internet na etapa 3 de 5") */
  erro: '#F7A59C',
} as const;

/** Fundos onde o destaque aparece (iguais no app e no BKO). */
export const FUNDOS = {
  ground: MARCA.perola,
  surface: MARCA.branco,
  ink: MARCA.grafite,
  faixa: MARCA.azulNoite,
} as const;

export interface ParContraste {
  /** onde aparece no kit */
  uso: string;
  fg: string;
  bg: string;
  tipo: TipoContraste;
}

/**
 * Pares do manual da marca §3 (e `docs/marca/ativos/2026-11-12-v1/contraste.json`), com a razão publicada lá. O teste mede
 * cada um e confere a razão com 2 casas.
 */
export const PARES_DA_MARCA: readonly (ParContraste & { razao: string })[] = [
  { uso: 'branco no Azul noite', fg: MARCA.branco, bg: MARCA.azulNoite, tipo: 'texto', razao: '12,77:1' },
  { uso: 'texto claro na faixa no Azul noite', fg: MARCA.claroNaFaixa, bg: MARCA.azulNoite, tipo: 'texto', razao: '8,07:1' },
  { uso: 'Azul noite no Pérola', fg: MARCA.azulNoite, bg: MARCA.perola, tipo: 'texto', razao: '11,82:1' },
  { uso: 'Azul noite no Azul suave', fg: MARCA.azulNoite, bg: MARCA.azulSuave, tipo: 'texto', razao: '9,83:1' },
  { uso: 'grafite no Pérola', fg: MARCA.grafite, bg: MARCA.perola, tipo: 'texto', razao: '15,26:1' },
  { uso: '#4A5562 no Pérola', fg: MARCA.textoSecundario, bg: MARCA.perola, tipo: 'texto', razao: '7,03:1' },
  { uso: '#5B6673 no Pérola', fg: MARCA.textoApoio, bg: MARCA.perola, tipo: 'texto', razao: '5,41:1' },
  { uso: 'Azul claro no grafite', fg: MARCA.azulClaro, bg: MARCA.grafite, tipo: 'texto', razao: '6,47:1' },
  { uso: 'sol laranja no Pérola (gráfico)', fg: MARCA.sol, bg: MARCA.perola, tipo: 'grafico', razao: '4,26:1' },
  { uso: 'sol claro no Azul noite (gráfico)', fg: MARCA.solClaro, bg: MARCA.azulNoite, tipo: 'grafico', razao: '5,85:1' },
];

/**
 * Todo uso do destaque, do gráfico e da faixa no kit, com o mínimo que ele precisa atingir. O teste mede cada par; a tabela de
 * docs/design/componentes.md §1.1 traz os mesmos pares com a razão calculada.
 */
export const PARES_DO_DESTAQUE: readonly ParContraste[] = [
  // ação em Azul noite
  { uso: 'texto do botão principal sobre o Azul noite', fg: DESTAQUE.onAccent, bg: DESTAQUE.accent, tipo: 'texto' },
  { uso: 'link e rótulo de ação no fundo', fg: DESTAQUE.accentInk, bg: FUNDOS.ground, tipo: 'texto' },
  { uso: 'link, rótulo de ação e aba ativa no cartão e na barra', fg: DESTAQUE.accentInk, bg: FUNDOS.surface, tipo: 'texto' },
  { uso: 'chip e cartão em destaque', fg: DESTAQUE.accentInk, bg: DESTAQUE.accentSoft, tipo: 'texto' },
  { uso: 'texto secundário no chip e no cartão em destaque', fg: MARCA.textoSecundario, bg: DESTAQUE.accentSoft, tipo: 'texto' },
  { uso: 'ícone, borda e foco Azul noite no fundo', fg: DESTAQUE.accent, bg: FUNDOS.ground, tipo: 'grafico' },
  // gráfico em laranja
  { uso: 'número do contador e do selo sobre o laranja', fg: MARCA.branco, bg: GRAFICO.cor, tipo: 'texto' },
  { uso: 'barra e marcador laranja no fundo', fg: GRAFICO.cor, bg: FUNDOS.ground, tipo: 'grafico' },
  { uso: 'barra e marcador laranja no cartão', fg: GRAFICO.cor, bg: FUNDOS.surface, tipo: 'grafico' },
  { uso: 'gráfico sol claro no grafite', fg: GRAFICO.sobreEscuro, bg: FUNDOS.ink, tipo: 'grafico' },
  // faixa Azul noite (cabeçalho e tela de entrada)
  { uso: 'título da faixa', fg: FAIXA.titulo, bg: FAIXA.fundo, tipo: 'texto' },
  { uso: 'subtítulo e voltar da faixa', fg: FAIXA.subtitulo, bg: FAIXA.fundo, tipo: 'texto' },
  { uso: 'barra de sincronização (preenchimento) na faixa', fg: GRAFICO.sobreEscuro, bg: FAIXA.fundo, tipo: 'grafico' },
  { uso: 'barra de sincronização (preenchimento) sobre o trilho', fg: GRAFICO.sobreEscuro, bg: FAIXA.trilho, tipo: 'grafico' },
  { uso: 'etapa feita (✓) na faixa', fg: FAIXA.feito, bg: FAIXA.fundo, tipo: 'texto' },
  { uso: 'erro na faixa', fg: FAIXA.erro, bg: FAIXA.fundo, tipo: 'texto' },
  { uso: '"Tentar de novo": Azul noite no botão branco', fg: FAIXA.fundo, bg: MARCA.branco, tipo: 'texto' },
  // sobre o grafite
  { uso: 'ação "Desfazer" e ícone de erro sobre o grafite', fg: DESTAQUE.accentLight, bg: FUNDOS.ink, tipo: 'texto' },
];

/**
 * Pares PROIBIDOS para texto (manual §3): o teste garante que continuam abaixo de 4,5:1, para a regra não virar letra morta se
 * alguém mexer na paleta.
 */
export const PARES_PROIBIDOS_PARA_TEXTO: readonly ParContraste[] = [
  { uso: 'texto laranja no Pérola (4,26:1): laranja é só gráfico', fg: GRAFICO.cor, bg: FUNDOS.ground, tipo: 'texto' },
  { uso: 'texto laranja no grafite (3,58:1)', fg: GRAFICO.cor, bg: FUNDOS.ink, tipo: 'texto' },
  { uso: 'texto laranja no Azul suave', fg: GRAFICO.cor, bg: DESTAQUE.accentSoft, tipo: 'texto' },
];

/** Azul noite encostado no grafite: um some no outro (1,29:1; proibido até como forma, manual §3). */
export const PAR_PROIBIDO_AZUL_NO_GRAFITE: ParContraste = { uso: 'Azul noite sobre o grafite', fg: MARCA.azulNoite, bg: MARCA.grafite, tipo: 'grafico' };

/** O par atinge o mínimo do seu tipo? */
export function atingeContraste(par: Pick<ParContraste, 'fg' | 'bg' | 'tipo'>): boolean {
  return contraste(par.fg, par.bg) >= MINIMO_CONTRASTE[par.tipo];
}

/** Razão arredondada em 2 casas, em pt-BR ("4,60:1"), para a tabela do guia. Passa ou não passa é sempre pelo valor exato. */
export function razaoTexto(fg: string, bg: string): string {
  return `${contraste(fg, bg).toFixed(2).replace('.', ',')}:1`;
}
