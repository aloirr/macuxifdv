import { describe, expect, it } from 'vitest';
import { ehFusoValido, FUSO_PADRAO_TENANT, fusoDoTenantOuPadrao } from './fuso';

describe('ctx.fuso(): fuso do tenant (RN-CORE-11, T-0035)', () => {
  it('padrão é America/Manaus (o mesmo DEFAULT_TZ de @macuxi/comum/fuso)', () => {
    expect(FUSO_PADRAO_TENANT).toBe('America/Manaus');
  });

  it('fuso IANA válido passa como está', () => {
    expect(fusoDoTenantOuPadrao('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(fusoDoTenantOuPadrao('America/Rio_Branco')).toBe('America/Rio_Branco');
    expect(fusoDoTenantOuPadrao('UTC')).toBe('UTC');
  });

  it('ausente, vazio, com espaço, inválido ou de outro tipo cai no padrão (nunca lança)', () => {
    for (const v of [undefined, null, '', '  ', ' America/Manaus', 'America/Atlantida', 'não/é/fuso', 42, {}]) {
      expect(ehFusoValido(v)).toBe(false);
      expect(fusoDoTenantOuPadrao(v)).toBe('America/Manaus');
    }
  });
});
