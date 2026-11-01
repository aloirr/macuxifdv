/**
 * Entidades de sync da central de notificações no app (T-0019; desenho T-0016 §5): pull `notificacao` (só as do próprio
 * usuário) e push `notificacao_leitura` (comando de leitura, `somente_insercao`). Mesmas definições da API. Puro.
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { LeituraNotificacaoSchema, NotificacaoSyncSchema } from '../../contracts';

export const entidadesNotificacao = [
  definirEntidadeSync({ nome: 'notificacao', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: NotificacaoSyncSchema }),
  definirEntidadeSync({ nome: 'notificacao_leitura', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: LeituraNotificacaoSchema }),
] as const;
