import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rotaGuiaPdf } from './guia-pdf-rota';

describe('guia.pdf público (decisão do dono do produto: sem login)', () => {
  it('devolve exatamente os bytes do PDF versionado', async () => {
    const corpo = (await rotaGuiaPdf.executar({} as never)) as Buffer;
    const arquivo = readFileSync(new URL('../docs/guia-api-hub.pdf', import.meta.url));
    expect(createHash('sha256').update(corpo).digest('hex')).toBe(createHash('sha256').update(arquivo).digest('hex'));
  });
});
