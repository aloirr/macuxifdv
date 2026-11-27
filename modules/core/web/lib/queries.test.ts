import { describe, expect, it } from 'vitest';
import { lerPerfilOpcoesV2 } from './queries';

describe('ADR 0073 §2.8: caixa de perfis do cadastro de usuário lê a resposta V2 (sem base)', () => {
  it('RN-CORE-54: lê {codigo,nome,cargo,onde_entra} de /core/perfis/opcoes e a caixa não fica vazia', async () => {
    const chamadas: string[] = [];
    const chamar = (async (caminho: string) => {
      chamadas.push(caminho);
      return { itens: [{ codigo: 'vendedor', nome: 'Vendedor', cargo: 'vendedor', onde_entra: ['campo'] }, { codigo: 'promotor_praca', nome: 'Promotor da praça', cargo: 'promotor', onde_entra: ['campo'] }] };
    }) as never;
    const itens = await lerPerfilOpcoesV2(chamar);
    expect(chamadas).toEqual(['/core/perfis/opcoes']);
    expect(itens.map((i) => i.codigo)).toEqual(['vendedor', 'promotor_praca']);
    expect(itens[1]?.cargo).toBe('promotor');
    expect('base' in (itens[0] ?? {})).toBe(false);
  });
});
