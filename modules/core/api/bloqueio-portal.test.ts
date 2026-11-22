import { describe, expect, it } from 'vitest';
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { CODIGOS_PORTAL } from '../contracts';
import { exigirChaveLivre } from './bloqueio-portal';

const agora = new Date('2026-11-07T12:00:00Z');

describe('exigirChaveLivre (423 único do portal)', () => {
  it('RN-CORE-31: chave sem bloqueio ou com bloqueio vencido não lança', () => {
    expect(() => exigirChaveLivre(null, agora)).not.toThrow();
    expect(() => exigirChaveLivre(new Date(agora.getTime() - 1_000), agora)).not.toThrow();
  });

  it('RN-CORE-31: chave bloqueada lança 423 portal.bloqueado com minutos_restantes', () => {
    try {
      exigirChaveLivre(new Date(agora.getTime() + 14 * 60_000 + 1_000), agora);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroHttpModulo);
      const erro = e as ErroHttpModulo;
      expect(erro.status).toBe(423);
      expect(erro.codigo).toBe(CODIGOS_PORTAL.bloqueado);
      expect(erro.detalhes).toEqual({ minutos_restantes: 15 });
    }
  });
});
