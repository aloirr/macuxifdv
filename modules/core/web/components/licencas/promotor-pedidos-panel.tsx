'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { PromotorVePedidosSchema } from '../../../contracts';

const CHAVE = ['core', 'parametros', 'promotor-ve-pedidos'] as const;
const CAMINHO = '/core/parametros/promotor-ve-pedidos';

/**
 * Opção do perfil Promotor: "Promotor vê pedidos" (RN-CORE-01; RN-PRO-01; T-0061). Por empresa, padrão ligado. Só controla a
 * LEITURA dos pedidos da carteira dele; criar, editar, cancelar, duplicar e excluir pedido continua sempre bloqueado.
 * Só admin (ação `parametro.promotor_ve_pedidos`; a API revalida e audita antes/depois). Vale nos aparelhos no próximo sync.
 * testIDs: `promotor-pedidos.painel` · `promotor-pedidos.toggle` (role=switch) · `promotor-pedidos.estado` (data-estado ligado|desligado).
 */
export function PromotorPedidosPanel() {
  const pode = usePode('parametro.promotor_ve_pedidos');
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHAVE, enabled: pode, queryFn: async () => PromotorVePedidosSchema.parse(await api<unknown>(CAMINHO)) });
  const gravar = useMutation({
    mutationFn: async (ligado: boolean) => PromotorVePedidosSchema.parse(await api<unknown>(CAMINHO, { method: 'PUT', body: { ligado } })),
    onSuccess: async (r) => {
      setAviso(r.ligado ? 'O promotor volta a ver os pedidos da carteira dele no próximo sync.' : 'O promotor deixa de ver pedidos no próximo sync. Ele continua sem poder criar ou alterar pedidos.');
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  if (!pode) return null;
  const ligado = q.data?.ligado;
  return (
    <Panel title="Opções do perfil Promotor">
      <div className="flex flex-col gap-3" data-testid="promotor-pedidos.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando a opção…" />}
        {aviso && (
          <Notice tone="info" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        {q.data && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[240px] flex-1 flex-col gap-1">
              <span className="text-[15px] font-semibold text-ink">Promotor vê pedidos</span>
              <span className="text-[13px] text-ink-2">Mostra ao promotor, só para leitura, os pedidos dos clientes da carteira dele (Cliente 360 e lista de pedidos). Ele nunca cria nem altera pedido.</span>
            </div>
            <span data-testid="promotor-pedidos.estado" data-estado={ligado ? 'ligado' : 'desligado'}>
              <Badge tone={ligado ? 'success' : 'neutral'}>{ligado ? 'Ligado' : 'Desligado'}</Badge>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={ligado}
              aria-label={ligado ? 'Desligar: promotor não vê pedidos' : 'Ligar: promotor vê pedidos'}
              disabled={gravar.isPending}
              data-testid="promotor-pedidos.toggle"
              onClick={() => gravar.mutate(!ligado)}
              className="h-[44px] min-w-[96px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:text-disabled"
            >
              {gravar.isPending ? 'Salvando…' : ligado ? 'Desligar' : 'Ligar'}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
