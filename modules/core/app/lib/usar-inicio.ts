/**
 * Hook do Início (boas-vindas; T-0073 §1.3): lê as linhas do pull e a cópia de `core.inicio@1` do aparelho (offline) e devolve a
 * `VisaoInicio` calculada por `montarInicio`. Recalcula quando um sync termina ou a fila muda — nenhum timer (RN-CORE-23); a virada
 * do dia é percebida no próximo sync, na próxima leitura da fila ou ao reabrir a tela. `null` até a primeira leitura.
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import type { ClienteSync, Inicio, MetaSync, NotificacaoSync, ParametroSync, RotaParadaSync, VisaoInicio, VisitaSync } from '../../contracts';
import { CHAVES, fusoDe } from './estado';
import { montarInicio, type LinhasInicio } from './inicio-local';
import { useCore } from './usar-core';

export function useInicio(): VisaoInicio | null {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [dados, setDados] = useState<{ linhas: LinhasInicio; copia: Inicio | null } | null>(null);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [metas, paradas, visitas, notificacoes, parametros, clientes, copia] = await Promise.all([
        motor.linhas<MetaSync>('meta'),
        motor.linhas<RotaParadaSync>('rota_parada'),
        motor.linhas<VisitaSync>('visita'),
        motor.linhas<NotificacaoSync>('notificacao'),
        motor.linhas<ParametroSync>('parametro'),
        motor.linhas<ClienteSync>('cliente'),
        motor.armazenamentoDoModulo('core').ler<Inicio>(CHAVES.inicio),
      ]);
      if (ativo) setDados({ linhas: { metas, paradas, visitas, notificacoes, parametros, clientes }, copia });
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  return useMemo(() => {
    const u = motor?.ambiente.usuario();
    if (!dados || !u) return null;
    return montarInicio(dados.linhas, dados.copia, itensParaSobrepor(estado), { usuarioId: u.id, perfil: u.perfil ?? 'vendedor', fuso: fusoDe(core.estado.me, u.fuso), agora: new Date() });
  }, [dados, estado.fila, estado.aceitos, motor, core.estado.me]);
}
