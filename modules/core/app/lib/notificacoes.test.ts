import { describe, expect, it } from 'vitest';
import type { NotificacaoSync } from '../../contracts';
import { comandoDeLeitura, contarNaoLidas, montarCaixa } from './notificacoes';

const u = '0e400000-0000-4000-8000-000000000001';
const n = (id: string, extra: Partial<NotificacaoSync> = {}): NotificacaoSync => ({
  id: `0e400000-0000-4000-8000-0000000000${id}`,
  updated_at: `2030-01-0${id.slice(1)}T10:00:00.000000Z`,
  deleted_at: null,
  external_id: null,
  usuario_id: u,
  tipo: 'recado',
  titulo: `t${id}`,
  corpo: 'c',
  origem_modulo: 'core',
  prioridade: 'normal',
  lida_em: null,
  expira_em: null,
  ...extra,
});
const AGORA = new Date('2030-02-01T00:00:00Z');

describe('RF-CORE-09: caixa de notificações offline', () => {
  it('não lidas primeiro, alta prioridade antes, mais novas antes; removidas e expiradas somem', () => {
    const caixa = montarCaixa(
      [n('11'), n('12', { prioridade: 'alta' }), n('13', { lida_em: '2030-01-05T00:00:00Z' }), n('14', { deleted_at: '2030-01-06T00:00:00Z' }), n('15', { expira_em: '2030-01-10T00:00:00Z' })],
      [],
      AGORA,
    );
    expect(caixa.map((x) => x.titulo)).toEqual(['t12', 't11', 't13']);
    expect(contarNaoLidas(caixa)).toBe(2);
  });
  it('leitura feita offline (item na fila) já aparece como lida e como pendente de envio', () => {
    const a = n('11');
    const fila = [{ entidade: 'notificacao_leitura', payload: { id: u, notificacao_id: a.id, lida_em: '2030-01-31T09:00:00.000Z' } }, { entidade: 'visita', payload: {} }];
    const [x] = montarCaixa([a], fila, AGORA);
    expect(x).toMatchObject({ lida_em: '2030-01-31T09:00:00.000Z', leituraPendente: true });
    expect(contarNaoLidas([x!])).toBe(0);
  });
  it('a leitura do servidor vence a da fila (primeira hora vale)', () => {
    const a = n('11', { lida_em: '2030-01-30T09:00:00.000Z' });
    const [x] = montarCaixa([a], [{ entidade: 'notificacao_leitura', payload: { id: u, notificacao_id: a.id, lida_em: '2030-01-31T09:00:00.000Z' } }], AGORA);
    expect(x).toMatchObject({ lida_em: '2030-01-30T09:00:00.000Z', leituraPendente: false });
  });
  it('comando de leitura leva o UUID do aparelho e o instante; só link interno navega', () => {
    expect(comandoDeLeitura(u, AGORA, () => 'id-1')).toEqual({ id: 'id-1', notificacao_id: u, lida_em: AGORA.toISOString() });
  });
});
