/**
 * T-0195 (ADR 0070, D8): o shell só mostra o link do APK novo se não restar no aparelho nada digitado e não enviado. Os rascunhos do
 * Vendedor (RN-VEN-38/39) ficam só no armazenamento do módulo, fora da fila do motor; aqui o shell os conta. Conta o mesmo que a tela
 * Rascunhos lista (`rascunhosParaLista`): pedido novo com itens e edição de registro salvo, sem os vencidos (24 h).
 */
import { comPrefixo, type ContextoPendenciasParaAtualizar, type PendenciaParaAtualizar } from '@macuxi/platform-sdk';

import { rascunhosParaLista } from '../../domain/rascunhos';
import { hrefRascunhos } from '../rotas';
import { criarRepositorio } from './repositorio';

export async function pendenciasRascunhosParaAtualizar(ctx: Pick<ContextoPendenciasParaAtualizar, 'armazenamento' | 'agora'>): Promise<PendenciaParaAtualizar | null> {
  // `ctx.armazenamento` = base do motor; o prefixo `mod:vendedor:` é o de `motor.armazenamentoDoModulo('vendedor')`, onde as telas gravam.
  const rascunhos = await criarRepositorio(comPrefixo(ctx.armazenamento, 'mod:vendedor:')).ler('rascunhos');
  const total = rascunhosParaLista(rascunhos, ctx.agora).length;
  return total > 0 ? { total, href: hrefRascunhos() } : null;
}
