/** Push pelo FCM direto (v1.0.10): `android.googleServicesFile` no app.config.ts só quando o arquivo existe. */
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import configDoApp, { arquivoGoogleServices, GOOGLE_SERVICES_PADRAO } from '../../app.config';

const RAIZ = '/projeto/apps/mobile';

describe('arquivoGoogleServices', () => {
  it('usa o caminho de GOOGLE_SERVICES_JSON (Actions e EAS) quando o arquivo existe', () => {
    const existe = (c: string) => c === '/tmp/runner/google-services.json';
    expect(arquivoGoogleServices(RAIZ, { GOOGLE_SERVICES_JSON: '/tmp/runner/google-services.json' }, existe)).toEqual({
      googleServicesFile: '/tmp/runner/google-services.json',
    });
  });
  it('sem a variável, usa ./google-services.json da raiz do app, se existir', () => {
    const padrao = resolve(RAIZ, GOOGLE_SERVICES_PADRAO);
    expect(arquivoGoogleServices(RAIZ, {}, (c) => c === padrao)).toEqual({ googleServicesFile: padrao });
    expect(arquivoGoogleServices(RAIZ, { GOOGLE_SERVICES_JSON: '  ' }, (c) => c === padrao)).toEqual({ googleServicesFile: padrao });
  });
  it('sem o arquivo, sem a chave (dev local e bundle seguem sem push)', () => {
    expect(arquivoGoogleServices(RAIZ, {}, () => false)).toEqual({});
    expect(arquivoGoogleServices(RAIZ, { GOOGLE_SERVICES_JSON: '/nao/existe.json' }, () => false)).toEqual({});
  });
});

describe('app.config.ts com e sem o google-services.json', () => {
  const contexto = (projectRoot: string) => ({ projectRoot, staticConfigPath: null, packageJsonPath: null, config: {} });
  it('sem o arquivo: sem googleServicesFile; o projeto da Expo continua (projectId e owner)', () => {
    const anterior = process.env.GOOGLE_SERVICES_JSON;
    delete process.env.GOOGLE_SERVICES_JSON;
    try {
      const c = configDoApp(contexto('/caminho/que/nao/existe'));
      expect(c.android).not.toHaveProperty('googleServicesFile');
      expect(c.owner).toBe('macuxifdv');
      expect((c.extra as { eas?: { projectId?: string } }).eas?.projectId).toBeTruthy();
    } finally {
      if (anterior !== undefined) process.env.GOOGLE_SERVICES_JSON = anterior;
    }
  });
  it('com o arquivo indicado na variável: googleServicesFile aponta para ele', () => {
    const anterior = process.env.GOOGLE_SERVICES_JSON;
    // um arquivo que sempre existe no repositório faz as vezes do google-services.json
    const arquivo = resolve(__dirname, '../../package.json');
    process.env.GOOGLE_SERVICES_JSON = arquivo;
    try {
      expect(configDoApp(contexto('/qualquer')).android?.googleServicesFile).toBe(arquivo);
    } finally {
      if (anterior === undefined) delete process.env.GOOGLE_SERVICES_JSON;
      else process.env.GOOGLE_SERVICES_JSON = anterior;
    }
  });
});
