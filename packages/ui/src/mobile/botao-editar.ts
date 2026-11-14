/**
 * T-0165 (pedido-v4.md §5.8; R-20261112-082212, aprovado com imagens): parte PURA do `BotaoEditar`, o lápis do item que já está
 * no pedido. Dois tamanhos: `linha` (aba Itens, no lugar do "+", 44 dp) e `tabela` (fim da linha do Resumo, depois do Total,
 * 32 dp com folga de toque até 48). Sem react-native: roda em Node.
 * Dois tons (pedido do dono do produto, 14/11/2026): `adicionado` (verde de situação do manual §3, "item já no pedido"; padrão
 * do tamanho `linha`) e `padrao` (destaque azul, só "editar"; padrão do tamanho `tabela`, no Resumo).
 */
import { folgaDeToque } from './componentes';
import { colors } from './tokens';

/** Medidas dos dois tamanhos (dp). O ícone `edit` em `accentInk` (6,27:1 sobre `accentSoft`); a borda `accent` 1,5. */
export const BOTAO_EDITAR = {
  linha: { lado: 44, raio: 12, icone: 20 },
  tabela: { lado: 32, raio: 9, icone: 16 },
  larguraBorda: 1.5,
  borda: colors.accent,
  fundo: colors.accentSoft,
  icone: colors.accentInk,
  /** Tons: `padrao` repete os campos raiz; `adicionado` usa o verde de sucesso, borda 2 (ícone 5,51:1 sobre `successBg`; borda 6,43:1 sobre o branco). */
  tons: {
    padrao: { larguraBorda: 1.5, borda: colors.accent, fundo: colors.accentSoft, icone: colors.accentInk },
    adicionado: { larguraBorda: 2, borda: colors.success, fundo: colors.successBg, icone: colors.success },
  },
} as const;

export type TamanhoBotaoEditar = 'linha' | 'tabela';
export type TomBotaoEditar = keyof typeof BOTAO_EDITAR.tons;

/** Tom explícito ou, por padrão, `adicionado` na aba Itens (`linha`) e `padrao` no Resumo (`tabela`). */
export function tomDoBotaoEditar(tamanho: TamanhoBotaoEditar, tom?: TomBotaoEditar): TomBotaoEditar {
  return tom ?? (tamanho === 'linha' ? 'adicionado' : 'padrao');
}

/** Folga de toque (hitSlop) de cada lado: o alvo fica com 48 dp nos dois tamanhos. */
export function folgaDoBotaoEditar(tamanho: TamanhoBotaoEditar): number {
  return folgaDeToque(BOTAO_EDITAR[tamanho].lado);
}

/** TalkBack: "Editar AGU-1500" (Resumo) ou "Água mineral 1,5 L, no pedido. Editar" (aba Itens). */
export function leituraDoBotaoEditar(item: string, tamanho: TamanhoBotaoEditar): string {
  const nome = item.trim();
  if (!nome) return 'Editar';
  return tamanho === 'linha' ? `${nome}, no pedido. Editar` : `Editar ${nome}`;
}
