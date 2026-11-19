/**
 * Tokens visuais PUROS do app (T-0072): cor, espaçamento, raio, altura dos controles, sombra e movimento.
 * Sem react-native: roda em Node (Vitest) e é reexportado por `@macuxi/ui/mobile/puro` e por `theme.ts`.
 * Referência: docs/design/referencia-2026-11-03/Componentes.dc.html · especificação: docs/design/componentes.md.
 * Marca v1 (T-0172, manual docs/marca/manual.md §3 e §4): ação em Azul noite #1E3350 (`accent`, `accentInk`), fundo Pérola
 * #F8F6F1, chip em destaque no Azul suave #DFE2E6, laranja #C2540A só em gráfico (`grafico`), cabeçalho na faixa Azul noite
 * (`faixa*`); grafite #16202A no texto. Fonte do sistema (Roboto no Android), hierarquia por peso; escala em `ESCALA_FONTE`. Pares e razões em
 * `../comum/contraste.ts` e docs/design/componentes.md §1.1.
 */

import { DESTAQUE, FAIXA, FUNDOS, GRAFICO, MARCA } from '../comum/contraste';

export * from '../comum/contraste';

/** neutro de apoio da marca #5B6673: texto terciário (`ink3`) e opção desabilitada (`inkDisabled`), um valor só */
const NEUTRO_APOIO = '#5B6673';

export const colors = {
  /** fundo das telas: Pérola */
  ground: FUNDOS.ground,
  surface: FUNDOS.surface,
  ink: FUNDOS.ink,
  ink2: '#4A5562',
  ink3: NEUTRO_APOIO,
  /** texto de opção desabilitada (lista suspensa, dia futuro): o neutro de apoio da marca #5B6673 (MC-1503 B, R-20261118-210515;
   * 5,84:1 no branco, 5,41:1 no Pérola), sempre com outro sinal (cadeado, sem toque) */
  inkDisabled: NEUTRO_APOIO,
  /** neutros da marca (MC-0004 B, manual §3): linha no Azul suave, linha suave na Névoa, linha forte no #C9CED5 */
  line: MARCA.azulSuave,
  lineSoft: MARCA.nevoa,
  lineStrong: MARCA.claroNaFaixa,
  /** AÇÃO (Azul noite): botão principal, aba ativa (ícone e borda), seleção, foco, ícone de ação. Nunca sobre o grafite. */
  accent: DESTAQUE.accent,
  /** ação e gráfico sobre o grafite: sol claro (7,56:1) */
  accentLight: DESTAQUE.accentLight,
  /** fundo do chip e do cartão em destaque: Azul suave */
  accentSoft: DESTAQUE.accentSoft,
  /** TEXTO de ação sobre claro: link, rótulo de ação, chip, aba ativa (11,82:1 no fundo, 12,77:1 no branco, 9,83:1 no accentSoft) */
  accentInk: DESTAQUE.accentInk,
  /** texto e ícone SOBRE o Azul noite (12,77:1) */
  onAccent: DESTAQUE.onAccent,
  accentTint: DESTAQUE.accentTint,
  /** borda do cartão em destaque (ex.: "Pedidos para aprovar" da Gestão): Azul claro, só enfeite da forma */
  accentLine: MARCA.azulClaro,
  /** GRÁFICO sobre claro: barra de meta e de share, contador, selo, marcador (laranja; nunca texto sobre claro) */
  grafico: GRAFICO.cor,
  /** GRÁFICO sobre o escuro (grafite e Azul noite): sol claro */
  graficoEscuro: GRAFICO.sobreEscuro,
  /** faixa do cabeçalho (Azul noite), título (branco) e subtítulo/voltar (#C9CED5) */
  faixa: FAIXA.fundo,
  faixaTitulo: FAIXA.titulo,
  faixaSub: FAIXA.subtitulo,
  /** tela de entrada: trilho da barra, ✓ da etapa feita e erro (docs/design/entrada-sync.md) */
  faixaTrilho: FAIXA.trilho,
  faixaFeito: FAIXA.feito,
  faixaErro: FAIXA.erro,
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
  /** chip neutro e botão desabilitado: Névoa (neutralInk 9,09:1; ink3 5,03:1) */
  neutralBg: MARCA.nevoa,
  neutralInk: '#34404D',
  /** texto claro sobre o escuro (grafite e faixa): o mesmo #C9CED5 da faixa, sem cor "quase igual" */
  darkMuted: MARCA.claroNaFaixa,
  darkTrack: '#34404D',
  mapBg: MARCA.nevoa,
  mapBorder: MARCA.claroNaFaixa,
  /** fundo escurecido atrás da folha e do diálogo */
  scrim: 'rgba(15,20,25,0.45)',
} as const;

