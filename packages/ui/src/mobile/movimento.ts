/**
 * Tokens e regras PURAS de movimento (T-0072). Sem react-native: roda em Node (Vitest), é reexportado por
 * `@macuxi/ui/mobile/puro` e usado pelas primitivas de `movimento-rn.tsx`, pela `Folha`, pelo `AvisoRodape` e pelo shell
 * (as transições de navegação são ligadas pelo engenheiro-apps com `transicaoDeAvancar` e `transicaoDeFolha`).
 *
 * Regra de ouro: com "reduzir movimento" ligado no aparelho, NENHUM deslocamento nem escala; a duração vira 0
 * (troca instantânea). O retorno ao toque passa a ser só a opacidade (`OPACIDADE_TOQUE_REDUZIDO`).
 */

export const MOVIMENTO = {
  /** Lista → detalhe entra pela direita; voltar sai pela direita. */
  avancar: { duracaoMs: 240 },
  /** Filtros, quantidade e desconto sobem numa folha; o fundo escurece junto. */
  folha: { duracaoMs: 280 },
  /** Botão afunda ao tocar (escala) e vibra leve ao confirmar. */
  toque: { duracaoMs: 120, escala: 0.97 },
  /** Aviso no rodapé: entra em 200 ms e fica 2,5 s na tela (mais com leitor de tela). */
  aviso: { duracaoMs: 200, visivelMs: 2500, visivelComLeitorMs: 8000 },
  /** Diálogo central: só esmaece. */
  dialogo: { duracaoMs: 200 },
  /** Barra de progresso (entrada e sincronização completa): o preenchimento anda até o novo valor. */
  barra: { duracaoMs: 240 },
} as const;

export type TipoMovimento = keyof typeof MOVIMENTO;

/** Curva padrão (desacelera no fim), em pontos de `cubic-bezier`. */
export const CURVA_PADRAO = [0.2, 0, 0, 1] as const;

/** Opacidade do elemento tocado quando o movimento está reduzido (sem escala). */
export const OPACIDADE_TOQUE_REDUZIDO = 0.7;

/** Duração da animação do tipo; 0 com "reduzir movimento". */
export function duracaoMovimento(tipo: TipoMovimento, reduzir: boolean): number {
  return reduzir ? 0 : MOVIMENTO[tipo].duracaoMs;
}

/** Escala do elemento tocado: 0,97 pressionado; 1 solto ou com "reduzir movimento". */
export function escalaDoToque(pressionado: boolean, reduzir: boolean): number {
  return pressionado && !reduzir ? MOVIMENTO.toque.escala : 1;
}

/** Opacidade do elemento tocado: só cai quando a escala está desligada (movimento reduzido). */
export function opacidadeDoToque(pressionado: boolean, reduzir: boolean): number {
  return pressionado && reduzir ? OPACIDADE_TOQUE_REDUZIDO : 1;
}

/** De onde a folha parte (dp abaixo da posição final): a altura dela; 0 com "reduzir movimento". */
export function deslocamentoDaFolha(altura: number, reduzir: boolean): number {
  return reduzir ? 0 : Math.max(0, altura);
}

/** Tempo que o aviso fica visível antes de sumir sozinho. Com leitor de tela, dá tempo de achar o "Desfazer". */
export function tempoDoAviso(leitorDeTela: boolean, visivelMs: number = MOVIMENTO.aviso.visivelMs): number {
  return leitorDeTela ? Math.max(visivelMs, MOVIMENTO.aviso.visivelComLeitorMs) : visivelMs;
}

/**
 * Opções de transição da pilha (expo-router / react-native-screens) para o shell. Só valores: quem liga é o
 * engenheiro-apps no `_layout` (`screenOptions`).
 */
export interface TransicaoPilha {
  animation: 'slide_from_right' | 'slide_from_bottom' | 'fade' | 'none';
  animationDuration: number;
}

/** Avançar (lista → detalhe): lateral em 240 ms; com "reduzir movimento", sem animação. */
export function transicaoDeAvancar(reduzir: boolean): TransicaoPilha {
  return reduzir ? { animation: 'none', animationDuration: 0 } : { animation: 'slide_from_right', animationDuration: MOVIMENTO.avancar.duracaoMs };
}

/** Tela apresentada como folha (modal): de baixo em 280 ms; com "reduzir movimento", sem animação. */
export function transicaoDeFolha(reduzir: boolean): TransicaoPilha {
  return reduzir ? { animation: 'none', animationDuration: 0 } : { animation: 'slide_from_bottom', animationDuration: MOVIMENTO.folha.duracaoMs };
}

// ---------- vibração leve ----------
/**
 * O kit não depende de `expo-haptics`: o shell registra a vibração com `definirVibracao` (apps/mobile/src/services/vibracao.ts:
 * Android com `performAndroidHapticsAsync`, que respeita o retorno tátil do sistema; iOS com `impactAsync(Light)`). Sem
 * registro, `vibrarLeve` não faz nada. Com "reduzir movimento" ligado o shell registra `null` e nada vibra (decisão de
 * 2026-11-04, R-20261104-231036); um botão isolado pode desligar com `vibrar={false}`.
 */
type Vibracao = () => unknown;
let vibracao: Vibracao | null = null;

export function definirVibracao(fn: Vibracao | null): void {
  vibracao = fn;
}

/** Vibração leve ao confirmar (botão principal, Desfazer). Nunca derruba a tela se o aparelho falhar. */
export function vibrarLeve(): void {
  if (!vibracao) return;
  try {
    const r = vibracao();
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
  } catch {
    // aparelho sem motor de vibração ou permissão: ignora
  }
}
