/**
 * Montagem dos comandos de visita no aparelho (T-0018): o check-in (`visita`) e o checkout (`visita_checkout`) que
 * entram na fila. Pura (sem react-native). As regras são do domínio (`avaliarCheckin` RN-CORE-10/13) e do contrato
 * (`CheckoutVisitaSchema`: RN-CORE-12/14); a API revalida tudo.
 */
import { CheckinVisitaSchema, CheckoutVisitaSchema, type CheckinVisita, type CheckoutVisita } from '../../contracts';
import { avaliarCheckin, RAIO_CHECKIN_PADRAO_M, type AvaliacaoCheckin } from '../../domain';

export interface PosicaoGps {
  lat: number;
  lng: number;
  precisao_m?: number | null;
}

export type ResultadoCheckin = { ok: true; payload: CheckinVisita; avaliacao: AvaliacaoCheckin } | { ok: false; avaliacao: AvaliacaoCheckin };

/** RN-CORE-10/13: fora do raio sem justificativa não gera comando (a tela pede a justificativa). Sem GPS segue, marcado. */
export function montarCheckin(e: {
  id: string;
  cliente: { id: string; lat: number | null; lng: number | null };
  rota_parada_id?: string | null;
  agora: Date;
  posicao: PosicaoGps | null;
  raio_m?: number;
  justificativa?: string | null;
  extra: boolean;
}): ResultadoCheckin {
  const avaliacao = avaliarCheckin({
    cliente: { lat: e.cliente.lat, lng: e.cliente.lng },
    posicao: e.posicao ? { lat: e.posicao.lat, lng: e.posicao.lng } : null,
    raio_m: e.raio_m ?? RAIO_CHECKIN_PADRAO_M,
    justificativa: e.justificativa,
  });
  if (!avaliacao.pode) return { ok: false, avaliacao };
  const justificativa = avaliacao.fora_do_raio ? (e.justificativa ?? '').trim() : null;
  const payload = CheckinVisitaSchema.parse({
    id: e.id,
    cliente_id: e.cliente.id,
    rota_parada_id: e.rota_parada_id ?? null,
    checkin_em: e.agora.toISOString(),
    // RN-CORE-13: a posição só vai neste comando e no checkout (nunca rastro)
    lat: e.posicao?.lat ?? null,
    lng: e.posicao?.lng ?? null,
    precisao_m: e.posicao?.precisao_m ?? null,
    justificativa_fora_raio: justificativa,
    extra: e.extra,
  });
  return { ok: true, payload, avaliacao };
}

export interface EntradaCheckoutVisita {
  id: string;
  visita_id: string;
  agora: Date;
  posicao?: PosicaoGps | null;
  resultado: CheckoutVisita['resultado'];
  motivo_id?: string | null;
  motivo_texto?: string | null;
  pedido_id?: string | null;
  foto_fachada_id?: string | null;
  etapas?: CheckoutVisita['etapas'];
}

/** RN-CORE-12/14: o schema recusa cliente fechado sem motivo/foto, pedido sem pedido e sem pedido sem motivo. */
export function montarCheckout(e: EntradaCheckoutVisita): CheckoutVisita {
  return CheckoutVisitaSchema.parse({
    id: e.id,
    visita_id: e.visita_id,
    checkout_em: e.agora.toISOString(),
    lat: e.posicao?.lat ?? null,
    lng: e.posicao?.lng ?? null,
    resultado: e.resultado,
    motivo_id: e.motivo_id ?? null,
    motivo_texto: e.motivo_texto?.trim() || null,
    pedido_id: e.pedido_id ?? null,
    foto_fachada_id: e.resultado === 'cliente_fechado' ? (e.foto_fachada_id ?? null) : null,
    etapas: e.etapas ?? [],
  });
}
