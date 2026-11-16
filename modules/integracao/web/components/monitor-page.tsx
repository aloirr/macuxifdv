'use client';

import { useMemo } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '@macuxi/ui/web';
import { podeExecutar } from '../lib/apresentacao';
import { filtrarLotes } from '../lib/filtros-url';
import { useAgora, useMonitor, useSessaoDoBko } from '../lib/queries';
import { useFiltrosNaUrl } from '../lib/use-filtros';
import { LoteDrawer } from './lote-drawer';
import { LotesPanel } from './lotes-panel';

/**
 * Integração ERP no BKO (T-0173; RF-INT-04): só o cabeçalho com "Atualizar", os filtros Entidade e Status e a tabela de lotes.
 * O clique na linha abre o log do lote (gaveta). Os cards de pedidos foram para BKO > Pedidos (Vendedor) e o de-para para
 * Parâmetros > Integração (`de-para-page.tsx`). Atualiza pelo sync_auto_min do tenant (RN-CORE-23). O shell só monta a página com o
 * módulo efetivo (licença) e a ação `monitor.ver`; a API revalida licença, perfil e tenant.
 */
export function MonitorPage() {
  const sessao = useSessaoDoBko();
  const agora = useAgora();
  const [filtros, mudar] = useFiltrosNaUrl();
  const monitor = useMonitor();
  const m = monitor.data;

  const lotes = useMemo(() => (m ? filtrarLotes(m.lotes_recentes, filtros) : []), [m, filtros]);
  const loteAberto = useMemo(() => m?.lotes_recentes.find((l) => l.lote_id === filtros.lote) ?? null, [m, filtros.lote]);

  if (!podeExecutar('monitor.ver', sessao.perfil)) {
    return (
      <>
        <PageHeader title="Integração ERP" />
        <ErrorBlock message="Seu perfil não acessa o monitor da Integração ERP. Peça acesso ao administrador do Macuxi." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Integração ERP"
        actions={
          <Button variant="link" onClick={() => void monitor.refetch()} disabled={monitor.isFetching} data-testid="integracao.monitor.atualizar">
            {monitor.isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {monitor.isError && !m && <ErrorBlock message={errorMessage(monitor.error)} onRetry={() => void monitor.refetch()} />}
      {monitor.isError && m && <ErrorBlock message="Não deu para atualizar agora." onRetry={() => void monitor.refetch()} />}
      {monitor.isPending && <LoadingBlock />}

      {m && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-monitor-conteudo">
          <LotesPanel lotes={lotes} filtros={filtros} mudar={mudar} tz={sessao.fuso} agora={agora} perfil={sessao.perfil} />
        </div>
      )}

      <LoteDrawer lote={loteAberto} tz={sessao.fuso} onClose={() => mudar({ lote: '' })} />
    </>
  );
}
