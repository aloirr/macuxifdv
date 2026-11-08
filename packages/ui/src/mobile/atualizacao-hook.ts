/**
 * `useAtualizacaoAutomatica` — RN-CORE-23 nas telas de lista (R-20261102-124413 item 2). A tela NÃO consulta o servidor
 * sozinha: o puxar para baixo dispara o MOTOR de sync pelo agendador único do app (`SincronizacaoProvider`, montado pelo
 * shell), com proteção de 30 s; a atualização automática (abrir o app, voltar depois de 30 min, a cada `sync_auto_min`,
 * aviso do servidor por push) é do agendador, não da tela.
 *
 *   const auto = useAtualizacaoAutomatica({ atualizar: relerDoAparelho, tz });
 *   <Screen refreshing={auto.puxando} onRefresh={auto.puxar}> … <Text>{auto.rodape}</Text>
 *
 * `atualizar` (opcional) é só a releitura LOCAL da tela (SQLite/armazenamento do módulo): roda depois de cada
 * sincronização concluída (automática, push ou puxar). Não chame `motor.sincronizar()` nem a API dentro dele.
 * `refreshing` recebe SÓ `auto.puxando`: a automática é silenciosa.
 * Fora do shell (sem provider), o puxar só chama `atualizar`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { rodapeAtualizacao } from './atualizacao';
import { useSincronizacao } from './sincronizacao';

export interface UsoAtualizacaoAutomatica {
  /** Para o `refreshing` do `Screen`: true só no puxar para baixo. */
  puxando: boolean;
  /** Para o `onRefresh` do `Screen`: Sincronizar (fila + pull), com proteção de 30 s. */
  puxar: () => void;
  /** Última sincronização concluída (ms) ou null. */
  atualizadoEm: number | null;
  /** "Atualizado às hh:mm · puxe para sincronizar", "Atualizado há instantes" ou, sem sinal, só "Atualizado às hh:mm" ("Ainda não sincronizado" sem hora). */
  rodape: string;
}

export function useAtualizacaoAutomatica({
  atualizar,
  tz,
}: {
  /** Releitura local da tela depois de cada sincronização (nada de rede aqui). */
  atualizar?: () => Promise<unknown> | unknown;
  tz?: string;
  /** Obsoleto (RN-CORE-23): o intervalo é o `sync_auto_min` do tenant, aplicado pelo agendador do app. Ignorado. */
  intervaloMin?: unknown;
  /** Obsoleto (RN-CORE-23): a automática é do agendador do app. Ignorado. */
  ativo?: boolean;
} = {}): UsoAtualizacaoAutomatica {
  const sync = useSincronizacao();
  const atualizarRef = useRef(atualizar);
  atualizarRef.current = atualizar;
  const [puxandoLocal, setPuxandoLocal] = useState(false);

  // releitura local a cada sincronização concluída (inclusive a automática e a do push), sem a primeira montagem
  const sincronizadoEm = sync?.sincronizadoEm ?? null;
  const anterior = useRef(sincronizadoEm);
  useEffect(() => {
    if (anterior.current === sincronizadoEm) return;
    anterior.current = sincronizadoEm;
    if (sincronizadoEm !== null) void Promise.resolve(atualizarRef.current?.()).catch(() => undefined);
  }, [sincronizadoEm]);

  const puxar = useCallback(() => {
    if (sync) {
      void sync.agendador.puxar().then(async (r) => {
        // falhou: relê mesmo assim (a fila local pode ter mudado); recente: nada mudou
        if (r === 'falhou') await Promise.resolve(atualizarRef.current?.()).catch(() => undefined);
      });
      return;
    }
    setPuxandoLocal(true);
    void Promise.resolve(atualizarRef.current?.())
      .catch(() => undefined)
      .finally(() => setPuxandoLocal(false));
  }, [sync]);

  const atualizadoEm = sincronizadoEm ? Date.parse(sincronizadoEm) : null;
  return {
    puxando: sync ? sync.estado.puxando : puxandoLocal,
    puxar,
    atualizadoEm: atualizadoEm !== null && Number.isFinite(atualizadoEm) ? atualizadoEm : null,
    rodape: rodapeAtualizacao(sincronizadoEm, tz ?? sync?.tz, { recente: sync?.estado.recente ?? false, semSinal: sync?.semSinal ?? false }),
  };
}
