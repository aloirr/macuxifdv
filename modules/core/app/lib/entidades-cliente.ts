/**
 * Entidades de sync de cliente que o app Campo/Gestão puxa (T-0017; desenho T-0016 §2): somente pull, o servidor
 * filtra pela carteira (`escopo: 'carteira'`, RN-CORE-04) e o app lê só o que está no aparelho (offline-first).
 * Mesmas definições da API (`api/sync.ts`): o motor valida o schema dos dois lados. Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import {
  CarteiraSyncSchema,
  ClienteContatoSyncSchema,
  ClienteFinanceiroSyncSchema,
  ClienteSyncSchema,
  HistoricoCompraSyncSchema,
  TituloSyncSchema,
} from '../../contracts';

const pull = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });

export const entidadesCliente = [
  pull('cliente', ClienteSyncSchema),
  pull('carteira', CarteiraSyncSchema),
  pull('cliente_contato', ClienteContatoSyncSchema),
  pull('cliente_financeiro', ClienteFinanceiroSyncSchema),
  pull('titulo', TituloSyncSchema),
  pull('historico_compra', HistoricoCompraSyncSchema),
] as const;
