/**
 * RN-PRO-01 / RN-CORE-01 / ADR 0073 §2.4: leitura de pedidos do próprio usuário (cargo e concessão), copiada para o aparelho
 * pela etapa `core-leitura-de-pedidos` (`cargas.ts`) e lida offline pela ficha do cliente (`pedidosVisiveisPelaLeitura`).
 */
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';

import { LeituraDePedidosDoUsuarioSchema, type LeituraDePedidosDoUsuario } from '../../contracts';
import { CHAVES } from './estado';
import { tolerante } from './leitor-tolerante';

export const LeituraDePedidosTolerante = tolerante(LeituraDePedidosDoUsuarioSchema);

/** A cópia guardada, ou `null` (ausente ou fora do contrato). */
export async function leituraDePedidosGuardada(armazenamento: Pick<ArmazenamentoSync, 'ler'>): Promise<LeituraDePedidosDoUsuario | null> {
  const r = LeituraDePedidosTolerante.safeParse(await armazenamento.ler<unknown>(CHAVES.leituraDePedidos));
  return r.success ? r.data : null;
}
