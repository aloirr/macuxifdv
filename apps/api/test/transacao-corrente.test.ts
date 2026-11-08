/**
 * T-0118 (D-T0107a) sem banco: a marca da transação corrente, a guarda de conexão dentro de transação e o reuso da
 * transação por `ctx.carteira()`/`ctx.usuariosVisiveis()` dentro de `ctx.comTenant`. A prova com o Postgres (pool 2, 6
 * pushes de pedido ao mesmo tempo) fica em `conexao-na-transacao.banco.test.ts`.
 */
import { definirModuloApi, type AcessoBanco, type ClienteBanco, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import {
  CODIGO_CONEXAO_NA_TRANSACAO,
  criarGuardaConexao,
  dentroDaTransacao,
  ErroConexaoNaTransacao,
  modoGuardaConexao,
  transacaoAberta,
} from '../src/transacao-corrente';
import { cab, CLIENTE_DA_CARTEIRA, modulosDeTeste, opcoesDeTeste, TENANT } from './apoio';

const cliente = (nome: string): ClienteBanco & { nome: string } => ({ nome, query: async () => ({ rows: [], rowCount: 0 }) });

describe('marca da transação corrente (AsyncLocalStorage)', () => {
  it('vale dentro de fn, inclusive depois de await, e some quando a transação termina', async () => {
    const dono = {};
    const db = cliente('tx');
    expect(transacaoAberta(dono)).toBeUndefined();
    let solta: Promise<unknown> | null = null;
    await dentroDaTransacao(dono, db, TENANT, async () => {
      await Promise.resolve();
      expect(transacaoAberta(dono)).toMatchObject({ db, tenantId: TENANT, aberta: true });
      // outro dono (outro pool) não enxerga esta transação
      expect(transacaoAberta({})).toBeUndefined();
      // promessa solta que continua depois do commit não fica marcada
      solta = new Promise((ok) => setTimeout(ok, 5)).then(() => transacaoAberta(dono));
    });
    expect(transacaoAberta(dono)).toBeUndefined();
    expect(await solta).toBeUndefined();
  });

  it('aninhada: a mais interna aberta vence; terminada a interna, a externa continua visível', async () => {
    const dono = {};
    const fora = cliente('fora');
    const dentro = cliente('dentro');
    await dentroDaTransacao(dono, fora, TENANT, async () => {
      await dentroDaTransacao(dono, dentro, null, async () => {
        expect(transacaoAberta(dono)?.db).toBe(dentro);
      });
      expect(transacaoAberta(dono)?.db).toBe(fora);
    });
  });
});

describe('guarda de conexão dentro de transação do mesmo pool', () => {
  it('modo: variável MACUXI_GUARDA_CONEXAO; sem ela, aviso em produção e erro no resto (teste e desenvolvimento)', () => {
    expect(modoGuardaConexao({})).toBe('erro');
    expect(modoGuardaConexao({ NODE_ENV: 'test' })).toBe('erro');
    expect(modoGuardaConexao({ NODE_ENV: 'production' })).toBe('aviso');
    expect(modoGuardaConexao({ NODE_ENV: 'production', MACUXI_GUARDA_CONEXAO: 'erro' })).toBe('erro');
    expect(modoGuardaConexao({ MACUXI_GUARDA_CONEXAO: ' Desligado ' })).toBe('desligado');
    expect(modoGuardaConexao({ MACUXI_GUARDA_CONEXAO: 'talvez' })).toBe('erro');
  });

  it('erro: lança ErroConexaoNaTransacao só com transação do MESMO pool aberta', async () => {
    const pool = {};
    const guardar = criarGuardaConexao(pool, { modo: 'erro' });
    expect(() => guardar('comTenant')).not.toThrow();
    await dentroDaTransacao({}, cliente('outro pool'), TENANT, async () => expect(() => guardar('comTenant')).not.toThrow());
    await dentroDaTransacao(pool, cliente('tx'), TENANT, async () => {
      const e = (() => {
        try {
          guardar('semTenant');
        } catch (x) {
          return x;
        }
        return null;
      })();
      expect(e).toBeInstanceOf(ErroConexaoNaTransacao);
      expect((e as ErroConexaoNaTransacao).codigo).toBe(CODIGO_CONEXAO_NA_TRANSACAO);
      expect((e as Error).message).toMatch(/^semTenant: .*D-T0107a/);
    });
    expect(() => guardar('comTenant')).not.toThrow();
  });

  it('aviso: não lança e avisa uma vez por ponto de chamada; desligado: nada', async () => {
    const pool = {};
    const avisar = vi.fn();
    const guardar = criarGuardaConexao(pool, { modo: 'aviso', avisar });
    const desligada = criarGuardaConexao(pool, { modo: 'desligado', avisar });
    await dentroDaTransacao(pool, cliente('tx'), TENANT, async () => {
      for (let i = 0; i < 3; i += 1) guardar('comTenant'); // mesmo ponto de chamada
      desligada('comTenant');
    });
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]![0]).toBeInstanceOf(ErroConexaoNaTransacao);
  });
});

