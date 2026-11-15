/**
 * Entidades de sync de cliente que o app Campo/Gestão puxa (T-0017; desenho T-0016 §2): somente pull, o servidor
 * filtra pela carteira (`escopo: 'carteira'`, RN-CORE-04) e o app lê só o que está no aparelho (offline-first).
 * Mesmas definições da API (`api/sync.ts`): o motor valida o schema dos dois lados. Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import {
  CarteiraSyncSchema,
  ClienteEnderecoSyncSchema,
  ClienteContatoSyncSchema,
  ClienteFinanceiroSyncSchema,
  ClienteSyncSchema,
  HistoricoCompraSyncSchema,
  TituloSyncSchema,
  ClienteVisitaResumoSyncSchema,
  UsuarioSyncSchema,
} from '../../contracts';

const pull = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema'], parcial = false) =>
  definirEntidadeSync({
    nome,
    modulo: 'core',
    direcao: 'pull',
    conflito: 'servidor_vence',
    schema,
    ...(parcial ? { parcial } : {}),
  });

export const entidadesCliente = [
  pull('cliente', ClienteSyncSchema, true),
  pull('carteira', CarteiraSyncSchema, true),
  pull('cliente_contato', ClienteContatoSyncSchema, true),
  pull('cliente_financeiro', ClienteFinanceiroSyncSchema),
  pull('titulo', TituloSyncSchema),
  pull('historico_compra', HistoricoCompraSyncSchema),
  // Endereços de entrega (RN-VEN-17): pull filtrado pela carteira
  pull('cliente_endereco', ClienteEnderecoSyncSchema, true),
  // RN-CORE-50 e RN-CORE-47: total de visitas, última visita e quem visitou (servidor, qualquer usuário) para a aba Performance e a linha da lista
  pull('cliente_visita_resumo', ClienteVisitaResumoSyncSchema),
  // RN-VEN-11a: funções e limite de desconto do usuário (o app usa a linha da sessão)
  pull('usuario', UsuarioSyncSchema),
] as const;
