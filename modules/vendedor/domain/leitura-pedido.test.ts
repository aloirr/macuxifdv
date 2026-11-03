import { describe, expect, it } from 'vitest';
import { podeLerPedidos } from './leitura-pedido';

describe('podeLerPedidos (RN-PRO-01, O-3 do doc 03: opção do perfil Promotor `promotor_ve_pedidos`)', () => {
  it('O-3: promotor com a opção ligada lê pedidos (só leitura, escopo de carteira)', () => {
    expect(podeLerPedidos('promotor', true)).toEqual({ ok: true });
  });

  it('O-3: promotor com a opção desligada recebe 403 em tudo (lista, detalhe e pull)', () => {
    const r = podeLerPedidos('promotor', false);
    expect(r).toMatchObject({ ok: false, http: 403, codigo: 'RN-PRO-01' });
    if (!r.ok) expect(r.mensagem).toMatch(/administrador/);
  });

  it.each(['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'])('O-3: %s não depende da opção (ligada ou desligada, lê como antes)', (perfil) => {
    expect(podeLerPedidos(perfil, true)).toEqual({ ok: true });
    expect(podeLerPedidos(perfil, false)).toEqual({ ok: true });
  });
});
