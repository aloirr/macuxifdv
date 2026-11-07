/** T-0109: nome e versão dos builds (Campo-Demo-v1.0.0 / Gestao-Oficial-v1.0.0). */
import { describe, expect, it } from 'vitest';

import { lerAlvo, lerPerfilEas, lerVersao, nomeDoApk, nomeDoBuild, perfilEas, textoDaVersao, versaoValida } from './nome-build';

describe('nome do build', () => {
  it('preview = Demo e produção = Oficial, nas duas variantes', () => {
    expect(nomeDoBuild('campo', 'preview', '1.0.0')).toBe('Campo-Demo-v1.0.0');
    expect(nomeDoBuild('gestao', 'preview', '1.0.0')).toBe('Gestao-Demo-v1.0.0');
    expect(nomeDoBuild('campo', 'producao', '1.0.0')).toBe('Campo-Oficial-v1.0.0');
    expect(nomeDoBuild('gestao', 'producao', '1.2.10')).toBe('Gestao-Oficial-v1.2.10');
  });

  it('desenvolvimento = Dev (premissa: o pedido só nomeou Demo e Oficial)', () => {
    expect(nomeDoBuild('campo', 'desenvolvimento', '1.0.0')).toBe('Campo-Dev-v1.0.0');
  });

  it('APK publicado leva o mesmo nome', () => {
    expect(nomeDoApk('campo', 'preview', '1.0.0')).toBe('Campo-Demo-v1.0.0.apk');
  });

  it('versão fora de X.Y.Z não gera nome', () => {
    for (const v of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', '', ' 1.0.0']) {
      expect(versaoValida(v)).toBe(false);
      expect(() => nomeDoBuild('campo', 'preview', v)).toThrow(/versão inválida/);
    }
    expect(versaoValida('10.20.30')).toBe(true);
    expect(versaoValida(undefined)).toBe(false);
  });
});

describe('linha da versão no Perfil', () => {
  it('é o nome do build', () => {
    expect(textoDaVersao('campo', 'preview', '1.0.0')).toBe('Campo-Demo-v1.0.0');
    expect(textoDaVersao('gestao', 'producao', '1.0.0')).toBe('Gestao-Oficial-v1.0.0');
  });

  it('sem versão legível não quebra a tela', () => {
    expect(textoDaVersao('campo', 'preview', undefined)).toBe('Campo-Demo-v?');
    expect(textoDaVersao('gestao', 'producao', 'abc')).toBe('Gestao-Oficial-v?');
  });
});

describe('versão do versao.json', () => {
  it('lê X.Y.Z', () => {
    expect(lerVersao({ versao: '1.0.0' })).toBe('1.0.0');
  });

  it('erro claro se faltar ou vier torta', () => {
    expect(() => lerVersao({})).toThrow(/versao\.json/);
    expect(() => lerVersao({ versao: 1 })).toThrow(/versao\.json/);
    expect(() => lerVersao(null)).toThrow(/versao\.json/);
    expect(() => lerVersao({ versao: '1.0' })).toThrow(/X\.Y\.Z/);
  });
});

describe('perfis do eas.json', () => {
  it('variante + canal → perfil e volta', () => {
    expect(perfilEas('campo', 'preview')).toBe('campo-preview');
    expect(perfilEas('gestao', 'producao')).toBe('gestao-producao');
    expect(perfilEas('gestao', 'desenvolvimento')).toBe('gestao');
    expect(lerPerfilEas('campo-producao')).toEqual({ variante: 'campo', perfil: 'producao' });
    expect(lerPerfilEas('gestao')).toEqual({ variante: 'gestao', perfil: 'desenvolvimento' });
    expect(lerPerfilEas('base')).toBeNull();
    expect(lerPerfilEas('campo-demo')).toBeNull();
  });

  it('argumentos dos scripts: demo/oficial/dev e sinônimos', () => {
    expect(lerAlvo('campo', 'demo')).toEqual({ variante: 'campo', perfil: 'preview' });
    expect(lerAlvo('Gestão', 'Oficial')).toEqual({ variante: 'gestao', perfil: 'producao' });
    expect(lerAlvo('gestao', 'producao')).toEqual({ variante: 'gestao', perfil: 'producao' });
    expect(lerAlvo('campo', 'dev')).toEqual({ variante: 'campo', perfil: 'desenvolvimento' });
    expect(() => lerAlvo('vendedor', 'demo')).toThrow(/campo\|gestao/);
    expect(() => lerAlvo('campo', 'beta')).toThrow(/demo\|oficial\|dev/);
    expect(() => lerAlvo(undefined, undefined)).toThrow(/alvo inválido/);
  });
});
