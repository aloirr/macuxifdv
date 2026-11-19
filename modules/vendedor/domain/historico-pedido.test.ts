import { describe, expect, it } from 'vitest';
import { tagsPorMotivoPendente } from './historico-pedido';

describe('Histórico do pedido em aprovação: uma etapa por motivo (T-0184, P3 B, prancha 02)', () => {
  const tag = (rotulo: string, extra = '') => ({ id: `t-${rotulo}`, rotulo, quando: '18/11 10:00', texto: `${rotulo} · 18/11 10:00${extra}`, leitura: `${rotulo}, 18 de novembro às 10:00`, tom: 'destaque' });
  it('P3 B: a etapa Em aprovação vira uma por motivo pendente, com o nome curto do motivo, e as outras tags ficam', () => {
    const r = tagsPorMotivoPendente([tag('Recebido'), tag('Em aprovação')], ['credito', 'inadimplencia']);
    expect(r.map((t) => t.texto)).toEqual(['Recebido · 18/11 10:00', 'Em aprovação · Crédito', 'Em aprovação · Inadimplente']);
    expect(new Set(r.map((t) => t.id)).size).toBe(3);
  });
  it('P3 B: cada motivo já aprovado vira "Aprovado · motivo · nome · data" (sucesso) antes da etapa pendente; a pendente continua sem data', () => {
    const r = tagsPorMotivoPendente([tag('Em aprovação')], ['credito'], [{ motivo: 'inadimplencia', por: 'Rui Matos', quando: '18/11 10:05' }]);
    expect(r.map((t) => t.texto)).toEqual(['Aprovado · Inadimplente · Rui Matos · 18/11 10:05', 'Em aprovação · Crédito']);
    expect(r[0]?.tom).toBe('sucesso');
    expect(r[0]?.leitura).toBe('Aprovado, Inadimplente, por Rui Matos, 18/11 10:05');
  });
  it('P3 B: aprovado sem nome ou sem data mostra só o que há', () => {
    const r = tagsPorMotivoPendente([tag('Em aprovação')], ['credito'], [{ motivo: 'desconto', por: null, quando: '18/11 10:05' }, { motivo: 'inadimplencia' }]);
    expect(r.map((t) => t.texto)).toEqual(['Aprovado · Desconto · 18/11 10:05', 'Aprovado · Inadimplente', 'Em aprovação · Crédito']);
  });
  it('sem motivos ou sem a etapa Em aprovação nada muda', () => {
    const tags = [tag('Recebido'), tag('Em aprovação')];
    expect(tagsPorMotivoPendente(tags, [])).toEqual(tags);
    expect(tagsPorMotivoPendente([tag('Aprovado')], ['credito'])).toHaveLength(1);
  });
});
