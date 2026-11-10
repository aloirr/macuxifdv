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

/** Pedido de abertura da foto de um cliente (o shell formata o visualizador; título e subtítulo já vêm prontos). */
export interface PedidoAbrirFotoPdv {
  arquivo_id: string;
  titulo?: string;
  subtitulo?: string;
}
export type AbrirFotoPdv = (p: PedidoAbrirFotoPdv) => void;

let abrirFoto: AbrirFotoPdv | null = null;

/** O shell registra o visualizador (T-0147); sem ele, "Foto do PDV" fica desligado na ficha. */
export function definirAbrirFotoPdv(fn: AbrirFotoPdv | null): void {
  abrirFoto = fn;
}

export function abrirFotoPdvRegistrado(): AbrirFotoPdv | null {
  return abrirFoto;
}

/** Pedido do visualizador para a fachada do cliente: "Fachada · dd/mm/aaaa" no fuso do tenant; `null` sem fachada enviada. */
export function pedidoDaFachada(nomeCliente: string, fachada: { arquivo_id: string; tirada_em: string | null } | null | undefined, tz: string): PedidoAbrirFotoPdv | null {
  if (!fachada) return null;
  const d = fachada.tirada_em ? new Date(fachada.tirada_em) : null;
  const data = d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : null;
  return { arquivo_id: fachada.arquivo_id, titulo: nomeCliente, subtitulo: data ? `Fachada · ${data}` : 'Fachada' };
}
