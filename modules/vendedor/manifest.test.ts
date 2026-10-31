import { describe, expect, it } from 'vitest';
import { defineModule } from '@macuxi/platform-sdk';
import manifest from './manifest';

describe('manifesto do vendedor', () => {
  it('RN-PRO-01: nenhuma ação de pedido tem promotor e promotor não é perfil do módulo', () => {
    const acoes = Object.entries(manifest.acoes);
    expect(acoes.map(([nome]) => nome).sort()).toEqual(['pedido.aprovar', 'pedido.cancelar', 'pedido.criar', 'pedido.criar_em_nome', 'pedido.editar', 'pedido.excluir']);
    for (const [, def] of acoes) expect(def.perfis).not.toContain('promotor');
    expect(manifest.perfis).not.toContain('promotor');
  });

  it('RN-VEN: aprovar e criar em nome ficam com supervisão/gestão; o manifesto recusa promotor em pedido', () => {
    expect(manifest.acoes['pedido.aprovar']!.perfis).toEqual(['supervisor', 'gerente', 'analista']);
    expect(manifest.acoes['pedido.criar_em_nome']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(() => defineModule({ ...manifest, acoes: { 'pedido.criar': { perfis: ['promotor'] } } })).toThrow(/RN-PRO-01/);
  });
});
