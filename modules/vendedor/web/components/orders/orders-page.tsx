'use client';

import { useMemo, useState } from 'react';
import { formatBRL, formatPct } from '@macuxi/comum';
import { localIsoDate } from '@macuxi/comum/fuso';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, FilterBar, formatDateTime, IconDownload, LoadingBlock, PageHeader, Panel, SelectField, TableScroll, td, tdNum, th, thNum, useToast } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, ORDER_STATUSES, type Order } from '../../../contracts';
import { totalDoPeriodo } from '../../../domain/totais';
import { ordersToCsv } from '../../lib/csv';
import { type FiltrosPedidos, temFiltro } from '../../lib/filtros-url';
import { usePedidos, usePendentes, useSessaoDoBko } from '../../lib/queries';
import { useFiltrosNaUrl } from '../../lib/use-filtros';
import { ApprovalsPanel } from './approvals-panel';
import { useAtualizarPedidos } from './decisao';
import { OrderDrawer } from './order-drawer';
import { OrderStatusBadge } from './status';

const campo = 'h-10 box-border rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';

/**
 * Pedidos no BKO (RF-VEN-04/09, T-0029 §8): lista com filtros na URL (status, período, vendedor, busca por cliente ou número),
 * paginação por cursor, atualização ao abrir, ao focar a janela, depois de decidir e pelo botão Atualizar (RN-CORE-23, sem
 * consulta periódica própria), painel "Aguardando aprovação" com Aprovar/Rejeitar, gaveta de detalhe com PDF.
 * A proteção real é na API (escopo, perfil, alçada); aqui a interface só reflete o que a API permite.
 */
export function OrdersPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const [filtros, mudar] = useFiltrosNaUrl();
  const [aberto, setAberto] = useState<Order | null>(null);
  const lista = usePedidos(filtros);
  const pendentes = usePendentes();
  const atualizar = useAtualizarPedidos();
  const tz = sessao.fuso;

  const pedidos = useMemo(() => lista.data?.pages.flatMap((p) => p.itens) ?? [], [lista.data]);
  // vendedores para o filtro: os que aparecem nas páginas carregadas e nos pendentes (a API devolve só o escopo do usuário)
  const vendedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of [...pedidos, ...(pendentes.data ?? [])]) m.set(o.seller_id, o.seller_name);
    if (filtros.seller_id && !m.has(filtros.seller_id)) m.set(filtros.seller_id, 'Vendedor selecionado');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [pedidos, pendentes.data, filtros.seller_id]);
  const set = <K extends keyof FiltrosPedidos>(k: K, v: FiltrosPedidos[K]) => mudar({ [k]: v } as Partial<FiltrosPedidos>);

  const exportarCsv = () => {
    downloadBlob(new Blob([ordersToCsv(pedidos, tz)], { type: 'text/csv;charset=utf-8' }), `pedidos_${localIsoDate(new Date(), tz)}.csv`);
    toast('success', `CSV com ${pedidos.length} pedidos exportado.`);
  };

  const total = totalDoPeriodo(pedidos);

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={lista.data ? `${pedidos.length} ${lista.hasNextPage ? 'carregados (há mais)' : 'pedidos'} · ${formatBRL(total)}${lista.isFetching ? ' · atualizando…' : ''}` : ' '}
        actions={
          <>
            <Button variant="link" onClick={() => atualizar()} disabled={lista.isFetching} className="font-semibold" data-testid="pedidos.atualizar">
              Atualizar
            </Button>
            <Button variant="link" onClick={exportarCsv} disabled={pedidos.length === 0} className="font-semibold" data-testid="pedidos.exportar-csv">
              <IconDownload size={15} />
              Exportar CSV
            </Button>
          </>
        }
      />

      <FilterBar>
        <SelectField label="Status" value={filtros.status} onChange={(e) => set('status', e.target.value)} data-testid="pedidos.filtro-status">
          <option value="">Todos</option>
          {ORDER_STATUSES.filter((s) => s !== 'draft' && s !== 'queued').map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vendedor" value={filtros.seller_id} onChange={(e) => set('seller_id', e.target.value)} data-testid="pedidos.filtro-vendedor">
          <option value="">Todos</option>
          {vendedores.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </SelectField>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          De
          <input type="date" className={campo} value={filtros.from} max={filtros.to || undefined} onChange={(e) => set('from', e.target.value)} data-testid="pedidos.filtro-de" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Até
          <input type="date" className={campo} value={filtros.to} min={filtros.from || undefined} onChange={(e) => set('to', e.target.value)} data-testid="pedidos.filtro-ate" />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Cliente ou número
          <input type="search" className={campo} value={filtros.q} maxLength={100} placeholder="Ex.: Auto Peças ou 000012" onChange={(e) => set('q', e.target.value)} data-testid="pedidos.filtro-busca" />
        </label>
        {temFiltro(filtros) && (
          <Button size="sm" onClick={() => mudar({ status: '', seller_id: '', from: '', to: '', q: '' })} data-testid="pedidos.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {lista.isError && !lista.data && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isError && lista.data && <ErrorBlock message={`Não deu para atualizar agora: ${errorMessage(lista.error)}`} />}
      {lista.isPending && <LoadingBlock />}

      {lista.data && (
        <div className="flex flex-wrap items-start gap-4">
          <ApprovalsPanel approvals={pendentes.data ?? []} nowMs={Date.now()} onOpen={setAberto} />

          <Panel
            label="Pedidos"
            title={
              <>
                Pedidos <span className="font-sans text-[13px] font-normal text-ink-2">· {pedidos.length}</span>
              </>
            }
            className="flex-[2_1_560px]"
          >
            <TableScroll minWidth={760}>
              <thead>
                <tr>
                  <th scope="col" className={th}>Nº</th>
                  <th scope="col" className={th}>Cliente</th>
                  <th scope="col" className={th}>Vendedor</th>
                  <th scope="col" className={thNum}>Valor</th>
                  <th scope="col" className={thNum}>Desc.</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Recebido</th>
                </tr>
              </thead>
              <tbody data-testid="pedidos.tabela">
                {pedidos.map((o) => (
                  <tr
                    key={o.id}
                    tabIndex={0}
                    aria-label={`Abrir pedido ${o.number}`}
                    data-testid={`pedido.linha.${o.number}`}
                    onClick={() => setAberto(o)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAberto(o);
                      }
                    }}
                    className="cursor-pointer outline-none hover:bg-ground focus-visible:bg-ground"
                  >
                    <td className={`${td} font-mono`}>{o.number || '—'}</td>
                    <td className={`${td} min-w-[150px] font-semibold`}>{o.customer_name}</td>
                    <td className={`${td} whitespace-nowrap`}>{o.seller_name}</td>
                    <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(o.total_cents)}</td>
                    <td className={tdNum}>{formatPct(o.discount_pct)}</td>
                    <td className={td}>
                      <OrderStatusBadge status={o.status} situacaoOrcamento={o.situacao_orcamento} />
                      {o.situacao_faturamento?.length ? (
                        <span className="mt-0.5 block whitespace-nowrap text-[12px] text-ink-2" data-testid={`pedido.faturamento.${o.number}`}>
                          {o.situacao_faturamento.join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(o.received_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
            {pedidos.length === 0 && <span className="text-[13px] text-ink-2">Nenhum pedido com esses filtros.</span>}
            {lista.hasNextPage && (
              <Button onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage} data-testid="pedidos.carregar-mais">
                {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </Button>
            )}
          </Panel>
        </div>
      )}

      <OrderDrawer order={aberto} tz={tz} onClose={() => setAberto(null)} />
    </>
  );
}
