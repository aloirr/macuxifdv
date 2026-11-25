/**
 * RN-VEN-39/48: leva o pedido salvo guardado na chave do cliente (formato anterior, um por cliente) para a chave própria, sem perder nada.
 * Grava a cópia ANTES de apagar a chave antiga; se parar no meio, a próxima abertura só apaga a antiga (a regra é idempotente).
 */
import { migrarSalvosParaChavePropria } from '../../domain/rascunhos';
import type { Rascunho } from './pedidos';

export interface RepositorioDeRascunhos {
  carregar(): Promise<{ rascunhos: Record<string, Rascunho> }>;
  guardarRascunho(chave: string, r: Rascunho): Promise<void>;
  limparRascunho(chave: string): Promise<void>;
}

export async function migrarSalvosGuardados(repo: RepositorioDeRascunhos, novoId: () => string): Promise<Array<{ de: string; para: string }>> {
  const { rascunhos } = await repo.carregar();
  const { rascunhos: depois, movidos } = migrarSalvosParaChavePropria(rascunhos, novoId);
  for (const m of movidos) {
    if (!(m.para in rascunhos)) await repo.guardarRascunho(m.para, depois[m.para]!);
    await repo.limparRascunho(m.de);
  }
  return movidos;
}
