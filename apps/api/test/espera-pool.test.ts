/**
 * T-0118 (D-T0107a), rede de segurança sem banco: o pool da API nunca deixa a requisição na fila sem prazo.
 * - `esperaDoPoolMs`: `MACUXI_API_POOL_ESPERA_MS`, padrão 10 s, nunca 0 (0 no pg-pool = esperar para sempre).
 * - `esperaDoPoolEsgotada`: reconhece o erro do pg-pool INSTALADO (pool real, cliente falso) quando a espera vence.
 * - Rota: com o pool cheio (aqui, uma 2ª conexão pedida dentro da transação, que em produção a guarda só avisa), a
 *   resposta é 503 `BANCO_OCUPADO` com `Retry-After` dentro da espera, a transação de fora é desfeita e o pool segue usável.
 * A prova com Postgres (pushes simultâneos > pool) fica em `conexao-na-transacao.banco.test.ts` (CI).
 */
import { EventEmitter } from 'node:events';
import { definirModuloApi } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp, ESPERA_POOL_PADRAO_MS, type OpcoesBanco, esperaDoPoolEsgotada, esperaDoPoolMs, RETRY_AFTER_BANCO_OCUPADO_S } from '../src/banco';
import { cab, modulosDeTeste, opcoesDeTeste } from './apoio';

/** Cliente falso para o pg-pool: conecta na hora e responde 0 linhas; registra os comandos de transação. */
const comandos: string[] = [];
class ClienteFalso extends EventEmitter {
  connect(cb: (e?: Error) => void) {
    setImmediate(() => cb());
  }
  // o prazo de conexão NOVA do pg-pool consulta isto; o falso conecta sempre (a espera testada é a da fila)
  isConnected() {
    return true;
  }
  // promessa (comTenant) ou callback (pool.query): nunca deixa quem chamou sem resposta
  query(sql: string, ...resto: unknown[]) {
    if (/^(begin|commit|rollback)$/.test(sql)) comandos.push(sql);
    const r = { rows: [], rowCount: 0 };
    const cb = resto.find((x): x is (e: null, r: unknown) => void => typeof x === 'function');
    if (!cb) return Promise.resolve(r);
    setImmediate(() => cb(null, r));
    return undefined;
  }
  end(cb?: () => void) {
    cb?.();
    return Promise.resolve();
  }
}

const pools: pg.Pool[] = [];
/** Banco da API sobre o pool falso; `verificar` (papel da conexão, no onReady) não se aplica ao cliente falso. */
const bancoSobre = (pool: pg.Pool, op: OpcoesBanco) => ({ ...criarBancoApp(pool, op), verificar: async () => undefined });
const poolFalso = (espera: number) => {
  const p = new pg.Pool({ max: 1, connectionTimeoutMillis: espera, Client: ClienteFalso as unknown as typeof pg.Client });
  pools.push(p);
  return p;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
  comandos.length = 0;
});

describe('espera por conexão do pool (MACUXI_API_POOL_ESPERA_MS)', () => {
  it('padrão 10 s; inteiro >= 1 vale; ausente, 0, negativo, fração ou texto = padrão (nunca fila sem prazo)', () => {
    expect(ESPERA_POOL_PADRAO_MS).toBe(10_000);
    expect(esperaDoPoolMs({})).toBe(10_000);
    expect(esperaDoPoolMs({ MACUXI_API_POOL_ESPERA_MS: ' 2500 ' })).toBe(2_500);
    for (const v of ['', '0', '-1', '1.5', 'dez', '1e4']) expect(esperaDoPoolMs({ MACUXI_API_POOL_ESPERA_MS: v }), v).toBe(10_000);
  });

  it('reconhece o erro do pg-pool instalado quando a espera vence (direto ou como causa); outros erros não', async () => {
    const pool = poolFalso(20);
    const presa = await pool.connect();
    const erro = await pool.connect().then(
      () => null,
      (e: unknown) => e,
    );
    presa.release();
    expect(erro).toBeInstanceOf(Error);
    expect(esperaDoPoolEsgotada(erro)).toBe(true);
    expect(esperaDoPoolEsgotada(new Error('falhou', { cause: erro }))).toBe(true);
    expect(esperaDoPoolEsgotada(new Error('Connection terminated due to connection timeout'))).toBe(false);
    expect(esperaDoPoolEsgotada('timeout exceeded when trying to connect')).toBe(false);
    expect(esperaDoPoolEsgotada(null)).toBe(false);
  });
});

describe('pool cheio na rota: 503 BANCO_OCUPADO com Retry-After, sem travar (D-T0107a)', () => {
  const rotas = definirModuloApi({
    manifesto: vendedor,
    rotas: [
      {
        // o defeito da D-T0107a: dentro da transação, outra conexão do mesmo pool (aqui direta, para não depender do Core)
        metodo: 'POST',
        caminho: 'aninhada',
        acao: 'pedido.criar',
        carteira: 'filtrar_no_dominio',
        executar: (ctx) => ctx.comTenant(async () => ctx.comTenant(async () => ({ nunca: true }))),
      },
      { metodo: 'GET', caminho: 'uma', acao: 'pedido.ver', carteira: 'filtrar_no_dominio', executar: (ctx) => ctx.comTenant(async () => ({ ok: true })) },
    ],
  });

  it('pool de 1 e 2ª conexão dentro da transação (guarda em aviso, como em produção): 503 na espera e o pool volta a servir', async () => {
    const avisar = vi.fn();
    const app = createApp({
      ...opcoesDeTeste(undefined, { banco: bancoSobre(poolFalso(50), { guardaConexao: { modo: 'aviso', avisar } }) }),
      modulos: modulosDeTeste({ vendedor: rotas }),
    });
    await app.ready();
    const t0 = Date.now();
    const r = await app.inject({ method: 'POST', url: '/v1/vendedor/aninhada', headers: cab('vendedor'), payload: {} });
    expect(r.statusCode, r.body).toBe(503);
    expect(r.json()).toEqual({ codigo: 'BANCO_OCUPADO', mensagem: 'Servidor ocupado. Tente de novo em instantes.' });
    expect(r.headers['retry-after']).toBe(String(RETRY_AFTER_BANCO_OCUPADO_S));
    // sem a espera, a requisição ficaria na fila para sempre; folga larga para a máquina carregada
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(avisar).toHaveBeenCalledTimes(1);
    // a transação de fora foi desfeita e a conexão devolvida: a próxima requisição usa o mesmo (único) slot
    expect(comandos).toEqual(['begin', 'rollback']);
    const depois = await app.inject({ method: 'GET', url: '/v1/vendedor/uma', headers: cab('vendedor') });
    expect(depois.statusCode, depois.body).toBe(200);
    expect(depois.json()).toEqual({ ok: true });
    await app.close();
  });

  it('pool ocupado por carga (sem defeito): a requisição que passa da espera recebe 503, não fica pendurada', async () => {
    const pool = poolFalso(50);
    const app = createApp({ ...opcoesDeTeste(undefined, { banco: bancoSobre(pool, { guardaConexao: { modo: 'erro' } }) }), modulos: modulosDeTeste({ vendedor: rotas }) });
    await app.ready();
    const presa = await pool.connect();
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/uma', headers: cab('vendedor') });
    presa.release();
    expect(r.statusCode, r.body).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'BANCO_OCUPADO' });
    await app.close();
  });
});
