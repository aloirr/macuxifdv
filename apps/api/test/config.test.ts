import { describe, expect, it } from 'vitest';
import { conferirSegredoJwt, ehAmbienteLocal } from '../src/config';

const forte = 'x'.repeat(32);

describe('MACUXI_JWT_SEGREDO na subida (falha fechada fora do local)', () => {
  it('segredo com 32+ caracteres: ok em qualquer ambiente', () => {
    expect(conferirSegredoJwt({ MACUXI_JWT_SEGREDO: forte, NODE_ENV: 'production' }, 'db.nuvem')).toEqual({ ok: true });
  });

  it('local (Postgres local e NODE_ENV != production): sobe com aviso; o login responde 503', () => {
    const r = conferirSegredoJwt({}, 'localhost');
    expect(r).toMatchObject({ ok: false, fatal: false });
    expect(conferirSegredoJwt({ MACUXI_JWT_SEGREDO: 'curto' }, 'macuxi-postgres')).toMatchObject({ ok: false, fatal: false });
  });

  it('fora do local (production ou banco remoto): ausente ou curto é fatal', () => {
    expect(conferirSegredoJwt({ NODE_ENV: 'production' }, 'localhost')).toMatchObject({ ok: false, fatal: true });
    expect(conferirSegredoJwt({ MACUXI_JWT_SEGREDO: 'curto' }, 'db.nuvem')).toMatchObject({ ok: false, fatal: true });
  });

  it('a mensagem nunca traz o valor do segredo', () => {
    const r = conferirSegredoJwt({ MACUXI_JWT_SEGREDO: 'segredo-curto-123' }, 'db.nuvem');
    expect(JSON.stringify(r)).not.toContain('segredo-curto-123');
  });

  it('ehAmbienteLocal: host local sem production', () => {
    expect(ehAmbienteLocal({}, 'LOCALHOST ')).toBe(true);
    expect(ehAmbienteLocal({ NODE_ENV: 'production' }, 'localhost')).toBe(false);
    expect(ehAmbienteLocal({}, '10.0.0.5')).toBe(false);
  });
});
