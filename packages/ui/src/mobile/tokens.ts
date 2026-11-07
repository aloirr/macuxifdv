/**
 * Tokens visuais PUROS do app (T-0072): cor, espaçamento, raio, altura dos controles, sombra e movimento.
 * Sem react-native: roda em Node (Vitest) e é reexportado por `@macuxi/ui/mobile/puro` e por `theme.ts`.
 * Referência: docs/design/referencia-2026-11-03/Componentes.dc.html · especificação: docs/design/componentes.md.
 * Identidade mantida (destaque #C2540A, grafite #16202A, fundo #F3F4F1; Archivo nos títulos e números, IBM Plex Sans no texto).
 */

export const colors = {
  ground: '#F3F4F1',
  surface: '#FFFFFF',
  ink: '#16202A',
  ink2: '#4A5562',
  ink3: '#5B6673',
  /** texto de opção desabilitada (lista suspensa, dia futuro): 3:1 no branco, sempre com outro sinal (cadeado, sem toque) */
  inkDisabled: '#8A949C',
  line: '#E1E4DE',
  lineSoft: '#ECEEE9',
  lineStrong: '#C9CEC6',
  accent: '#C2540A',
  accentLight: '#F59A52',
  accentSoft: '#FBE9DC',
  accentInk: '#8F3D06',
  accentTint: '#FDF4EC',
  /** borda do cartão em destaque (ex.: "Pedidos para aprovar" da Gestão) */
  accentLine: '#F3C9A8',
  success: '#1D6B4F',
  successBg: '#E2F1EA',
  /** borda e trilho da barra no cartão de meta batida */
  successLine: '#B9DCCB',
  successTrack: '#C6E3D5',
  /** verde do ícone sobre o grafite (aviso no rodapé) */
  successOnDark: '#7FD1A8',
  /** vermelho de alerta sobre o grafite (ex.: aviso do gatilho no cartão Minha RV, T-0082): 8,5:1 sobre ink, 5,4:1 sobre darkTrack */
  dangerOnDark: '#F7A59C',
  warning: '#7A4F00',
  warningInk: '#5C3B00',
  warningBg: '#FFF1D6',
  danger: '#A8261B',
  dangerBg: '#FDE8E6',
  neutralBg: '#E6E9E2',
  neutralInk: '#34404D',
  /** roxo da referência do Novo pedido (selo de orçamento, T-0071): contraste 7,9:1 sobre o fundo */
  violet: '#4B2FA3',
  violetBg: '#ECE7FB',
  darkMuted: '#C9D0D8',
  darkTrack: '#34404D',
  mapBg: '#E6E9E2',
  mapBorder: '#D6DAD1',
  /** fundo escurecido atrás da folha e do diálogo */
  scrim: 'rgba(15,20,25,0.45)',
} as const;

/** Escala de espaçamento (dp). Use estes valores em gap, padding e margin. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Respiros fixos das telas (guia de 03/11 e `Screen`). */
export const layout = {
  /** margem lateral da tela (o `LinhaChips` sangra o mesmo valor) */
  telaLateral: 20,
  telaTopo: 28,
  /** entre blocos da tela (saudação, recado, metas, notificações) */
  entreBlocos: 14,
  /** entre cartões numa grade ou lista */
  entreCartoes: 8,
  /** dentro do cartão */
  cartao: 12,
  /** dentro do cartão de seção (recado do dia, folha) */
  secao: 18,
} as const;

/**
 * Raios. `sm`…`xxl` são os antigos (continuam valendo); os nomes em português dizem onde usar.
 * Botão 52 → 14; botão 44 → 12; cartão 14; seção 18; folha 22; pílula (chip de estado) 999.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 18,
  botao: 14,
  botaoMedio: 12,
  cartao: 14,
  secao: 18,
  folha: 22,
  pilula: 999,
} as const;

/** Alturas dos controles (dp). Alvo de toque mínimo: 48 (`TOUCH`). */
export const ALTURA = {
  principal: 52,
  secundario: 44,
  toque: 48,
  chipEstado: 28,
  chipEstadoPequeno: 24,
  barraAbas: 64,
  aviso: 52,
} as const;

