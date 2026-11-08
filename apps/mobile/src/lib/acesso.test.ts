import { describe, expect, it } from 'vitest';
import type { PerfilDaRequisicao } from '@macuxi/platform-sdk';
import { entraEm, perfisDaSessao, perfisDeFabricaQueEntram } from './acesso';

describe('acesso do shell pelo motor do SDK (ADR 0033)', () => {
  it('RN-CORE-33: de fábrica, só admin, analista, assistente e gerente entram no BKO (supervisor não)', () => {
    expect(perfisDeFabricaQueEntram('bko').sort()).toEqual(['admin', 'analista', 'assistente', 'gerente']);
    for (const p of ['vendedor', 'promotor', 'supervisor'] as const) expect(entraEm('bko', p)).toBe(false);
  });

  it('RN-CORE-33: o portal é só do admin', () => {
    expect(perfisDeFabricaQueEntram('portal')).toEqual(['admin']);
  });

  it('sem perfil, nada (falha fechada)', () => {
    expect(perfisDaSessao(null)).toEqual([]);
    expect(entraEm('bko', null)).toBe(false);
    expect(entraEm('bko', undefined)).toBe(false);
  });

  it('com os perfis resolvidos pela API, vale o que veio (não o perfil base)', () => {
    const tirouBko: PerfilDaRequisicao[] = [{ codigo: 'gerente_sem_bko', base: 'gerente', permissoes: { 'acesso.gestao': {} } }];
    expect(entraEm('bko', 'gerente', tirouBko)).toBe(false);
    expect(entraEm('gestao', 'gerente', tirouBko)).toBe(true);
    const deuBko: PerfilDaRequisicao[] = [{ codigo: 'analista_x', base: 'analista', permissoes: { 'acesso.bko': {} } }];
    expect(entraEm('bko', 'analista', deuBko)).toBe(true);
  });

  it('lista vazia de perfis resolvidos cai no padrão de fábrica', () => {
    expect(entraEm('bko', 'admin', [])).toBe(true);
  });
});

describe('onde o perfil entra (lista da demonstração)', () => {
  it('RN-CORE-33: supervisor só no Gestão; gerente no Gestão e no BKO; vendedor no Campo; admin no BKO', async () => {
    const { ondeOPerfilEntra } = await import('./acesso');
    expect(ondeOPerfilEntra('supervisor')).toBe('o Macuxi Gestão');
    expect(ondeOPerfilEntra('gerente')).toBe('o Macuxi Gestão ou o backoffice (web)');
    expect(ondeOPerfilEntra('vendedor')).toBe('o Macuxi Campo');
    expect(ondeOPerfilEntra('admin')).toBe('o backoffice (web)');
    expect(ondeOPerfilEntra(null)).toBeNull();
  });
});
