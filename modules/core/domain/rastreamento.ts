/**
 * Portão do rastreamento (T-0156; desenho `docs/desenho/tracking.md` §2; ADR 0061 decisão 2). RN-CORE-13 e RN-CORE-37.
 * Função pura, a mesma no app (liga e desliga a captura, descarta o ponto) e na API (descarta o ponto que chega fora do portão).
 * Sem coordenada: decide só por cadastro, instante e fuso.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { localIsoDate, zonedParts } from '@macuxi/comum/fuso';
import type { Expediente, MotivoSemRastreio } from '../contracts';

/** Pausa pessoal sem "Retomar" vale no máximo este tempo (§4.3). */
export const PAUSA_MAX_MIN = 60;
/** Cargos de campo (ADR 0049): só eles são rastreados. */
export const CARGOS_RASTREADOS: readonly string[] = ['vendedor', 'promotor'];

export interface EntradaRastreio {
  /** Parâmetro `rastreamento.ativo` do tenant (padrão desligado). */
  ativo: boolean;
  /** Maior versão publicada do termo no tenant; `null` = nenhum termo publicado. */
  termoVigente: number | null;
  /** Cargo do usuário (perfil base). */
  cargo: string;
  /** App que pede ('campo' | 'gestao'); a API passa 'campo' (só o push do Campo manda ponto). */
  app: string;
  /** Aceite mais recente do usuário. */
  aceite: { versao: number; aceito_em: string } | null;
  expediente: Expediente;
  /** Feriados do tenant (AAAA-MM-DD); os nacionais entram sempre. */
  feriados: readonly string[];
  /** Ausências do usuário (datas civis no fuso do tenant, `de` e `ate` inclusive). */
  ausencias: ReadonlyArray<{ de: string; ate: string }>;
  pausas: ReadonlyArray<{ inicio: string; fim: string | null }>;
  /** Permissão "o tempo todo" (só o app sabe); `undefined` = não conferida (API). */
  permissao?: boolean | undefined;
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

function emPausa(pausas: EntradaRastreio['pausas'], ms: number): boolean {
  return pausas.some((p) => {
    const inicio = Date.parse(p.inicio);
    const fim = p.fim === null ? inicio + PAUSA_MAX_MIN * 60_000 : Date.parse(p.fim);
    return inicio <= ms && ms < fim;
  });
}

/** RN-CORE-13: rastreia só com as seis condições do §2; o primeiro motivo que falha volta (o Diagnóstico mostra o estado). */
export function podeRastrear(e: EntradaRastreio): ResultadoRastreio {
  if (!e.ativo) return nao('desligado');
  if (e.termoVigente === null) return nao('sem_termo');
  if (!CARGOS_RASTREADOS.includes(e.cargo)) return nao('cargo');
  if (e.app !== 'campo') return nao('app');
  const ms = Date.parse(e.instante);
  if (!e.aceite || e.aceite.versao !== e.termoVigente || Date.parse(e.aceite.aceito_em) > ms) return nao('sem_aceite');
  const data = localIsoDate(e.instante, e.fuso);
  if (ehFeriado(data, e.feriados)) return nao('feriado');
  if (e.ausencias.some((a) => a.de <= data && data <= a.ate)) return nao('ausencia');
  if (!dentroDoExpediente(e.expediente, e.instante, e.fuso)) return nao('fora_do_expediente');
  if (emPausa(e.pausas, ms)) return nao('pausa');
  if (e.permissao === false) return nao('sem_permissao');
  return { pode: true };
}
