/**
 * T-0109: build.mjs e comum.mjs (ainda chamados pelo .github/workflows/eas-build.yml) e invariantes da
 * versão (versao.json como fonte única do `version`; versionCode remoto e sempre crescente em todo perfil).
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import appConfig from '../../app.config';
import { planoDeBuild } from './build.mjs';
import { ambienteDoEas, nomes, versaoAtual } from './comum.mjs';

const eas = JSON.parse(readFileSync(new URL('../../eas.json', import.meta.url), 'utf8')) as {
  cli: { appVersionSource?: string };
  build: Record<string, { extends?: string; autoIncrement?: boolean; env?: Record<string, string> }>;
};
const versaoDoArquivo = (JSON.parse(readFileSync(new URL('./versao.json', import.meta.url), 'utf8')) as { versao: string }).versao;

describe('versão: fonte única e versionCode crescente', () => {
  const varianteAntes = process.env.APP_VARIANT;
  afterEach(() => {
    if (varianteAntes === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = varianteAntes;
  });

  // Sem travar o número: o teste confere o formato e o nome derivado (ex.: 1.0.7 → Campo-Oficial-v1.0.7 / Gestao-Oficial-v1.0.7).
  it('versao.json em X.Y.Z e nome do build derivado dele, igual nas duas variantes', () => {
    expect(versaoDoArquivo).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    expect(versaoAtual()).toBe(versaoDoArquivo);
    const nomesOficiais = planoDeBuild(['ambos', 'oficial'], versaoAtual()).builds.map((b) => b.nome);
    expect(nomesOficiais).toEqual([`Campo-Oficial-v${versaoDoArquivo}`, `Gestao-Oficial-v${versaoDoArquivo}`]);
  });

  it('versão torta no versao.json é recusada', () => {
    for (const torta of ['1.0', '1.0.2.1', 'v1.0.2', '01.0.2', '1.0.2 ', '', null, 102]) {
      expect(() => nomes.lerVersao({ versao: torta }), JSON.stringify(torta)).toThrow(/versão inválida/);
    }
    expect(() => nomes.lerVersao({})).toThrow(/versão inválida/);
  });

  it('o app.config usa a versão do versao.json nas duas variantes', () => {
    for (const v of ['campo', 'gestao']) {
      process.env.APP_VARIANT = v;
      const c = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
      // as duas variantes saem da mesma fonte: divergência entre Campo e Gestão quebra aqui
      expect(c.version).toBe(versaoDoArquivo);
      // versionCode NÃO fica no repositório: é do EAS (appVersionSource remote)
      expect(c.android?.versionCode).toBeUndefined();
    }
  });

  it('versionCode remoto com autoIncrement em todo perfil que gera APK', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    const herda = (nome: string): boolean | undefined => {
      const p = eas.build[nome];
      if (!p) return undefined;
      return p.autoIncrement ?? (p.extends ? herda(p.extends) : undefined);
    };
    const perfis = Object.keys(eas.build).filter((n) => n !== 'base');
    // só produção: os perfis de desenvolvimento (campo/gestao) e preview (*-preview) saíram do eas.json
    expect(perfis.sort()).toEqual(['campo-producao', 'gestao-producao']);
    for (const p of perfis) expect(eas.build[p]?.extends, p).toBe('base');
    for (const p of perfis) expect(herda(p), p).toBe(true);
  });
});

describe('build.mjs: mensagem do build', () => {
  it('campo oficial → perfil campo-producao e mensagem Campo-Oficial-v1.0.0', () => {
    const { builds, simular } = planoDeBuild(['campo', 'oficial'], '1.0.0');
    expect(simular).toBe(false);
    expect(builds).toEqual([
      { nome: 'Campo-Oficial-v1.0.0', perfilEas: 'campo-producao', args: ['build', '--platform', 'android', '--profile', 'campo-producao', '--message', 'Campo-Oficial-v1.0.0'] },
    ]);
  });

  it('gestao oficial → perfil gestao-producao e mensagem Gestao-Oficial-vX.Y.Z', () => {
    const { builds } = planoDeBuild(['gestao', 'oficial'], '2.3.4');
    expect(builds.map((b) => [b.perfilEas, b.nome])).toEqual([['gestao-producao', 'Gestao-Oficial-v2.3.4']]);
  });

  it('ambos + --simular + opções extras do eas depois de --', () => {
    const { builds, simular } = planoDeBuild(['ambos', 'oficial', '--simular', '--', '--no-wait'], '1.0.0');
    expect(simular).toBe(true);
    expect(builds.map((b) => b.nome)).toEqual(['Campo-Oficial-v1.0.0', 'Gestao-Oficial-v1.0.0']);
    expect(builds[0]?.args.at(-1)).toBe('--no-wait');
  });

  it('cada perfil montado existe no eas.json', () => {
    for (const b of planoDeBuild(['ambos', 'oficial'], '1.0.0').builds) expect(eas.build[b.perfilEas], b.perfilEas).toBeDefined();
  });

  it('argumento errado = mensagem de uso', () => {
    expect(() => planoDeBuild(['campo'], '1.0.0')).toThrow(/uso:/);
    expect(() => planoDeBuild(['campo', 'oficial', '--no-wait'], '1.0.0')).toThrow(/opção desconhecida/);
    expect(() => planoDeBuild(['campo', 'oficial'], '1.0')).toThrow(/versão inválida/);
  });
});

describe('comum.mjs: ambiente do eas (v1.0.1)', () => {
  it('liga EAS_SKIP_AUTO_FINGERPRINT=1 por padrão (o fingerprint levou ~20 min por build no v1.0.0) e mantém o resto', () => {
    expect(ambienteDoEas({ PATH: 'x' })).toEqual({ PATH: 'x', EAS_SKIP_AUTO_FINGERPRINT: '1' });
  });
  it('respeita quem já definiu a variável', () => {
    expect(ambienteDoEas({ EAS_SKIP_AUTO_FINGERPRINT: '0' }).EAS_SKIP_AUTO_FINGERPRINT).toBe('0');
  });
});
