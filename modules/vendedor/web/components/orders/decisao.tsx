'use client';

/**
 * Aprovar e rejeitar pedido no BKO (RN-GES-08; ADR 0011): chama as rotas do Vendedor. Aprovar é 1 clique (comentário
 * opcional não é pedido); rejeitar abre um diálogo com o motivo obrigatório (3+ caracteres). A API revalida nível e escopo.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, Notice, type NoticeTone } from '@macuxi/ui/web';
import { MOTIVO_REJEICAO_MIN, OrderDetail, type Order } from '../../../contracts';

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
    mutationFn: async (p: PedidoDecidivel) => OrderDetail.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/aprovar`, { method: 'POST', body: {} })),
    onSuccess: (_r, p) => onFeito('success', `Pedido ${p.number} aprovado.`),
    onError: (e, p) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  const rejeitar = useMutation({
    mutationFn: async ({ p, motivo }: { p: PedidoDecidivel; motivo: string }) =>
      OrderDetail.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/rejeitar`, { method: 'POST', body: { motivo } })),
    onSuccess: (_r, { p }) => onFeito('success', `Pedido ${p.number} rejeitado.`),
    onError: (e, { p }) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  return { aprovar, rejeitar };
}

export function BotoesDeDecisao({ pedido, onFeito, tamanho = 'sm' }: { pedido: PedidoDecidivel; onFeito: (tom: NoticeTone, texto: string) => void; tamanho?: 'sm' | 'md' }) {
  const { aprovar, rejeitar } = useDecidir(onFeito);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const ocupado = aprovar.isPending || rejeitar.isPending;
  const motivoOk = motivo.trim().length >= MOTIVO_REJEICAO_MIN;

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
          onClick={() => {
            setMotivo('');
            setRejeitando(true);
          }}
        >
          Rejeitar
        </Button>
      </div>
      <Dialog
        open={rejeitando}
        title={`Rejeitar pedido ${pedido.number}`}
        onClose={() => !rejeitar.isPending && setRejeitando(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setRejeitando(false)} disabled={rejeitar.isPending}>
              Voltar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!motivoOk || rejeitar.isPending}
              data-testid="pedido.rejeitar.confirmar"
              onClick={() => rejeitar.mutate({ p: pedido, motivo: motivo.trim() }, { onSettled: () => setRejeitando(false) })}
            >
              {rejeitar.isPending ? 'Rejeitando…' : 'Rejeitar pedido'}
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
    </>
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
