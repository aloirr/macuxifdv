'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, Drawer, ErrorBlock, LoadingBlock, Notice, TableScroll, formatDateTime, formatDayMonthLong, td, th } from '@macuxi/ui/web';
import { TAREFA_MOTIVO_CANCELAMENTO_MAX } from '../../../contracts/tarefa';
import { CHAVE_TAREFAS, chaveDetalhe, type ApiTarefas, type TarefaDetalheBko } from './api';
import { ROTULO_SITUACAO, ROTULO_TIPO, validarMotivo } from './tarefas';

/** Detalhe da tarefa (§7.1): uma linha por consultor e o cancelamento com motivo (RN-CORE-TAR-08). */
export function TarefaDetalhe({ cliente, id, fuso, onClose }: { cliente: ApiTarefas; id: string; fuso: string; onClose: () => void }) {
  const qc = useQueryClient();
  const podeCancelar = usePode('tarefa.cancelar');
  const q = useQuery({ queryKey: chaveDetalhe(id), queryFn: () => cliente.detalhe(id) });
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const cancelar = useMutation({
    mutationFn: (m: string) => cliente.cancelar(id, { motivo: m }),
    onSuccess: async () => {
      setCancelando(false);
      await qc.invalidateQueries({ queryKey: CHAVE_TAREFAS });
    },
    onError: (e) => setErro(errorMessage(e)),
  });
  const confirmar = () => {
    const v = validarMotivo(motivo);
    if (!v.ok) return setErro(v.erro);
    setErro(null);
    cancelar.mutate(v.motivo);
  };

  const t = q.data;
  return (
    <Drawer open title={t?.titulo ?? 'Tarefa'} subtitle={t ? `${ROTULO_TIPO[t.tipo]} · prazo ${formatDayMonthLong(t.prazo)}` : undefined} onClose={onClose}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando a tarefa…" />}
      {t && (
        <DetalheTarefa
          tarefa={t}
          fuso={fuso}
          podeCancelar={podeCancelar}
          onCancelar={() => {
            setMotivo('');
            setErro(null);
            setCancelando(true);
          }}
        />
      )}
      {cancelando && (
        <Dialog
          open
          title="Cancelar tarefa"
          onClose={() => setCancelando(false)}
          footer={
            <>
              <Button onClick={() => setCancelando(false)}>Voltar</Button>
              <Button variant="danger" disabled={cancelar.isPending} onClick={confirmar} data-testid="tarefa.cancelar.confirmar">
                Cancelar tarefa
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Motivo
            <textarea
              value={motivo}
              maxLength={TAREFA_MOTIVO_CANCELAMENTO_MAX}
              rows={3}
              onChange={(e) => setMotivo(e.target.value)}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'tarefa.cancelar.erro' : undefined}
              className="rounded-xl border border-field bg-surface p-3 text-[14px] font-normal text-ink"
              data-testid="tarefa.cancelar.motivo"
            />
            {erro && (
              <span id="tarefa.cancelar.erro" className="font-normal text-danger" data-testid="tarefa.cancelar.erro">
                {erro}
              </span>
            )}
          </label>
        </Dialog>
      )}
    </Drawer>
  );
}

/** Conteúdo do detalhe, sem consulta (renderizável no teste). */
export function DetalheTarefa({ tarefa, fuso, podeCancelar, onCancelar }: { tarefa: TarefaDetalheBko; fuso: string; podeCancelar: boolean; onCancelar: () => void }) {
  return (
    <div className="flex flex-col gap-4 text-[13px]" data-testid="tarefa.detalhe">
      {tarefa.cancelada_em && (
        <Notice tone="info">
          Cancelada em {formatDateTime(tarefa.cancelada_em, fuso)}. Motivo: {tarefa.motivo_cancelamento}
        </Notice>
      )}
      {tarefa.descricao && <p className="m-0 whitespace-pre-line text-ink">{tarefa.descricao}</p>}
      <TableScroll minWidth={480}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Consultor</th>
              <th className={th}>Situação</th>
              <th className={th}>Feita em</th>
            </tr>
          </thead>
          <tbody>
            {tarefa.destinatarios.map((l) => (
              <tr key={l.id} data-testid={`tarefa.consultor.${l.usuario_id}`}>
                <td className={td}>
                  {l.nome}
                  {l.observacao && <span className="block text-ink-2">{l.observacao}</span>}
                </td>
                <td className={td}>
                  <Badge tone={ROTULO_SITUACAO[l.situacao].tom}>{ROTULO_SITUACAO[l.situacao].texto}</Badge>
                </td>
                <td className={td}>
                  {l.concluida_em ? formatDateTime(l.concluida_em, fuso) : '—'}
                  {l.fotos > 0 && <span className="block text-ink-2">{l.fotos === 1 ? '1 foto' : `${l.fotos} fotos`}</span>}
                  {l.suspeita && <span className="block text-ink-2">Relógio do aparelho adiantado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {podeCancelar && !tarefa.cancelada_em && (
        <div>
          <Button variant="danger" onClick={onCancelar} data-testid="tarefa.cancelar">
            Cancelar tarefa
          </Button>
        </div>
      )}
    </div>
  );
}
