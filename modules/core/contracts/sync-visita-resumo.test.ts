import { describe, expect, it } from 'vitest';
import { ClienteVisitaResumoSyncSchema } from './sync';

const C = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const base = { id: C, updated_at: '2026-11-14T10:00:00.123456Z', deleted_at: null, external_id: null, cliente_id: C };

describe('RN-CORE-50: cliente_visita_resumo@1', () => {
  it('RN-CORE-50: aceita total, instante UTC e quem visitou por último', () => {
    const r = ClienteVisitaResumoSyncSchema.safeParse({ ...base, total_visitas: 12, ultima_visita_em: '2026-11-13T15:20:00.000000Z', ultima_visita_usuario_id: U, ultima_visita_usuario_nome: 'Ana Souza' });
    expect(r.success).toBe(true);
  });
  it('RN-CORE-50: aceita cliente sem visita (campos nulos) e recusa total negativo, data sem hora e campo a mais', () => {
    expect(ClienteVisitaResumoSyncSchema.safeParse({ ...base, total_visitas: 0, ultima_visita_em: null, ultima_visita_usuario_id: null, ultima_visita_usuario_nome: null }).success).toBe(true);
    const ok = { ...base, total_visitas: 1, ultima_visita_em: '2026-11-13T15:20:00Z', ultima_visita_usuario_id: U, ultima_visita_usuario_nome: 'Ana' };
    expect(ClienteVisitaResumoSyncSchema.safeParse({ ...ok, total_visitas: -1 }).success).toBe(false);
    expect(ClienteVisitaResumoSyncSchema.safeParse({ ...ok, ultima_visita_em: '2026-11-13' }).success).toBe(false);
    expect(ClienteVisitaResumoSyncSchema.safeParse({ ...ok, tenant_id: C }).success).toBe(false);
  });
});
