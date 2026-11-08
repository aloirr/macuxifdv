import { describe, expect, it } from 'vitest';
import { avisoEtapaPendenteDaEquipe, primeiroNome, visitaDaEquipeComEtapaPendente, type VisitaDaEquipe } from './etapa-pendente-equipe';

const CLI = '11111111-1111-4111-8111-111111111111';
const OUTRO_CLI = '33333333-3333-4333-8333-333333333333';
const SUP = '44444444-4444-4444-8444-444444444444';
const RAFAEL = '55555555-5555-4555-8555-555555555555';
const ANA = '66666666-6666-4666-8666-666666666666';
const NOMES = new Map([
  [RAFAEL, 'Rafael Souza Lima'],
  [ANA, 'Ana Paula'],
  [SUP, 'Carla Supervisora'],
]);

const v = (o: Partial<VisitaDaEquipe> = {}): VisitaDaEquipe => ({
  id: '22222222-2222-4222-8222-222222222222',
  usuario_id: RAFAEL,
  cliente_id: CLI,
  updated_at: '2026-11-04T12:30:00.000Z',
  data_local: '2026-11-04',
  checkin_em: '2026-11-04T12:02:00.000Z',
  deleted_at: null,
  etapas_pendentes: 1,
  ...o,
});
const base = { clienteId: CLI, perfil: 'supervisor', usuarioId: SUP, nomes: NOMES };

describe('aviso da etapa pendente na ficha do cliente do Gestão (T-0102, checkout-pendencia.md §2.2)', () => {
  it('RN-CORE-12: 1 etapa → texto do §2.2 com o primeiro nome e a data dd/mm', () => {
    expect(avisoEtapaPendenteDaEquipe([v()], base)).toEqual({
      linha1: 'Uma etapa da visita de Rafael em 04/11 ainda não chegou ao Macuxi',
      linha2: 'Peça a Rafael para abrir a fila do aparelho e sincronizar',
      visita_id: '22222222-2222-4222-8222-222222222222',
      usuario_id: RAFAEL,
      etapas: 1,
    });
  });

  it('RN-CORE-12: N etapas → plural ("2 etapas … ainda não chegaram …"); sem ponto final', () => {
    const a = avisoEtapaPendenteDaEquipe([v({ etapas_pendentes: 2 })], base);
    expect(a?.linha1).toBe('2 etapas da visita de Rafael em 04/11 ainda não chegaram ao Macuxi');
    expect(a?.linha1.endsWith('.')).toBe(false);
    expect(a?.linha2.endsWith('.')).toBe(false);
  });

  it('a pendência some sem festa: etapas_pendentes 0 ou ausente → sem aviso', () => {
    expect(avisoEtapaPendenteDaEquipe([v({ etapas_pendentes: 0 })], base)).toBeNull();
    expect(avisoEtapaPendenteDaEquipe([v({ etapas_pendentes: undefined })], base)).toBeNull();
    expect(avisoEtapaPendenteDaEquipe([], base)).toBeNull();
  });

  it('só o cliente da ficha; visita removida (deleted_at) não conta', () => {
    expect(avisoEtapaPendenteDaEquipe([v({ cliente_id: OUTRO_CLI })], base)).toBeNull();
    expect(avisoEtapaPendenteDaEquipe([v({ deleted_at: '2026-11-05T10:00:00.000Z' })], base)).toBeNull();
  });

  it('RN-CORE-04: só supervisor e gerente; vendedor, promotor, analista, admin e sem perfil não veem', () => {
    for (const perfil of ['vendedor', 'promotor', 'analista', 'admin', null, undefined]) expect(avisoEtapaPendenteDaEquipe([v()], { ...base, perfil })).toBeNull();
    expect(avisoEtapaPendenteDaEquipe([v()], { ...base, perfil: 'gerente' })).not.toBeNull();
  });

  it('a visita do próprio usuário fica com o Banner do Core (§1.2): não duplica nem usa o texto do supervisor', () => {
    expect(avisoEtapaPendenteDaEquipe([v({ usuario_id: SUP })], base)).toBeNull();
    // a do próprio usuário é mais recente, mas o aviso do Gestão mostra a da equipe
    const lista = [v({ id: 'minha', usuario_id: SUP, checkin_em: '2026-11-06T12:00:00.000Z', data_local: '2026-11-06' }), v({ id: 'rafael' })];
    expect(avisoEtapaPendenteDaEquipe(lista, base)?.visita_id).toBe('rafael');
  });

  it('mais recente ENTRE as pendentes: visita nova sem pendência não esconde a anterior; entre duas pendentes vale a mais nova', () => {
    const lista = [
      v({ id: 'antiga', checkin_em: '2026-11-03T12:00:00.000Z', data_local: '2026-11-03' }),
      v({ id: 'pendente-ana', usuario_id: ANA, checkin_em: '2026-11-04T15:00:00.000Z', data_local: '2026-11-04', etapas_pendentes: 1 }),
      v({ id: 'nova-sem', checkin_em: '2026-11-05T12:00:00.000Z', data_local: '2026-11-05', etapas_pendentes: 0 }),
    ];
    const a = avisoEtapaPendenteDaEquipe(lista, base);
    expect(a?.visita_id).toBe('pendente-ana');
    expect(a?.linha1).toBe('Uma etapa da visita de Ana em 04/11 ainda não chegou ao Macuxi');
    expect(a?.linha2).toBe('Peça a Ana para abrir a fila do aparelho e sincronizar');
  });

  it('checkin_em é comparado como data, não como texto (formato com deslocamento)', () => {
    const lista = [v({ id: 'a', checkin_em: '2026-11-04T10:00:00-04:00' }), v({ id: 'b', checkin_em: '2026-11-04T13:30:00.000Z' })];
    expect(visitaDaEquipeComEtapaPendente(lista, { clienteId: CLI, usuarioId: SUP })?.id).toBe('a');
  });

  it('a data vem do data_local da visita (dia civil no fuso do tenant), sem converter o check-in', () => {
    // check-in 02:30 UTC = 22:30 do dia 03 em Boa Vista (UTC-4): o Core grava data_local 2026-11-03
    expect(avisoEtapaPendenteDaEquipe([v({ checkin_em: '2026-11-04T02:30:00.000Z', data_local: '2026-11-03' })], base)?.linha1).toContain('em 03/11');
  });

  it('sem o nome na visão do Gestor: texto neutro, sem nome e sem quebrar', () => {
    const a = avisoEtapaPendenteDaEquipe([v({ usuario_id: '77777777-7777-4777-8777-777777777777' })], base);
    expect(a?.linha1).toBe('Uma etapa da visita de 04/11 ainda não chegou ao Macuxi');
    expect(a?.linha2).toBe('Peça a quem fez a visita para abrir a fila do aparelho e sincronizar');
  });

  it('sem usuário identificado ainda, mostra as visitas da equipe que chegaram', () => {
    expect(avisoEtapaPendenteDaEquipe([v()], { ...base, usuarioId: null })?.visita_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('primeiroNome: primeiro termo, sem espaços; vazio → null', () => {
    expect(primeiroNome('  Rafael  Souza ')).toBe('Rafael');
    expect(primeiroNome('Ana')).toBe('Ana');
    expect(primeiroNome('   ')).toBeNull();
    expect(primeiroNome(undefined)).toBeNull();
  });
});
