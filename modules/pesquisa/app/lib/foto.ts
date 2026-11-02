/**
 * Captura de foto da Pesquisa (RF-PES-04, RN-PES-06). O módulo não tem câmera própria (revisão R-20261031-140037):
 * o SHELL registra a captura com `definirCapturaFotoPesquisa` — a mesma câmera do Core, gravando
 * `<documentos>/fotos/<uuid>.jpg` com no máximo 1600 px no maior lado e JPEG 80 — e devolve só o UUID. Sem captura
 * registrada (ex.: testes, web), a pergunta de foto mostra a orientação e não trava as outras.
 */
export interface FotoCapturada {
  /** UUID da foto (= id do arquivo na fila do motor e na resposta). */
  id: string;
  largura_px?: number;
  altura_px?: number;
}

export type CapturaFotoPesquisa = () => Promise<FotoCapturada | null>;

let captura: CapturaFotoPesquisa | null = null;

export function definirCapturaFotoPesquisa(fn: CapturaFotoPesquisa | null): void {
  captura = fn;
}

export function capturaDisponivel(): boolean {
  return captura !== null;
}

/** `null` = o usuário cancelou ou não há câmera registrada. */
export async function capturarFotoPesquisa(): Promise<FotoCapturada | null> {
  return captura ? captura() : null;
}
