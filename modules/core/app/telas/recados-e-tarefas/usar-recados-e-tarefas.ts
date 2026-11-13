/**
 * Hook de "Recados e tarefas" (T-0170; desenho `docs/desenho/tarefas-consultor.md` §2.2, §5 e §7.2). Offline: junta a caixa de
 * notificações do aparelho (leitura da fila já aplicada) e as tarefas do pull `tarefa`, com as conclusões da fila sobrepostas,
 * pela `montarRecadosETarefas` do domain (N-B).
 * - Concluir = enfileirar o comando `tarefa_conclusao` (UUID do aparelho, hora do aparelho, RN-CORE-TAR-06) e marcar o aviso lido.
 * - Desmarcar (D4) = descartar os comandos ainda na fila (`desmarcarTarefa`); depois de aceito, não há desfazer no app.
 * A entidade `tarefa` (pull) e `tarefa_conclusao` (push) são registradas na costura (N-D); até lá a lista mostra só os recados.
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConclusaoTarefaSchema, type ConclusaoTarefa, type TarefaSync } from '../../../contracts/tarefa';
import { dataLocal } from '../../../domain';
import { desmarcarTarefa, ENTIDADE_CONCLUSAO } from '../../../domain/tarefas/conclusao';
import { montarRecadosETarefas } from '../../../domain/tarefas/recados-e-tarefas';
import { useCore } from '../../lib/usar-core';
import { useNotificacoes } from '../../lib/usar-notificacoes';
import { chegadaDosAvisos, type ContextoLinha, type ItemDaTela } from './linhas-recados-e-tarefas';

/** Entidade do pull das tarefas (uma linha por destinatário). */
export const ENTIDADE_TAREFA = 'tarefa';

export interface UsoRecadosETarefas {
  itens: ItemDaTela[];
  contexto: ContextoLinha;
  carregado: boolean;
  /** Abrir um recado ou a tarefa: marca lido (o recado ou o aviso da tarefa). */
  marcarLido: (item: ItemDaTela) => Promise<void>;
  /** Conclui a tarefa no aparelho (fotos já capturadas no tipo foto). */
  concluir: (tarefaId: string, opcoes?: { fotoIds?: string[]; observacao?: string | null }) => Promise<void>;
  /** D4: desfaz a conclusão que ainda não subiu. `false` quando já sincronizou. */
  desmarcar: (tarefaId: string) => Promise<boolean>;
}

export function useRecadosETarefas(): UsoRecadosETarefas {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const { caixa, marcarLida, carregado: caixaCarregada } = useNotificacoes();
  const [tarefas, setTarefas] = useState<TarefaSync[] | null>(null);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const linhas = await motor.linhas<TarefaSync>(ENTIDADE_TAREFA);
      if (ativo) setTarefas(linhas);
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  const fuso = core.tz;
  const fila = useMemo(() => itensParaSobrepor(estado, [ENTIDADE_CONCLUSAO]), [estado.fila, estado.aceitos]);
  const pesquisaAtiva = estado.modulosAtivos.length > 0 ? estado.modulosAtivos.includes('pesquisa') : undefined;

  const itens = useMemo(
    () => montarRecadosETarefas(caixa, tarefas ?? [], fila, { agora: new Date(), fuso, pesquisa_ativa: pesquisaAtiva }),
    [caixa, tarefas, fila, fuso, pesquisaAtiva],
  );
  const contexto = useMemo<ContextoLinha>(() => ({ hoje: dataLocal(new Date(), fuso), fuso, chegadaDoAviso: chegadaDosAvisos(caixa) }), [fuso, caixa]);

  const marcarLido = useCallback(
    async (item: ItemDaTela) => {
      if (item.tipo === 'recado') await marcarLida(item.id);
      else if (item.aviso_id && item.nova) await marcarLida(item.aviso_id);
    },
    [marcarLida],
  );

  const concluir = useCallback(
    async (tarefaId: string, o: { fotoIds?: string[]; observacao?: string | null } = {}) => {
      if (!motor) return;
      const item = itens.find((i) => i.tipo === 'tarefa' && i.id === tarefaId);
      if (!item || item.tipo !== 'tarefa' || item.tarefa.concluida_em) return;
      const cmd: ConclusaoTarefa = ConclusaoTarefaSchema.parse({
        id: motor.ambiente.novoId(),
        tarefa_destinatario_id: tarefaId,
        concluida_em: new Date().toISOString(),
        foto_ids: o.fotoIds ?? [],
        observacao: o.observacao?.trim() ? o.observacao.trim() : null,
      });
      await motor.enfileirar({ id: cmd.id, entidade: ENTIDADE_CONCLUSAO, payload: cmd, rotulo: 'Tarefa feita', detalhe: item.tarefa.titulo });
      await marcarLido(item);
    },
    [motor, itens, marcarLido],
  );

  const desmarcar = useCallback(
    async (tarefaId: string) => {
      if (!motor) return false;
      const item = itens.find((i) => i.tipo === 'tarefa' && i.id === tarefaId);
      if (!item || item.tipo !== 'tarefa') return false;
      const linha = (tarefas ?? []).find((t) => t.id === tarefaId);
      const r = desmarcarTarefa({ id: tarefaId, concluida_em: linha?.concluida_em ?? null }, fila);
      if (!r.ok) return false;
      for (const id of r.descartar) await motor.descartar(id);
      return true;
    },
    [motor, itens, tarefas, fila],
  );

  return { itens, contexto, carregado: caixaCarregada && tarefas !== null, marcarLido, concluir, desmarcar };
}
