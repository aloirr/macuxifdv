import { describe, expect, it } from 'vitest';
import type { LoteListagemItem } from '../../contracts';
import {
  agruparPorEntidade,
  cabecalhoDoMonitor,
  falhouEm,
  horaDaFalha,
  textoLinhas,
  textoUltimaCarga,
} from './entidades';

let n = 0;
function lote(p: Partial<LoteListagemItem>): LoteListagemItem {
  n += 1;
  return {
    lote_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    conector_id: 'erp-matriz',
    entidade: 'cliente',
    modo: 'delta',
    status: 'concluido',
    recebidas: 10,
    com_erro: 0,
    novas: 0,
    atualizadas: 0,
    inalteradas: 10,
    obsoletas: 0,
    inativadas: 0,
    recebido_em: '2026-11-15T05:01:00.000Z',
    concluido_em: '2026-11-15T05:02:00.000Z',
    ...p,
  };
}

describe('Monitor da Integração ERP: uma linha por entidade (RF-INT-04, RN-INT-15)', () => {
  it('RF-INT-04: agrupa os lotes da mesma entidade numa linha só', () => {
    const linhas = agruparPorEntidade([
      lote({ entidade: 'cliente' }),
      lote({ entidade: 'estoque' }),
      lote({ entidade: 'cliente' }),
    ]);
    expect(linhas.map((l) => [l.entidade, l.lotes.length])).toEqual([
      ['cliente', 2],
      ['estoque', 1],
    ]);
  });

  it('RN-INT-15: Com falha só quando há lote reprocessável (falhou ou concluído com erros); cancelado e em andamento não contam', () => {
    const [a] = agruparPorEntidade([
      lote({ status: 'concluido' }),
      lote({ status: 'cancelado' }),
      lote({ status: 'processando' }),
    ]);
    expect(a?.comFalha).toBe(false);
    expect(a?.reprocessaveis).toEqual([]);
    const [b] = agruparPorEntidade([
      lote({ status: 'concluido' }),
      lote({ status: 'falhou' }),
      lote({ status: 'concluido_com_erros' }),
    ]);
    expect(b?.comFalha).toBe(true);
    expect(b?.reprocessaveis).toHaveLength(2);
  });

  it('RF-INT-04: linhas com falha vêm primeiro; depois a carga mais recente', () => {
    const linhas = agruparPorEntidade([
      lote({ entidade: 'preco', recebido_em: '2026-11-15T09:00:00.000Z' }),
      lote({ entidade: 'estoque', recebido_em: '2026-11-15T08:00:00.000Z' }),
      lote({ entidade: 'cliente', status: 'falhou', recebido_em: '2026-11-14T08:00:00.000Z' }),
    ]);
    expect(linhas.map((l) => l.entidade)).toEqual(['cliente', 'preco', 'estoque']);
  });

  it('RN-INT-15: linhas integradas são as do lote mais recente; lote que falhou não integrou nada; em andamento e cancelado ficam sem número', () => {
    expect(textoLinhas('concluido_com_erros', 100, 5)).toBe('95 de 100');
    expect(textoLinhas('falhou', 3695, 0)).toBe('0 de 3.695');
    expect(textoLinhas('processando', 40, 0)).toBe('');
    expect(textoLinhas('recebido', 40, 0)).toBe('');
    expect(textoLinhas('cancelado', 3695, 0)).toBe('');
  });

  it('RF-INT-04: hora da falha só com hora; se o dia no fuso do tenant é outro, leva a data', () => {
    const tz = 'America/Manaus';
    expect(horaDaFalha('2026-11-15T05:03:00.000Z', '2026-11-15T05:02:00.000Z', tz)).toBe('01:03');
    expect(horaDaFalha('2026-11-16T05:03:00.000Z', '2026-11-15T05:02:00.000Z', tz)).toBe('16/11 01:03');
    expect(horaDaFalha('2026-11-15T03:30:00.000Z', '2026-11-15T05:02:00.000Z', tz)).toBe('14/11 23:30');
  });

  it('RF-INT-04: última carga é o recebimento mais recente; a hora da falha é a do lote mais recente, e só se ele falhou', () => {
    const [l] = agruparPorEntidade([
      lote({
        status: 'falhou',
        recebido_em: '2026-11-15T05:00:00.000Z',
        concluido_em: '2026-11-15T05:03:00.000Z',
      }),
      lote({
        status: 'falhou',
        recebido_em: '2026-11-15T05:01:00.000Z',
        concluido_em: '2026-11-15T05:04:00.000Z',
      }),
    ]);
    expect(l?.ultimaCargaEm).toBe('2026-11-15T05:01:00.000Z');
    expect(l?.falhaEm).toBe('2026-11-15T05:04:00.000Z');
    const [sarou] = agruparPorEntidade([
      lote({ status: 'falhou', recebido_em: '2026-11-15T05:00:00.000Z' }),
      lote({ status: 'concluido', recebido_em: '2026-11-15T05:10:00.000Z' }),
    ]);
    expect(sarou?.falhaEm).toBeNull();
    expect(textoUltimaCarga(sarou!, 'America/Manaus')).toBe('15/11 às 01:10 · 2 lotes');
  });

  it('RF-INT-04: texto da última carga mostra a data uma vez, com a hora da falha e a quantidade de lotes (fuso do tenant)', () => {
    const tz = 'America/Manaus';
    const [falhou] = agruparPorEntidade([
      lote({
        status: 'falhou',
        recebido_em: '2026-11-15T05:02:00.000Z',
        concluido_em: '2026-11-15T05:03:00.000Z',
      }),
    ]);
    expect(textoUltimaCarga(falhou!, tz)).toBe('15/11 às 01:02 · falhou 01:03');
    const [varios] = agruparPorEntidade([
      lote({ recebido_em: '2026-11-15T05:02:00.000Z' }),
      lote({ recebido_em: '2026-11-15T05:00:00.000Z' }),
      lote({ recebido_em: '2026-11-15T04:00:00.000Z' }),
    ]);
    expect(textoUltimaCarga(varios!, tz)).toBe('15/11 às 01:02 · 3 lotes');
  });

  it('RF-INT-04: cabeçalho traz conector, versão e a última carga recebida; sem lotes, não inventa nada', () => {
    const lotes = [
      lote({ conector_id: 'erp-a', recebido_em: '2026-11-15T05:02:00.000Z' }),
      lote({ conector_id: 'erp-b', recebido_em: '2026-11-14T05:02:00.000Z' }),
    ];
    expect(
      cabecalhoDoMonitor(lotes, [{ conector_id: 'erp-a', versao_conector: '1.4.2' }], 'America/Manaus'),
    ).toBe('erp-a · v1.4.2 · última carga recebida 15/11 às 01:02');
    expect(cabecalhoDoMonitor(lotes, [], 'America/Manaus')).toBe(
      'erp-a · última carga recebida 15/11 às 01:02',
    );
    expect(cabecalhoDoMonitor([], [], 'America/Manaus')).toBe('');
  });
});

describe('falhouEm', () => {
  it('RN-INT-15: lote que falhou devolve a conclusão, ou o recebimento sem ela; os outros, nulo', () => {
    expect(falhouEm(lote({ status: 'falhou', concluido_em: '2026-11-15T05:03:00.000Z' }))).toBe(
      '2026-11-15T05:03:00.000Z',
    );
    expect(falhouEm(lote({ status: 'falhou', concluido_em: null }))).toBe('2026-11-15T05:01:00.000Z');
    expect(falhouEm(lote({ status: 'concluido' }))).toBeNull();
  });
});
