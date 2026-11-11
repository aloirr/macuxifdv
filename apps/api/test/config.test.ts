import { describe, expect, it } from 'vitest';
import { conferirSegredoJwt, diagnosticosAppLigados, diagnosticosLigados, ehAmbienteLocal, lerTrustProxy } from '../src/config';

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

describe('MACUXI_TRUST_PROXY (T-0026)', () => {
  it('ausente, vazio, false ou 0: desligado', () => {
    for (const v of [undefined, '', ' ', 'false', 'FALSE', '0']) expect(lerTrustProxy({ MACUXI_TRUST_PROXY: v })).toBe(false);
  });
  it('true, número de saltos ou lista de IPs/CIDR/palavras-chave', () => {
    expect(lerTrustProxy({ MACUXI_TRUST_PROXY: 'true' })).toBe(true);
    const saltos = lerTrustProxy({ MACUXI_TRUST_PROXY: '2' });
    expect(typeof saltos).toBe('function');
    if (typeof saltos === 'function') expect([saltos('10.0.0.1', 0), saltos('10.0.0.2', 1), saltos('10.0.0.3', 2)]).toEqual([true, true, false]);
    expect(lerTrustProxy({ MACUXI_TRUST_PROXY: 'loopback' })).toEqual(['loopback']);
    expect(lerTrustProxy({ MACUXI_TRUST_PROXY: '127.0.0.1, 10.0.0.0/8,' })).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });
});

describe('MACUXI_DIAGNOSTICOS e MACUXI_DIAGNOSTICOS_APP (T-0158, R-20261111-011107)', () => {
  it('só 1/true/sim ligam; ausente, vazio ou outro valor = desligado', () => {
    for (const v of ['1', 'true', 'sim', ' SIM ', 'True']) expect(diagnosticosLigados({ MACUXI_DIAGNOSTICOS: v })).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'nao', 'ligado']) expect(diagnosticosLigados({ MACUXI_DIAGNOSTICOS: v })).toBe(false);
  });
  it('botão do app (recursos.diagnosticos): só com os dois flags ligados; o MACUXI_DIAGNOSTICOS=1 da demo sozinho não liga', () => {
    expect(diagnosticosAppLigados({})).toBe(false);
    expect(diagnosticosAppLigados({ MACUXI_DIAGNOSTICOS: '1' })).toBe(false);
    expect(diagnosticosAppLigados({ MACUXI_DIAGNOSTICOS_APP: '1' })).toBe(false);
    expect(diagnosticosAppLigados({ MACUXI_DIAGNOSTICOS: '1', MACUXI_DIAGNOSTICOS_APP: '0' })).toBe(false);
    expect(diagnosticosAppLigados({ MACUXI_DIAGNOSTICOS: 'sim', MACUXI_DIAGNOSTICOS_APP: 'true' })).toBe(true);
  });
});
