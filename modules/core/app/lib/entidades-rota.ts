/**
 * Entidades de sync de rota e visita que o app Campo/Gestão usa (T-0018; desenho T-0016 §2): pull de `motivo`,
 * `rota`, `rota_parada` e `visita` (linha do servidor) e push de `visita` (check-in, id = id da visita) e
 * `visita_checkout` (id = UUID do comando). Mesmas definições da API (`api/sync.ts`). Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { CheckinVisitaSchema, CheckoutVisitaSchema, MotivoSyncSchema, ParametroSyncSchema, RotaParadaSyncSchema, RotaSyncSchema, VisitaSyncSchema } from '../../contracts';

const pull = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });

export const entidadesRota = [
  pull('motivo', MotivoSyncSchema),
  pull('parametro', ParametroSyncSchema),
  pull('rota', RotaSyncSchema),
  pull('rota_parada', RotaParadaSyncSchema),
  definirEntidadeSync({
    nome: 'visita',
    modulo: 'core',
    direcao: 'ambos',
    conflito: 'servidor_vence',
    schema: CheckinVisitaSchema,
    schemaLinha: VisitaSyncSchema,
  }),
  definirEntidadeSync({ nome: 'visita_checkout', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: CheckoutVisitaSchema }),
] as const;
