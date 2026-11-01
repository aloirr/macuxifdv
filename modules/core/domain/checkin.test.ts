import { describe, expect, it } from 'vitest';
import { aplicarPendentesVisita, avaliarCheckin, dataLocal, resolverCheckin, type VisitaLinha } from './checkin';

const MANAUS = 'America/Manaus'; // UTC-4
const SP = 'America/Sao_Paulo'; // UTC-3
const cliente = { lat: -3.1, lng: -60.0 };

describe('check-in dentro do raio (RN-CORE-10)', () => {
  it('RN-CORE-10: dentro do raio de 200 m não exige justificativa', () => {
    const r = avaliarCheckin({ cliente, posicao: { lat: -3.1005, lng: -60.0 }, raio_m: 200, justificativa: null });
    expect(r.fora_do_raio).toBe(false);
    expect(r.exige_justificativa).toBe(false);
    expect(r.pode).toBe(true);
    expect(r.distancia_m).toBeLessThan(200);
  });

  it('RN-CORE-10: fora do raio exige justificativa e fica sinalizado', () => {
    const r = avaliarCheckin({ cliente, posicao: { lat: -3.11, lng: -60.0 }, raio_m: 200, justificativa: null });
    expect(r.fora_do_raio).toBe(true);
    expect(r.exige_justificativa).toBe(true);
    expect(r.pode).toBe(false);
    expect(r.pendencias).toEqual(['justificativa']);
  });

  it('RN-CORE-10: fora do raio com justificativa (3+ caracteres) é aceito, ainda sinalizado', () => {
    const r = avaliarCheckin({ cliente, posicao: { lat: -3.11, lng: -60.0 }, raio_m: 200, justificativa: 'Cliente mudou de endereço' });
    expect(r.pode).toBe(true);
    expect(r.fora_do_raio).toBe(true);
  });

  it('RN-CORE-10: justificativa só com espaços não vale', () => {
    const r = avaliarCheckin({ cliente, posicao: { lat: -3.11, lng: -60.0 }, raio_m: 200, justificativa: '   ' });
    expect(r.pode).toBe(false);
  });

  it('RN-CORE-10: cliente sem coordenada sugere a coordenada ao BKO e não bloqueia', () => {
    const r = avaliarCheckin({ cliente: { lat: null, lng: null }, posicao: { lat: -3.1, lng: -60.0 }, raio_m: 200, justificativa: null });
    expect(r.sugere_coordenada).toBe(true);
    expect(r.fora_do_raio).toBe(false);
    expect(r.distancia_m).toBeNull();
    expect(r.pode).toBe(true);
  });

  it('RN-CORE-13: sem GPS o check-in é aceito e marcado sem_gps (sem rastreamento, sem bloqueio)', () => {
    const r = avaliarCheckin({ cliente, posicao: null, raio_m: 200, justificativa: null });
    expect(r.sem_gps).toBe(true);
    expect(r.pode).toBe(true);
    expect(r.fora_do_raio).toBe(false);
    expect(r.sugere_coordenada).toBe(false);
  });

  it('RN-CORE-10: o raio vem do parâmetro (500 m aceita o que 200 m recusa)', () => {
    const pos = { lat: -3.103, lng: -60.0 }; // ~333 m
    expect(avaliarCheckin({ cliente, posicao: pos, raio_m: 200, justificativa: null }).fora_do_raio).toBe(true);
    expect(avaliarCheckin({ cliente, posicao: pos, raio_m: 500, justificativa: null }).fora_do_raio).toBe(false);
  });
});

describe('data local (fuso do tenant)', () => {
  it('RN-CORE-11: 23h30 em Manaus ainda é o mesmo dia; em São Paulo já virou', () => {
    const t = new Date('2026-10-13T03:30:00Z');
    expect(dataLocal(t, MANAUS)).toBe('2026-10-12');
    expect(dataLocal(t, SP)).toBe('2026-10-13');
  });
});

