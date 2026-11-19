/**
 * Entidades de sync do rastreamento no app (T-0156; desenho `tracking.md` §3.4 e §6). Mesmas definições da API (`sync-trajeto.ts`).
 * Ordem do push: o aceite do termo antes dos pontos. Pull: termo vigente do tenant e as ausências do próprio usuário; o aceite volta
 * no pull só do próprio usuário. Puro.
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import {
  AceiteTermoRastreamentoSchema,
  AceiteTermoRastreamentoSyncSchema,
  AusenciaUsuarioSchema,
  ENTIDADE_ACEITE_TERMO_RASTREAMENTO,
  ENTIDADE_AUSENCIA_USUARIO,
  ENTIDADE_PAUSA_TRAJETO,
  ENTIDADE_PONTO_TRAJETO,
  ENTIDADE_TERMO_RASTREAMENTO,
  PausaTrajetoSchema,
  PontoTrajetoSchema,
  TermoRastreamentoSchema,
} from '../../contracts';

export const entidadesRastreamento = [
  definirEntidadeSync({ nome: ENTIDADE_ACEITE_TERMO_RASTREAMENTO, modulo: 'core', direcao: 'ambos', conflito: 'servidor_vence', schema: AceiteTermoRastreamentoSchema, schemaLinha: AceiteTermoRastreamentoSyncSchema }),
  definirEntidadeSync({ nome: ENTIDADE_PONTO_TRAJETO, modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: PontoTrajetoSchema }),
  definirEntidadeSync({ nome: ENTIDADE_PAUSA_TRAJETO, modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: PausaTrajetoSchema }),
  definirEntidadeSync({ nome: ENTIDADE_TERMO_RASTREAMENTO, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: TermoRastreamentoSchema }),
  definirEntidadeSync({ nome: ENTIDADE_AUSENCIA_USUARIO, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: AusenciaUsuarioSchema }),
] as const;
