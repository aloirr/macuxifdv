import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashRegistro } from '../domain';

describe('RN-INT-02: contrato do hash com o banco (db/migrations/0010_integracao.up.sql)', () => {
  it('RN-INT-02: o CHECK do banco continua ^[0-9a-f]{64}$ e o hash do domain casa com ele', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0010_integracao.up.sql', import.meta.url), 'utf8');
    expect(sql).toContain("check (hash ~ '^[0-9a-f]{64}$')");
    expect(hashRegistro({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
