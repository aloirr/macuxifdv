/**
 * Portão do rastreamento (T-0156; desenho `docs/desenho/tracking.md` §2; ADR 0061 decisão 2). RN-CORE-13 e RN-CORE-37.
 * Função pura, a mesma no app (liga e desliga a captura, descarta o ponto) e na API (descarta o ponto que chega fora do portão).
 * Sem coordenada: decide só por cadastro, instante e fuso.
 * As 7 condições, todas obrigatórias: parâmetro ligado, cargo rastreado, app do cargo (Campo para vendedor e promotor, Gestão para supervisor), feriado, ausência, expediente e permissão do aparelho.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { localIsoDate, zonedParts } from '@macuxi/comum/fuso';
import type { Expediente, MotivoSemRastreio } from '../contracts';

/** Cargos rastreados (ADR 0049; T-0187: o supervisor entra, o gerente continua fora). */
export const CARGOS_RASTREADOS: readonly string[] = ['vendedor', 'promotor', 'supervisor'];

/** App em que cada cargo rastreado é rastreado (T-0187 §1.2): a API não sabe de que app veio o push, então o cargo decide. */
export const APP_RASTREADO_DO_CARGO: Readonly<Record<string, string>> = { vendedor: 'campo', promotor: 'campo', supervisor: 'gestao' };

export interface EntradaRastreio {
  /** Parâmetro `rastreamento.ativo` do tenant (padrão desligado). */
  ativo: boolean;
  /** Cargo do usuário (perfil base). */
  cargo: string;
  /** App que pede ('campo' | 'gestao'); a API usa `APP_RASTREADO_DO_CARGO[cargo]`. */
  app: string;
  expediente: Expediente;
  /** Feriados do tenant (AAAA-MM-DD); os nacionais entram sempre. */
  feriados: readonly string[];
  /** Ausências do usuário (datas civis no fuso do tenant, `de` e `ate` inclusive). */
  ausencias: ReadonlyArray<{ de: string; ate: string }>;
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

/** RN-CORE-13: rastreia só com as condições do §2: parâmetro, cargo, app, feriado, ausência, expediente e permissão; o primeiro motivo que falha volta (o Diagnóstico mostra o estado). */
export function podeRastrear(e: EntradaRastreio): ResultadoRastreio {
  if (!e.ativo) return nao('desligado');
  if (!CARGOS_RASTREADOS.includes(e.cargo)) return nao('cargo');
  if (e.app !== APP_RASTREADO_DO_CARGO[e.cargo]) return nao('app');
  const data = localIsoDate(e.instante, e.fuso);
  if (ehFeriado(data, e.feriados)) return nao('feriado');
  if (e.ausencias.some((a) => a.de <= data && data <= a.ate)) return nao('ausencia');
  if (!dentroDoExpediente(e.expediente, e.instante, e.fuso)) return nao('fora_do_expediente');
  if (e.permissao === false) return nao('sem_permissao');
  return { pode: true };
}
