/**
 * Entidades de sync do rastreamento no app (T-0156; desenho `tracking.md` §3.4). Mesmas definições da API (`sync-trajeto.ts`).
 * Push: `ponto_trajeto`. Pull: as ausências do próprio usuário. O rastreamento é interno: o Campo não tem tela dele. Puro.
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { AusenciaUsuarioSchema, ENTIDADE_AUSENCIA_USUARIO, ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema } from '../../contracts';

export const entidadesRastreamento = [
  definirEntidadeSync({ nome: ENTIDADE_PONTO_TRAJETO, modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: PontoTrajetoSchema }),
  definirEntidadeSync({ nome: ENTIDADE_AUSENCIA_USUARIO, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: AusenciaUsuarioSchema }),
] as const;
