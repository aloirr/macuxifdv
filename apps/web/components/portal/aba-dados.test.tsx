/**
 * Aba "Dados" do portal (R-20261124-090510; desenho empresa-zerar.md §6.4), renderizada com `react-dom/server` e o cache do React
 * Query semeado com o detalhe do monitor falso: uma tabela só, uma linha por entidade, com Situação, Última carga, Registros, Última
 * alteração e Corrigir no ERP, e o "⋯" (Reprocessar e Zerar dados) em toda entidade com o que fazer. Os itens do "⋯" só existem com
 * o menu aberto: aqui se confere o botão do menu; o e2e abre e escolhe.
 */
import { MonitorDetalhes, MonitorResumo } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { responderMonitorFalso } from '@/lib/portal-falso-monitor';
import { escopoDoPortal } from '@/lib/portal-monitor';

import { AbaDados } from './aba-dados';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const empresa = { id: T, codigo: 'AM2290', razao_social: 'Mercantil Rio Branco Ltda', fuso: 'America/Manaus' };
const resposta = async (caminho: string) => (await responderMonitorFalso('GET', caminho, T, true)).json();

async function montar(): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  qc.setQueryData(['integracao', escopoDoPortal(T), 'monitor', 'detalhes'], MonitorDetalhes.parse(await resposta('/integracao/monitor/detalhes')));
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <AbaDados empresa={empresa} />
    </QueryClientProvider>,
  );
}

const linha = (html: string, e: string) => html.split(`data-testid="dados.entidade.${e}"`)[1]!.split('</tr>')[0]!;

describe('aba Dados', () => {
  it('uma tabela só por entidade: colunas da carga e do Hub juntas, sem os quadros antigos nem o Conector', async () => {
    const html = await montar();
    expect(html.split('data-testid="dados.entidades"').length).toBe(2);
    const cab = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
    expect(cab).toEqual(['Entidade', 'Situação', 'Última carga', 'Registros', 'Última alteração', 'Corrigir no ERP']);
    for (const fora of ['Cargas recentes', 'Dados no Hub', 'Linhas integradas', 'Identificador', 'integracao.monitor']) expect(html).not.toContain(fora);
  });
  it('Produtos com falha: selo "Com falha", registros e "Corrigir no ERP" na mesma linha', async () => {
    const html = await montar();
    expect(linha(html, 'produto')).toMatch(/Com falha.*820 ativos · 40 inativos.*3 · campo_obrigatorio/);
    expect(linha(html, 'cliente')).toContain('Em dia');
  });
  it('"⋯" em toda entidade com lote a reprocessar ou dados no Hub, e em nenhuma sem', async () => {
    const html = await montar();
    for (const e of ['produto', 'cliente', 'cliente_endereco', 'preco', 'vendedor', 'estoque', 'titulo']) expect(html.split(`data-testid="dados.entidades.acoes.${e}"`).length).toBe(2);
    expect(html).not.toContain('dados.entidades.acoes.filial');
  });
  it('linha sem dados no Hub (RD-2678): selo neutro "Sem dados" na Situação, Registros vazio e sem "—"', async () => {
    const filial = linha(await montar(), 'filial');
    expect(filial).toContain('Sem dados');
    expect(filial).not.toContain('—');
    expect(filial).not.toContain('Em dia');
  });
  it('modo falso: a última alteração no ERP nunca passa da última carga da entidade', async () => {
    const resumo = MonitorResumo.parse(await resposta('/integracao/monitor'));
    const det = MonitorDetalhes.parse(await resposta('/integracao/monitor/detalhes'));
    for (const c of resumo.ultima_carga_por_entidade) {
      const alteracoes = det.entidades.find((x) => x.entidade === c.entidade)?.cursores.map((x) => x.alterado_em!) ?? [];
      for (const a of alteracoes) expect(Date.parse(a)).toBeLessThanOrEqual(Date.parse(c.recebido_em));
    }
    expect(resumo.ultima_carga_por_entidade.map((c) => c.entidade)).toContain('vendedor');
  });
});
