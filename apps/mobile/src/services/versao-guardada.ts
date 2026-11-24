/**
 * T-0195 (ADR 0070, RN-CORE-80): a última versão publicada que o aparelho conhece, guardada para valer sem sinal na entrada.
 * Uma chave só no armazenamento do aparelho (variante, versão e hora da publicação; nenhum dado pessoal), lida pelo app aberto
 * (`state/plataforma.tsx`) e pela tarefa sem tela (`services/segundo-plano.ts`).
 */
import { varianteAtual } from '@/lib/variante';
import {
  appInstalado,
  CHAVE_VERSAO_PUBLICADA,
  estaBloqueada,
  lerGuardada,
  type VersaoPublicadaGuardada,
} from '@/lib/versao-app';

import { readJson, writeJson } from './storage';

export async function lerVersaoGuardada(): Promise<VersaoPublicadaGuardada | null> {
  return lerGuardada(await readJson<unknown>(CHAVE_VERSAO_PUBLICADA).catch(() => null), varianteAtual());
}

export async function gravarVersaoGuardada(v: VersaoPublicadaGuardada): Promise<void> {
  await writeJson(CHAVE_VERSAO_PUBLICADA, v).catch(() => undefined);
}

/** O app instalado está bloqueado pela última informação guardada e o relógio agora (sem rede)? */
export async function bloqueadoNoAparelho(agora = new Date()): Promise<boolean> {
  return estaBloqueada(await lerVersaoGuardada(), appInstalado()?.versao, agora);
}
