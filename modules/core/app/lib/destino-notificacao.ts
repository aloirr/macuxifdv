/**
 * Destino ao tocar numa notificação (RF-CORE-09, RN-CORE-80): o aviso de versão nova do app (sem `link`, `subtipo`
 * `app_versao_nova`) abre a tela de atualização do shell; as demais seguem o `link` interno, se a tela estiver na visão.
 */
import { linkInternoNavegavel } from '@macuxi/platform-sdk';
import { ehAvisoDeVersaoApp, ROTA_TELA_ATUALIZAR_APP } from '../../contracts/app-atualizacao';

export function destinoDaNotificacao(
  n: { tipo?: string | null; subtipo?: string | null; link?: string | null },
  paginaExiste: (caminho: string) => boolean,
): string | null {
  if (ehAvisoDeVersaoApp(n)) return ROTA_TELA_ATUALIZAR_APP;
  return linkInternoNavegavel(n.link ?? null, paginaExiste);
}
