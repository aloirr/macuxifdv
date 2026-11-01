import { describe, expect, it } from 'vitest';
import { AuditoriaQuerySchema, cursorAuditoria, filtroAuditoria, lerCursorAuditoria, LIMITE_AUDITORIA_MAX, LIMITE_AUDITORIA_PADRAO } from './auditoria';

const U1 = '0b000000-0000-4000-8000-000000000001';
const U2 = '0B000000-0000-4000-8000-000000000002';

describe('RN-AUD-01: filtro de licença e escopo da trilha', () => {
  it('escopo tenant: todos os módulos efetivos e todos os autores (inclui sem autor)', () => {
    expect(filtroAuditoria({ efetivos: ['core', 'vendedor'], visiveis: 'tenant' })).toEqual({ negado: false, modulos: ['core', 'vendedor'], usuarios: 'todos' });
  });

  it('RN-CORE-04: gerente vê só os usuários visíveis a ele (ids em minúsculas)', () => {
    const r = filtroAuditoria({ efetivos: ['core'], visiveis: new Set([U2, U1]) });
    expect(r).toEqual({ negado: false, modulos: ['core'], usuarios: [U1, U2.toLowerCase()] });
  });

  it('RN-CORE-01/02: filtrar por um módulo inativo para o usuário é negado; por um ativo, só ele', () => {
    expect(filtroAuditoria({ efetivos: ['core'], visiveis: 'tenant', modulo: 'vendedor' })).toEqual({ negado: true, modulo: 'vendedor' });
    expect(filtroAuditoria({ efetivos: ['core', 'vendedor'], visiveis: 'tenant', modulo: 'vendedor' })).toMatchObject({ negado: false, modulos: ['vendedor'] });
  });
});

describe('cursor da trilha', () => {
  it('ida e volta', () => {
    const c = cursorAuditoria({ ocorrido_em: '2026-11-01T12:00:00.123Z', id: U2 });
    expect(lerCursorAuditoria(c)).toEqual({ ocorrido_em: '2026-11-01T12:00:00.123Z', id: U2.toLowerCase() });
  });

  it('cursor malformado → null', () => {
    for (const c of ['', 'x', `_${U1}`, `2026-11-01_${U1}`, '2026-11-01T12:00:00.000Z_nao-uuid', `2026-13-01T12:00:00.000Z_${U1}`]) expect(lerCursorAuditoria(c)).toBeNull();
  });
});

describe('AuditoriaQuerySchema', () => {
  it('limite padrão, teto e campos desconhecidos recusados', () => {
    expect(AuditoriaQuerySchema.parse({}).limite).toBe(LIMITE_AUDITORIA_PADRAO);
    expect(AuditoriaQuerySchema.parse({ limite: '20' }).limite).toBe(20);
    expect(AuditoriaQuerySchema.safeParse({ limite: String(LIMITE_AUDITORIA_MAX + 1) }).success).toBe(false);
    expect(AuditoriaQuerySchema.safeParse({ modulo: 'x' }).success).toBe(false);
    expect(AuditoriaQuerySchema.safeParse({ entity: 'pedido' }).success).toBe(false);
  });
});
