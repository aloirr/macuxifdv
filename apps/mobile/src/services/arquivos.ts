/**
 * Arquivos locais da fila de arquivos do motor (ADR 0010 §4; desenho T-0016 §1 E4). O motor guarda o caminho
 * RELATIVO à pasta de documentos do app (padrão `fotos/<uuid>.jpg`, onde a câmera grava — `camera.ts`) e pede os bytes
 * aqui na hora do upload. Navegador (demonstração): sem arquivos locais, a fila fica parada sem erro.
 */
import type { ArquivosLocais } from '@macuxi/platform-sdk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { caminhoLocalValido, PASTA_FOTOS } from '@/lib/foto';

function arquivo(caminho: string): File {
  if (!caminhoLocalValido(caminho)) throw new Error('caminho de arquivo local inválido');
  const partes = caminho.split('/');
  const nome = partes.pop()!;
  return new File(partes.length ? new Directory(Paths.document, ...partes) : Paths.document, nome);
}

export function arquivosLocais(): ArquivosLocais {
  return {
    async ler(caminho) {
      if (Platform.OS === 'web') return null;
      const f = arquivo(caminho);
      return f.exists ? await f.bytes() : null;
    },
    async remover(caminho) {
      if (Platform.OS === 'web') return;
      const f = arquivo(caminho);
      if (f.exists) f.delete();
    },
  };
}

/**
 * RN-CORE-15 (aparelho bloqueado): apaga a pasta das fotos inteira, inclusive as que ainda não entraram na fila, e as
 * miniaturas do catálogo guardadas no cache (T-0097).
 */
export async function apagarFotosLocais(): Promise<void> {
  if (Platform.OS === 'web') return;
  const pasta = new Directory(Paths.document, PASTA_FOTOS);
  if (pasta.exists) pasta.delete();
  apagarMiniaturas();
}

/** Pasta das miniaturas do catálogo dentro do cache do app (T-0097; `services/miniaturas.ts`). */
export const PASTA_MINIATURAS = 'miniaturas';

/** RN-CORE-15: apaga as miniaturas guardadas (junto com as fotos, no bloqueio do aparelho). */
export function apagarMiniaturas(): void {
  if (Platform.OS === 'web') return;
  const pasta = new Directory(Paths.cache, PASTA_MINIATURAS);
  if (pasta.exists) pasta.delete();
}
