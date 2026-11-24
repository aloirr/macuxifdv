/**
 * T-0195 (ADR 0070, D8): o shell só mostra o link do APK novo se não restar no aparelho nada digitado e não enviado. Os rascunhos do
 * Vendedor (RN-VEN-38/39) ficam só no armazenamento do módulo, fora da fila do motor; aqui o shell os conta. Conta o mesmo que a tela
 * Rascunhos lista (`rascunhosParaLista`): pedido novo com itens e edição de registro salvo, sem os vencidos (24 h).
 */
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';

import { rascunhosParaLista } from '../../domain/rascunhos';
import { criarRepositorio } from './repositorio';

/** `arm` = `motor.armazenamentoDoModulo('vendedor')`, o mesmo que as telas do Vendedor usam. */
export async function contarRascunhosParaAtualizar(arm: ArmazenamentoSync, agora: Date = new Date()): Promise<number> {
  const rascunhos = await criarRepositorio(arm).ler('rascunhos');
  return rascunhosParaLista(rascunhos, agora).length;
}
