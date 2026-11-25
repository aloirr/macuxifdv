/**
 * Seção "Monitor" no topo da aba Integração do portal (desenho empresa-zerar.md §6.4; R-20261124-090510), renderizada com
 * `react-dom/server` e o cache do React Query semeado com o detalhe do monitor falso: só o Conector (saúde, versão, último sinal e
 * fila). Nada por entidade (isso é da aba Dados). Fora do time da Macuxi a seção não aparece.
 */
import { MonitorDetalhes } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { responderMonitorFalso } from '@/lib/portal-falso-monitor';
import { escopoDoPortal } from '@/lib/portal-monitor';

import { MonitorDaEmpresa, SecaoMonitor } from './secao-monitor';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

async function montar(): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  const det = await responderMonitorFalso('GET', '/integracao/monitor/detalhes', T, true).json();
  qc.setQueryData(['integracao', escopoDoPortal(T), 'monitor', 'detalhes'], MonitorDetalhes.parse(det));
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MonitorDaEmpresa tenant={T} fuso="America/Manaus" />
    </QueryClientProvider>,
  );
}

describe('seção Monitor', () => {
  it('Conector com saúde, versão e fila; nada por entidade (carga, registros e ações ficam na aba Dados)', async () => {
    const html = await montar();
    expect(html).toContain('>Monitor</h2>');
    expect(html).toMatch(/integracao\.monitor\.conector\.erp.*Em dia.*1\.4\.0.*2 lotes · 380 linhas/);
    // RD-2679: a coluna é "Identificador"; "Conector" fica só no título do quadro
    expect(html).toContain('>Identificador<');
    for (const fora of ['Cargas recentes', 'Dados no Hub', 'Corrigir no ERP', 'Registros', 'acoes.']) expect(html).not.toContain(fora);
  });
  it('sem a sessão do time da Macuxi, nada aparece', () => {
    const qc = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <SecaoMonitor tenant={T} />
      </QueryClientProvider>,
    );
    expect(html).toBe('');
  });
});
