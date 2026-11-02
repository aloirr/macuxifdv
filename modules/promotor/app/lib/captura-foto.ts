/**
 * Câmera do Promotor (RN-PRO-02: foto tirada na hora, sem galeria). O módulo não importa biblioteca de câmera: o shell
 * do app registra a captura (`definirCapturaFotoPromotor`, a mesma câmera do Core: comprime e grava em `fotos/<id>.jpg`)
 * e o Promotor só guarda a referência. Sem câmera registrada a captura devolve `null` e a tela orienta o usuário.
 */
export interface FotoCapturada {
  /** UUID gerado no aparelho (nome do arquivo `fotos/<id>.jpg`). */
  id: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** O shell pode devolver só o id (câmera do Core) ou o id com a coordenada do momento. */
export type CapturaFotoPromotor = () => Promise<FotoCapturada | string | null>;

let captura: CapturaFotoPromotor | null = null;

export function definirCapturaFotoPromotor(fn: CapturaFotoPromotor | null): void {
  captura = fn;
}

export function temCamera(): boolean {
  return captura !== null;
}

export async function capturarFoto(): Promise<FotoCapturada | null> {
  const r = captura ? await captura() : null;
  if (r === null) return null;
  return typeof r === 'string' ? { id: r } : r;
}
