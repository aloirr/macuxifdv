/**
 * Porta do visor de foto comum (RD-0088): o que o shell entrega aos módulos em `ambiente.abrirFoto` e registra no Core
 * para a foto do PDV. Abre a rota `/foto` (`app/foto.tsx`); a carga dos bytes de um `arquivo_id` segue a regra da foto do
 * PDV (`carregarFotoPdv`: local primeiro, nuvem só com sinal, só em memória).
 */
import { router } from 'expo-router';

import { rotaDoVisor, type PedidoAbrirFoto } from '@/lib/visor-foto';

/** Abre o visor; `false` = fonte recusada (arquivo que não é UUID, endereço inválido) e nada abriu. Nunca lança. */
export function abrirFoto(p: PedidoAbrirFoto): boolean {
  let rota: ReturnType<typeof rotaDoVisor>;
  try {
    rota = rotaDoVisor(p);
  } catch {
    return false;
  }
  router.push(rota as never);
  return true;
}
