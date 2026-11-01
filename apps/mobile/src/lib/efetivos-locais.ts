/**
 * Módulos efetivos quando o app ainda não tem a resposta de `GET /v1/me/modulos` (puro, roda em Node).
 * - API real (`v1`): só o Core. A licença vem do servidor (RN-CORE-01/02); sem resposta guardada no aparelho, nenhum
 *   módulo licenciável monta aba (T-0034: nenhuma aba sem licença). O motor guarda a última resposta e a usa offline.
 * - Demonstração (`demo`, mock-api da Fase M, que não tem `/me/modulos`): todos os instalados como ativos no tenant
 *   + o padrão do perfil pelo manifesto (o promotor fica sem o Vendedor, RN-PRO-01).
 */
import { modulosEfetivos, type ModuloId, type Perfil } from '@macuxi/platform-sdk';

import { MANIFESTOS_INSTALADOS } from './instalados';
import type { ModoApi } from './modo-api';

export function efetivosSemServidor(modo: ModoApi, perfil: Perfil | null): ModuloId[] {
  if (modo !== 'demo' || !perfil) return ['core'];
  return modulosEfetivos({
    manifestos: MANIFESTOS_INSTALADOS,
    ativosNoTenant: MANIFESTOS_INSTALADOS.map((m) => m.id),
    doPerfil: MANIFESTOS_INSTALADOS.filter((m) => m.perfis.includes(perfil)).map((m) => m.id),
  });
}
