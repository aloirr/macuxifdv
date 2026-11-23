'use client';

import { Button, ErrorBlock, PageHeader } from '@macuxi/ui/web';
import { podeExecutar } from '../lib/apresentacao';
import { useClienteDoBko } from '../lib/cliente';
import { cabecalhoDoMonitor } from '../lib/entidades';
import { useMonitor, useSessaoDoBko } from '../lib/queries';
import { MonitorPainel } from './monitor-painel';

/**
 * Integração ERP no BKO (RF-INT-04): cabeçalho com o conector, a versão e a última carga, "Atualizar" e o `MonitorPainel` (uma linha
 * por entidade; o Histórico abre os lotes e "Ver erros" abre o log do lote). Os cards de pedidos foram para BKO > Pedidos (Vendedor)
 * e o de-para para Parâmetros > Integração (`de-para-page.tsx`). Atualiza pelo sync_auto_min do tenant (RN-CORE-23). O shell só monta
 * a página com o módulo efetivo (licença) e a ação `monitor.ver`; a API revalida licença, perfil e tenant.
 */
export function MonitorPage() {
  const cliente = useClienteDoBko();
  const sessao = useSessaoDoBko();
  // o cliente vai por parâmetro: o único provider é o do `MonitorPainel`
  const monitor = useMonitor(cliente);
  const m = monitor.data;
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
      <MonitorPainel cliente={cliente} tz={sessao.fuso} perfil={sessao.perfil} />
    </>
  );
}
