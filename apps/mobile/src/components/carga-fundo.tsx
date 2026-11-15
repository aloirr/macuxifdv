/**
 * ADR 0054 (solução 5, "trabalhar enquanto carrega"): a carga inicial que continua com o usuário dentro do app.
 * - `IndicadorCargaFundo` do kit (docs/design/carga-em-segundo-plano.md), montado pelo shell uma vez, colado em cima da barra
 *   de abas, enquanto `estado.pendentes` não está vazio; o toque abre o detalhe da carga (`/sync?detalhe=1`);
 * - retomada: com o app reaberto no meio da carga (liberado, sem carga completa, nada rodando), pede a sincronização ao shell
 *   (`deveSincronizar` evita repetir a tentativa recente; sem sinal, o shell não tenta).
 * Regras puras em `lib/carga-fundo.ts`; etapas pela regra do Core (RN-CORE-48, `progressoDaEntrada`), que nunca volta.
 */
import { progressoDaEntrada } from '@macuxi/core/app';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { IndicadorCargaFundo } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { deveRetomarCarga, indicadorDaCargaFundo, ROTA_DETALHE_CARGA } from '@/lib/carga-fundo';
import { criarMemoriaDaEntrada } from '@/lib/entrada';
import { usePlataforma } from '@/state/plataforma';

export function CargaEmFundo() {
  const { sessao, perfil, modulosAtivos, offline, sincronizarSeNecessario } = usePlataforma();
  const { estado } = useMotorSync();
  const [lembrar] = useState(criarMemoriaDaEntrada);
  const retomar = deveRetomarCarga(estado);

  useEffect(() => {
    if (retomar) void sincronizarSeNecessario('carga-fundo');
  }, [retomar, sincronizarSeNecessario]);

  if (!sessao) return null;
  const progresso = lembrar(`${sessao.user.id}|${sessao.tenant?.id ?? ''}`, (anterior) =>
    progressoDaEntrada({
      perfil,
      modulos: modulosAtivos,
      carga: estado.carga,
      progresso: estado.progresso,
      sincronizando: estado.sincronizando,
      erro: null,
      sincronizado: false,
      anterior,
    }),
  );
  const indicador = indicadorDaCargaFundo(estado, progresso, offline);
  if (!indicador) return null;
  return <IndicadorCargaFundo {...indicador} aoTocar={() => router.push(ROTA_DETALHE_CARGA as never)} />;
}
