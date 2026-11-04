/**
 * Aviso para a tela de destino (revisão de UX 23c): quem salva e fecha a tela deixa o texto aqui e o destino o mostra ao focar.
 * Vive só na memória do app; é lido uma vez.
 */
let pendente: string | null = null;

export function deixarAvisoPendente(texto: string): void {
  pendente = texto;
}

export function pegarAvisoPendente(): string | null {
  const t = pendente;
  pendente = null;
  return t;
}
