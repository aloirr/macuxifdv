import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { FotoColeta, GondolaRegistro, MedicaoShare, RupturaItem, VisitaLoja } from '../../contracts';
import { abrirVisitaLoja, checkinAberto, fecharVisitaLoja, montarFoto, montarGondola, montarPreco, montarRuptura, montarShare, montarTarefa, reaisParaCentavos } from './loja';

const relogio = criarRelogio({ agora: '2026-11-03T14:00:00Z' });
const em = (min: number) => relogio.relativo({ minutos: min });
const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const EU = u(1);
const LOJA = u(2);

const linha = (id: number, extra: Record<string, unknown> = {}) => ({ id: u(id), usuario_id: EU, cliente_id: LOJA, checkin_em: em(0).toISOString(), checkout_em: null, deleted_at: null, ...extra });

describe('RN-PRO-02: check-in aberto do Core no aparelho (offline)', () => {
  it('linha do pull sem checkout é o check-in aberto', () => {
    expect(checkinAberto([linha(10)], [], EU)).toEqual({ visita_id: u(10), cliente_id: LOJA, checkin_em: em(0).toISOString() });
  });

  it('check-in ainda na fila (offline) também vale, e o mais recente vence', () => {
    const fila = [{ entidade: 'visita', payload: { id: u(11), cliente_id: u(3), checkin_em: em(5).toISOString(), extra: false } }];
    expect(checkinAberto([linha(10)], fila, EU)).toMatchObject({ visita_id: u(11), cliente_id: u(3) });
  });

  it('checkout na fila fecha a visita; visita de outro usuário, removida ou com checkout não conta', () => {
    const fila = [{ entidade: 'visita_checkout', payload: { id: u(20), visita_id: u(10) } }];
    expect(checkinAberto([linha(10)], fila, EU)).toBeNull();
    expect(checkinAberto([linha(12, { usuario_id: u(9) }), linha(13, { deleted_at: em(1).toISOString() }), linha(14, { checkout_em: em(2).toISOString() })], [], EU)).toBeNull();
  });
});

describe('visita de loja no aparelho', () => {
  it('abre no instante do check-in do Core e fecha com a permanência do domain (RN-PRO-07)', () => {
    const v = abrirVisitaLoja(u(30), { visita_id: u(10), cliente_id: LOJA, checkin_em: em(0).toISOString() }, null);
    expect(VisitaLoja.safeParse(v).success).toBe(true);
    const f = fecharVisitaLoja(v, em(42));
    expect(f).toMatchObject({ permanencia_min: 42, desfecho: 'realizada', checkout_em: em(42).toISOString() });
    expect(VisitaLoja.safeParse(f).success).toBe(true);
  });

  it('relógio do aparelho atrás do check-in não gera checkout anterior ao check-in', () => {
    const v = abrirVisitaLoja(u(30), { visita_id: u(10), cliente_id: LOJA, checkin_em: em(0).toISOString() }, null);
    expect(fecharVisitaLoja(v, em(-3))).toMatchObject({ permanencia_min: 0 });
  });
});

