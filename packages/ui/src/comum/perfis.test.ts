import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ehPerfilPadrao, ORDEM_PERFIL_PADRAO, ROTULO_PERFIL_CURTO, ROTULO_PERFIL_LONGO, rotuloDoPerfil } from './perfis';
import { ORDEM_PERFIL_BASE, ROTULO_PERFIL_BASE } from '../web/perfis';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('RD-0014: nome dos 7 perfis padrão, um só em todas as telas', () => {
  it('texto fixado: curto (desenho da T-0111) e longo', () => {
    expect(ORDEM_PERFIL_PADRAO.map((p) => ROTULO_PERFIL_CURTO[p])).toEqual(['Vendedor', 'Promotor', 'Supervisor', 'Gerente', 'Analista', 'Assistente', 'Admin']);
    expect(ORDEM_PERFIL_PADRAO.map((p) => ROTULO_PERFIL_LONGO[p])).toEqual([
      'Vendedor de campo',
      'Promotor de trade marketing',
      'Supervisor de vendas',
      'Gerente comercial',
      'Analista comercial',
      'Assistente de backoffice',
      'Administrador da empresa',
    ]);
  });

  it('o curto é uma palavra; o longo começa pelo curto (ou o diz por extenso, no admin)', () => {
    for (const p of ORDEM_PERFIL_PADRAO) {
      expect(ROTULO_PERFIL_CURTO[p]).toMatch(/^\S+$/);
      expect(ROTULO_PERFIL_CURTO[p].length).toBeLessThanOrEqual(10);
      if (p !== 'admin') expect(ROTULO_PERFIL_LONGO[p].startsWith(`${ROTULO_PERFIL_CURTO[p]} `)).toBe(true);
    }
    // sem jargão interno no longo, que vai a quem não é do BKO (convite, app)
    expect(Object.values(ROTULO_PERFIL_LONGO).join(' ')).not.toMatch(/\bBKO\b/);
  });

  it('o kit web não tem mapa próprio: ROTULO_PERFIL_BASE e ORDEM_PERFIL_BASE são os mesmos objetos', () => {
    expect(ROTULO_PERFIL_BASE).toBe(ROTULO_PERFIL_CURTO);
    expect(ORDEM_PERFIL_BASE).toBe(ORDEM_PERFIL_PADRAO);
    // nenhum outro arquivo do kit escreve os nomes à mão
    expect(ler('../web/perfis.ts')).not.toMatch(/admin: 'Admin'/);
  });

  it('perfil padrão pelo mapa; perfil da empresa pelo nome dado; sem nome, o código', () => {
    expect(rotuloDoPerfil('assistente')).toBe('Assistente');
    expect(rotuloDoPerfil('admin', { forma: 'longo' })).toBe('Administrador da empresa');
    // o nome do banco não troca o de um perfil padrão: o texto é um só
    expect(rotuloDoPerfil('admin', { nome: 'Administrador' })).toBe('Admin');
    expect(rotuloDoPerfil('vendedor_balcao', { nome: ' Vendedor de balcão ' })).toBe('Vendedor de balcão');
    expect(rotuloDoPerfil('vendedor_balcao', { nome: '  ' })).toBe('vendedor_balcao');
    expect(ehPerfilPadrao('gerente')).toBe(true);
    expect(ehPerfilPadrao('gerente_regional')).toBe(false);
    expect(ehPerfilPadrao(null)).toBe(false);
  });

  it('exportado pelos dois kits (web pelo perfis.ts; mobile pelo índice e pela parte pura)', () => {
    expect(ler('../web/perfis.ts')).toContain("export * from '../comum/perfis'");
    expect(ler('../mobile/puro.ts')).toContain("export * from '../comum/perfis'");
    expect(ler('../mobile/index.ts')).toContain("export * from '../comum/perfis'");
  });
});
