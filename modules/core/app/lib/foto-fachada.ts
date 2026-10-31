/**
 * Captura da foto da fachada (RN-CORE-14). O shell do app registra a câmera real (`definirCapturaFoto`);
 * o core só guarda a referência (id) devolvida. Sem câmera registrada, devolve null e a tela orienta o usuário.
 */
export type CapturaFoto = () => Promise<string | null>;

let captura: CapturaFoto | null = null;

export function definirCapturaFoto(fn: CapturaFoto | null): void {
  captura = fn;
}

export async function capturarFotoFachada(): Promise<string | null> {
  return captura ? captura() : null;
}
