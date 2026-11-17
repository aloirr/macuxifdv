import { describe, expect, it } from 'vitest';
import type { Entidade } from '../contracts';
import { dependentesDe, ordenarFilaAplicacao, type LoteNaFila } from './aplicacao';

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
