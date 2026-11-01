/**
 * Entidades de sync de metas no app (T-0020; desenho T-0016 §2): pull de `meta` e `indicador_diario` dos usuários
 * visíveis (no Campo, só o próprio). Mesmas definições da API (`api/sync.ts`). Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { IndicadorDiarioSyncSchema, MetaSyncSchema } from '../../contracts';

export const entidadesMeta = [
  definirEntidadeSync({ nome: 'meta', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: MetaSyncSchema }),
  definirEntidadeSync({ nome: 'indicador_diario', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: IndicadorDiarioSyncSchema }),
] as const;
