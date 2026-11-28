import { describe, expect, it } from 'vitest';
import { PARAMETRO_PROMOTOR_VE_PEDIDOS } from '../contracts';
import { pedidosVisiveisPelaLeitura, perfilRecebeHistoricoDeCompra, perfilPodeVerPedidos, promotorVePedidos, promotorVePedidosDasLinhas, usuarioDaRequisicaoVePedidos } from './promotor-pedidos';
import type { PerfilDaRequisicaoV2 } from '@macuxi/platform-sdk';

const linha = (valor: unknown, extra: Record<string, unknown> = {}) => ({ modulo: 'core', chave: 'promotor_ve_pedidos', valor, ...extra });

describe('RN-CORE-01 / RN-PRO-01: opção promotor_ve_pedidos (padrão ligado)', () => {
  it('a chave do parâmetro é promotor_ve_pedidos', () => {
    expect(PARAMETRO_PROMOTOR_VE_PEDIDOS).toBe('promotor_ve_pedidos');
  });

  it('ausência de registro = ligado (padrão do tenant novo)', () => {
    expect(promotorVePedidos(undefined)).toBe(true);
    expect(promotorVePedidos(null)).toBe(true);
    expect(promotorVePedidosDasLinhas([])).toBe(true);
  });

  it('só o valor false desliga; valor inválido cai no padrão ligado (nunca esconde por engano)', () => {
    expect(promotorVePedidos(false)).toBe(false);
    expect(promotorVePedidos(true)).toBe(true);
    expect(promotorVePedidos('false')).toBe(true);
    expect(promotorVePedidos(0)).toBe(true);
    expect(promotorVePedidos({})).toBe(true);
  });

  it('lê o valor efetivo das linhas sincronizadas; removido ou de outro módulo/chave não conta', () => {
    expect(promotorVePedidosDasLinhas([linha(false)])).toBe(false);
    expect(promotorVePedidosDasLinhas([linha(true)])).toBe(true);
    expect(promotorVePedidosDasLinhas([linha(false, { deleted_at: '2030-01-01T00:00:00Z' })])).toBe(true);
    expect(promotorVePedidosDasLinhas([{ modulo: 'vendedor', chave: 'promotor_ve_pedidos', valor: false }])).toBe(true);
    expect(promotorVePedidosDasLinhas([{ modulo: 'core', chave: 'checkin.raio_m', valor: false }])).toBe(true);
  });

  it('RN-PRO-01: a opção só controla a LEITURA do promotor; vendedor, gestor e demais perfis não mudam', () => {
    expect(perfilPodeVerPedidos('promotor', true)).toBe(true);
    expect(perfilPodeVerPedidos('promotor', false)).toBe(false);
    for (const p of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const) {
      expect(perfilPodeVerPedidos(p, false)).toBe(true);
      expect(perfilPodeVerPedidos(p, true)).toBe(true);
    }
  });
});

describe('RN-PRO-01 / T-0077 D2: histórico de compras segue promotor_ve_pedidos', () => {
  it('RN-PRO-01: promotor só recebe o histórico de compras com a opção ligada', () => {
    expect(perfilRecebeHistoricoDeCompra('promotor', true)).toBe(true);
    expect(perfilRecebeHistoricoDeCompra('promotor', false)).toBe(false);
  });
  it('RN-PRO-01: demais perfis recebem o histórico independentemente da opção', () => {
    for (const p of ['vendedor', 'supervisor', 'gerente', 'admin']) {
      expect(perfilRecebeHistoricoDeCompra(p, false)).toBe(true);
      expect(perfilRecebeHistoricoDeCompra(p, true)).toBe(true);
    }
  });
});

describe('RN-PRO-01 / ADR 0073 §2.4: quem lê pedidos na requisição (a decisão "é promotor?" é o promotorNaRequisicao do SDK)', () => {
  const acesso = (cargo: string, chaves: string[]) => ({ cargo, permissoes: Object.fromEntries(chaves.map((c) => [c, {}])) }) as unknown as PerfilDaRequisicaoV2;
  it('ADR 0073 §2.4: promotor em concessao lê pelo pedido.ver; em legado, pelo parâmetro; os demais sempre', () => {
    expect(usuarioDaRequisicaoVePedidos({ perfil_acesso: acesso('promotor', []) }, true)).toBe(false);
    expect(usuarioDaRequisicaoVePedidos({ perfil_acesso: acesso('promotor', ['pedido.ver']) }, false)).toBe(true);
    expect(usuarioDaRequisicaoVePedidos({ perfil: 'promotor' }, false)).toBe(false);
    expect(usuarioDaRequisicaoVePedidos({ perfil: 'promotor' }, true)).toBe(true);
    expect(usuarioDaRequisicaoVePedidos({ perfil_acesso: acesso('vendedor', []) }, false)).toBe(true);
  });
});

describe('RN-PRO-01 / RN-CORE-01 / ADR 0073 §2.4: pedidosVisiveisPelaLeitura (leitura guardada do usuário, offline)', () => {
  const EU = '00000000-0000-4000-8000-000000000001';
  const OUTRO = '00000000-0000-4000-8000-000000000002';
  const leitura = (ve_pedidos: boolean, leitura: 'concessao' | 'legado', usuario_id = EU) => ({ usuario_id, ve_pedidos, leitura });
  const casos = (l: ReturnType<typeof leitura> | null, perfil: string | null, parametros: ReturnType<typeof linha>[]) =>
    pedidosVisiveisPelaLeitura({ usuarioId: EU, perfil, parametros, leitura: l });

  it('concessão do próprio usuário: vale ve_pedidos, contra o parâmetro e o perfil', () => {
    expect(casos(leitura(false, 'concessao'), 'promotor', [linha(true)])).toBe(false);
    expect(casos(leitura(true, 'concessao'), 'promotor', [linha(false)])).toBe(true);
    expect(casos(leitura(false, 'concessao'), 'vendedor', [])).toBe(false);
  });

  it('legado: igual a pedidosVisiveisNoAparelho (parâmetro e perfil)', () => {
    expect(casos(leitura(true, 'legado'), 'promotor', [linha(false)])).toBe(false);
    expect(casos(leitura(false, 'legado'), 'promotor', [linha(true)])).toBe(true);
    expect(casos(leitura(false, 'legado'), 'vendedor', [linha(false)])).toBe(true);
  });

  it('sem leitura guardada (nunca sincronizou ou falha de rede): comportamento de hoje', () => {
    expect(casos(null, 'promotor', [linha(false)])).toBe(false);
    expect(casos(null, 'promotor', [])).toBe(true);
    expect(casos(null, null, [linha(false)])).toBe(true);
  });

  it('leitura de outro usuário (ou sem usuário na sessão) não vale: comportamento de hoje', () => {
    expect(casos(leitura(false, 'concessao', OUTRO), 'promotor', [linha(true)])).toBe(true);
    expect(pedidosVisiveisPelaLeitura({ usuarioId: null, perfil: 'promotor', parametros: [linha(true)], leitura: leitura(false, 'concessao') })).toBe(true);
  });
});