describe('ctx.carteira()/ctx.usuariosVisiveis() dentro de ctx.comTenant usam a transação corrente (D-T0107a)', () => {
  /** Banco falso que conta as transações (cada uma = uma conexão do pool) e entrega um cliente distinto a cada uma. */
  function bancoContado() {
    const abertas: (ClienteBanco & { nome: string })[] = [];
    const banco: BancoApp = {
      verificar: async () => undefined,
      comTenant: async (_t, fn) => {
        const c = cliente(`tx${abertas.length + 1}`);
        abertas.push(c);
        return fn(c);
      },
      semTenant: async (fn) => fn(cliente('sem tenant')),
      horizonteSync: async () => new Date(Date.now() - 2_000),
      instanteSync: async () => new Date(),
    };
    return { banco, abertas };
  }
  /** Os serviços do Core leem pelo AcessoBanco que a plataforma passa: registram em qual conexão leram. */
  const leituras: { servico: string; db: string }[] = [];
  const servico =
    (nome: string, valor: ReadonlySet<string>) =>
    (u: UsuarioAutenticado, acesso: AcessoBanco): Promise<ReadonlySet<string>> =>
      acesso.comTenant(u.tenant_id, async (db) => {
        leituras.push({ servico: nome, db: (db as ClienteBanco & { nome: string }).nome });
        return valor;
      });
  const rotaApi = definirModuloApi({
    manifesto: vendedor,
    rotas: [
      {
        metodo: 'POST',
        caminho: 'dentro',
        acao: 'pedido.criar',
        carteira: 'filtrar_no_dominio',
        executar: (ctx) =>
          ctx.comTenant(async (db) => {
            const [c, u] = await Promise.all([ctx.carteira(), ctx.usuariosVisiveis()]);
            return { tx: (db as ClienteBanco & { nome: string }).nome, carteira: [...(c as Set<string>)], usuarios: (u as Set<string>).size };
          }),
      },
      {
        metodo: 'GET',
        caminho: 'fora',
        acao: 'pedido.ver',
        carteira: 'filtrar_no_dominio',
        executar: async (ctx) => {
          const c = await ctx.carteira();
          return { carteira: [...(c as Set<string>)] };
        },
      },
    ],
  });
  const montar = () => {
    const { banco, abertas } = bancoContado();
    leituras.length = 0;
    const app = createApp({
      ...opcoesDeTeste(undefined, { banco }),
      carteira: servico('carteira', new Set([CLIENTE_DA_CARTEIRA])),
      usuariosVisiveis: servico('usuarios', new Set()),
      modulos: modulosDeTeste({ vendedor: rotaApi }),
    });
    return { app, abertas };
  };

  it('dentro da transação: nenhuma 2ª conexão; carteira e usuários leem pela transação da rota', async () => {
    const { app, abertas } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/vendedor/dentro', headers: cab('vendedor'), payload: {} });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ tx: 'tx1', carteira: [CLIENTE_DA_CARTEIRA], usuarios: 1 });
    expect(abertas.map((c) => c.nome)).toEqual(['tx1']);
    expect(leituras).toEqual([
      { servico: 'carteira', db: 'tx1' },
      { servico: 'usuarios', db: 'tx1' },
    ]);
  });

  it('fora da transação: a carteira abre a sua, como antes', async () => {
    const { app, abertas } = montar();
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/fora', headers: cab('vendedor') });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ carteira: [CLIENTE_DA_CARTEIRA] });
    expect(abertas.map((c) => c.nome)).toEqual(['tx1']);
    expect(leituras).toEqual([{ servico: 'carteira', db: 'tx1' }]);
  });
});
