'use client';

/**
 * Aprovar e rejeitar pedido no BKO (RN-GES-08; ADR 0011): chama as rotas do Vendedor. Aprovar é 1 clique (comentário
 * opcional não é pedido); rejeitar abre um diálogo com o motivo obrigatório (3+ caracteres). A API revalida nível e escopo.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, Notice, type NoticeTone } from '@macuxi/ui/web';
import { DecisaoAprovacaoResposta, MOTIVO_REJEICAO_MIN, type Order } from '../../../contracts';
import { corpoDaDecisao } from '../../lib/tabela-pedidos';

export type PedidoDecidivel = Pick<Order, 'id' | 'number' | 'customer_name' | 'seller_name' | 'total_cents'>;

/** Atualiza lista, painel, detalhe e decisões depois de decidir. */
export function useAtualizarPedidos() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['vendedor'] });
  };
}

export function useDecidir(onFeito: (tom: NoticeTone, texto: string) => void) {
  const atualizar = useAtualizarPedidos();
  const aprovar = useMutation({
    mutationFn: async (p: PedidoDecidivel) => DecisaoAprovacaoResposta.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/aprovar`, { method: 'POST', body: corpoDaDecisao('aprovar', '') })),
    onSuccess: (_r, p) => onFeito('success', `Pedido ${p.number} aprovado.`),
    onError: (e, p) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  const rejeitar = useMutation({
    mutationFn: async ({ p, motivo, rota = 'rejeitar' }: { p: PedidoDecidivel; motivo: string; rota?: 'rejeitar' | 'recusar' }) =>
      DecisaoAprovacaoResposta.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/${rota}`, { method: 'POST', body: corpoDaDecisao(rota, motivo) })),
    onSuccess: (_r, { p, rota }) => onFeito('success', rota === 'recusar' ? `Pedido ${p.number} rejeitado.` : `Pedido ${p.number} devolvido ao vendedor.`),
    onError: (e, { p }) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  return { aprovar, rejeitar };
}

export function BotoesDeDecisao({ pedido, onFeito, tamanho = 'sm' }: { pedido: PedidoDecidivel; onFeito: (tom: NoticeTone, texto: string) => void; tamanho?: 'sm' | 'md' }) {
  const { aprovar, rejeitar } = useDecidir(onFeito);
  const [rejeitando, setRejeitando] = useState(false);
  const ocupado = aprovar.isPending || rejeitar.isPending;

  return (
    <>
      <div className="flex gap-2">
        <Button variant="primary" size={tamanho} className="flex-1" disabled={ocupado} onClick={() => aprovar.mutate(pedido)} data-testid={`pedido.aprovar.${pedido.number}`}>
          {aprovar.isPending ? 'Aprovando…' : 'Aprovar'}
        </Button>
        <Button
          size={tamanho}
          className="flex-1"
          disabled={ocupado}
          data-testid={`pedido.rejeitar.${pedido.number}`}
          onClick={() => setRejeitando(true)}
        >
          Rejeitar
        </Button>
      </div>
      <DialogoDeRejeicao
        aberto={rejeitando}
        pedido={pedido}
        titulo={`Rejeitar pedido ${pedido.number}`}
        rotuloConfirmar="Rejeitar pedido"
        pendente={rejeitar.isPending}
        onFechar={() => setRejeitando(false)}
        onConfirmar={(motivo) => rejeitar.mutate({ p: pedido, motivo, rota: 'recusar' }, { onSettled: () => setRejeitando(false) })}
      />
    </>
  );
}

/** Diálogo do motivo (RN-GES-08: 3+ caracteres), usado pelo quadro de decisão e pela tabela de Pedidos. */
export function DialogoDeRejeicao({ aberto, pedido, titulo, rotuloConfirmar, pendente, onFechar, onConfirmar }: { aberto: boolean; pedido: PedidoDecidivel; titulo: string; rotuloConfirmar: string; pendente: boolean; onFechar: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const motivoOk = motivo.trim().length >= MOTIVO_REJEICAO_MIN;
  useEffect(() => {
    if (aberto) setMotivo('');
  }, [aberto]);
  return (
      <Dialog
        open={aberto}
        title={titulo}
        onClose={() => !pendente && onFechar()}
        footer={
          <>
            <Button size="sm" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!motivoOk || pendente}
              data-testid="pedido.rejeitar.confirmar"
              onClick={() => onConfirmar(motivo.trim())}
            >
              {pendente ? 'Enviando…' : rotuloConfirmar}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <span className="text-[13px] text-ink-2">
            {pedido.customer_name} · {pedido.seller_name} · {formatBRL(pedido.total_cents)}
          </span>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Motivo da rejeição
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              data-testid="pedido.rejeitar.motivo"
              placeholder="Ex.: desconto acima da política para este cliente"
              className="rounded-[10px] border border-field bg-surface px-3 py-2 text-[15px] font-normal text-ink"
            />
          </label>
          {!motivoOk && motivo.length > 0 && <span className="text-[12px] text-danger">Escreva ao menos {MOTIVO_REJEICAO_MIN} caracteres.</span>}
        </div>
      </Dialog>
  );
}

/** Aviso do resultado da última decisão (some ao fechar). */
export function AvisoDeDecisao({ aviso, onClose }: { aviso: { tom: NoticeTone; texto: string } | null; onClose: () => void }) {
  if (!aviso) return null;
  return (
    <Notice tone={aviso.tom} onClose={onClose}>
      {aviso.texto}
    </Notice>
  );
}
