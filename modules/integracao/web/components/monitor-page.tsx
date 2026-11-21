'use client';

import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '@macuxi/ui/web';
import { podeExecutar } from '../lib/apresentacao';
import { cabecalhoDoMonitor } from '../lib/entidades';
import { useMonitor, useSessaoDoBko } from '../lib/queries';
import { useFiltrosNaUrl } from '../lib/use-filtros';
import { LoteDrawer } from './lote-drawer';
import { EntidadesPanel } from './entidades-panel';

/**
 * Integração ERP no BKO (RF-INT-04): cabeçalho com o conector, a versão e a última carga, "Atualizar" e uma linha por entidade.
 * O Histórico da entidade abre os lotes e "Ver erros" abre o log do lote (gaveta). Os cards de pedidos foram para BKO > Pedidos (Vendedor) e o de-para para
 * Parâmetros > Integração (`de-para-page.tsx`). Atualiza pelo sync_auto_min do tenant (RN-CORE-23). O shell só monta a página com o
 * módulo efetivo (licença) e a ação `monitor.ver`; a API revalida licença, perfil e tenant.
 */
export function MonitorPage() {
  const sessao = useSessaoDoBko();
  const [filtros, mudar] = useFiltrosNaUrl();
  const monitor = useMonitor();
  const m = monitor.data;

  const loteAberto = m?.lotes_recentes.find((l) => l.lote_id === filtros.lote) ?? null;
  const cabecalho = m ? cabecalhoDoMonitor(m.lotes_recentes, m.conectores, sessao.fuso) : '';

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
        subtitle={cabecalho || undefined}
        actions={
          <Button variant="link" onClick={() => void monitor.refetch()} disabled={monitor.isFetching} data-testid="integracao.monitor.atualizar">
            Atualizar
          </Button>
        }
      />

      {monitor.isError && !m && <ErrorBlock message={errorMessage(monitor.error)} onRetry={() => void monitor.refetch()} />}
      {monitor.isError && m && <ErrorBlock message="Não deu para atualizar agora." onRetry={() => void monitor.refetch()} />}
      {monitor.isPending && <LoadingBlock />}

      {m && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-monitor-conteudo">
          <EntidadesPanel lotes={m.lotes_recentes} filtros={filtros} mudar={mudar} tz={sessao.fuso} perfil={sessao.perfil} />
        </div>
      )}

      <LoteDrawer lote={loteAberto} tz={sessao.fuso} onClose={() => mudar({ lote: '' })} />
    </>
  );
}
