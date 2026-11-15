/**
 * T-0182 (logo do cliente; R-20261114-223500 e R-20261114-234500): parte PURA da `PlacaLogoCliente`, a placa branca onde a
 * logo da empresa (a distribuidora) aparece no app. Sem react-native: roda em Node. Spec: docs/design/telas/logo-cliente.md
 * §1, §3 e §5.
 *
 * - Placa branca (`surface` #FFFFFF), raio 12 (`radius.md`), borda 1 dp no Azul suave #DFE2E6 (`line`) sobre o Pérola e sem
 *   borda sobre o Azul noite.
 * - A logo cabe na caixa (`contain`), com a proporção dela: nunca recortada, esticada, recolorida, com sombra ou filtro.
 * - `carga`: placa de 64 dp de altura e até 112 de largura; logo de 48 × até 96 (folga de 8 em volta).
 * - `mais`: placa de 52 dp de altura e até 176 de largura; logo de 36 × até 152 (folga de 8 em cima e embaixo, 12 dos lados).
 */
import { colors, radius } from './tokens';

export type TamanhoPlacaLogo = 'carga' | 'mais';

export interface MedidasPlacaLogo {
  /** Altura da placa (dp). */
  altura: number;
  /** Largura máxima da placa (dp). */
  larguraMaxima: number;
  /** Altura da logo dentro da placa (dp). */
  alturaLogo: number;
  /** Largura máxima da logo (dp). */
  larguraMaximaLogo: number;
  /** Folga entre a logo e a borda de fora da placa (dp), em cima/embaixo e dos lados. */
  folgaVertical: number;
  folgaLateral: number;
}

export const PLACA_LOGO: Record<TamanhoPlacaLogo, MedidasPlacaLogo> = {
  carga: { altura: 64, larguraMaxima: 112, alturaLogo: 48, larguraMaximaLogo: 96, folgaVertical: 8, folgaLateral: 8 },
  mais: { altura: 52, larguraMaxima: 176, alturaLogo: 36, larguraMaximaLogo: 152, folgaVertical: 8, folgaLateral: 12 },
};

/** Cores e raio da placa (tokens do kit; a placa é sempre branca, nos dois apps). */
export const ESTILO_PLACA_LOGO = {
  fundo: colors.surface,
  borda: colors.line,
  larguraBorda: 1,
  raio: radius.md,
} as const;

export interface CaixaPlacaLogo {
  larguraPlaca: number;
  larguraLogo: number;
  alturaLogo: number;
}

/**
 * Largura da placa e da logo pela proporção da imagem (largura ÷ altura). A logo fica com a altura do tamanho e a largura
 * da proporção, limitada à máxima (logo larga: o `contain` reduz a altura, sem esticar). A placa nunca fica mais estreita
 * que alta. Sem proporção conhecida (imagem ainda carregando), a caixa usa a largura máxima, e o `contain` mantém a logo
 * inteira.
 */
export function caixaDaPlacaLogo(tamanho: TamanhoPlacaLogo, proporcao?: number | null): CaixaPlacaLogo {
  const m = PLACA_LOGO[tamanho];
  const valida = typeof proporcao === 'number' && Number.isFinite(proporcao) && proporcao > 0;
  const larguraLogo = valida ? Math.min(m.larguraMaximaLogo, Math.round(m.alturaLogo * proporcao)) : m.larguraMaximaLogo;
  const larguraPlaca = Math.max(m.altura, Math.min(m.larguraMaxima, larguraLogo + 2 * m.folgaLateral));
  return { larguraPlaca, larguraLogo, alturaLogo: m.alturaLogo };
}

/**
 * Leitura do TalkBack: "Logo da <nome fantasia>". Sem nome (logo decorativa, como no fim do Mais, onde a frase acima já diz
 * o nome), devolve `null` e a placa fica fora da leitura.
 */
export function rotuloDaPlacaLogo(nomeFantasia?: string | null): string | null {
  const nome = nomeFantasia?.trim();
  return nome ? `Logo da ${nome}` : null;
}
