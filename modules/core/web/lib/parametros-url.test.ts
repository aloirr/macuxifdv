import { describe, expect, it } from 'vitest';
import { perfilDosModulos, perfilEmEdicao } from './parametros-url';

const q = (s: string) => new URLSearchParams(s);

describe('parâmetros de URL dos painéis Perfis e Módulos (/parametros/acesso)', () => {
  it('filtrar o perfil em Módulos não abre a edição em Perfis', () => {
    const p = q('nivel=perfil&modulos_perfil=promotor');
    expect(perfilEmEdicao(p)).toBeNull();
    expect(perfilDosModulos(p)).toBe('promotor');
  });
  it('editar um perfil em Perfis não muda o filtro de Módulos', () => {
    const p = q('editar_perfil=gerente');
    expect(perfilEmEdicao(p)).toBe('gerente');
    expect(perfilDosModulos(p)).toBeNull();
  });
  it('link antigo /perfis?perfil=X abre a edição em Perfis e não filtra Módulos', () => {
    const p = q('perfil=supervisor');
    expect(perfilEmEdicao(p)).toBe('supervisor');
    expect(perfilDosModulos(p)).toBeNull();
  });
  it('link antigo de Módulos com nivel e perfil não abre a edição em Perfis', () => {
    expect(perfilEmEdicao(q('nivel=perfil&perfil=promotor'))).toBeNull();
  });
});
