import { describe, expect, it } from 'vitest';
import { UsuarioListaQuerySchema, VincularErpRequestSchema, VincularErpRespostaSchema } from './usuarios';

const ID = '5d000000-0000-4000-8000-000000000001';

describe('RN-CORE-58: contrato do vínculo do vendedor do ERP', () => {
  it('RN-CORE-58: o pedido leva só o usuário real (uuid) e recusa campo a mais', () => {
    expect(VincularErpRequestSchema.safeParse({ usuario_id: ID }).success).toBe(true);
    expect(VincularErpRequestSchema.safeParse({ usuario_id: 'x' }).success).toBe(false);
    expect(VincularErpRequestSchema.safeParse({ usuario_id: ID, email: 'a@b.com' }).success).toBe(false);
  });
  it('RN-CORE-58: a resposta traz o código e quantos clientes passaram', () => {
    expect(VincularErpRespostaSchema.safeParse({ provisorio_id: ID, usuario_id: ID, external_id: 'VEN-1', clientes_movidos: 3, ja_vinculado: false }).success).toBe(true);
    expect(VincularErpRespostaSchema.safeParse({ provisorio_id: ID, usuario_id: ID, external_id: 'VEN-1', clientes_movidos: -1, ja_vinculado: false }).success).toBe(false);
  });
  it('RN-CORE-58: a lista filtra só os provisórios', () => {
    expect(UsuarioListaQuerySchema.safeParse({ provisorio: 'true' }).success).toBe(true);
    expect(UsuarioListaQuerySchema.safeParse({ provisorio: 'false' }).success).toBe(false);
  });
});
