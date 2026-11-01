/**
 * Sessão de carga completa (RN-INT-06): vários lotes (parte n, último = sim). Só ao fechar a
 * sessão — todas as partes 1..n concluídas — os registros ausentes da carga são inativados
 * (`deleted_at`), nunca apagados. Sessão incompleta ou expirada não inativa nada.
 */
import type { EstadoLote } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export interface SessaoCargaEstado {
  id: string;
  entidade: string;
  iniciadaEm: string;
  /** Último estado conhecido de cada parte. */
  partes: Readonly<Record<number, EstadoLote>>;
  /** Número da parte marcada como `ultimo`; `null` enquanto não chegou. */
  ultimaParte: number | null;
}

export type SituacaoSessao = 'aberta' | 'completa' | 'expirada';

export function novaSessao(id: string, entidade: string, iniciadaEm: string): SessaoCargaEstado {
  return { id, entidade, iniciadaEm, partes: {}, ultimaParte: null };
}

/** Registra (ou atualiza, no reenvio) o estado de uma parte. Não altera a sessão original. */
export function registrarParte(sessao: SessaoCargaEstado, parte: { parte: number; ultimo: boolean; status: EstadoLote }): SessaoCargaEstado {
  return {
    ...sessao,
    partes: { ...sessao.partes, [parte.parte]: parte.status },
    ultimaParte: parte.ultimo ? parte.parte : sessao.ultimaParte,
  };
}

const CONCLUIDAS: ReadonlySet<EstadoLote> = new Set<EstadoLote>(['concluido', 'concluido_com_erros']);

function completa(s: SessaoCargaEstado): boolean {
  if (s.ultimaParte === null) return false;
  const numeros = Object.keys(s.partes).map(Number);
  if (numeros.some((n) => n > (s.ultimaParte as number))) return false;
  for (let n = 1; n <= s.ultimaParte; n++) {
    const st = s.partes[n];
    if (st === undefined || !CONCLUIDAS.has(st)) return false;
  }
  return true;
}

export function situacaoSessao(sessao: SessaoCargaEstado, agora: string, opcoes: { ttlMin?: number } = {}): SituacaoSessao {
  if (completa(sessao)) return 'completa';
  const ttl = opcoes.ttlMin ?? PARAMETROS_PADRAO.ttlSessaoMin;
  return Date.parse(agora) - Date.parse(sessao.iniciadaEm) > ttl * 60_000 ? 'expirada' : 'aberta';
}

export type MotivoSemInativacao = 'sessao_incompleta' | 'linhas_sem_external_id' | 'linhas_invalidas_omitidas' | 'carga_vazia' | 'excede_limite_inativacao';

export interface EntradaInativacao {
  sessao: SessaoCargaEstado;
  agora: string;
  /** external_id dos registros ativos da entidade no Macuxi. */
  ativosNoMacuxi: Iterable<string>;
  /** external_id de todas as linhas da sessão, inclusive as que tiveram erro de validação. */
  recebidosNaSessao: Iterable<string>;
  /** Linhas da sessão sem external_id legível: sem elas não dá para saber o que faltou. */
  linhasSemExternalId?: number;
  /**
   * T-0025: linhas inválidas que o Conector só contou (passaram do limite de 500 por lote): não se sabe de quais registros são,
   * então a inativação não acontece.
   */
  linhasInvalidasOmitidas?: number;
  ttlMin?: number;
  /** Percentual máximo de ativos inativados sem confirmação (padrão `limiteInativacaoPct`). */
  limitePct?: number;
  /** Operador confirmou a inativação em massa no BKO. */
  confirmado?: boolean;
}

export interface ResultadoInativacao {
  permitido: boolean;
  inativar: string[];
  /** Só quando `excede_limite_inativacao`: o que seria inativado se o operador confirmar. */
  candidatos?: string[];
  motivo: MotivoSemInativacao | null;
}

export function calcularInativacao(e: EntradaInativacao): ResultadoInativacao {
  const nega = (motivo: MotivoSemInativacao): ResultadoInativacao => ({ permitido: false, inativar: [], motivo });
  if (situacaoSessao(e.sessao, e.agora, { ttlMin: e.ttlMin }) !== 'completa') return nega('sessao_incompleta');
  if ((e.linhasSemExternalId ?? 0) > 0) return nega('linhas_sem_external_id');
  if ((e.linhasInvalidasOmitidas ?? 0) > 0) return nega('linhas_invalidas_omitidas');
  const recebidos = new Set(e.recebidosNaSessao);
  if (recebidos.size === 0) return nega('carga_vazia');
  const inativar = [...new Set(e.ativosNoMacuxi)].filter((id) => !recebidos.has(id));
  const ativos = new Set(e.ativosNoMacuxi).size;
  const limite = e.limitePct ?? PARAMETROS_PADRAO.limiteInativacaoPct;
  if (!e.confirmado && ativos > 0 && (inativar.length / ativos) * 100 > limite) {
    return { permitido: false, inativar: [], candidatos: inativar, motivo: 'excede_limite_inativacao' };
  }
  return { permitido: true, inativar, motivo: null };
}
