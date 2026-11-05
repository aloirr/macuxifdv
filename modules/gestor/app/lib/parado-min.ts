/**
 * RN-CORE-26: o limite do "parado" é do tenant (`inicio.parado_min`, publicado pelo Core no pull `parametro`). O Gestão lê a
 * linha do aparelho (mesma regra do Início do Core: faixa de 15 a 480 min) e, se válida, ela vence o valor que veio na visão
 * do Gestor (fallback). Só o contrato do Core é importado (regra 1).
 */
import { PARAMETRO_PARADO_MIN } from '@macuxi/core/contracts';

const MIN = 15;
const MAX = 480;

interface LinhaParametro {
  modulo: string;
  chave: string;
  valor: unknown;
  deleted_at?: string | null;
}

export function paradoMinDoTenant(linhas: readonly LinhaParametro[]): number | null {
  const v = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_PARADO_MIN && !l.deleted_at)?.valor;
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN && v <= MAX ? v : null;
}

export function aplicarParadoMinDoTenant<V extends { parado_min?: number }>(visao: V | null, linhas: readonly LinhaParametro[]): V | null {
  const n = paradoMinDoTenant(linhas);
  return visao && n !== null ? { ...visao, parado_min: n } : visao;
}
