/**
 * Portão do rastreamento (T-0156; desenho `docs/desenho/tracking.md` §2; ADR 0061 decisão 2). RN-CORE-13 e RN-CORE-37.
 * Função pura, a mesma no app (liga e desliga a captura, descarta o ponto) e na API (descarta o ponto que chega fora do portão).
 * Sem coordenada: decide só por cadastro, instante e fuso.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { localIsoDate, zonedParts } from '@macuxi/comum/fuso';
import type { Expediente, MotivoSemRastreio } from '../contracts';

/** Cargos de campo (ADR 0049): só eles mandam ponto. Fora do `podeRastrear`: a API confere no push (`triarPontoRecebido`); o app Campo só tem usuário de campo. */
export const CARGOS_RASTREADOS: readonly string[] = ['vendedor', 'promotor'];

export interface EntradaRastreio {
  /** Parâmetro `rastreamento.ativo` do tenant (padrão desligado). */
  ativo: boolean;
  expediente: Expediente;
  /** Feriados do tenant (AAAA-MM-DD); os nacionais entram sempre. */
  feriados: readonly string[];
  /** Ausências do usuário (datas civis no fuso do tenant, `de` e `ate` inclusive). */
  ausencias: ReadonlyArray<{ de: string; ate: string }>;
  /** Instante avaliado (UTC, ISO): agora no app, `capturado_em` na API. */
  instante: string;
  fuso: string;
}

export type ResultadoRastreio = { pode: true } | { pode: false; motivo: MotivoSemRastreio };

const nao = (motivo: MotivoSemRastreio): ResultadoRastreio => ({ pode: false, motivo });

function dentroDoExpediente(expediente: Expediente, instante: string, fuso: string): boolean {
  const p = zonedParts(instante, fuso);
  const dia = String(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()) as keyof Expediente;
  const minuto = p.hour * 60 + p.minute;
  return expediente[dia].some((f) => f.inicio_min <= minuto && minuto < f.fim_min);
}

/**
 * RN-CORE-13: três condições do §2, todas obrigatórias: parâmetro ligado, fora de feriado e de ausência, dentro do expediente.
 * Pré-condições fora daqui: usuário de campo no app Campo; a permissão "o tempo todo" (RN-CORE-37) só decide se o Android entrega posição.
 */
export function podeRastrear(e: EntradaRastreio): ResultadoRastreio {
  if (!e.ativo) return nao('desligado');
  const data = localIsoDate(e.instante, e.fuso);
  if (ehFeriado(data, e.feriados)) return nao('feriado');
  if (e.ausencias.some((a) => a.de <= data && data <= a.ate)) return nao('ausencia');
  if (!dentroDoExpediente(e.expediente, e.instante, e.fuso)) return nao('fora_do_expediente');
  return { pode: true };
}
