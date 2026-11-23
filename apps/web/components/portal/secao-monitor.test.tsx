/**
 * Seção "Monitor" da aba Integração no portal (desenho empresa-zerar.md §6.4), renderizada com `react-dom/server` e o cache do
 * React Query semeado com as respostas do monitor falso: Conector, painel do módulo com "Reprocessar" e "Zerar dados" por linha, e
 * "Dados no Hub" com o "Zerar dados" só nas entidades sem lote. Fora do time da Macuxi a seção não aparece.
 */
import { MonitorDetalhes, MonitorResumo } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { responderMonitorFalso } from '@/lib/portal-falso-monitor';
import { escopoDoPortal } from '@/lib/portal-monitor';

import { MonitorDaEmpresa, SecaoMonitor } from './secao-monitor';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const empresa = { id: T, codigo: 'AM2290', razao_social: 'Mercantil Rio Branco Ltda', fuso: 'America/Manaus' };
const resposta = async (caminho: string) => (await responderMonitorFalso('GET', caminho, T, true)).json();

async function montar(): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  const escopo = escopoDoPortal(T);
  qc.setQueryData(['integracao', escopo, 'monitor'], MonitorResumo.parse(await resposta('/integracao/monitor')));
  qc.setQueryData(['integracao', escopo, 'monitor', 'detalhes'], MonitorDetalhes.parse(await resposta('/integracao/monitor/detalhes')));
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MonitorDaEmpresa empresa={empresa} />
    </QueryClientProvider>,
  );
}

describe('seção Monitor', () => {
  it('Conector com saúde, versão e fila; painel com Reprocessar e Zerar dados na linha', async () => {
    const html = await montar();
    expect(html).toContain('>Monitor</h2>');
    expect(html).toMatch(/integracao\.monitor\.conector\.erp.*Em dia.*1\.4\.0.*2 lotes · 380 linhas/);
    expect(html).toContain('data-testid="integracao.entidade.reprocessar.produto"');
    for (const e of ['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor']) expect(html).toContain(`data-testid="integracao.entidade.zerar.${e}"`);
  });
  it('Dados no Hub: registros, cursor e erros por classe; Zerar dados só em Estoque e Títulos (sem lote); um botão por entidade', async () => {
    const html = await montar();
    expect(html).toMatch(/integracao\.monitor\.entidade\.produto.*820 ativos · 40 inativos.*12 a reprocessar · 3 a corrigir no ERP \(campo_obrigatorio\)/);
    expect(html).toContain('data-testid="integracao.entidade.zerar.estoque"');
    expect(html).toContain('data-testid="integracao.entidade.zerar.titulo"');
    for (const e of ['produto', 'estoque', 'titulo', 'cliente']) expect(html.split(`data-testid="integracao.entidade.zerar.${e}"`).length).toBe(2);
    expect(html).not.toContain('integracao.entidade.zerar.filial');
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
