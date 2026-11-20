import { describe, expect, it } from 'vitest';
import type { LicencasEstado } from '../../contracts';
import { csvDeLicencas, efetivosDoUsuario, efetivosListaveisDoUsuario, linhasDoNivel, linhasListaveisDoNivel, modulosQueTambemDesligam } from './licencas';

const U1 = '0b000000-0000-4000-8000-000000000001';
const estado: LicencasEstado = {
  modulos: ['core', 'catalogo', 'vendedor', 'promotor'],
  dependencias: { catalogo: ['core'], vendedor: ['core', 'catalogo'], promotor: ['core'] },
  tenant: { core: true, catalogo: true, vendedor: true, promotor: false },
  perfis: { vendedor: ['core', 'catalogo', 'vendedor'], promotor: ['core', 'promotor'], admin: ['core'] },
  usuarios: [{ id: U1, nome: 'Vera "V." Silva', email: 'vera@exemplo.com.br', perfil: 'vendedor', removidos: [] }],
};

describe('RF-CORE-02: tela de licenças (tenant → perfil → usuário)', () => {
  it('RN-CORE-01: linhas por nível; o core vem travado e sempre ativo', () => {
    const t = linhasDoNivel(estado, 'tenant');
    expect(t.find((l) => l.modulo === 'core')).toEqual({ modulo: 'core', ativo: true, travado: true });
    expect(t.find((l) => l.modulo === 'promotor')?.ativo).toBe(false);
    expect(linhasDoNivel(estado, 'perfil', { perfil: 'promotor' }).filter((l) => l.ativo).map((l) => l.modulo)).toEqual(['core', 'promotor']);
    expect(linhasDoNivel(estado, 'usuario', { usuarioId: U1 }).every((l) => l.ativo)).toBe(true);
  });

  it('RN-CORE-01: a tela de licenças não lista o core, como o "Meus módulos" do app (linhas e efetivos)', () => {
    expect(linhasListaveisDoNivel(estado, 'tenant').map((l) => l.modulo)).toEqual(['catalogo', 'vendedor', 'promotor']);
    expect(linhasListaveisDoNivel(estado, 'perfil', { perfil: 'promotor' }).filter((l) => l.ativo).map((l) => l.modulo)).toEqual(['promotor']);
    expect(efetivosListaveisDoUsuario(estado, U1)).toEqual(['catalogo', 'vendedor']);
  });

  it('RN-CORE-01: efetivos do usuário = tenant ∩ perfil − exceções (a exceção só remove)', () => {
    expect(efetivosDoUsuario(estado, U1)).toEqual(['core', 'catalogo', 'vendedor']);
    const comExcecao = { ...estado, usuarios: [{ ...estado.usuarios[0]!, removidos: ['vendedor' as const] }] };
    expect(efetivosDoUsuario(comExcecao, U1)).toEqual(['core', 'catalogo']);
    expect(efetivosDoUsuario(estado, 'inexistente')).toEqual([]);
  });

  it('RN-CORE-03: desligar o Catálogo avisa que o Vendedor também desliga (só se estiver ligado no nível)', () => {
    expect(modulosQueTambemDesligam(estado, 'catalogo', ['core', 'catalogo', 'vendedor'])).toEqual(['vendedor']);
    expect(modulosQueTambemDesligam(estado, 'catalogo', ['core', 'catalogo'])).toEqual([]);
    expect(modulosQueTambemDesligam(estado, 'vendedor', ['core', 'catalogo', 'vendedor'])).toEqual([]);
  });

  it('exportar CSV: BOM, separador ;, aspas escapadas e os três níveis', () => {
    const csv = csvDeLicencas({ ...estado, usuarios: [{ ...estado.usuarios[0]!, nome: 'Vera "V." Silva', removidos: ['vendedor'] }] });
    expect(csv.startsWith('﻿"nivel";"alvo";"modulo";"estado"')).toBe(true);
    expect(csv).toContain('"tenant";"empresa";"promotor";"inativo"');
    expect(csv).toContain('"perfil";"promotor";"promotor";"ativo"');
    expect(csv).toContain('"usuario";"vera@exemplo.com.br";"vendedor";"removido"');
    expect(csv).toContain('"efetivos";"vera@exemplo.com.br";"core catalogo";"efetivo"');
  });
});
