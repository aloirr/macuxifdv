/**
 * T-0119 (🟡 da revisão R-20261108-183906): corrida entre a invalidação do retrato do catálogo e a carga. Repositório com banco e Core
 * falsos: o Core responde quando o teste manda, e o catálogo "vira" de uma versão para outra entre as leituras.
 */
import type { ClienteBanco, ContextoBase, TransacaoTenant } from '@macuxi/platform-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarRepositorioPostgres, esquecerRetratoCatalogo, RECONFERENCIA_RETRATO_MS, SEM_MARCAS, TTL_RETRATO_MS } from './repositorio-postgres';

const TENANT = '0ca00000-0000-4000-8000-0000000000a1';
const PRODUTO = '0ca00000-0000-4000-8000-0000000000b1';

interface Core {
  nome: string;
  /** Segura a resposta do Core até `liberar()`. */
  espera: Promise<void> | null;
  /** Versão barata do Catálogo (`max(updated_at)`) que o banco devolve; ausente = sem versão. */
  versao?: string | null;
  /** Quantas vezes o cadastro foi lido do Core. */
  leituras?: number;
}

function repositorio(core: Core, tenant = TENANT, emSegundoPlano = false) {
  const ctx = { usuario: { id: 'u1', tenant_id: tenant, perfil: 'vendedor' } } as unknown as ContextoBase;
  const db = {
    query: async (sql: string) => ({ rows: sql.includes('greatest') ? [{ versao: core.versao ?? null }] : /tabela_preco_item/.test(sql) ? [{ produto_id: PRODUTO }] : [] }),
  } as unknown as ClienteBanco;
  const tx = {
    consultar: async () => {
      core.leituras = (core.leituras ?? 0) + 1;
      const nome = core.nome; // o catálogo é lido AGORA, a resposta só chega depois da espera
      if (core.espera) await core.espera;
      return { clientes: [], usuarios: [], produtos: [{ id: PRODUTO, sku: 'S-1', nome, unidade: 'UN', ativo: true }] };
    },
  } as unknown as TransacaoTenant;
  // com `emSegundoPlano` a renovação roda por `ctx.comTenant` (como na API); sem ele, na própria chamada
  if (emSegundoPlano) (ctx as unknown as { comTenant: unknown }).comTenant = (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx);
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

describe('Catálogo: retrato renovado em segundo plano (T-0119, stale-while-revalidate)', () => {
  beforeEach(() => {
    esquecerRetratoCatalogo();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('RF-CAT-01 (T-0119): TTL vencido e versão igual — serve o mesmo retrato e não relê o cadastro', async () => {
    const core: Core = { nome: 'V1', espera: null, versao: '2026-11-11 10:00:00+00' };
    const primeira = await repositorio(core).produtosEmCache!();
    const leituras = core.leituras;
    await vi.advanceTimersByTimeAsync(TTL_RETRATO_MS + 1_000);
    expect(await repositorio(core).produtosEmCache!()).toBe(primeira);
    expect(core.leituras).toBe(leituras);
    // o retrato foi reconfirmado: dentro do novo TTL nem a versão é consultada
    expect(await repositorio(core).produtosEmCache!()).toBe(primeira);
  });

  it('RF-CAT-01 (T-0119): TTL vencido e versão nova — quem pede recebe o retrato antigo na hora e o novo entra depois, em segundo plano', async () => {
    const core: Core = { nome: 'V1', espera: null, versao: 'v1' };
    const primeira = await repositorio(core, TENANT, true).produtosEmCache!();
    core.nome = 'V2';
    core.versao = 'v2';
    await vi.advanceTimersByTimeAsync(TTL_RETRATO_MS + 1_000);
    const durante = await repositorio(core, TENANT, true).produtosEmCache!();
    expect(durante).toBe(primeira); // não esperou a renovação
    expect(durante[0]!.nome).toBe('V1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await repositorio(core, TENANT, true).produtosEmCache!())[0]!.nome).toBe('V2');
  });

  it('RF-CAT-01 (T-0119): uma só renovação por tenant, mesmo com várias requisições no TTL vencido', async () => {
    const core: Core = { nome: 'V1', espera: null, versao: 'v1' };
    await repositorio(core, TENANT, true).produtosEmCache!();
    const antes = core.leituras!;
    core.versao = 'v2';
    await vi.advanceTimersByTimeAsync(TTL_RETRATO_MS + 1_000);
    await Promise.all([1, 2, 3, 4, 5].map(() => repositorio(core, TENANT, true).produtosEmCache!()));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(core.leituras).toBe(antes + 1);
  });

  it('RF-CAT-01 (T-0119): versão mudou mas o conteúdo é o mesmo — mantém a lista (e o índice) em vez de trocar', async () => {
    const core: Core = { nome: 'V1', espera: null, versao: 'v1' };
    const primeira = await repositorio(core, TENANT, true).produtosEmCache!();
    core.versao = 'v2'; // por exemplo, só um preço mudou
    await vi.advanceTimersByTimeAsync(TTL_RETRATO_MS + 1_000);
    await repositorio(core, TENANT, true).produtosEmCache!();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await repositorio(core, TENANT, true).produtosEmCache!()).toBe(primeira);
  });

  it('RF-CAT-01 (T-0119): sem mudança de versão, o cadastro do Core ainda é relido depois da reconferência', async () => {
    const core: Core = { nome: 'V1', espera: null, versao: 'v1' };
    await repositorio(core, TENANT, true).produtosEmCache!();
    core.nome = 'V2'; // mudou no Core, que a versão não enxerga
    await vi.advanceTimersByTimeAsync(RECONFERENCIA_RETRATO_MS + 1_000);
    await repositorio(core, TENANT, true).produtosEmCache!();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await repositorio(core, TENANT, true).produtosEmCache!())[0]!.nome).toBe('V2');
  });
});
