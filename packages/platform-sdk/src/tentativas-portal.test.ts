/** RD-0406: a chave das tentativas do portal tem valor fixo (o mesmo da `chaveDeTentativa` do Core com o e-mail normalizado). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chaveDeTentativaDoPortal } from './tentativas-portal';

describe('chaveDeTentativaDoPortal', () => {
  it('HMAC-SHA256 hex de portal.login:<e-mail normalizado>', () => {
    // o mesmo valor de `chaveDeTentativa('s'.repeat(32), 'equipe@macuxi.com.br')` do Core (modules/core/api/seguranca-plataforma.ts)
    expect(chaveDeTentativaDoPortal('s'.repeat(32), 'equipe@macuxi.com.br')).toBe(
      '0b0383284e988f1bdfbce60c2249c29391f89c1503f23f5858114dba9885afba',
    );
  });

  it('normaliza o e-mail (espaços e maiúsculas dão a mesma chave)', () => {
    expect(chaveDeTentativaDoPortal('s'.repeat(32), '  Equipe@Macuxi.com.BR ')).toBe(chaveDeTentativaDoPortal('s'.repeat(32), 'equipe@macuxi.com.br'));
  });

  it('só pelo subcaminho: o index não a exporta e o package.json expõe ./tentativas-portal', () => {
    expect(readFileSync(new URL('./index.ts', import.meta.url), 'utf8')).not.toContain('tentativas-portal');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
    expect(pkg.exports['./tentativas-portal']).toBe('./src/tentativas-portal.ts');
  });
});
