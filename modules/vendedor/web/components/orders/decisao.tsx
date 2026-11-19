'use client';

/**
 * Aprovar, devolver e rejeitar pedido no BKO (RN-GES-08; ADR 0011, 0062): chama as rotas do Vendedor, escolhidas e montadas por `contracts`
 * (`ROTA_DA_DECISAO`, `corpoDaDecisao`). Aprovar é 1 clique; devolver e rejeitar abrem um diálogo com o motivo obrigatório (3+ caracteres).
 * A API revalida nível e escopo.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, Notice, type NoticeTone } from '@macuxi/ui/web';
import { corpoDaDecisao, DecisaoAprovacaoResposta, MOTIVO_REJEICAO_MIN, ROTA_DA_DECISAO, type Order } from '../../../contracts';

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
    mutationFn: async (p: PedidoDecidivel) => DecisaoAprovacaoResposta.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/${ROTA_DA_DECISAO.aprovar}`, { method: 'POST', body: corpoDaDecisao('aprovar', '') })),
    onSuccess: (_r, p) => onFeito('success', `Pedido ${p.number} aprovado.`),
    onError: (e, p) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  const rejeitar = useMutation({
    mutationFn: async ({ p, motivo, decisao }: { p: PedidoDecidivel; motivo: string; decisao: 'devolver' | 'recusar' }) =>
      DecisaoAprovacaoResposta.parse(await api<unknown>(`/vendedor/pedidos/${p.id}/${ROTA_DA_DECISAO[decisao]}`, { method: 'POST', body: corpoDaDecisao(decisao, motivo) })),
    onSuccess: (_r, { p, decisao }) => onFeito('success', decisao === 'recusar' ? `Pedido ${p.number} rejeitado.` : `Pedido ${p.number} devolvido ao vendedor.`),
    onError: (e, { p }) => onFeito('danger', `Pedido ${p.number}: ${errorMessage(e)}`),
    onSettled: () => atualizar(),
  });
  return { aprovar, rejeitar };
}

/** Diálogo do motivo (RN-GES-08: 3+ caracteres), usado pela lista de ações da tabela de Pedidos (a decisão fica só na linha). */
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
