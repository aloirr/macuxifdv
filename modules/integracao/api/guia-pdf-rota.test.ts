import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOME_ARQUIVO_ROTA_RE } from '@macuxi/platform-sdk';
import { moduloApi } from './index';
import { rotaGuiaPdf } from './guia-pdf-rota';

describe('guia.pdf público (decisão do dono do produto: sem login)', () => {
  it('é rota pública GET guia.pdf, com limite 60/min, cache de 1 h, application/pdf e nome de arquivo válido', () => {
    expect(moduloApi.rotasPublicas).toContain(rotaGuiaPdf);
    expect(rotaGuiaPdf).toMatchObject({ metodo: 'GET', caminho: 'guia.pdf', limite: { max: 60, janelaMs: 60_000 }, cache: { maxAgeSegundos: 3600 }, tipoConteudo: 'application/pdf' });
    expect(NOME_ARQUIVO_ROTA_RE.test(rotaGuiaPdf.nomeArquivo as string)).toBe(true);
  });

  it('devolve exatamente os bytes do PDF versionado (um PDF de verdade)', async () => {
    const corpo = (await rotaGuiaPdf.executar({} as never)) as Buffer;
    const arquivo = readFileSync(new URL('../docs/guia-api-hub.pdf', import.meta.url));
    expect(createHash('sha256').update(corpo).digest('hex')).toBe(createHash('sha256').update(arquivo).digest('hex'));
    expect(corpo.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
