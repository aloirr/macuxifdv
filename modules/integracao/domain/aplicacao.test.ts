import { describe, expect, it } from 'vitest';
import type { Entidade } from '../contracts';
import { dependentesDe, ordenarFilaAplicacao, resumirCargaPorEntidade, type LoteNaFila } from './aplicacao';

const t0 = '2026-11-01T10:00:00.000Z';
const min = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
let n = 0;
const lote = (entidade: Entidade, extra: Partial<LoteNaFila> = {}): LoteNaFila => ({
  lote_id: `L${++n}`,
  conector_id: 'matriz-01',
  entidade,
  status: 'recebido',
  recebido_em: t0,
  parte: null,
  ...extra,
});

describe('RN-INT-04: aplicação do lote em ordem de dependência', () => {
  it('RN-INT-04: lotes recebidos fora de ordem são aplicados vendedor → cliente → rota/título/nota e produto → preço/estoque', () => {
    const fila = [lote('preco'), lote('rota'), lote('cliente'), lote('estoque'), lote('produto'), lote('vendedor'), lote('titulo'), lote('nota')];
    const r = ordenarFilaAplicacao(fila, t0);
    // só os que não esperam ninguém estão prontos agora
    expect(r.prontos.map((l) => l.entidade).sort()).toEqual(['produto', 'vendedor']);
    const espera = Object.fromEntries(r.aguardando.map((a) => [a.lote.entidade, a.esperaPor]));
    expect(espera.cliente).toEqual(['vendedor']);
    expect(espera.rota).toEqual(['vendedor', 'cliente']);
    expect(espera.preco).toEqual(['produto']);
    expect(espera.titulo).toEqual(['cliente']);
  });

  it('RN-INT-04: depois que a dependência conclui, o dependente fica pronto', () => {
    const fila = [lote('vendedor', { status: 'concluido' }), lote('cliente')];
    expect(ordenarFilaAplicacao(fila, t0).prontos.map((l) => l.entidade)).toEqual(['cliente']);
  });

  it('RN-INT-04: dependência em processando também segura o dependente (ela ainda pode criar o registro referenciado)', () => {
    const fila = [lote('vendedor', { status: 'processando' }), lote('cliente')];
    const r = ordenarFilaAplicacao(fila, t0);
    expect(r.prontos).toEqual([]);
    expect(r.aguardando[0]?.esperaPor).toEqual(['vendedor']);
  });

  it('RN-INT-04: dependência que falhou não segura ninguém (a linha vira referencia_ausente, reprocessável)', () => {
    const fila = [lote('vendedor', { status: 'falhou' }), lote('cliente')];
    expect(ordenarFilaAplicacao(fila, t0).prontos.map((l) => l.entidade)).toEqual(['cliente']);
  });

  it('RN-INT-04: espera máxima de 30 min — dependência travada não prende o dependente para sempre', () => {
    const fila = [lote('vendedor', { recebido_em: t0 }), lote('cliente', { recebido_em: t0 })];
    expect(ordenarFilaAplicacao(fila, min(t0, 29)).prontos.map((l) => l.entidade)).toEqual(['vendedor']);
    expect(ordenarFilaAplicacao(fila, min(t0, 31)).prontos.map((l) => l.entidade).sort()).toEqual(['cliente', 'vendedor']);
  });

  it('RN-INT-05: um lote por vez por (conector, entidade) — a fila segue a ordem de chegada e a parte', () => {
    const a = lote('cliente', { recebido_em: t0, parte: 2 });
    const b = lote('cliente', { recebido_em: min(t0, 1), parte: 1 });
    const r = ordenarFilaAplicacao([b, a], t0);
    expect(r.prontos.map((l) => l.lote_id)).toEqual([a.lote_id]);
    expect(r.aguardando.map((x) => x.lote.lote_id)).toEqual([b.lote_id]);
    expect(r.aguardando[0]?.motivo).toBe('mesma_entidade_em_andamento');
  });

  it('RN-INT-05: se já há um lote processando da mesma entidade e conector, o próximo espera', () => {
    const r = ordenarFilaAplicacao([lote('cliente', { status: 'processando' }), lote('cliente')], t0);
    expect(r.prontos).toEqual([]);
  });

  it('RN-INT-05: conectores diferentes aplicam em paralelo', () => {
    const r = ordenarFilaAplicacao([lote('cliente', { conector_id: 'a' }), lote('cliente', { conector_id: 'b' })], t0);
    expect(r.prontos).toHaveLength(2);
  });

  it('RN-INT-04: ignora lotes que não estão recebidos (concluídos etc. não voltam à fila)', () => {
    const r = ordenarFilaAplicacao([lote('cliente', { status: 'concluido' }), lote('produto', { status: 'falhou' })], t0);
    expect(r.prontos).toEqual([]);
    expect(r.aguardando).toEqual([]);
  });

  it('RN-INT-04: pronto sai na ordem topológica da entidade, depois por chegada', () => {
    const r = ordenarFilaAplicacao([lote('produto', { recebido_em: min(t0, 2) }), lote('vendedor', { recebido_em: min(t0, 1) }), lote('produto', { conector_id: 'b', recebido_em: t0 })], t0);
    expect(r.prontos.map((l) => `${l.entidade}/${l.conector_id}`)).toEqual(['vendedor/matriz-01', 'produto/b', 'produto/matriz-01']);
  });
});