describe('um atendimento aberto por vez (RN-CORE-11)', () => {
  const aberta = (id: string, cliente_id: string, checkin_em: string) => ({ id, cliente_id, checkin_em, checkout_em: null });

  it('RN-CORE-11: sem atendimento aberto, nada a fechar', () => {
    expect(resolverCheckin([], { cliente_id: 'c1' }, new Date('2026-10-12T15:00:00Z'), MANAUS)).toEqual({ fechar: [], reaproveitar: null });
  });

  it('RN-CORE-11: aberto em outro cliente no mesmo dia é fechado como auto na hora do novo check-in', () => {
    const agora = new Date('2026-10-12T15:00:00Z');
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { cliente_id: 'c2' }, agora, MANAUS);
    expect(r.fechar).toEqual([{ id: 'a', checkout_em: agora.toISOString(), resultado: 'nao_finalizado', fechada_por: 'auto', motivo: 'outro_cliente' }]);
    expect(r.reaproveitar).toBeNull();
  });

  it('RN-CORE-11: esquecido de ontem fecha na virada do dia no fuso do tenant (Manaus 04:00Z)', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T21:51:00Z')], { cliente_id: 'c1' }, new Date('2026-10-13T12:00:00Z'), MANAUS);
    expect(r.fechar).toEqual([{ id: 'a', checkout_em: '2026-10-13T04:00:00.000Z', resultado: 'nao_finalizado', fechada_por: 'auto', motivo: 'dia_virou' }]);
    expect(r.reaproveitar).toBeNull();
  });

  it('RN-CORE-11: a virada em São Paulo é 03:00Z', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T21:51:00Z')], { cliente_id: 'c2' }, new Date('2026-10-13T12:00:00Z'), SP);
    expect(r.fechar[0]?.checkout_em).toBe('2026-10-13T03:00:00.000Z');
  });

  it('RN-CORE-11: já em atendimento no mesmo cliente hoje reaproveita a visita aberta', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { cliente_id: 'c1' }, new Date('2026-10-12T15:00:00Z'), MANAUS);
    expect(r).toEqual({ fechar: [], reaproveitar: 'a' });
  });

  it('RN-CORE-11: duas abertas por dado antigo ficam só com a mais recente', () => {
    const r = resolverCheckin(
      [aberta('a', 'c1', '2026-10-12T12:00:00Z'), aberta('b', 'c2', '2026-10-12T13:00:00Z')],
      { cliente_id: 'c3' },
      new Date('2026-10-12T15:00:00Z'),
      MANAUS,
    );
    expect(r.fechar.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('RN-CORE-11: visita já fechada não conta como aberta', () => {
    const fechada = { id: 'a', cliente_id: 'c1', checkin_em: '2026-10-12T13:00:00Z', checkout_em: '2026-10-12T14:00:00Z' };
    expect(resolverCheckin([fechada], { cliente_id: 'c2' }, new Date('2026-10-12T15:00:00Z'), MANAUS).fechar).toEqual([]);
  });
});

describe('RN-CORE-11 no servidor (push atrasado e id novo)', () => {
  const aberta = (id: string, cliente_id: string, checkin_em: string) => ({ id, cliente_id, checkin_em, checkout_em: null });
  const auto = (id: string, checkout_em: string, motivo: 'outro_cliente' | 'dia_virou') => ({ id, checkout_em, resultado: 'nao_finalizado', fechada_por: 'auto', motivo });

  it('RN-CORE-11: mesmo cliente com id novo fecha a anterior como auto e aceita a nova (não reaproveita)', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { id: 'novo', cliente_id: 'c1', checkin_em: '2026-10-12T14:00:00Z' }, new Date('2026-10-12T15:00:00Z'), MANAUS);
    expect(r.reaproveitar).toBeNull();
    expect(r.fechar).toEqual([auto('a', '2026-10-12T14:00:00.000Z', 'outro_cliente')]);
  });

  it('RN-CORE-11: reenvio do mesmo id é idempotente (nada fecha)', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { id: 'a', cliente_id: 'c1', checkin_em: '2026-10-12T13:00:00Z' }, new Date('2026-10-12T15:00:00Z'), MANAUS);
    expect(r).toEqual({ fechar: [], reaproveitar: 'a' });
  });

  it('RN-CORE-11: push atrasado fecha a anterior no checkin_em do novo, não na chegada do lote', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { id: 'n', cliente_id: 'c2', checkin_em: '2026-10-12T14:30:00Z' }, new Date('2026-10-12T20:00:00Z'), MANAUS);
    expect(r.fechar[0]?.checkout_em).toBe('2026-10-12T14:30:00.000Z');
  });

  it('RN-CORE-11: novo com checkin_em antes da anterior não fecha antes do check-in dela', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T15:00:00Z')], { id: 'n', cliente_id: 'c2', checkin_em: '2026-10-12T14:00:00Z' }, new Date('2026-10-12T20:00:00Z'), MANAUS);
    expect(r.fechar[0]?.checkout_em).toBe('2026-10-12T15:00:00Z');
  });

  it('RN-CORE-11: lote chegando no dia seguinte usa o dia do check-in novo (Manaus)', () => {
    const r = resolverCheckin([aberta('a', 'c1', '2026-10-12T13:00:00Z')], { id: 'n', cliente_id: 'c2', checkin_em: '2026-10-12T22:00:00Z' }, new Date('2026-10-13T12:00:00Z'), MANAUS);
    expect(r.fechar).toEqual([auto('a', '2026-10-12T22:00:00.000Z', 'outro_cliente')]);
  });

  it('RN-CORE-11: o mesmo par de instantes cruza a virada em São Paulo (03:00Z) mas não em Manaus', () => {
    const entrada = [aberta('a', 'c1', '2026-10-12T02:30:00Z')];
    const novo = { id: 'n', cliente_id: 'c2', checkin_em: '2026-10-12T03:30:00Z' };
    const agora = new Date('2026-10-12T20:00:00Z');
    expect(resolverCheckin(entrada, novo, agora, MANAUS).fechar[0]?.motivo).toBe('outro_cliente');
    const sp = resolverCheckin(entrada, novo, agora, SP);
    expect(sp.fechar).toEqual([auto('a', '2026-10-12T03:00:00.000Z', 'dia_virou')]);
  });
});

