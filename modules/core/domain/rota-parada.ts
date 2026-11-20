/** RN-CORE-52: 2ª linha da parada não iniciada na Rota; o complemento vem do slot `rota.parada_complemento`. */
export const MAX_COMPLEMENTO_PARADA = 60;

export function subtituloParada(horario: string, texto?: string | null): string {
  const t = (texto ?? '').trim().slice(0, MAX_COMPLEMENTO_PARADA).trim();
  return t ? `${horario} · ${t}` : horario;
}