describe('coletas montadas com o domain (válidas pelo contrato)', () => {
  const V = u(30);

  it('RN-PRO-02: foto sem coordenada sai com sem_gps; com coordenada, sem_gps falso', () => {
    const sem = montarFoto({ id: u(40), visita_loja_id: V, tipo: 'gondola_antes', agora: em(3) });
    const com = montarFoto({ id: u(41), visita_loja_id: V, tipo: 'gondola_depois', agora: em(4), latitude: -3.1, longitude: -60 });
    expect(sem).toMatchObject({ sem_gps: true, latitude: null });
    expect(com).toMatchObject({ sem_gps: false });
    expect(FotoColeta.safeParse(sem).success && FotoColeta.safeParse(com).success).toBe(true);
  });

  it('RN-PRO-03: share 12 de 40 = 30%, meta 40 → atingimento 75%; sem meta, atingimento nulo', () => {
    const r = montarShare({ id: u(42), visita_loja_id: V, categoria_gondola_id: u(5), frentes_nossas: '12', frentes_total: '40', meta: { id: u(6), meta_pct: 40 }, agora: em(5) });
    expect(r).toMatchObject({ ok: true, coleta: { share_pct: 30, atingimento_pct: 75, meta_share_id: u(6) } });
    if (r.ok) expect(MedicaoShare.safeParse(r.coleta).success).toBe(true);
    expect(montarShare({ id: u(43), visita_loja_id: V, categoria_gondola_id: u(5), frentes_nossas: '1', frentes_total: '3', meta: null, agora: em(5) })).toMatchObject({ ok: true, coleta: { share_pct: 33.33, meta_pct: null, atingimento_pct: null } });
  });

  it('RN-PRO-03: frentes inválidas ou nossas > total dão erro em português', () => {
    expect(montarShare({ id: u(44), visita_loja_id: V, categoria_gondola_id: u(5), frentes_nossas: '1,5', frentes_total: '3', meta: null, agora: em(5) })).toMatchObject({ ok: false });
    expect(montarShare({ id: u(44), visita_loja_id: V, categoria_gondola_id: u(5), frentes_nossas: '5', frentes_total: '3', meta: null, agora: em(5) })).toMatchObject({ ok: false, erro: expect.stringMatching(/total/) });
  });

  it('RN-PRO-05: presença — gôndola, falta com estoque (reposição) e sem estoque', () => {
    const base = { visita_loja_id: V, produto_id: u(7), mix_obrigatorio_id: u(8), agora: em(6) };
    expect(montarRuptura({ ...base, id: u(45), na_gondola: true, no_deposito: null })).toMatchObject({ ok: true, coleta: { status: 'presente' } });
    const rep = montarRuptura({ ...base, id: u(46), na_gondola: false, no_deposito: true, quantidade_reposta: 6 });
    expect(rep).toMatchObject({ ok: true, coleta: { status: 'ruptura_gondola', quantidade_reposta: 6 } });
    expect(montarRuptura({ ...base, id: u(47), na_gondola: false, no_deposito: false, quantidade_reposta: 6 })).toMatchObject({ ok: true, coleta: { status: 'ruptura_total', quantidade_reposta: 0 } });
    expect(montarRuptura({ ...base, id: u(48), na_gondola: false, no_deposito: null })).toMatchObject({ ok: false, erro: expect.stringMatching(/depósito/) });
    if (rep.ok) expect(RupturaItem.safeParse(rep.coleta).success).toBe(true);
  });

  it('RN-PRO-04: preço em reais vira centavos; variação acima do limite pede confirmação', () => {
    expect(reaisParaCentavos('10,90')).toBe(1090);
    expect(reaisParaCentavos('R$ 7')).toBe(700);
    expect(reaisParaCentavos('abc')).toBeNull();
    const base = { id: u(49), visita_loja_id: V, produto_id: u(7), anterior_cents: 599, limite_pct: 50, agora: em(7) };
    expect(montarPreco({ ...base, preco: '599,00', confirmar_variacao: false })).toMatchObject({ ok: false, precisa_confirmar: true });
    expect(montarPreco({ ...base, preco: '599,00', confirmar_variacao: true })).toMatchObject({ ok: true, coleta: { preco_cents: 59900, variacao_confirmada: true } });
    expect(montarPreco({ ...base, preco: '6,10', confirmar_variacao: false })).toMatchObject({ ok: true, coleta: { variacao_confirmada: false } });
  });

  it('RF-PRO-03: gôndola exige as duas fotos e motivo quando não conforme', () => {
    const base = { id: u(50), visita_loja_id: V, categoria_gondola_id: u(5), foto_referencia_id: null, agora: em(8) };
    expect(montarGondola({ ...base, foto_antes_id: u(40), foto_depois_id: null, conformidade: 'conforme', motivo: '' })).toMatchObject({ ok: false });
    expect(montarGondola({ ...base, foto_antes_id: u(40), foto_depois_id: u(41), conformidade: 'nao_conforme', motivo: '  ' })).toMatchObject({ ok: false });
    const ok = montarGondola({ ...base, foto_antes_id: u(40), foto_depois_id: u(41), conformidade: 'parcial', motivo: '' });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(GondolaRegistro.safeParse(ok.coleta).success).toBe(true);
  });

  it('RF-PRO-10: tarefa sem foto não conclui', () => {
    expect(montarTarefa({ id: u(51), tarefa_trade_id: u(9), visita_loja_id: V, cliente_id: LOJA, foto_ids: [], agora: em(9) })).toMatchObject({ ok: false });
    expect(montarTarefa({ id: u(51), tarefa_trade_id: u(9), visita_loja_id: V, cliente_id: LOJA, foto_ids: [u(40)], agora: em(9) })).toMatchObject({ ok: true });
  });
});
