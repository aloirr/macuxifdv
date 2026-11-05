import { describe, expect, it } from 'vitest';
import { alertasDePendenciaCheckout, ehNotificacaoDePendenciaCheckout, type NotificacaoPendencia } from './alertas-pendencia-checkout';

const CLI = '11111111-1111-4111-8111-111111111111';
const n = (o: Partial<NotificacaoPendencia> = {}): NotificacaoPendencia => ({
  id: '22222222-2222-4222-8222-222222222222',
  tipo: 'sistema',
  origem_modulo: 'core',
  titulo: 'Etapa pendente na visita de Rafael a Mercado Boa Vista',
  corpo: 'Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · não chegou em 24 h',
  link: `/m/cliente?id=${CLI}`,
  created_at: '2026-11-05T10:00:00.000Z',
  deleted_at: null,
  expira_em: null,
  ...o,
});
const AGORA = '2026-11-05T12:00:00.000Z';

describe('alerta de etapa pendente no checkout (T-0039 §4.3)', () => {
  it('RN-CORE-12: a notificação do supervisor vira alerta com o texto da especificação e o link da ficha do cliente', () => {
    const [a] = alertasDePendenciaCheckout([n()], { perfil: 'supervisor', agora: AGORA });
    expect(a).toMatchObject({
      tipo: 'etapa_pendente_checkout',
      titulo: 'Etapa pendente na visita de Rafael a Mercado Boa Vista',
      mensagem: 'Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · não chegou em 24 h',
      cliente_id: CLI,
      severidade: 'atencao',
      aberto_em: '2026-11-05T10:00:00.000Z',
    });
  });

  it('RN-CORE-04: só supervisor e gerente veem; vendedor, promotor, analista e admin não', () => {
    for (const perfil of ['vendedor', 'promotor', 'analista', 'admin']) expect(alertasDePendenciaCheckout([n()], { perfil, agora: AGORA })).toEqual([]);
    expect(alertasDePendenciaCheckout([n()], { perfil: 'gerente', agora: AGORA })).toHaveLength(1);
  });

  it('a versão do vendedor (sem "de <nome>") e notificações de outros assuntos não entram', () => {
    expect(ehNotificacaoDePendenciaCheckout(n({ titulo: 'Etapa pendente na visita a Mercado Boa Vista' }))).toBe(false);
    expect(ehNotificacaoDePendenciaCheckout(n({ tipo: 'recado' }))).toBe(false);
    expect(ehNotificacaoDePendenciaCheckout(n({ origem_modulo: 'vendedor' }))).toBe(false);
    expect(ehNotificacaoDePendenciaCheckout(n({ link: '/m/pedido?id=x' }))).toBe(false);
  });

  it('apagada ou expirada some; mais recente primeiro', () => {
    const lista = [
      n({ id: 'a', created_at: '2026-11-04T10:00:00.000Z' }),
      n({ id: 'b', created_at: '2026-11-05T09:00:00.000Z' }),
      n({ id: 'c', deleted_at: '2026-11-05T11:00:00.000Z' }),
      n({ id: 'd', expira_em: '2026-11-05T11:00:00.000Z' }),
    ];
    expect(alertasDePendenciaCheckout(lista, { perfil: 'supervisor', agora: AGORA }).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('RN-CORE-12: com subtipo etapa_pendente_checkout reconhece mesmo sem "de <nome>" no título; outro subtipo não entra', () => {
    expect(ehNotificacaoDePendenciaCheckout(n({ subtipo: 'etapa_pendente_checkout', titulo: 'Etapa pendente na visita a Mercado Boa Vista' }))).toBe(true);
    expect(ehNotificacaoDePendenciaCheckout(n({ subtipo: 'outro' }))).toBe(false);
    expect(alertasDePendenciaCheckout([n({ subtipo: 'etapa_pendente_checkout', titulo: 'Etapa pendente na visita a X' })], { perfil: 'supervisor', agora: AGORA })).toHaveLength(1);
  });

  it('RN-CORE-12: sem subtipo (linha antiga ou subtipo nulo) vale o título como reserva', () => {
    expect(ehNotificacaoDePendenciaCheckout(n({ subtipo: null }))).toBe(true);
    expect(ehNotificacaoDePendenciaCheckout(n({ subtipo: undefined, titulo: 'Outro assunto' }))).toBe(false);
  });

  it('RN-CORE-12: notificação com mais de 30 dias (janela do pull) não vira alerta; com 29 dias ainda vira', () => {
    const lista = [n({ id: 'velha', created_at: '2026-10-05T11:59:00.000Z' }), n({ id: 'nova', created_at: '2026-10-07T12:00:00.000Z' })];
    expect(alertasDePendenciaCheckout(lista, { perfil: 'supervisor', agora: AGORA }).map((x) => x.id)).toEqual(['nova']);
  });

  it('expira_em é comparado como data, não como texto (formato com deslocamento)', () => {
    expect(alertasDePendenciaCheckout([n({ expira_em: '2026-11-05T07:00:00-04:00' })], { perfil: 'supervisor', agora: AGORA })).toEqual([]);
  });
});
