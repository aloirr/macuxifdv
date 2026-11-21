'use client';

import { useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import {
  Badge,
  Button,
  Dialog,
  formatDataHoraCurta,
  useToast,
  type ColunaDaTabela,
  TabelaDados,
} from '@macuxi/ui/web';
import type { LoteListagemItem } from '../../contracts';
import { podeCancelarLote } from '../../domain';
import { ROTULO_ENTIDADE, rotuloDoLote, tomDoLote } from '../lib/apresentacao';
import { falhouEm, horaDaFalha, textoLinhas, type LinhaEntidade } from '../lib/entidades';
import { useCancelarLote } from '../lib/queries';

/**
 * Histórico da entidade (RF-INT-04): os lotes recentes dela, "Ver erros" abre o log do lote e "Reprocessar os n lotes" refaz os que
 * podem ser refeitos (RN-INT-15). Lote em andamento leva "Cancelar", com confirmação.
 */
export function HistoricoDialog({
  linha,
  oculto,
  tz,
  reprocessando,
  onReprocessar,
  onVerErros,
  onClose,
}: {
  linha: LinhaEntidade | null;
  /** Gaveta de erros aberta por cima: o Histórico some e volta ao fechá-la. */
  oculto: boolean;
  tz: string;
  reprocessando: boolean;
  onReprocessar: (loteIds: readonly string[]) => void;
  onVerErros: (loteId: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const cancelar = useCancelarLote();
  const [cancelando, setCancelando] = useState<LoteListagemItem | null>(null);

  const colunas: ReadonlyArray<ColunaDaTabela<LoteListagemItem>> = [
    {
      id: 'recebido',
      titulo: 'Recebido',
      largura: '17%',
      celula: (l) => formatDataHoraCurta(l.recebido_em, tz),
    },
    {
      id: 'falhou',
      titulo: 'Falhou',
      largura: '17%',
      celula: (l) => {
        const f = falhouEm(l);
        return f ? horaDaFalha(f, l.recebido_em, tz) : '';
      },
    },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '26%',
      celula: (l) => <Badge tone={tomDoLote(l.status)}>{rotuloDoLote(l.status)}</Badge>,
    },
    {
      id: 'linhas',
      titulo: 'Linhas',
      numero: true,
      largura: '20%',
      celula: (l) => textoLinhas(l.status, l.recebidas, l.com_erro),
    },
    {
      id: 'acoes',
      titulo: '',
      celula: (l) => (
        <span className="flex justify-end gap-3">
          {podeCancelarLote(l.status) && (
            <Button
              variant="link"
              onClick={() => setCancelando(l)}
              data-testid={`integracao.lote.cancelar.${l.lote_id}`}
            >
              Cancelar
            </Button>
          )}
          {(l.status === 'falhou' || l.com_erro > 0) && (
            <Button
              variant="link"
              onClick={() => onVerErros(l.lote_id)}
              data-testid={`integracao.lote.ver-erros.${l.lote_id}`}
            >
              Ver erros
            </Button>
          )}
        </span>
      ),
    },
  ];

  const aRefazer = linha?.reprocessaveis ?? [];

  return (
    <>
      <Dialog
        open={linha !== null && cancelando === null && !oculto}
        title={linha ? `Histórico — ${ROTULO_ENTIDADE[linha.entidade]}` : ''}
        largura="larga"
        subtitle={
          linha
            ? `${linha.lotes[0]?.conector_id} · ${linha.lotes.length} ${linha.lotes.length === 1 ? 'lote' : 'lotes'}`
            : undefined
        }
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Fechar</Button>
            {aRefazer.length > 0 && (
              <Button
                variant="primary"
                disabled={reprocessando}
                onClick={() => onReprocessar(aRefazer)}
                data-testid="integracao.historico.reprocessar"
              >
                {aRefazer.length === 1 ? 'Reprocessar o lote' : `Reprocessar os ${aRefazer.length} lotes`}
              </Button>
            )}
          </>
        }
      >
        {linha && (
          <div className="flex flex-col gap-3" data-testid="integracao.historico">
            <TabelaDados
              colunas={colunas}
              linhas={linha.lotes}
              chave={(l) => l.lote_id}
              rotulo="Lotes da entidade"
              testId="integracao.historico.lotes"
            />
          </div>
        )}
      </Dialog>

      <Dialog
        open={cancelando !== null}
        title="Cancelar este lote?"
        onClose={() => setCancelando(null)}
        footer={
          <>
            <Button onClick={() => setCancelando(null)}>Voltar</Button>
            <Button
              variant="danger"
              disabled={cancelar.isPending}
              data-testid="integracao.cancelar.confirmar"
              onClick={() =>
                cancelando &&
                cancelar.mutate(cancelando.lote_id, {
                  onSuccess: () => {
                    toast('success', 'Lote cancelado.');
                    setCancelando(null);
                  },
                  onError: (e) => {
                    toast('danger', errorMessage(e));
                    setCancelando(null);
                  },
                })
              }
            >
              Cancelar lote
            </Button>
          </>
        }
      >
        {cancelando && (
          <p className="m-0 text-[15px]">
            {ROTULO_ENTIDADE[cancelando.entidade]} · lote {cancelando.lote_id.slice(0, 8)}
          </p>
        )}
      </Dialog>
    </>
  );
}
