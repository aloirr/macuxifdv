import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('lotes-panel: filtros (RD-0971, §P4)', () => {
  const fonte = readFileSync(new URL('./lotes-panel.tsx', import.meta.url), 'utf8');

  it('RD-0971: existe um único "Limpar filtros" (na barra); o estado vazio não repete a ação', () => {
    expect(fonte.match(/Limpar filtros/g)).toHaveLength(1);
    const vazio = fonte.slice(fonte.indexOf('<EstadoVazio'));
    expect(vazio.slice(0, vazio.indexOf('/>'))).not.toMatch(/acao=/);
  });
});
