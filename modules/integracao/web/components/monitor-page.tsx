'use client';

import { useMemo } from 'react';
import { localIsoDate } from '@macuxi/comum/fuso';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, IconDownload, KpiCard, KpiGrid, LoadingBlock, PageHeader, Panel, TableScroll, td, tdNum, th, thNum, useToast } from '@macuxi/ui/web';
import { ROTULO_ENTIDADE, ROTULO_ESTADO_CARGA, TOM_ESTADO_CARGA, podeExecutar, tempoDesde } from '../lib/apresentacao';
import { lotesParaCsv } from '../lib/csv';
import { filtrarLotes } from '../lib/filtros-url';
import { useAgora, useMonitor, useSessaoDoBko } from '../lib/queries';
import { useFiltrosNaUrl } from '../lib/use-filtros';
import { AlertasPanel } from './alertas-panel';
import { ConectoresPanel } from './conectores-panel';
import { InativacoesPanel } from './inativacoes-panel';
import { LoteDrawer } from './lote-drawer';
import { LotesPanel } from './lotes-panel';
import { PedidosPanel } from './pedidos-panel';

/**
 * Monitor do Hub no BKO (T-0051; RF-INT-04, RF-INT-06; hub-api.md §13): Conectores com sinal de vida e versão, alertas, carga por
 * entidade, lotes (recebido, aplicado, com erros) com os erros por linha em CSV, inativação em massa aguardando confirmação
 * (admin ou analista, P-3) e a fila de pedidos do ERP com os erros de retorno. Atualiza pelo sync_auto_min do tenant (RN-CORE-23) e pelo botão "Atualizar".
 * O shell só monta a página com o módulo efetivo (licença) e a ação `monitor.ver`; a API revalida licença, perfil e tenant.
 */
export function MonitorPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const agora = useAgora();
  const [filtros, mudar] = useFiltrosNaUrl();
  const monitor = useMonitor();
  const tz = sessao.fuso;
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

  const exportarLotes = () => {
    downloadBlob(new Blob([lotesParaCsv(lotes, tz)], { type: 'text/csv;charset=utf-8' }), `lotes_integracao_${localIsoDate(agora, tz)}.csv`);
    toast('success', `CSV com ${lotes.length} lotes exportado.`);
  };

  const noAr = m?.conectores.filter((c) => c.saude === 'ok').length ?? 0;
  const ativos = m?.conectores.filter((c) => c.ativo).length ?? 0;
  const lotesComErro = m?.lotes_recentes.filter((l) => l.com_erro > 0 || l.status === 'falhou').length ?? 0;
  const criticos = m?.alertas.filter((a) => a.severidade === 'critico').length ?? 0;

  return (
    <>
      <PageHeader
        title="Integração ERP"
        subtitle={m ? `Atualizado ${tempoDesde(m.gerado_em, agora)}${monitor.isFetching ? ' · atualizando…' : ''}` : ' '}
        badge={criticos > 0 ? <Badge tone="danger">{criticos} crítico{criticos > 1 ? 's' : ''}</Badge> : undefined}
        actions={
          <>
          <Button variant="link" onClick={() => void monitor.refetch()} disabled={monitor.isFetching} className="font-semibold" data-testid="integracao.monitor.atualizar">
            Atualizar
          </Button>
          <Button variant="link" onClick={exportarLotes} disabled={lotes.length === 0} className="font-semibold" data-testid="integracao.lotes.exportar-csv">
            <IconDownload size={15} />
            Exportar lotes (CSV)
          </Button>
          </>
        }
      />

      {monitor.isError && !m && <ErrorBlock message={errorMessage(monitor.error)} onRetry={() => void monitor.refetch()} />}
      {monitor.isError && m && <ErrorBlock message={`Não deu para atualizar agora: ${errorMessage(monitor.error)}`} />}
      {monitor.isPending && <LoadingBlock />}

      {m && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-monitor-conteudo">
          <KpiGrid>
            <KpiCard label="Conectores no ar" value={`${noAr} de ${ativos}`} sub="sinal há menos de 3 min" />
            <KpiCard label="Lotes com erro" value={lotesComErro} sub={`dos ${m.lotes_recentes.length} mais recentes`} />
            <KpiCard label="Inativações aguardando" value={m.pendencias_inativacao.length} sub="carga completa acima do limite" />
            <KpiCard label="Pedidos presos ou retidos" value={m.pedidos.presos + m.pedidos.retidos} sub="fila do ERP" />
          </KpiGrid>

          <AlertasPanel alertas={m.alertas} />
          <ConectoresPanel conectores={m.conectores} agora={agora} tz={tz} />
          <InativacoesPanel pendencias={m.pendencias_inativacao} perfil={sessao.perfil} agora={agora} tz={tz} />

          <Panel label="Carga por entidade" title="Carga por entidade">
            <TableScroll minWidth={560}>
              <thead>
                <tr>
                  <th scope="col" className={th}>Entidade</th>
                  <th scope="col" className={th}>Estado</th>
                  <th scope="col" className={thNum}>Lotes</th>
                  <th scope="col" className={thNum}>Com erro</th>
                  <th scope="col" className={th}>Aguardando</th>
                </tr>
              </thead>
              <tbody data-testid="integracao.cargas">
                {m.cargas.map((c) => (
                  <tr key={c.entidade}>
                    <td className={`${td} font-semibold`}>{ROTULO_ENTIDADE[c.entidade]}</td>
                    <td className={td}>
                      <Badge tone={TOM_ESTADO_CARGA[c.estado]}>{ROTULO_ESTADO_CARGA[c.estado]}</Badge>
                    </td>
                    <td className={tdNum}>{c.lotes}</td>
                    <td className={tdNum}>{c.com_erro}</td>
                    <td className={`${td} text-[12px] text-ink-2`}>{c.aguardando.map((e) => ROTULO_ENTIDADE[e]).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </Panel>

          <LotesPanel lotes={lotes} total={m.lotes_recentes.length} conectores={m.conectores} filtros={filtros} mudar={mudar} tz={tz} />
          <PedidosPanel pedidos={m.pedidos} alertas={m.alertas} />
        </div>
      )}

      <LoteDrawer lote={loteAberto} tz={tz} onClose={() => mudar({ lote: '' })} />
    </>
  );
}
