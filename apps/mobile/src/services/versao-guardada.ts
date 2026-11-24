/**
 * T-0195 (ADR 0070, RN-CORE-80): a última versão publicada que o aparelho conhece, guardada para valer sem sinal na entrada.
 * Uma chave só no armazenamento do aparelho (variante, versão e hora da publicação; nenhum dado pessoal), lida pelo app aberto
 * (`state/plataforma.tsx`) e pela tarefa sem tela (`services/segundo-plano.ts`).
 */
import type { SituacaoDaVersao } from '@macuxi/platform-sdk';

import { varianteAtual } from '@/lib/variante';
import {
  appInstalado,
  CHAVE_VERSAO_PUBLICADA,
  lerGuardada,
  situacaoGuardada,
  type VersaoPublicadaGuardada,
} from '@/lib/versao-app';

import { readJson, writeJson } from './storage';

export async function lerVersaoGuardada(): Promise<VersaoPublicadaGuardada | null> {
  return lerGuardada(await readJson<unknown>(CHAVE_VERSAO_PUBLICADA).catch(() => null), varianteAtual());
}

export async function gravarVersaoGuardada(v: VersaoPublicadaGuardada): Promise<void> {
  await writeJson(CHAVE_VERSAO_PUBLICADA, v).catch(() => undefined);
}

/** Situação do app instalado com a última informação guardada e o relógio agora (sem rede). */
export async function situacaoNoAparelho(agora = new Date()): Promise<SituacaoDaVersao> {
  return situacaoGuardada(await lerVersaoGuardada(), appInstalado()?.versao, agora);
}