/** Sombras (Android usa `elevation`; iOS e web usam shadow*). O app usa borda; sombra só no que flutua. */
export const shadow = {
  nenhuma: {},
  folha: { elevation: 16, shadowColor: '#0F1419', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
  aviso: { elevation: 6, shadowColor: '#0F1419', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cartaoElevado: { elevation: 2, shadowColor: '#0F1419', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
} as const;

/** Níveis de botão (um só `principal` por tela). */
export type NivelBotao = 'principal' | 'secundario' | 'neutro' | 'perigo';

export interface EstiloNivel {
  altura: number;
  raio: number;
  fundo: string;
  texto: string;
  borda: string | null;
  larguraBorda: number;
  tamanhoFonte: number;
}

export const NIVEIS_BOTAO: Record<NivelBotao, EstiloNivel> = {
  principal: { altura: ALTURA.principal, raio: radius.botao, fundo: colors.accent, texto: '#FFFFFF', borda: null, larguraBorda: 0, tamanhoFonte: 16 },
  secundario: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.surface, texto: colors.ink, borda: colors.ink, larguraBorda: 1.5, tamanhoFonte: 14 },
  neutro: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.lineSoft, texto: colors.ink, borda: null, larguraBorda: 0, tamanhoFonte: 14 },
  perigo: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.dangerBg, texto: colors.danger, borda: null, larguraBorda: 0, tamanhoFonte: 14 },
};

/** Visual do botão desabilitado (todos os níveis): cinza com texto legível, sem transparência. */
export const BOTAO_DESABILITADO = { fundo: colors.neutralBg, texto: colors.ink3, borda: null as string | null } as const;

/** Fundo escuro sobre o qual a variante `sobreEscuro` foi medida (faixa "Em atendimento", `Cartao tom="escuro"`). */
export const FUNDO_ESCURO = colors.ink;

/**
 * Níveis sobre fundo grafite (`<Botao sobreEscuro>`; T-0072, revisão do #94). No claro, o secundário (branco com borda
 * grafite) e o neutro (cinza claro) ficam quase iguais sobre o grafite; aqui cada nível tem um peso próprio:
 * - principal: o mesmo laranja cheio com texto branco (a regra de um só principal por tela não muda);
 * - secundário: laranja-claro cheio com texto grafite (a ação da faixa: "Fazer checkout");
 * - neutro: só o contorno claro, fundo transparente e texto branco (a alternativa: "Ver cliente");
 * - perigo: rosa com texto vermelho (o mesmo do claro, que se destaca do grafite).
 * `fundo: 'transparent'` = o texto fica sobre o `FUNDO_ESCURO` (o teste de contraste mede assim).
 */
export const NIVEIS_BOTAO_ESCURO: Record<NivelBotao, EstiloNivel> = {
  principal: { ...NIVEIS_BOTAO.principal },
  secundario: { ...NIVEIS_BOTAO.secundario, fundo: colors.accentLight, texto: colors.ink, borda: null, larguraBorda: 0 },
  neutro: { ...NIVEIS_BOTAO.neutro, fundo: 'transparent', texto: colors.surface, borda: colors.darkMuted, larguraBorda: 1.5 },
  perigo: { ...NIVEIS_BOTAO.perigo },
};

/** Desabilitado sobre o grafite: cinza-grafite com texto claro (o cinza claro do desabilitado comum brilharia mais que a ação). */
export const BOTAO_DESABILITADO_ESCURO = { fundo: colors.darkTrack, texto: colors.darkMuted, borda: null as string | null } as const;

/**
 * Estilo final do nível, com a altura grande (52) para o secundário que acompanha o principal no rodapé. `sobreEscuro` troca as
 * cores pelas de `NIVEIS_BOTAO_ESCURO` (alturas, raios e fontes não mudam).
 */
export function estiloDoNivel(nivel: NivelBotao, opcoes: { alto?: boolean; desabilitado?: boolean; sobreEscuro?: boolean } = {}): EstiloNivel {
  const base = (opcoes.sobreEscuro ? NIVEIS_BOTAO_ESCURO : NIVEIS_BOTAO)[nivel];
  const alto = nivel === 'principal' || Boolean(opcoes.alto);
  const tamanho = alto ? { altura: ALTURA.principal, raio: radius.botao, tamanhoFonte: 16 } : { altura: ALTURA.secundario, raio: radius.botaoMedio, tamanhoFonte: 14 };
  if (opcoes.desabilitado) {
    const off = opcoes.sobreEscuro ? BOTAO_DESABILITADO_ESCURO : BOTAO_DESABILITADO;
    return { ...base, ...tamanho, fundo: off.fundo, texto: off.texto, borda: null, larguraBorda: 0 };
  }
  return { ...base, ...tamanho };
}

/** Tons do chip de estado (cor SEMPRE acompanhada de texto). */
export type TomEstado = 'sucesso' | 'aviso' | 'erro' | 'neutro' | 'destaque' | 'roxo';

export const TONS_ESTADO: Record<TomEstado, { fg: string; bg: string }> = {
  sucesso: { fg: colors.success, bg: colors.successBg },
  aviso: { fg: colors.warning, bg: colors.warningBg },
  erro: { fg: colors.danger, bg: colors.dangerBg },
  neutro: { fg: colors.neutralInk, bg: colors.neutralBg },
  destaque: { fg: colors.accentInk, bg: colors.accentSoft },
  roxo: { fg: colors.violet, bg: colors.violetBg },
};

// ---------- contraste (WCAG 2.x) ----------
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
