import { describe, expect, it } from 'vitest';
import { rotuloDaPermissao } from './acesso';
import { frasesDaRecusa, rotuloDaChave, rotuloDoModulo, rotuloDoNivel } from './perfis';

describe('Perfis: rótulos e recusa (RN-CORE-35)', () => {
  it('spec §5.13: a chave com rótulo curado usa o de ROTULO_DA_PERMISSAO, não a descrição', () => {
    expect(rotuloDaPermissao('conector.gerenciar', 'qualquer')).toBe('Cadastrar o Conector e a chave de acesso');
    expect(rotuloDaPermissao('visita.checkin_fora_de_rota')).toBe('Check-in fora de rota');
  });

  it('spec §5.13: chave sem rótulo usa a descrição do manifesto até o primeiro " ("', () => {
    expect(rotuloDaChave('x.y', 'Fazer algo bonito (RN-X); mais')).toBe('Fazer algo bonito');
    expect(rotuloDaChave('x.y', 'Sem parênteses')).toBe('Sem parênteses');
    expect(rotuloDaChave('x.y', '')).toBe('x.y');
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
