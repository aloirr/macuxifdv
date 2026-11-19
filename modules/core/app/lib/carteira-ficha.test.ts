import { describe, expect, it } from 'vitest';

import type { CarteiraSync, UsuarioSync } from '../../contracts';
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
const usu = (id: string, nome: string, telefone: string | null, extra: Partial<UsuarioSync> = {}): UsuarioSync =>
  ({ id, updated_at: '2026-11-01T00:00:00Z', deleted_at: null, external_id: null, codigo_fdv: null, desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null, almoco_inicio_min: null, almoco_fim_min: null, nome, telefone, ...extra }) as UsuarioSync;

describe('T-0186 spec §3.5: tabela Carteira da ficha no Gestão', () => {
  it('RN-CORE-04: lista quem tem o cliente na carteira, com o nome do usuário e os links de Ligar e WhatsApp', () => {
    const r = pessoasDaCarteira(C1, [cart(U1)], [usu(U1, 'Marcos Lima', '(92) 98237-3437')], HOJE);
    expect(r).toEqual([{ id: U1, nome: 'Marcos Lima', tel: 'tel:92982373437', whatsapp_url: 'https://wa.me/5592982373437' }]);
  });
  it('só entram os vínculos do cliente, vivos e dentro da vigência', () => {
    const r = pessoasDaCarteira(
      C1,
      [cart(U1), cart(U2, {}, C2), cart(U3, { fim: '2026-11-18' }), cart(U2, { inicio: '2026-11-20' }), cart(U2, { deleted_at: '2026-11-10T00:00:00Z' })],
      [usu(U1, 'Ana', null), usu(U2, 'Bia', null), usu(U3, 'Caio', null)],
      HOJE,
    );
    expect(r.map((p) => p.nome)).toEqual(['Ana']);
  });
  it('sem telefone no usuário, Ligar e WhatsApp ficam desligados', () => {
    const r = pessoasDaCarteira(C1, [cart(U1)], [usu(U1, 'Ana', null)], HOJE);
    expect(r[0]).toMatchObject({ tel: null, whatsapp_url: null });
  });
  it('usuário fora do aparelho aparece pelo papel e sem botões; vendedor vem antes do promotor', () => {
    const r = pessoasDaCarteira(C1, [cart(U2, { papel: 'promotor' }), cart(U1), cart(U3, { papel: 'promotor' })], [usu(U2, 'Bia', '92 99999-0000')], HOJE);
    expect(r.map((p) => p.nome)).toEqual(['Vendedor', 'Bia', 'Promotor']);
    expect(r[0]).toMatchObject({ tel: null, whatsapp_url: null });
  });
});
