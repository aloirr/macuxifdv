/**
 * T-0046 (revisão da T-0014, itens 🔴 2 e 3): eventos do Core lidos pelos schemas OFICIAIS do Core.
 *  - `core.visita.checkout@1`: `fechada_por` / `permanencia_s` (RN-CORE-11) e precedência usuario > auto;
 *  - `core.cliente.atualizado@1`: sem `vendedor_id` (o Core ainda não publica a carteira) ⇒ carteira PENDENTE com aviso.
 * Relógio injetado (`AGORA`); instantes fixos só como dado de entrada.
 */
import { describe, expect, it } from 'vitest';
import type { MembroEquipe } from '../contracts';
import { avaliarAlertas, resolverRegras } from './alertas';
import { CLIENTE_A, CLIENTE_B, checkin, checkout, ev, PROMOTOR, u, VENDEDOR, VENDEDOR_2 } from './fixtures';
import { visitasDoPeriodo } from './painel';
import { aplicarEvento, aplicarEventos, carteiraPendente, estadoInicial, situacaoDaCarteira, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const vend = { id: VENDEDOR, perfil: 'vendedor' } as const;
const DIA = '2026-10-30';

describe('RN-CORE-11: core.visita.checkout@1 oficial (fechada_por, permanencia_s)', () => {
  const ini = checkin({ visita: u(2500), em: '2026-10-30T13:00:00Z' });
  const usuario = checkout({ visita: u(2500), em: '2026-10-30T13:25:00Z' }); // 25 min
  // o servidor fecha na virada do dia, DEPOIS do checkout real (ocorrido_em maior)
  const auto = checkout({ visita: u(2500), em: '2026-10-31T04:00:00Z', fechada_por: 'auto' });

  it('visita fechada pelo servidor (auto) não entra no tempo em cliente', () => {
    expect(visitasDoPeriodo(montar([ini, auto]), vend, DIA, DIA)).toMatchObject({ realizadas: 1, tempo_total_min: 0, tempo_medio_min: null, em_andamento: 0 });
  });

  it('o tempo em cliente vem do permanencia_s do Core', () => {
    const outro = checkout({ visita: u(2500), em: '2026-10-30T13:25:00Z' });
    (outro.payload as { permanencia_s: number }).permanencia_s = 18 * 60; // o Core descontou uma pausa
    expect(visitasDoPeriodo(montar([ini, outro]), vend, DIA, DIA).tempo_total_min).toBe(18);
  });

  it('usuario → auto: o auto que chega depois (ocorrido_em maior) NÃO substitui o checkout do usuário', () => {
    const s = montar([ini, usuario, auto]);
    expect(s.visitas[u(2500)]!.checkout).toMatchObject({ fechada_por: 'usuario', checkout_em: '2026-10-30T13:25:00Z' });
    expect(visitasDoPeriodo(s, vend, DIA, DIA).tempo_total_min).toBe(25);
  });

  it('auto → usuario: o checkout do usuário substitui o auto mesmo com ocorrido_em anterior (sync atrasado)', () => {
    const s = montar([ini, auto, usuario]);
    expect(s.visitas[u(2500)]!.checkout?.fechada_por).toBe('usuario');
    expect(visitasDoPeriodo(s, vend, DIA, DIA).tempo_total_min).toBe(25);
    expect(montar([ini, auto, usuario])).toEqual(montar([ini, usuario, auto]));
  });

  it('entre dois checkouts do mesmo tipo vence o carimbo maior', () => {
    const corrigido = checkout({ visita: u(2500), em: '2026-10-30T13:40:00Z', ocorrido_em: '2026-10-30T13:41:00Z' });
    expect(montar([ini, corrigido, usuario]).visitas[u(2500)]!.checkout?.checkout_em).toBe('2026-10-30T13:40:00Z');
  });

  it('checkout sem fechada_por (formato antigo `encerramento`) é inválido', () => {
    const { fechada_por: _f, ...antigo } = usuario.payload as Record<string, unknown>;
    expect(aplicarEvento(estadoInicial(), { ...usuario, payload: { ...antigo, encerramento: 'normal' } }).situacao).toBe('invalido');
  });
});

describe('T-0046 / RN-GES-01/02: core.cliente.atualizado@1 sem carteira ⇒ aviso de carteira incompleta', () => {
  const AGORA = '2026-10-30T20:00:00Z';
  const MEMBROS: MembroEquipe[] = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true }];
  /** Como o Core publica HOJE (modules/core/api/rotas.ts): sem dados de carteira. */
  const publicado = (cliente: string, em: string, campos = ['latitude', 'longitude']) => ev('core.cliente.atualizado@1', em, { cliente_id: cliente, campos, origem: 'bko' });
  const comCarteira = (cliente: string, em: string, vendedor: string | null = VENDEDOR) =>
    ev('core.cliente.atualizado@1', em, { cliente_id: cliente, campos: ['vendedor_id'], origem: 'erp', vendedor_id: vendedor, ativo: true });
  const semVisita = (estado: ReturnType<typeof montar>) =>
    avaliarAlertas({ estado, membros: MEMBROS, agora: AGORA, modulos: new Set(['core']), regras: resolverRegras() }).filter((c) => c.tipo === 'cliente_sem_visita');

  it('evento real do Core (sem vendedor_id) é aplicado com aviso, e a carteira fica pendente — não vazia em silêncio', () => {
    const r = aplicarEvento(estadoInicial(), publicado(CLIENTE_A, '2026-09-01T10:00:00Z'));
    expect(r.situacao).toBe('aplicado');
    expect(r.aviso).toMatch(/^Carteira incompleta: .*sem vendedor_id/);
    expect(r.aviso).toContain(CLIENTE_A);
    expect(r.estado.clientes).toEqual({});
    expect(carteiraPendente(r.estado, CLIENTE_A)).toBe(true);
    expect(situacaoDaCarteira(r.estado)).toEqual({
      completa: false,
      clientes_pendentes: [CLIENTE_A],
      aviso: 'Carteira incompleta: 1 cliente sem vendedor informado pelo Core. O alerta de cliente sem visita não vale para ele até o Core publicar a carteira no core.cliente.atualizado@1.',
    });
  });

  it('aviso no plural, clientes ordenados e contagem de avisos no lote', () => {
    const { estado, avisos } = aplicarEventos(estadoInicial(), [publicado(CLIENTE_B, '2026-09-01T10:00:00Z'), publicado(CLIENTE_A, '2026-09-01T11:00:00Z')]);
    expect(avisos).toBe(2);
    expect(situacaoDaCarteira(estado)).toMatchObject({ completa: false, clientes_pendentes: [CLIENTE_A, CLIENTE_B] });
    expect(situacaoDaCarteira(estado).aviso).toMatch(/^Carteira incompleta: 2 clientes sem vendedor/);
  });

  it('quando o Core informar a carteira, o aviso some e o alerta cliente_sem_visita volta a valer (fora de ordem dá o mesmo)', () => {
    const eventos = [publicado(CLIENTE_A, '2026-09-01T10:00:00Z'), comCarteira(CLIENTE_A, '2026-09-02T10:00:00Z')];
    for (const lista of [eventos, [...eventos].reverse()]) {
      const s = montar(lista);
      expect(situacaoDaCarteira(s)).toEqual({ completa: true, clientes_pendentes: [], aviso: null });
      expect(semVisita(s)).toHaveLength(1); // nunca visitado, ~58 dias na carteira (RN-GES-02)
    }
  });

  it('carteira conhecida + evento sem carteira que não mexe nela (lat/long): sem aviso, carteira mantida', () => {
    const s0 = montar([comCarteira(CLIENTE_A, '2026-09-01T10:00:00Z')]);
    const r = aplicarEvento(s0, publicado(CLIENTE_A, '2026-10-01T10:00:00Z'));
    expect(r.aviso).toBeUndefined();
    expect(r.estado.clientes[CLIENTE_A]?.vendedor_id).toBe(VENDEDOR);
    expect(situacaoDaCarteira(r.estado).completa).toBe(true);
  });

  it('carteira conhecida + evento que diz ter mudado vendedor_id mas não traz o dono: pendente, sem alertar o vendedor antigo', () => {
    const s0 = montar([comCarteira(CLIENTE_A, '2026-09-01T10:00:00Z')]);
    expect(semVisita(s0)).toHaveLength(1);
    const r = aplicarEvento(s0, publicado(CLIENTE_A, '2026-10-01T10:00:00Z', ['vendedor_id']));
    expect(r.aviso).toMatch(/Carteira incompleta/);
    expect(carteiraPendente(r.estado, CLIENTE_A)).toBe(true);
    expect(semVisita(r.estado)).toEqual([]);
    // o Core manda o novo dono depois: resolve
    const s2 = aplicarEvento(r.estado, comCarteira(CLIENTE_A, '2026-10-01T10:05:00Z', VENDEDOR_2)).estado;
    expect(carteiraPendente(s2, CLIENTE_A)).toBe(false);
    expect(s2.clientes[CLIENTE_A]?.vendedor_id).toBe(VENDEDOR_2);
  });

  it('evento sem campos/origem (fora do schema oficial do Core) é inválido', () => {
    expect(aplicarEvento(estadoInicial(), ev('core.cliente.atualizado@1', AGORA, { cliente_id: CLIENTE_A, vendedor_id: VENDEDOR, ativo: true })).situacao).toBe('invalido');
  });

  it('promotor não é afetado: só eventos do Core entram na carteira', () => {
    expect(situacaoDaCarteira(montar([checkin({ visita: u(2600), usuario: PROMOTOR, em: AGORA })])).completa).toBe(true);
  });
});
