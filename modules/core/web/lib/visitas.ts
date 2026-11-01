/**
 * Visão das telas Visitas, Coordenadas sugeridas e Motivos do BKO (T-0018): funções puras sobre
 * `GET /v1/core/visitas`, `coordenadas-sugeridas` e `motivos`. Sem React e sem rede.
 */
import type { VisitaBko } from '../../contracts';

const BOM = String.fromCharCode(0xfeff); // o Excel abre o CSV em UTF-8
const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

const RESULTADO: Record<string, string> = {
  pedido: 'Com pedido',
  sem_pedido: 'Sem pedido',
  atendido: 'Atendido',
  cliente_fechado: 'Cliente fechado',
  nao_finalizado: 'Não finalizado (fechado sozinho)',
};

export function rotuloResultado(resultado: string | null): string {
  return resultado ? (RESULTADO[resultado] ?? resultado) : 'Em atendimento';
}

/** Data/hora curta no fuso informado (o do tenant). */
export function quando(iso: string | null, fuso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** Duração do atendimento em minutos (ou `null` se aberto). */
export function permanenciaMin(v: Pick<VisitaBko, 'checkin_em' | 'checkout_em'>): number | null {
  return v.checkout_em ? Math.max(0, Math.round((Date.parse(v.checkout_em) - Date.parse(v.checkin_em)) / 60_000)) : null;
}

/** Sinalizações da visita para a tabela (RN-CORE-10/13). */
export function sinais(v: Pick<VisitaBko, 'fora_do_raio' | 'sem_gps' | 'sugere_coordenada' | 'extra'>): string[] {
  return [v.fora_do_raio ? 'Fora do raio' : '', v.sem_gps ? 'Sem GPS' : '', v.sugere_coordenada ? 'Sugere coordenada' : '', v.extra ? 'Visita extra' : ''].filter(Boolean);
}

/** CSV (ponto e vírgula, Excel pt-BR) das visitas filtradas na tela. */
export function csvDeVisitas(itens: readonly VisitaBko[], fuso: string): string {
  const cab = ['Data', 'Vendedor', 'Cliente', 'Check-in', 'Checkout', 'Minutos', 'Resultado', 'Motivo', 'Distância (m)', 'Sinais', 'Justificativa', 'Foto da fachada'];
  const linhas = itens.map((v) =>
    [
      v.data_local,
      v.usuario_nome,
      v.cliente_nome,
      quando(v.checkin_em, fuso),
      quando(v.checkout_em, fuso),
      String(permanenciaMin(v) ?? ''),
      rotuloResultado(v.resultado),
      v.motivo_descricao ?? v.motivo_texto ?? '',
      v.distancia_m === null ? '' : String(v.distancia_m),
      sinais(v).join(', '),
      v.justificativa_fora_raio ?? '',
      v.foto_fachada_id ? 'sim' : '',
    ]
      .map(aspas)
      .join(';'),
  );
  return BOM + `${[cab.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}

/** Link do mapa para uma coordenada sugerida. */
export function linkDoMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function novoId(): string {
  return globalThis.crypto.randomUUID();
}
