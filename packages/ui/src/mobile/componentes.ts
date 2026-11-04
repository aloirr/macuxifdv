/**
 * Parte PURA dos componentes genéricos de formulário e resumo (T-0071, fatia 4): contador da aba, limites do passo,
 * leitura da quantidade digitada e folga de toque. Sem react-native: roda em Node (Vitest) e é reexportada por
 * `@macuxi/ui/mobile/puro`. Nenhum texto de tela mora aqui: rótulos chegam por props.
 */

/** Alvo de toque mínimo dos componentes (48 dp, Material). */
export const ALVO_TOQUE = 48;

/** "Itens" + 3 → "Itens (3)". Sem contador (undefined/null) devolve só o rótulo. */
export function rotuloComContador(rotulo: string, contador?: number | null): string {
  if (contador === undefined || contador === null || !Number.isFinite(contador)) return rotulo;
  return `${rotulo} (${Math.trunc(contador)})`;
}

/** Limita o valor do passo (stepper) a inteiro entre `min` e `max` (sem `max`, sem teto). */
export function limitarPasso(valor: number, min = 0, max?: number): number {
  if (!Number.isFinite(valor)) return min;
  const n = Math.trunc(valor);
  const comTeto = max === undefined ? n : Math.min(max, n);
  return Math.max(min, comTeto);
}

/** Próximo valor do passo ao tocar − (`-1`) ou + (`+1`), já limitado. */
export function proximoPasso(valor: number, direcao: -1 | 1, passo = 1, min = 0, max?: number): number {
  return limitarPasso(valor + direcao * passo, min, max);
}

/** Lê a quantidade digitada ("12", " 3 ", "1.000"). Texto sem dígito → null (a tela mantém o valor anterior). */
export function lerQuantidade(texto: string): number | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos === '') return null;
  return Number.parseInt(digitos, 10);
}

/** Folga de toque (hitSlop) de cada lado para um elemento visual de `visual` dp alcançar o alvo de 48 dp. */
export function folgaDeToque(visual: number, alvo = ALVO_TOQUE): number {
  return Math.max(0, Math.ceil((alvo - visual) / 2));
}
