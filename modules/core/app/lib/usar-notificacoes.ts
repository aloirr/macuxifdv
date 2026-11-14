/**
 * Hook da caixa de notificações: lê `notificacao` do aparelho (offline) e aplica a fila de leituras. Recarrega quando
 * um sync termina ou a fila muda. Marcar como lida = enfileirar `notificacao_leitura` (id = UUID do comando) e guardar a
 * leitura no aparelho (`leituras-locais.ts`), a mesma para todas as instâncias: o sino zera no primeiro toque e não volta a 1
 * quando o sync solta o aceito antes de reler a linha.
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { NotificacaoSync } from '../../contracts';
import { leiturasDoMotor } from './leituras-locais';
import { comandoDeLeitura, contarNaoLidas, montarCaixa, type NotificacaoLocal } from './notificacoes';

const SEM_LIDAS: ReadonlyMap<string, string> = new Map();
const semAssinatura = () => () => undefined;

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

  const locais = motor ? leiturasDoMotor(motor) : null;
  const lidas = useSyncExternalStore(locais ? locais.assinar : semAssinatura, () => locais?.lidas() ?? SEM_LIDAS);

  const caixa = useMemo(
    () => montarCaixa(linhas, itensParaSobrepor(estado, ['notificacao_leitura']), new Date(), lidas),
    [linhas, estado.fila, estado.aceitos, lidas],
  );

  const marcarLida = useCallback(
    async (id: string) => {
      if (!motor) return;
      const alvo = caixa.find((n) => n.id === id);
      if (!alvo || alvo.lida_em) return;
      const cmd = comandoDeLeitura(id, new Date(), motor.ambiente.novoId);
      // primeiro no aparelho (o sino zera no toque), depois na fila; se a fila não gravar, desfaz
      const locais = leiturasDoMotor(motor);
      locais.registrar(id, cmd.lida_em);
      try {
        await motor.enfileirar({ id: cmd.id, entidade: 'notificacao_leitura', payload: cmd, rotulo: 'Leitura de aviso', detalhe: alvo.titulo });
      } catch (e) {
        locais.desfazer(id);
        throw e;
      }
    },
    [motor, caixa],
  );

  return { caixa, naoLidas: contarNaoLidas(caixa), marcarLida, carregado };
}
