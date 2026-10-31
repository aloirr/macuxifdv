import { describe, expect, it } from 'vitest';
import { perfilDaFaseM, perfilUsaApp } from './perfis';

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
});