/**
 * Escala de fonte do app por papel (R-20261115-110600; manual da marca §5.3): 12 legenda e rótulo pequeno · 14 secundário ·
 * 16 texto, campo e botão · 18 título de seção e valor · 22 título de tela, folha, diálogo e saudação · 28 número grande.
 * Nada abaixo de 12. Os estilos de texto (`type` em theme.ts) e os componentes usam só estes tamanhos.
 */
export const ESCALA_FONTE = { minimo: 12, apoio: 14, base: 16, secao: 18, titulo: 22, destaque: 28 } as const;
export const TAMANHOS_FONTE: readonly number[] = Object.values(ESCALA_FONTE);

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
 * Botão 52 → 14; botão 44 → 12; cartão 14; seção 18; diálogo 20; folha 22; pílula (chip de estado) 999.
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
  /** diálogo central (`Dialogo`, folha.tsx) */
  dialogo: 20,
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
  principal: { altura: ALTURA.principal, raio: radius.botao, fundo: colors.accent, texto: colors.onAccent, borda: null, larguraBorda: 0, tamanhoFonte: 16 },
  secundario: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.surface, texto: colors.ink, borda: colors.ink, larguraBorda: 1.5, tamanhoFonte: 14 },
  neutro: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.lineSoft, texto: colors.ink, borda: null, larguraBorda: 0, tamanhoFonte: 14 },
  perigo: { altura: ALTURA.secundario, raio: radius.botaoMedio, fundo: colors.dangerBg, texto: colors.danger, borda: null, larguraBorda: 0, tamanhoFonte: 14 },
};

/** Visual do botão desabilitado (todos os níveis): cinza com texto legível, sem transparência. */
export const BOTAO_DESABILITADO = { fundo: colors.neutralBg, texto: colors.ink3, borda: null as string | null } as const;

/** Fundo escuro sobre o qual a variante `sobreEscuro` foi medida (faixa "Em atendimento", `Cartao tom="escuro"`). */
export const FUNDO_ESCURO = colors.ink;

/**
 * Níveis sobre fundo escuro (grafite ou faixa Azul noite; `<Botao sobreEscuro>`). Marca v1 (T-0172): o Azul noite some no grafite
 * (1,29:1, proibido no manual §3), então sobre o escuro o principal é branco com texto Azul noite ("Tentar de novo" da entrada):
 * - principal: branco cheio com texto Azul noite (um só principal por tela);
 * - secundário: contorno claro (#C9CED5), fundo transparente e texto branco ("Continuar sem sincronizar", "Ver cliente");
 * - neutro: só o texto branco, sem fundo nem contorno ("Trocar usuário");
 * - perigo: rosa com texto vermelho (o mesmo do claro, que se destaca do grafite).
 * `fundo: 'transparent'` = o texto fica sobre o `FUNDO_ESCURO` (o teste de contraste mede assim).
 */
export const NIVEIS_BOTAO_ESCURO: Record<NivelBotao, EstiloNivel> = {
  principal: { ...NIVEIS_BOTAO.principal, fundo: colors.surface, texto: colors.accent },
  secundario: { ...NIVEIS_BOTAO.secundario, fundo: 'transparent', texto: colors.surface, borda: colors.darkMuted, larguraBorda: 1.5 },
  neutro: { ...NIVEIS_BOTAO.neutro, fundo: 'transparent', texto: colors.surface, borda: null, larguraBorda: 0 },
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
export type TomEstado = 'sucesso' | 'aviso' | 'erro' | 'neutro' | 'destaque';

export const TONS_ESTADO: Record<TomEstado, { fg: string; bg: string }> = {
  sucesso: { fg: colors.success, bg: colors.successBg },
  aviso: { fg: colors.warning, bg: colors.warningBg },
  erro: { fg: colors.danger, bg: colors.dangerBg },
  neutro: { fg: colors.neutralInk, bg: colors.neutralBg },
  destaque: { fg: colors.accentInk, bg: colors.accentSoft },
};

/**
 * Chip de escolha (filtro, prazo, transportadora), MC-0002: o ativo no Azul suave com texto Azul noite (9,83:1), como nas
 * pranchas T-0171 e T-0173; o inativo branco com linha e texto grafite. O mesmo chip tem a mesma cor em todas as telas.
 */
export const CORES_CHIP = {
  ativo: { fundo: colors.accentSoft, borda: colors.accentSoft, texto: colors.accentInk },
  inativo: { fundo: colors.surface, borda: colors.lineStrong, texto: colors.ink },
} as const;