describe('sobreposição da fila (ADR 0009 §3)', () => {
  const base: VisitaLinha = {
    id: 'v1',
    usuario_id: 'u1',
    cliente_id: 'c1',
    rota_parada_id: null,
    data_local: '2026-10-12',
    checkin_em: '2026-10-12T13:00:00Z',
    sem_gps: false,
    fora_do_raio: false,
    sugere_coordenada: false,
    extra: false,
    checkout_em: null,
    resultado: null,
    fechada_por: null,
  };

  it('check-in pendente que o pull ainda não trouxe aparece como visita aberta', () => {
    const r = aplicarPendentesVisita([], [{ tipo: 'checkin', id: 'v2', cliente_id: 'c2', checkin_em: '2026-10-12T14:00:00Z', extra: true }], { usuario_id: 'u1', fuso: MANAUS });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'v2', cliente_id: 'c2', usuario_id: 'u1', checkout_em: null, extra: true, data_local: '2026-10-12' });
  });

  it('checkout pendente fecha a visita mesmo que o pull a traga aberta (não reabre)', () => {
    const r = aplicarPendentesVisita([base], [{ tipo: 'checkout', visita_id: 'v1', checkout_em: '2026-10-12T14:00:00Z', resultado: 'pedido', pedido_id: 'p1' }], { usuario_id: 'u1', fuso: MANAUS });
    expect(r[0]).toMatchObject({ checkout_em: '2026-10-12T14:00:00Z', resultado: 'pedido', fechada_por: 'usuario', pedido_id: 'p1' });
  });

  it('check-in pendente já presente no pull não duplica', () => {
    const r = aplicarPendentesVisita([base], [{ tipo: 'checkin', id: 'v1', cliente_id: 'c1', checkin_em: base.checkin_em, extra: false }], { usuario_id: 'u1', fuso: MANAUS });
    expect(r).toHaveLength(1);
  });

  it('devolve o MESMO tipo das linhas (campos extras como distancia_m não se perdem)', () => {
    const comExtra = { ...base, distancia_m: 42 };
    const r = aplicarPendentesVisita([comExtra], [], { usuario_id: 'u1', fuso: MANAUS });
    expect(r[0]?.distancia_m).toBe(42);
  });

  it('RN-CORE-11: check-in pendente em outro cliente fecha a aberta anterior como auto (só uma aberta na tela)', () => {
    const r = aplicarPendentesVisita([base], [{ tipo: 'checkin', id: 'v2', cliente_id: 'c2', checkin_em: '2026-10-12T14:00:00Z' }], { usuario_id: 'u1', fuso: MANAUS });
    const abertas = r.filter((v) => !v.checkout_em);
    expect(abertas.map((v) => v.id)).toEqual(['v2']);
    expect(r.find((v) => v.id === 'v1')).toMatchObject({ resultado: 'nao_finalizado', fechada_por: 'auto', checkout_em: '2026-10-12T14:00:00.000Z' });
  });

  it('RN-CORE-11: checkout pendente da primeira visita vem antes do 2º check-in e não é tratado como auto', () => {
    const r = aplicarPendentesVisita<VisitaLinha>([], [
      { tipo: 'checkin', id: 'v1', cliente_id: 'c1', checkin_em: '2026-10-12T13:00:00Z' },
      { tipo: 'checkout', visita_id: 'v1', checkout_em: '2026-10-12T13:30:00Z', resultado: 'pedido', pedido_id: 'p1' },
      { tipo: 'checkin', id: 'v2', cliente_id: 'c2', checkin_em: '2026-10-12T14:00:00Z' },
    ], { usuario_id: 'u1', fuso: MANAUS });
    expect(r.find((v) => v.id === 'v1')).toMatchObject({ resultado: 'pedido', fechada_por: 'usuario' });
    expect(r.find((v) => v.id === 'v2')?.checkout_em).toBeNull();
  });

  it('ADR 0009 §3: checkout pendente cujo id já está em checkout_id da linha do servidor não é reaplicado', () => {
    const doServidor = { ...base, checkout_em: '2026-10-12T13:40:00Z', resultado: 'sem_pedido', fechada_por: 'usuario' as const, checkout_id: 'cmd-1' };
    const r = aplicarPendentesVisita([doServidor], [{ tipo: 'checkout', id: 'cmd-1', visita_id: 'v1', checkout_em: '2026-10-12T13:30:00Z', resultado: 'pedido' }], { usuario_id: 'u1', fuso: MANAUS });
    expect(r[0]).toMatchObject({ resultado: 'sem_pedido', checkout_em: '2026-10-12T13:40:00Z' });
  });

  it('sem pendentes devolve as linhas como vieram', () => {
    expect(aplicarPendentesVisita([base], [], { usuario_id: 'u1', fuso: MANAUS })).toEqual([base]);
  });
});
