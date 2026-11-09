/**
 * T-0109: scripts do EAS (mensagem do build, APK com o nome do build, link temporário do bucket) e invariantes da
 * versão (versao.json como fonte única do `version`; versionCode remoto e sempre crescente em todo perfil).
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import appConfig from '../../app.config';
import { configDoBucket, dadosDoBuild, opcoesDoDownload, urlsDoBucket } from './baixar-apk.mjs';
import { planoDeBuild } from './build.mjs';
import { ambienteDoEas } from './comum.mjs';
import { alvoNoBucket, chaveDoApk, codificar, urlAssinada, VALIDADE_MAXIMA_S } from './s3-assinado';

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

  it('versao.json está em 1.0.1 (próximo build: Campo-Demo-v1.0.1 / Gestao-Demo-v1.0.1)', () => {
    expect(versaoDoArquivo).toBe('1.0.1');
  });

  it('o app.config usa a versão do versao.json nas duas variantes', () => {
    for (const v of ['campo', 'gestao']) {
      process.env.APP_VARIANT = v;
      const c = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
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
    expect(perfis.sort()).toEqual(['campo', 'campo-preview', 'campo-producao', 'gestao', 'gestao-preview', 'gestao-producao']);
    for (const p of perfis) expect(herda(p), p).toBe(true);
  });
});

describe('build.mjs: mensagem do build', () => {
  it('campo demo → perfil campo-preview e mensagem Campo-Demo-v1.0.0', () => {
    const { builds, simular } = planoDeBuild(['campo', 'demo'], '1.0.0');
    expect(simular).toBe(false);
    expect(builds).toEqual([
      { nome: 'Campo-Demo-v1.0.0', perfilEas: 'campo-preview', args: ['build', '--platform', 'android', '--profile', 'campo-preview', '--message', 'Campo-Demo-v1.0.0'] },
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
    for (const canal of ['demo', 'oficial', 'dev']) {
      for (const b of planoDeBuild(['ambos', canal], '1.0.0').builds) expect(eas.build[b.perfilEas], b.perfilEas).toBeDefined();
    }
  });

  it('argumento errado = mensagem de uso', () => {
    expect(() => planoDeBuild(['campo'], '1.0.0')).toThrow(/uso:/);
    expect(() => planoDeBuild(['campo', 'demo', '--no-wait'], '1.0.0')).toThrow(/opção desconhecida/);
    expect(() => planoDeBuild(['campo', 'demo'], '1.0')).toThrow(/versão inválida/);
  });
});

describe('baixar-apk.mjs: APK com o nome do build', () => {
  const build = {
    id: 'b1',
    status: 'FINISHED',
    buildProfile: 'campo-preview',
    appVersion: '1.0.0',
    appBuildVersion: '42',
    message: 'Campo-Demo-v1.0.0',
    artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/x.apk' },
  };

  it('opções: alvo, pasta, publicar e validade', () => {
    const o = opcoesDoDownload(['campo', 'demo', '--publicar', '--validade-horas', '24', '--pasta', 'saida']);
    expect(o).toMatchObject({ alvos: [{ variante: 'campo', perfil: 'preview' }], publicar: true, validadeHoras: 24, pasta: 'saida', build: null });
    expect(opcoesDoDownload(['--build', 'abc'])).toMatchObject({ alvos: [], build: 'abc', validadeHoras: 72, pasta: 'dist/apk' });
    expect(opcoesDoDownload(['ambos', 'oficial']).alvos).toHaveLength(2);
    expect(() => opcoesDoDownload(['campo', 'demo', '--validade-horas', '200'])).toThrow(/1 a 168/);
    expect(() => opcoesDoDownload(['ambos', 'demo', '--build', 'x'])).toThrow(/ambos/);
    expect(() => opcoesDoDownload(['campo', 'demo', '--build'])).toThrow(/falta o valor/);
  });

  it('nome do arquivo = nome do build, pela versão gravada no build', () => {
    const d = dadosDoBuild(build, { variante: 'campo', perfil: 'preview' });
    expect(d).toMatchObject({ nomeApk: 'Campo-Demo-v1.0.0.apk', versionCode: '42', url: 'https://expo.dev/artifacts/eas/x.apk', avisoMensagem: null });
    expect(dadosDoBuild({ ...build, buildProfile: 'gestao-producao', appVersion: '1.1.0', message: undefined }, null).nomeApk).toBe('Gestao-Oficial-v1.1.0.apk');
  });

  it('avisa quando a mensagem do build não bate com o nome', () => {
    expect(dadosDoBuild({ ...build, message: 'build manual' }, null).avisoMensagem).toMatch(/Campo-Demo-v1\.0\.0/);
  });

  it('recusa build de outro perfil, não terminado ou sem APK', () => {
    expect(() => dadosDoBuild(build, { variante: 'gestao', perfil: 'preview' })).toThrow(/gestao-preview/);
    expect(() => dadosDoBuild({ ...build, status: 'IN_PROGRESS' }, null)).toThrow(/não terminou/);
    expect(() => dadosDoBuild({ ...build, artifacts: {} }, null)).toThrow(/sem|não tem APK/);
    expect(() => dadosDoBuild({ ...build, buildProfile: 'base' }, null)).toThrow(/não é campo\/gestao/);
  });

  it('bucket: lista só os NOMES das variáveis que faltam', () => {
    expect(() => configDoBucket({ MACUXI_APK_S3_CHAVE: 'segredo-que-nao-pode-vazar' })).toThrow(/MACUXI_APK_S3_ENDPOINT/);
    try {
      configDoBucket({ MACUXI_APK_S3_CHAVE: 'segredo-que-nao-pode-vazar' });
    } catch (e) {
      expect(String(e)).not.toContain('segredo-que-nao-pode-vazar');
    }
  });

  it('link temporário com a validade pedida e o nome do arquivo no download', () => {
    const bucket = configDoBucket({
      MACUXI_APK_S3_ENDPOINT: 'https://br-se1.magaluobjects.com',
      MACUXI_APK_S3_REGIAO: 'br-se1',
      MACUXI_APK_S3_BUCKET: 'macuxi-apk',
      MACUXI_APK_S3_CHAVE: 'AKID',
      MACUXI_APK_S3_SEGREDO: 'SEGREDO',
    });
    const agora = new Date('2026-11-07T12:00:00Z');
    const u = urlsDoBucket(bucket, 'Campo-Demo-v1.0.0.apk', '42', 72, agora);
    expect(u.chave).toBe('apk/build-42/Campo-Demo-v1.0.0.apk');
    expect(u.download.startsWith('https://br-se1.magaluobjects.com/macuxi-apk/apk/build-42/Campo-Demo-v1.0.0.apk?')).toBe(true);
    expect(u.download).toContain('X-Amz-Expires=259200');
    expect(u.download).toContain('response-content-disposition=attachment%3B%20filename%3D%22Campo-Demo-v1.0.0.apk%22');
    expect(u.envio).toContain('X-Amz-Expires=900');
    expect(u.download).not.toContain('SEGREDO');
    expect(u.expiraEm.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('s3-assinado: SigV4 na query', () => {
  it('confere com o exemplo de URL assinada da documentação da AWS (GET examplebucket/test.txt)', () => {
    const url = urlAssinada({
      metodo: 'GET',
      protocolo: 'https:',
      host: 'examplebucket.s3.amazonaws.com',
      caminho: '/test.txt',
      credenciais: { regiao: 'us-east-1', chave: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      agora: new Date('2013-05-24T00:00:00Z'),
      expiraEm: 86400,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('validade de 1 s a 7 dias; credencial completa', () => {
    const base = { metodo: 'GET' as const, protocolo: 'https:', host: 'h', caminho: '/b/k', credenciais: { regiao: 'r', chave: 'c', segredo: 's' }, agora: new Date(0) };
    expect(() => urlAssinada({ ...base, expiraEm: VALIDADE_MAXIMA_S + 1 })).toThrow(/7 dias/);
    expect(() => urlAssinada({ ...base, expiraEm: 0 })).toThrow(/limite/);
    expect(() => urlAssinada({ ...base, expiraEm: 60, credenciais: { regiao: 'r', chave: '', segredo: 's' } })).toThrow(/incompletas/);
  });

  it('codificação RFC 3986, chave e endereço no estilo de caminho', () => {
    expect(codificar("a b/c!'()*~")).toBe('a%20b%2Fc%21%27%28%29%2A~');
    expect(chaveDoApk('Gestao-Oficial-v1.0.0.apk', 7)).toBe('apk/build-7/Gestao-Oficial-v1.0.0.apk');
    expect(chaveDoApk('Campo-Demo-v1.0.0.apk', null, '')).toBe('sem-versioncode/Campo-Demo-v1.0.0.apk');
    expect(() => chaveDoApk('../x.apk', 1)).toThrow(/inválido/);
    expect(alvoNoBucket('https://s3.exemplo.com/', 'meu-bucket', 'a/b.apk')).toEqual({ protocolo: 'https:', host: 's3.exemplo.com', caminho: '/meu-bucket/a/b.apk' });
    expect(() => alvoNoBucket('http://s3.exemplo.com', 'meu-bucket', 'a')).toThrow(/https/);
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
