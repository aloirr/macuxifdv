/**
 * "Equipe agora" no Gestão (T-0073, RN-CORE-26 e §1.5 do desenho): além de em visita / em rota / sem check-in, quem está
 * PARADO = sem check-in aberto, com paradas pendentes na rota e `parado_min` minutos (padrão 60, `inicio.parado_min`)
 * desde o último checkout. Sem expediente nem GPS (RN-CORE-13). Funções puras: a API grava os fatos no painel do dia e o
 * aparelho aplica a regra com o relógio dele (por isso o status não fica velho no cache).
 */
import { instanteMs } from './numeros';
import { diaLocal } from './painel';
import type { EstadoProjecao } from './projecao';

export interface SituacaoDaRota {
  paradas_planejadas: number;
  paradas_pendentes: number;
  /** Último checkout do dia (UTC), ou `null` sem checkout. */
  ultimo_checkout_em: string | null;
}

/** Fatos da rota de `usuarioId` no dia civil `dia` (fuso do tenant): paradas pendentes = clientes da rota sem check-in hoje. */
export function situacaoDaRota(estado: EstadoProjecao, usuarioId: string, dia: string, fuso: string): SituacaoDaRota {
  const planejados = new Set(estado.planejadas[`${usuarioId}|${dia}`]?.cliente_ids ?? []);
  const visitados = new Set<string>();
  let ultimo: string | null = null;
  for (const f of Object.values(estado.visitas)) {
    if (!f.checkin || f.checkin.usuario_id !== usuarioId || diaLocal(f.checkin.checkin_em, fuso) !== dia) continue;
    visitados.add(f.checkin.cliente_id);
    const co = f.checkout?.checkout_em;
    if (co && (ultimo === null || instanteMs(co) > instanteMs(ultimo))) ultimo = co;
  }
  const pendentes = [...planejados].filter((c) => !visitados.has(c)).length;
  return { paradas_planejadas: planejados.size, paradas_pendentes: pendentes, ultimo_checkout_em: ultimo };
}

export * from './agora-status';
