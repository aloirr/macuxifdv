import { describe, expect, it } from 'vitest';

import type { CarteiraSync } from '../../contracts';
import { pessoasDaCarteira } from './carteira-ficha';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOJE = '2026-11-19';

const cart = (usuario_id: string, extra: Partial<CarteiraSync> = {}, cliente_id = C1): CarteiraSync => ({
  id: `${usuario_id}-${cliente_id}`, updated_at: '2026-11-01T00:00:00Z', deleted_at: null, external_id: null, cliente_id, usuario_id, papel: 'vendedor', inicio: null, fim: null, ...extra,
});

describe('T-0186 spec §3.5 e T-0168: tabela Carteira da ficha no Gestão, sem dado pessoal no aparelho', () => {
  it('RN-CORE-04 e RN-VEN-11a: lista quem tem o cliente na carteira só pelo papel, com Ligar e WhatsApp desligados', () => {
    const r = pessoasDaCarteira(C1, [cart(U1)], HOJE);
    expect(r).toEqual([{ id: U1, nome: 'Vendedor', tel: null, whatsapp_url: null }]);
  });
  it('só entram os vínculos do cliente, vivos e dentro da vigência', () => {
    const r = pessoasDaCarteira(C1, [cart(U1), cart(U2, {}, C2), cart(U3, { fim: '2026-11-18' }), cart(U2, { inicio: '2026-11-20' }), cart(U2, { deleted_at: '2026-11-10T00:00:00Z' })], HOJE);
    expect(r.map((p) => p.id)).toEqual([U1]);
  });
  it('vendedor vem antes do promotor', () => {
    const r = pessoasDaCarteira(C1, [cart(U2, { papel: 'promotor' }), cart(U1), cart(U3, { papel: 'promotor' })], HOJE);
    expect(r.map((p) => p.nome)).toEqual(['Vendedor', 'Promotor', 'Promotor']);
  });
});
