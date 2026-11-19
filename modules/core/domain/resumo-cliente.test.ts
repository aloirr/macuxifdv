import { describe, expect, it } from 'vitest';
import { dadosCadastraisDoCliente, performanceDoCliente, rotuloCurva } from './resumo-cliente';

const HOJE = '2026-11-19';
const mes = (ano_mes: string, valor_cents: number, pedidos: number, itens = 1, ultima: string | null = null) => ({ ano_mes, valor_cents, pedidos, itens, ultima_compra_em: ultima });
const curvas = [
  { dimensao: 'faturamento' as const, curva: 'A' as const, rotulo: 'Faturamento A' },
  { dimensao: 'frequencia' as const, curva: 'A' as const, rotulo: 'Frequência A' },
  { dimensao: 'volume' as const, curva: 'B' as const, rotulo: 'Volume B' },
];
const visitas = { total: 46, ultima_data: '2026-11-12', ultimo_usuario_id: 'u1', ultimo_usuario_nome: 'Carla Lima' };

describe('T-0186 / R-20261119-0530: bloco Performance do Resumo', () => {
  it('RN-CORE-49: as curvas viram linhas "Curva Faturamento", "Curva Frequência" e "Curva Volume"', () => {
    expect(rotuloCurva('faturamento')).toBe('Curva Faturamento');
    expect(rotuloCurva('frequencia')).toBe('Curva Frequência');
    expect(rotuloCurva('volume')).toBe('Curva Volume');
    const p = performanceDoCliente({ historico: [], curvas, visitas, hoje: HOJE, comAcessoACompras: true, visitadaPor: null });
    expect(p.curvas.map((c) => [c.rotulo, c.curva])).toEqual([['Curva Faturamento', 'A'], ['Curva Frequência', 'A'], ['Curva Volume', 'B']]);
  });
  it('RN-CORE-40: 3 indicadores (compra média/mês, ticket médio e frequência), sem "Última compra"', () => {
    const p = performanceDoCliente({ historico: [mes('2026-11', 394_000, 2, 5, '2026-11-12'), mes('2026-10', 100_000, 1)], curvas: [], visitas, hoje: HOJE, comAcessoACompras: true, visitadaPor: null });
    expect(p.compras).toEqual({ compra_media_mes_cents: 41_167, ticket_medio_cents: 164_667, frequencia_media_dias: 16.3, sem_compras: false });
    expect(JSON.stringify(p)).not.toMatch(/ultima_compra/);
  });
  it('RN-CORE-40: sem compra na janela vira "sem compras em 12 meses", sem zeros; as visitas ficam', () => {
    const p = performanceDoCliente({ historico: [mes('2024-01', 1, 1)], curvas: [], visitas, hoje: HOJE, comAcessoACompras: true, visitadaPor: null });
    expect(p.compras).toEqual({ compra_media_mes_cents: 0, ticket_medio_cents: 0, frequencia_media_dias: null, sem_compras: true });
    expect(p.visitas_total).toBe(46);
  });
  it('P7: visitas e última visita entram no bloco; "Visitada por" só quando informada (Gestão)', () => {
    const p = performanceDoCliente({ historico: [], curvas: [], visitas, hoje: HOJE, comAcessoACompras: true, visitadaPor: 'Carla Lima' });
    expect(p).toMatchObject({ visitas_total: 46, ultima_visita_em: '2026-11-12', ultima_visita_por: 'Carla Lima' });
  });
  it('P12: promotor sem promotor_ve_pedidos: sem curvas e sem indicadores de compra; as visitas ficam', () => {
    const p = performanceDoCliente({ historico: [mes('2026-11', 1, 1)], curvas, visitas, hoje: HOJE, comAcessoACompras: false, visitadaPor: null });
    expect(p.curvas).toEqual([]);
    expect(p.compras).toBeNull();
    expect(p.visitas_total).toBe(46);
  });
});

describe('T-0186 / spec §3.1: dados cadastrais do Resumo', () => {
  it('Razão social, CNPJ, Filial, Segmento e Cliente desde (data civil do tenant)', () => {
    expect(dadosCadastraisDoCliente({ razao_social: 'Bom Preço Ltda', documento: '12345678000190', segmento: 'Supermercado', created_at: '2025-03-02T02:00:00.000Z' }, 'Matriz', 'America/Manaus')).toEqual({
      razao_social: 'Bom Preço Ltda',
      cnpj: '12345678000190',
      filial_nome: 'Matriz',
      segmento: 'Supermercado',
      cliente_desde: '2025-03-01',
    });
  });
});
