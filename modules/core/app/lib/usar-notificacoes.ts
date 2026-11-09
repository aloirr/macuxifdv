/**
 * Hook da caixa de notificações: lê `notificacao` do aparelho (offline) e aplica a fila de leituras. Recarrega quando
 * um sync termina ou a fila muda. Marcar como lida = enfileirar `notificacao_leitura` (id = UUID do comando).
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { NotificacaoSync } from '../../contracts';
import { comandoDeLeitura, contarNaoLidas, montarCaixa, type NotificacaoLocal } from './notificacoes';

export function useNotificacoes(): { caixa: NotificacaoLocal[]; naoLidas: number; marcarLida: (id: string) => Promise<void>; carregado: boolean } {
  const { motor, estado } = useMotorSync();
  const [linhas, setLinhas] = useState<NotificacaoSync[]>([]);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const l = await motor.linhas<NotificacaoSync>('notificacao');
      if (ativo) {
        setLinhas(l);
        setCarregado(true);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  const caixa = useMemo(() => montarCaixa(linhas, itensParaSobrepor(estado, ['notificacao_leitura']), new Date()), [linhas, estado.fila, estado.aceitos]);

  const marcarLida = useCallback(
    async (id: string) => {
      if (!motor) return;
      const alvo = caixa.find((n) => n.id === id);
      if (!alvo || alvo.lida_em) return;
      const cmd = comandoDeLeitura(id, new Date(), motor.ambiente.novoId);
      await motor.enfileirar({ id: cmd.id, entidade: 'notificacao_leitura', payload: cmd, rotulo: 'Leitura de aviso', detalhe: alvo.titulo });
    },
    [motor, caixa],
  );

  return { caixa, naoLidas: contarNaoLidas(caixa), marcarLida, carregado };
}
