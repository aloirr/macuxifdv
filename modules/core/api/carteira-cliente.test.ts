import { cabecalhosDaRota, CACHE_CONTROL_SEM_CACHE, ErroHttpModulo, problemasCabecalhosRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CarteiraClienteRespostaSchema } from '../contracts';
import { listarCarteiraDoCliente, rotasDeCarteiraDoCliente, type RepositorioCarteiraCliente } from './carteira-cliente';

const C1 = '0ea00000-0000-4000-8000-000000000001';
const U1 = '0ea00000-0000-4000-8000-0000000000a1';
const repo: RepositorioCarteiraCliente = { vinculos: async (c) => (c === C1 ? [{ usuario_id: U1, nome: 'Ana', telefone: '92982373437' }] : []) };

describe('RN-CORE-04 / T-0168: GET clientes/:id/carteira (Gestão)', () => {
  it('RN-CORE-04: perfil de gestão recebe nome e links; o contrato Zod aceita a resposta', async () => {
    const r = await listarCarteiraDoCliente(repo, { perfil: 'gerente', clienteId: C1, hoje: '2026-11-19' });
    expect(CarteiraClienteRespostaSchema.parse(r).itens[0]).toMatchObject({ nome: 'Ana', tel: 'tel:+5592982373437' });
  });
  it('RN-CORE-04: vendedor e promotor recebem 403 e o repositório nem é consultado', async () => {
    let lido = false;
    const espiao: RepositorioCarteiraCliente = { vinculos: async () => ((lido = true), []) };
    for (const perfil of ['vendedor', 'promotor']) {
      await expect(listarCarteiraDoCliente(espiao, { perfil, clienteId: C1, hoje: '2026-11-19' })).rejects.toBeInstanceOf(ErroHttpModulo);
    }
    expect(lido).toBe(false);
  });
  it('RN-CORE-04: a rota só aceita perfis de gestão (a plataforma devolve 403 ao vendedor e ao promotor) e filtra pela carteira', () => {
    const r = rotasDeCarteiraDoCliente[0]!;
    expect(r.perfis).toEqual(['supervisor', 'gerente', 'analista', 'assistente', 'admin']);
    expect(r.carteira).toBe('filtrar_no_dominio');
  });
  it('RN-CORE-04: a resposta da rota sai com Cache-Control no-store (dado pessoal do tenant não fica em cache)', () => {
    const r = rotasDeCarteiraDoCliente[0]!;
    expect(r.semCache).toBe(true);
    expect(cabecalhosDaRota(r)).toEqual({ 'cache-control': CACHE_CONTROL_SEM_CACHE });
    expect(CACHE_CONTROL_SEM_CACHE).toBe('no-store');
    expect(problemasCabecalhosRota('carteira', r)).toEqual([]);
  });
});