describe('RN-INT-04: reprocessar quem dependia de uma entidade', () => {
  it('RN-INT-04: quando vendedor conclui, reprocessam-se as linhas referencia_ausente de cliente, rota e nota; produto, de preço e estoque', () => {
    expect(dependentesDe('vendedor').sort()).toEqual(['cliente', 'nota', 'rota']);
    expect(dependentesDe('cliente').sort()).toEqual(['cliente_endereco', 'nota', 'rota', 'titulo']);
    expect(dependentesDe('produto').sort()).toEqual(['estoque', 'preco', 'produto_unidade', 'tabela_escalonada']);
    expect(dependentesDe('rota')).toEqual([]);
  });
});

describe('RN-INT-04/06: resultado da carga por entidade (monitor)', () => {
  const c = (extra = {}) => ({ recebidas: 10, com_erro: 0, novas: 10, atualizadas: 0, inalteradas: 0, ...extra });

  it('RN-INT-04: devolve as 15 entidades (8 originais + 4 da T-0061 + 3 da T-0089) na ordem de dependência, com estado e quem ainda está pendente', () => {
    const r = resumirCargaPorEntidade([
      { entidade: 'vendedor', status: 'concluido', contagens: c() },
      { entidade: 'cliente', status: 'processando', contagens: c({ recebidas: 0 }) },
      { entidade: 'rota', status: 'recebido', contagens: c({ recebidas: 0 }) },
    ]);
    expect(r).toHaveLength(15);
    const por = Object.fromEntries(r.map((x) => [x.entidade, x]));
    expect(por.vendedor).toMatchObject({ estado: 'concluida', lotes: 1, recebidas: 10 });
    expect(por.cliente?.estado).toBe('em_andamento');
    expect(por.rota).toMatchObject({ estado: 'pendente', aguardando: ['cliente'] });
    expect(por.titulo).toMatchObject({ estado: 'sem_lotes', lotes: 0 });
    expect(r.findIndex((x) => x.entidade === 'vendedor')).toBeLessThan(r.findIndex((x) => x.entidade === 'cliente'));
    expect(r.findIndex((x) => x.entidade === 'cliente')).toBeLessThan(r.findIndex((x) => x.entidade === 'rota'));
  });

  it('RN-INT-03: concluida_com_erros quando algum lote teve erro por linha; falhou só quando todos os lotes falharam', () => {
    const comErro = resumirCargaPorEntidade([
      { entidade: 'preco', status: 'concluido', contagens: c() },
      { entidade: 'preco', status: 'concluido_com_erros', contagens: c({ com_erro: 3, novas: 7 }) },
    ]).find((x) => x.entidade === 'preco');
    expect(comErro).toMatchObject({ estado: 'concluida_com_erros', lotes: 2, com_erro: 3, recebidas: 20 });
    const todosFalharam = resumirCargaPorEntidade([{ entidade: 'preco', status: 'falhou', contagens: c({ com_erro: 10, novas: 0 }) }]).find((x) => x.entidade === 'preco');
    expect(todosFalharam?.estado).toBe('falhou');
    const misto = resumirCargaPorEntidade([
      { entidade: 'preco', status: 'falhou', contagens: c({ com_erro: 10, novas: 0 }) },
      { entidade: 'preco', status: 'concluido', contagens: c() },
    ]).find((x) => x.entidade === 'preco');
    expect(misto?.estado).toBe('concluida_com_erros');
  });
});
