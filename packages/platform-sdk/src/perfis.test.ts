import { describe, expect, it } from 'vitest';
import { mensagemPerfilForaDoApp, perfilDaFaseM, perfilUsaApp } from './perfis';

describe('perfis por app e conversão da Fase M', () => {
  it('converte os papéis em inglês da Fase M para os perfis do doc 03', () => {
    expect(['seller', 'manager', 'analyst', 'bko_assistant', 'admin'].map(perfilDaFaseM)).toEqual(['vendedor', 'gerente', 'analista', 'assistente', 'admin']);
    expect(perfilDaFaseM('diretor')).toBeNull();
    expect(perfilDaFaseM(undefined)).toBeNull();
  });

  it('Q6: promotor e vendedor não acessam o BKO; Campo é de vendedor/promotor e Gestão de supervisor/gerente', () => {
    expect(perfilUsaApp('vendedor', 'web')).toBe(false);
    expect(perfilUsaApp('promotor', 'web')).toBe(false);
    expect(perfilUsaApp('supervisor', 'web')).toBe(true);
    expect(perfilUsaApp('promotor', 'campo')).toBe(true);
    expect(perfilUsaApp('gerente', 'campo')).toBe(false);
    expect(perfilUsaApp('gerente', 'gestao')).toBe(true);
    expect(perfilUsaApp(null, 'gestao')).toBe(false);
  });

  it('doc 03: perfil fora do app recebe mensagem com o app certo; perfil do app não recebe nada', () => {
    expect(mensagemPerfilForaDoApp('promotor', 'web')).toBe('O perfil promotor não usa o backoffice (web). Entre pelo app Macuxi Campo.');
    expect(mensagemPerfilForaDoApp('supervisor', 'campo')).toBe('O perfil supervisor não usa o app Macuxi Campo. Entre pelo app Macuxi Gestão ou pelo backoffice (web).');
    expect(mensagemPerfilForaDoApp('admin', 'gestao')).toBe('O perfil admin não usa o app Macuxi Gestão. Entre pelo backoffice (web).');
    expect(mensagemPerfilForaDoApp('gerente', 'web')).toBeNull();
    expect(mensagemPerfilForaDoApp(null, 'web')).toMatch(/não foi reconhecido/);
  });
});
