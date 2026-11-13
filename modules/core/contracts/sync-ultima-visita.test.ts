import { describe, expect, it } from 'vitest';
import { ClienteUltimaVisitaSyncSchema } from './sync';

const base = { id: '11111111-1111-4111-8111-111111111111', updated_at: '2026-11-13T10:00:00Z', deleted_at: null, external_id: null, cliente_id: '11111111-1111-4111-8111-111111111111' };

describe('RN-CORE-47: ultima_visita_data do sync', () => {
  it('RN-CORE-47: aceita data AAAA-MM-DD e recusa outro formato', () => {
    expect(ClienteUltimaVisitaSyncSchema.safeParse({ ...base, ultima_visita_data: '2026-11-12' }).success).toBe(true);
    expect(ClienteUltimaVisitaSyncSchema.safeParse({ ...base, ultima_visita_data: '12/11/2026' }).success).toBe(false);
  });
});
