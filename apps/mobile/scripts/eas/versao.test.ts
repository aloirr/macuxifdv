/**
 * T-0109: invariantes da versão. `versao.json` é a fonte única do `version` (igual nas duas variantes); o versionCode fica
 * fora do repositório (scripts/ci/android-build.mjs, `versionCodeDe`).
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import appConfig from '../../app.config';
import { lerVersao, nomeDoBuild } from '../../src/lib/nome-build';

const versaoDoArquivo = (JSON.parse(readFileSync(new URL('./versao.json', import.meta.url), 'utf8')) as { versao: string }).versao;

describe('versão: fonte única', () => {
  const varianteAntes = process.env.APP_VARIANT;
  afterEach(() => {
    if (varianteAntes === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = varianteAntes;
  });

  // Sem travar o número: o teste confere o formato e o nome derivado (ex.: 1.0.7 → Campo-Oficial-v1.0.7 / Gestao-Oficial-v1.0.7).
  it('versao.json em X.Y.Z e nome do build derivado dele, igual nas duas variantes', () => {
    expect(versaoDoArquivo).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    expect(lerVersao({ versao: versaoDoArquivo })).toBe(versaoDoArquivo);
    expect([nomeDoBuild('campo', 'producao', versaoDoArquivo), nomeDoBuild('gestao', 'producao', versaoDoArquivo)]).toEqual([
      `Campo-Oficial-v${versaoDoArquivo}`,
      `Gestao-Oficial-v${versaoDoArquivo}`,
    ]);
  });

  it('versão torta no versao.json é recusada', () => {
    for (const torta of ['1.0', '1.0.2.1', 'v1.0.2', '01.0.2', '1.0.2 ', '', null, 102]) {
      expect(() => lerVersao({ versao: torta }), JSON.stringify(torta)).toThrow(/versão inválida/);
    }
    expect(() => lerVersao({})).toThrow(/versão inválida/);
  });

  it('o app.config usa a versão do versao.json nas duas variantes', () => {
    for (const v of ['campo', 'gestao']) {
      process.env.APP_VARIANT = v;
      const c = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
      // as duas variantes saem da mesma fonte: divergência entre Campo e Gestão quebra aqui
      expect(c.version).toBe(versaoDoArquivo);
      // versionCode fora do repositório (scripts/ci/android-build.mjs, versionCodeDe)
      expect(c.android?.versionCode).toBeUndefined();
    }
  });
});
