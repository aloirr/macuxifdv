import { describe, expect, it } from 'vitest';
import { frasesDaRecusa, rotuloDaChave, rotuloDoModulo, rotuloDoNivel } from './perfis';

describe('Perfis: rótulos e recusa (RN-CORE-35)', () => {
  it('spec §5.13: chave nova sem rótulo usa a descrição do manifesto até o primeiro " ("', () => {
    expect(rotuloDaChave('x.y', 'Fazer algo bonito (RN-X); mais')).toBe('Fazer algo bonito');
    expect(rotuloDaChave('farol.ver', 'qualquer')).toBe('Ver o farol de clientes');
  });

  it('spec §7.2: a recusa mostra no máximo 3 frases e "e mais N", sem JSON', () => {
    const viol = ['a', 'b', 'c', 'd', 'e'].map((mensagem) => ({ mensagem }));
    expect(frasesDaRecusa({ violacoes: viol }, 'x')).toEqual(['a', 'b', 'c', 'e mais 2']);
    expect(frasesDaRecusa(null, 'só a mensagem')).toEqual(['só a mensagem']);
  });

  it('módulos e níveis aparecem pelo nome, nunca pelo código', () => {
    expect(rotuloDoModulo('integracao')).toBe('Integração com o ERP');
    expect(rotuloDoModulo('core')).toBe('Core');
    expect(rotuloDoNivel('equipes_abaixo')).toBe('Equipes abaixo');
  });
});
