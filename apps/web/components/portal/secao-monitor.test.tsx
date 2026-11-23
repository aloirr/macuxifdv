/**
 * Seção "Monitor" da aba Integração no portal (desenho empresa-zerar.md §6.4), renderizada com `react-dom/server` e o cache do
 * React Query semeado com as respostas do monitor falso: Conector, "Cargas recentes" (painel do módulo, Reprocessar e Histórico no
 * "⋯") e "Dados no Hub" com o "Zerar dados" no "⋯" de toda entidade com dados (o único lugar dele). Fora do time da Macuxi a seção
 * não aparece. Os itens do "⋯" só existem com o menu aberto: aqui se confere o botão do menu; o e2e abre e escolhe.
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
  it('Conector com saúde, versão e fila; "Cargas recentes" com o "⋯" do painel e nenhum "Zerar dados" nele', async () => {
    const html = await montar();
    expect(html).toContain('>Monitor</h2>');
    expect(html).toMatch(/integracao\.monitor\.conector\.erp.*Em dia.*1\.4\.0.*2 lotes · 380 linhas/);
    expect(html).toContain('>Cargas recentes<');
    for (const e of ['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor']) expect(html).toContain(`data-testid="integracao.entidades.acoes.${e}"`);
    expect(html).not.toContain('integracao.entidade.zerar.');
  });
  it('Dados no Hub: registros, cursor e "Corrigir no ERP"; o "⋯" (Zerar dados) em toda entidade com dados e em nenhuma sem', async () => {
    const html = await montar();
    expect(html).toContain('>Corrigir no ERP<');
    expect(html).not.toContain('a reprocessar');
    expect(html).toMatch(/integracao\.monitor\.entidade\.produto.*820 ativos · 40 inativos.*3 · campo_obrigatorio/);
    for (const e of ['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor', 'estoque', 'titulo'])
      expect(html.split(`data-testid="integracao.monitor.entidades.acoes.${e}"`).length).toBe(2);
    expect(html).not.toContain('integracao.monitor.entidades.acoes.filial');
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
