/**
 * RN-CORE-23 no shell: monta o `SincronizacaoProvider` do kit (botão Sincronizar e `useAtualizacaoAutomatica` das telas)
 * com o agendador único do app e o estado do motor, e liga o push (T-0065 A, item 3):
 * - registra o token do aparelho no servidor (`PUT /v1/dispositivos/atual/push`) uma vez por sessão (API real);
 * - push recebido com o app aberto → o agendador sincroniza só as entidades indicadas (sem lista = novidades);
 * - toque no push → abre a tela certa (ex.: detalhe do pedido).
 * Fica dentro do `ShellProvider` e do `Stack` (o roteador já existe para abrir a rota do push).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { SincronizacaoProvider, type ValorSincronizacao } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { dispositivoId } from '@/services/motor-do-usuario';
import { ouvirPush, registrarPush } from '@/services/push';
import { usePlataforma } from '@/state/plataforma';

export function SincronizacaoDoShell({ children }: { children: ReactNode }) {
  const app = usePlataforma();
  const { estado } = useMotorSync();
  const { agendador, estadoAgendador, offline, sessao, me, modo, ambiente } = app;
  const tz = me?.tenant.timezone ?? sessao?.tenant?.fuso ?? 'America/Manaus';
  const naFila = estado.fila.length + estado.arquivos.filter((a) => a.situacao !== 'enviado').length;

  const valor = useMemo<ValorSincronizacao | null>(
    () =>
      agendador
        ? {
            agendador,
            estado: estadoAgendador,
            sincronizadoEm: estado.sincronizado_em,
            naFila,
            sincronizando: estado.sincronizando,
            semSinal: offline,
            tz,
          }
        : null,
    [agendador, estadoAgendador, estado.sincronizado_em, estado.sincronizando, naFila, offline, tz],
  );

  // ---------- push: ouvintes (app aberto) ----------
  const agendadorRef = useRef(agendador);
  agendadorRef.current = agendador;
  const temSessao = sessao !== null;
  useEffect(() => {
    if (!temSessao) return;
    return ouvirPush({
      aoAviso: (entidades) => void agendadorRef.current?.aviso(entidades ?? undefined),
      aoAbrir: (rota) => {
        try {
          router.push(rota as never);
        } catch {
          // rota que não existe nesta variante: fica no Início
        }
      },
    });
  }, [temSessao]);

  // ---------- push: registro do token (uma vez por sessão, só na API real) ----------
  const usuarioId = sessao?.user.id ?? null;
  const cargaFeita = estado.sincronizado_em !== null;
  // `ambiente` muda de identidade com o sinal; o registro só precisa rodar de novo com outro usuário (lido por ref)
  const httpRef = useRef(ambiente.http);
  httpRef.current = ambiente.http;
  useEffect(() => {
    if (!usuarioId || modo !== 'v1' || !cargaFeita) return;
    let vivo = true;
    void (async () => {
      const id = await dispositivoId();
      if (!vivo) return;
      await registrarPush({
        usuarioId,
        dispositivoId: id,
        enviar: (corpo) => httpRef.current.requisitar('PUT', '/dispositivos/atual/push', { body: corpo }),
      });
    })();
    return () => {
      vivo = false;
    };
  }, [usuarioId, modo, cargaFeita]);

  return <SincronizacaoProvider value={valor}>{children}</SincronizacaoProvider>;
}
