/** T-0109: nome e versão dos builds (Campo-Oficial-v1.0.0 / Gestao-Oficial-v1.0.0). */
import { describe, expect, it } from 'vitest';

import { lerAlvo, lerPerfilEas, lerVersao, nomeDoApk, nomeDoBuild, perfilEas, textoDaVersao, versaoValida } from './nome-build';

describe('nome do build', () => {
  it('produção = Oficial, nas duas variantes', () => {
    expect(nomeDoBuild('campo', 'producao', '1.0.0')).toBe('Campo-Oficial-v1.0.0');
    expect(nomeDoBuild('gestao', 'producao', '1.2.10')).toBe('Gestao-Oficial-v1.2.10');
  });

  it('desenvolvimento = Dev (premissa: o pedido só nomeou Demo e Oficial)', () => {
    expect(nomeDoBuild('campo', 'desenvolvimento', '1.0.0')).toBe('Campo-Dev-v1.0.0');
  });

  it('APK publicado leva o mesmo nome', () => {
    expect(nomeDoApk('campo', 'producao', '1.0.0')).toBe('Campo-Oficial-v1.0.0.apk');
  });

  it('versão fora de X.Y.Z não gera nome', () => {
    for (const v of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', '', ' 1.0.0']) {
      expect(versaoValida(v)).toBe(false);
      expect(() => nomeDoBuild('campo', 'producao', v)).toThrow(/versão inválida/);
    }
    expect(versaoValida('10.20.30')).toBe(true);
    expect(versaoValida(undefined)).toBe(false);
  });
});

describe('linha da versão no Perfil', () => {
  it('é o nome do build', () => {
    expect(textoDaVersao('campo', 'producao', '1.0.0')).toBe('Campo-Oficial-v1.0.0');
    expect(textoDaVersao('gestao', 'producao', '1.0.0')).toBe('Gestao-Oficial-v1.0.0');
  });

  it('sem versão legível não quebra a tela', () => {
    expect(textoDaVersao('campo', 'producao', undefined)).toBe('Campo-Oficial-v?');
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
    expect(perfilEas('campo', 'producao')).toBe('campo-producao');
    expect(perfilEas('gestao', 'producao')).toBe('gestao-producao');
    expect(lerPerfilEas('campo-producao')).toEqual({ variante: 'campo', perfil: 'producao' });
    expect(lerPerfilEas('gestao-producao')).toEqual({ variante: 'gestao', perfil: 'producao' });
    expect(lerPerfilEas('base')).toBeNull();
    // perfis de desenvolvimento e preview saíram do eas.json
    expect(lerPerfilEas('gestao')).toBeNull();
    expect(lerPerfilEas('campo-preview')).toBeNull();
    expect(lerPerfilEas('campo-demo')).toBeNull();
  });

  it('argumentos dos scripts: só oficial (e sinônimos)', () => {
    expect(lerAlvo('Gestão', 'Oficial')).toEqual({ variante: 'gestao', perfil: 'producao' });
    expect(lerAlvo('gestao', 'producao')).toEqual({ variante: 'gestao', perfil: 'producao' });
    expect(lerAlvo('campo', 'oficial')).toEqual({ variante: 'campo', perfil: 'producao' });
    expect(() => lerAlvo('campo', 'demo')).toThrow(/<campo\|gestao> oficial/);
    expect(() => lerAlvo('campo', 'dev')).toThrow(/alvo inválido/);
    expect(() => lerAlvo('vendedor', 'oficial')).toThrow(/campo\|gestao/);
    expect(() => lerAlvo(undefined, undefined)).toThrow(/alvo inválido/);
  });
});
