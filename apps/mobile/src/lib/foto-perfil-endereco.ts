/**
 * Foto do perfil no Início do Campo (RN-CORE-42): resolvedor para `definirResolvedorFotoPerfil` do Core. O `arquivo_id` da
 * escolha viva vira a rota autenticada `/v1/arquivos/<id>` (ADR 0010) e passa pelo mesmo caminho da miniatura do Catálogo
 * (`criarResolvedorMiniatura`): baixa uma vez com a sessão, até o teto da foto do perfil, guarda no cache e devolve o
 * `file://`. Sem sinal, id inválido ou falha = `null` (a tela mostra as iniciais). A foto trocada tem outro `arquivo_id`,
 * por isso a versão no nome do cache é fixa. Puro: a rede e o disco entram por parâmetro (`services/miniaturas.ts`).
 */
import { AVATAR_FOTO_MAX_BYTES } from '@macuxi/core/contracts';

import { criarResolvedorMiniatura, type DependenciasResolvedor } from './miniatura-endereco';

export function criarResolvedorFotoPerfil(d: DependenciasResolvedor): (arquivoId: string) => Promise<string | null> {
  const resolver = criarResolvedorMiniatura(d);
  return (arquivoId) => resolver(`/v1/arquivos/${arquivoId}`, { arquivo_id: arquivoId, bytes_max: AVATAR_FOTO_MAX_BYTES, versao: 'perfil' });
}
