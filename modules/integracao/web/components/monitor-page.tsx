'use client';

import { useMemo } from 'react';
import { localIsoDate } from '@macuxi/comum/fuso';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, ErrorBlock, KpiCard, KpiGrid, LoadingBlock, MenuAcoes, PageHeader, Panel, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import type { MonitorResumo } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_ESTADO_CARGA, TOM_ESTADO_CARGA, podeExecutar } from '../lib/apresentacao';
import { lotesParaCsv } from '../lib/csv';
import { filtrarLotes } from '../lib/filtros-url';
import { useAgora, useMonitor, useSessaoDoBko } from '../lib/queries';
import { useFiltrosNaUrl } from '../lib/use-filtros';
import { AlertasPanel } from './alertas-panel';
import { ConectoresPanel } from './conectores-panel';
import { InativacoesPanel } from './inativacoes-panel';
import { LoteDrawer } from './lote-drawer';
import { LotesPanel } from './lotes-panel';
import { MapeamentoPanel } from './mapeamento-panel';
import { PedidosPanel } from './pedidos-panel';

type Carga = MonitorResumo['cargas'][number];

/** Carga por entidade (revisão do BKO §P2): sem rolagem lateral; o estado é o selo único da linha (§P5). */
const COLUNAS_CARGA: ReadonlyArray<ColunaDaTabela<Carga>> = [
  { id: 'entidade', titulo: 'Entidade', celula: (c) => <span className="font-semibold">{ROTULO_ENTIDADE[c.entidade]}</span>, texto: (c) => ROTULO_ENTIDADE[c.entidade] },
  { id: 'estado', titulo: 'Situação', largura: '180px', celula: (c) => <Badge tone={TOM_ESTADO_CARGA[c.estado]}>{ROTULO_ESTADO_CARGA[c.estado]}</Badge> },
  { id: 'lotes', titulo: 'Lotes', numero: true, prioridade: 2, largura: '96px', celula: (c) => c.lotes },
  { id: 'com-erro', titulo: 'Com erro', numero: true, largura: '104px', celula: (c) => c.com_erro },
  {
    id: 'aguardando',
    titulo: 'Aguardando',
    prioridade: 3,
    celula: (c) => c.aguardando.map((e) => ROTULO_ENTIDADE[e]).join(', ') || '—',
    texto: (c) => c.aguardando.map((e) => ROTULO_ENTIDADE[e]).join(', '),
  },
];

/**
 * Monitor do Hub no BKO (T-0051; RF-INT-04, RF-INT-06; hub-api.md §13): Conectores com sinal de vida e versão, alertas, carga por
 * entidade, lotes (recebido, aplicado, com erros) com os erros por linha em CSV, inativação em massa aguardando confirmação
 * (admin ou analista, P-3) e a fila de pedidos do ERP com os erros de retorno. Atualiza pelo sync_auto_min do tenant (RN-CORE-23);
 * "Atualizar" e "Exportar lotes (CSV)" ficam no "⋯" da página (revisão do BKO §P1).
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

  return (
    <>
      <PageHeader
        title="Integração ERP"
        actions={
          <MenuAcoes
            testId="integracao.monitor.mais-acoes"
            acoes={[
              { id: 'exportar', rotulo: 'Exportar lotes (CSV)', aoEscolher: exportarLotes, desligada: lotes.length === 0, testId: 'integracao.lotes.exportar-csv' },
              { id: 'atualizar', rotulo: monitor.isFetching ? 'Atualizando…' : 'Atualizar', aoEscolher: () => void monitor.refetch(), desligada: monitor.isFetching, testId: 'integracao.monitor.atualizar' },
            ]}
          />
        }
      />

      {monitor.isError && !m && <ErrorBlock message={errorMessage(monitor.error)} onRetry={() => void monitor.refetch()} />}
      {monitor.isError && m && <ErrorBlock message={`Não deu para atualizar agora: ${errorMessage(monitor.error)}`} />}
      {monitor.isPending && <LoadingBlock />}

      {m && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-monitor-conteudo">
          <KpiGrid>
            <KpiCard label="Conectores no ar" value={`${noAr} de ${ativos}`} />
            <KpiCard label="Lotes com erro" value={lotesComErro} />
          </KpiGrid>

          <AlertasPanel alertas={m.alertas} />
          <ConectoresPanel conectores={m.conectores} agora={agora} tz={tz} />
          <InativacoesPanel pendencias={m.pendencias_inativacao} perfil={sessao.perfil} agora={agora} tz={tz} />

          <Panel label="Carga por entidade" title="Carga por entidade">
            <TabelaDados colunas={COLUNAS_CARGA} linhas={m.cargas} chave={(c) => c.entidade} rotulo="Carga por entidade" testId="integracao.cargas" />
          </Panel>

          <LotesPanel lotes={lotes} conectores={m.conectores} filtros={filtros} mudar={mudar} tz={tz} />
          <PedidosPanel pedidos={m.pedidos} alertas={m.alertas} />
          <MapeamentoPanel perfil={sessao.perfil} />
        </div>
      )}

      <LoteDrawer lote={loteAberto} tz={tz} onClose={() => mudar({ lote: '' })} />
    </>
  );
}
