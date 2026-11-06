import { describe, expect, it, vi } from 'vitest';

import { buscarNoCatalogoComReserva } from './busca-catalogo';

const indisp = (e: unknown) => e instanceof Error && e.name === 'ConsultaIndisponivel';

describe('T-0084-A3 (RN-CAT-12): reserva local só em ConsultaIndisponivel', () => {
  it('ConsultaIndisponivel cai na busca local, sem erro e sem log', async () => {
    const registrar = vi.fn();
    const e = Object.assign(new Error('sem leitura'), { name: 'ConsultaIndisponivel' });
    const r = await buscarNoCatalogoComReserva(() => Promise.reject(e), indisp, registrar);
    expect(r).toEqual({ tipo: 'reserva' });
    expect(registrar).not.toHaveBeenCalled();
  });
  it('outro erro vira erro da busca e vai ao log só com o nome (sem dado pessoal)', async () => {
    const registrar = vi.fn();
    const r = await buscarNoCatalogoComReserva(() => Promise.reject(new TypeError('cliente Maria 123')), indisp, registrar);
    expect(r).toEqual({ tipo: 'erro' });
    expect(registrar).toHaveBeenCalledWith(expect.any(String), { nome: 'TypeError' });
    expect(JSON.stringify(registrar.mock.calls)).not.toContain('Maria');
  });
  it('sucesso devolve os itens', async () => {
    const r = await buscarNoCatalogoComReserva(() => Promise.resolve({ itens: [{ produto_id: 'p1', serve_em: null }] }), indisp, vi.fn());
    expect(r).toEqual({ tipo: 'ok', itens: [{ produto_id: 'p1', serve_em: null }] });
  });
});
