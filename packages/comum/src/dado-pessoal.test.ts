import { describe, expect, it } from 'vitest';
import { MARCADOR_DADO_PESSOAL, mascararDadoPessoal as m } from './dado-pessoal';

describe('mascararDadoPessoal (regra 8: sem dado pessoal em log; fonte única do shell e do Conector)', () => {
  it('e-mail, CNPJ, CPF e telefone com DDD, com e sem máscara', () => {
    expect(m('cliente 123.456.789-09 / 12.345.678/0001-95 / ana@ex.com.br / (95) 99123-4567')).toBe(
      'cliente [cpf] / [cnpj] / [e-mail] / [telefone]',
    );
    expect(m('12345678909 e 12345678000195')).toBe('[cpf] e [cnpj]');
    expect(m('Cliente ana@x.com.br, CNPJ 12.345.678/0001-90, tel (92) 99123-4567.')).toBe('Cliente [e-mail], CNPJ [cnpj], tel [telefone].');
    // 11 dígitos corridos não distinguem celular com DDD de CPF: sai como [cpf], mascarado do mesmo jeito
    expect(m('fone 92 3234-5678 ou (92) 991234567 ou 92991234567')).toBe('fone [telefone] ou [telefone] ou [cpf]');
  });

  it('e-mail com acento, com dígitos e sem domínio de topo', () => {
    expect(m('joão.silva@empresa.com.br')).toBe('[e-mail]');
    expect(m('12345678909@x.com')).toBe('[e-mail]');
    expect(m('usuario fulano@servidor recusado')).toBe('usuario [e-mail] recusado');
  });

  it('telefone sem DDD (E8 do testes) e sequência longa fora do padrão', () => {
    expect(m('ligar 99123-4567 ou 3234-5678 ou 991234567')).toBe('ligar [telefone] ou [telefone] ou [telefone]');
    expect(m('conta 1234 5678 9012 3456 bloqueada')).toBe('conta [número] bloqueada');
  });

  it('fica o que o suporte precisa: UUID, pilha, data e hora, número curto', () => {
    const fica = [
      'id 550e8400-e29b-41d4-a716-446655440000',
      'id 9f3c2b1a-7d4e-4c8f-a1b2-c3d4e5f6a7b8 e 12345678-1234-4123-8123-123456789012',
      'at f (index.android.bundle:1234:56789)',
      'em 2026-11-08T21:11:00.000Z, pedido 1234',
      'em 2026-11-09 02:50:00 e 09/11/2026 14:30',
      'pedido 000010, versão 1.0.1, 10.0.2.2:3000',
    ];
    for (const t of fica) expect(m(t)).toBe(t);
  });

  it('não toca segredo já mascarado pelo chamador (string de conexão do Conector)', () => {
    expect(m('postgres://user:***@host/db')).toBe('postgres://user:***@host/db');
  });

  it('valor em reais com R$ (T-0158, D-T0158-1), com e sem milhar, espaço, centavos ou sinal', () => {
    expect(m('Pedido de R$ 1.234,56 travou')).toBe('Pedido de [valor] travou');
    expect(m('Total R$ 530,83 acima do crédito')).toBe('Total [valor] acima do crédito');
    expect(m('R$530,83, R$ 1.234.567,89, R$ 10, -R$ 10,00 e R$ -5,5.')).toBe('[valor], [valor], [valor], [valor] e [valor].');
    expect(m('Limite R$ 10.')).toBe('Limite [valor].');
    // sem R$ fica (número curto, data, hora, versão e pilha continuam para o suporte)
    expect(m('item 3 de 10, versão 1.0.3, em 10/11/2026 14:30')).toBe('item 3 de 10, versão 1.0.3, em 10/11/2026 14:30');
  });

  it('marcadores estáveis', () => {
    expect(Object.values(MARCADOR_DADO_PESSOAL)).toEqual(['[e-mail]', '[cnpj]', '[cpf]', '[telefone]', '[número]', '[valor]']);
  });
});
