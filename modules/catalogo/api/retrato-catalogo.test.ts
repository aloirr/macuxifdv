/**
 * T-0119 (🟡 da revisão R-20261108-183906): corrida entre a invalidação do retrato do catálogo e a carga. Repositório com banco e Core
 * falsos: o Core responde quando o teste manda, e o catálogo "vira" de uma versão para outra entre as leituras.
 */
import type { ClienteBanco, ContextoBase, TransacaoTenant } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { criarRepositorioPostgres, esquecerRetratoCatalogo, SEM_MARCAS } from './repositorio-postgres';

const TENANT = '0ca00000-0000-4000-8000-0000000000a1';
const PRODUTO = '0ca00000-0000-4000-8000-0000000000b1';

interface Core {
  nome: string;
  /** Segura a resposta do Core até `liberar()`. */
  espera: Promise<void> | null;
}

function repositorio(core: Core, tenant = TENANT) {
  const ctx = { usuario: { id: 'u1', tenant_id: tenant, perfil: 'vendedor' } } as unknown as ContextoBase;
  const db = {
    query: async (sql: string) => ({ rows: /tabela_preco_item/.test(sql) ? [{ produto_id: PRODUTO }] : [] }),
  } as unknown as ClienteBanco;
  const tx = {
    consultar: async () => {
      const nome = core.nome; // o catálogo é lido AGORA, a resposta só chega depois da espera
      if (core.espera) await core.espera;
      return { clientes: [], usuarios: [], produtos: [{ id: PRODUTO, sku: 'S-1', nome, unidade: 'UN', ativo: true }] };
    },
  } as unknown as TransacaoTenant;
  return criarRepositorioPostgres({ marcas: SEM_MARCAS })(ctx, db, tx);
}

function porta(): { espera: Promise<void>; liberar: () => void } {
  let liberar!: () => void;
  const espera = new Promise<void>((r) => (liberar = r));
  return { espera, liberar };
}

describe('Catálogo: retrato do catálogo em memória × invalidação (T-0119)', () => {
  beforeEach(() => esquecerRetratoCatalogo());

  it('T-0119: um descarte durante a carga não deixa o retrato velho (a carga em andamento não grava de volta)', async () => {
    const core: Core = { nome: 'Velho', espera: null };
    const { espera, liberar } = porta();
    core.espera = espera;
    const carga = repositorio(core).produtosEmCache!(); // lê "Velho" e fica esperando
    await Promise.resolve();
    esquecerRetratoCatalogo(TENANT); // a gravação chegou no meio da carga
    liberar();
    expect((await carga)[0]!.nome).toBe('Velho'); // quem pediu antes da gravação recebe o que leu
    core.nome = 'Novo';
    core.espera = null;
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Novo'); // mas o velho não virou retrato
  });

  it('T-0119: uma carga velha que termina depois de uma mais nova não a sobrescreve', async () => {
    const core: Core = { nome: 'Velho', espera: null };
    const { espera, liberar } = porta();
    core.espera = espera;
    const velha = repositorio(core).produtosEmCache!(); // fica presa
    await Promise.resolve();
    esquecerRetratoCatalogo(TENANT);
    core.nome = 'Novo';
    core.espera = null;
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Novo'); // carga nova termina primeiro e vira retrato
    liberar();
    await velha;
    core.nome = 'Outro'; // se o retrato tivesse sido sobrescrito, a próxima leitura viria dele; se estiver correto, é o Novo (dentro do TTL)
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Novo');
  });

  it('T-0119: gravação seguida de busca devolve o dado novo (busca no meio da transação + descarte depois do commit)', async () => {
    const core: Core = { nome: 'Velho', espera: null };
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Velho');
    // a rota descarta antes de gravar...
    esquecerRetratoCatalogo(TENANT);
    // ...outra requisição busca antes do COMMIT e enxerga o catálogo ainda sem a mudança (isolamento da transação): guarda o velho
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Velho');
    // COMMIT: o catálogo agora é outro, e a rota descarta de novo (aposGravar)
    core.nome = 'Novo';
    esquecerRetratoCatalogo(TENANT);
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('Novo');
  });

  it('T-0119: o descarte de um tenant não derruba o retrato de outro; esquecer tudo derruba os dois', async () => {
    const outro = '0ca00000-0000-4000-8000-0000000000a2';
    const core: Core = { nome: 'V1', espera: null };
    await repositorio(core).produtosEmCache!();
    await repositorio(core, outro).produtosEmCache!();
    core.nome = 'V2';
    esquecerRetratoCatalogo(TENANT);
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('V2');
    expect((await repositorio(core, outro).produtosEmCache!())[0]!.nome).toBe('V1');
    esquecerRetratoCatalogo();
    expect((await repositorio(core, outro).produtosEmCache!())[0]!.nome).toBe('V2');
  });

  it('T-0119: falha na carga não deixa retrato nem trava a próxima leitura', async () => {
    const core: Core = { nome: 'V1', espera: null };
    const ctx = { usuario: { id: 'u1', tenant_id: TENANT, perfil: 'vendedor' } } as unknown as ContextoBase;
    const db = { query: async () => ({ rows: [{ produto_id: PRODUTO }] }) } as unknown as ClienteBanco;
    const quebrado = { consultar: async () => { throw new Error('Core fora do ar'); } } as unknown as TransacaoTenant;
    await expect(criarRepositorioPostgres({ marcas: SEM_MARCAS })(ctx, db, quebrado).produtosEmCache!()).rejects.toThrow('Core fora do ar');
    expect((await repositorio(core).produtosEmCache!())[0]!.nome).toBe('V1');
  });
});
