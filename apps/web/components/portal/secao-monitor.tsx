'use client';

/**
 * Seção "Monitor" no topo da aba Integração da empresa no portal `config.` (desenho docs/desenho/empresa-zerar.md §6.4; R-20261124-090510):
 * saúde, versão, último sinal e fila de cada Conector (`MonitorDetalhes`). Só o time da Macuxi: o admin do cliente não vê a seção (e a
 * API recusa os detalhes). O que é por entidade (carga, registros, Reprocessar e Zerar) fica na aba Dados (`AbaDados`).
 */
import { useMemo } from 'react';
import type { ConectorDetalhe } from '@macuxi/integracao/contracts';
import { useMonitorDetalhes } from '@macuxi/integracao/web';
import { Badge, ErrorBlock, formatDateTime, LoadingBlock, Panel, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { clienteDoPortal, SAUDE_DO_CONECTOR, textoFila } from '@/lib/portal-monitor';
import { ehTimeMacuxi } from '@/lib/portal-sessao';

import { useSessaoPortal } from './base';

export function SecaoMonitor({ tenant, fuso }: { tenant: string; fuso?: string }) {
  const sessao = useSessaoPortal();
  if (!ehTimeMacuxi(sessao)) return null;
  return <MonitorDaEmpresa tenant={tenant} fuso={fuso} />;
}

/** O corpo da seção (exportado para o teste, que o monta sem a sessão do portal). */
export function MonitorDaEmpresa({ tenant, fuso }: { tenant: string; fuso?: string }) {
  const cliente = useMemo(() => clienteDoPortal(tenant, true), [tenant]);
  const detalhes = useMonitorDetalhes(cliente);

  const colunas: ReadonlyArray<ColunaDaTabela<ConectorDetalhe>> = [
    { id: 'conector', titulo: 'Identificador', celula: (c) => <span className="font-mono">{c.conector_id}</span>, texto: (c) => c.conector_id },
    { id: 'saude', titulo: 'Situação', largura: '170px', celula: (c) => <Badge tone={SAUDE_DO_CONECTOR[c.saude].tom}>{SAUDE_DO_CONECTOR[c.saude].rotulo}</Badge> },
    { id: 'versao', titulo: 'Versão', largura: '100px', prioridade: 2, celula: (c) => c.versao_conector ?? '—' },
    { id: 'sinal', titulo: 'Último sinal', largura: '150px', numero: true, prioridade: 2, celula: (c) => formatDateTime(c.ultimo_sinal_em, fuso) },
    { id: 'fila', titulo: 'Fila', largura: '170px', numero: true, prioridade: 2, celula: (c) => textoFila(c.sinal) },
  ];

  const d = detalhes.data;
  return (
    // no topo da aba (R-20261124-090510): ocupa as duas colunas e se separa das seções Conector e API pelo filete de 1 px
    <section aria-labelledby="integracao-monitor" data-testid="integracao.monitor" className="mb-6 flex min-w-0 flex-col gap-4 border-b border-line pb-6 md:col-span-2">
      <h2 id="integracao-monitor" className="m-0 text-[20px] font-bold">
        Monitor
      </h2>
      {detalhes.isPending && <LoadingBlock />}
      {detalhes.isError && <ErrorBlock message={mensagemDoErro(detalhes.error)} onRetry={() => void detalhes.refetch()} />}
      {d && (
        <Panel title="Conector">
          <TabelaDados colunas={colunas} linhas={d.conectores} chave={(c) => c.conector_id} rotulo="Conector" testId="integracao.monitor.conectores" linhaTestId={(c) => `integracao.monitor.conector.${c.conector_id}`} />
        </Panel>
      )}
    </section>
  );
}
