'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Dialog, Drawer, ErrorBlock, LoadingBlock, Notice, TabelaDados, formatDateTime, formatDayMonthLong, type ColunaDaTabela } from '@macuxi/ui/web';
import { TAREFA_MOTIVO_CANCELAMENTO_MAX } from '../../../contracts/tarefa';
import { CHAVE_TAREFAS, chaveDetalhe, type ApiTarefas, type LinhaConsultorTarefa, type TarefaDetalheBko } from './api';
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
          <CampoFormulario rotulo="Motivo">
            <textarea
              value={motivo}
              maxLength={TAREFA_MOTIVO_CANCELAMENTO_MAX}
              rows={3}
              onChange={(e) => setMotivo(e.target.value)}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'tarefa.cancelar.erro' : undefined}
              className={`${CLASSE_CAMPO} h-auto py-2`}
              data-testid="tarefa.cancelar.motivo"
            />
            {erro && (
              <span id="tarefa.cancelar.erro" className="text-[12px] font-normal text-danger" data-testid="tarefa.cancelar.erro">
                {erro}
              </span>
            )}
          </CampoFormulario>
        </Dialog>
      )}
    </Drawer>
  );
}

const colunas = (fuso: string): ReadonlyArray<ColunaDaTabela<LinhaConsultorTarefa>> => [
  {
    id: 'consultor',
    titulo: 'Consultor',
    texto: (l) => l.nome,
    celula: (l) => (
      <>
        {l.nome}
        {l.observacao && <span className="block truncate font-normal text-ink-2">{l.observacao}</span>}
      </>
    ),
  },
  { id: 'situacao', titulo: 'Situação', largura: '150px', celula: (l) => <Badge tone={ROTULO_SITUACAO[l.situacao].tom}>{ROTULO_SITUACAO[l.situacao].texto}</Badge> },
  {
    id: 'feita',
    titulo: 'Feita em',
    largura: '130px',
    celula: (l) => (
      <>
        {l.concluida_em ? formatDateTime(l.concluida_em, fuso) : '—'}
        {l.fotos > 0 && <span className="block text-ink-2">{l.fotos === 1 ? '1 foto' : `${l.fotos} fotos`}</span>}
        {l.suspeita && <span className="block truncate text-ink-2">Relógio do aparelho adiantado</span>}
      </>
    ),
  },
];

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
      <TabelaDados
        rotulo="Consultores da tarefa"
        colunas={colunas(fuso)}
        linhas={tarefa.destinatarios}
        chave={(l) => l.id}
        linhaTestId={(l) => `tarefa.consultor.${l.usuario_id}`}
      />
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
