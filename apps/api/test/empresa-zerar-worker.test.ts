/**
 * Worker do "Zerar dados" (ADR 0068; desenho docs/desenho/empresa-zerar.md §3 e §6) sem banco real: o pool falso responde às
 * funções da 0099 (`pegar_zerar`, `executar_zerar`, `fechar_zerar`, `objetos_do_expurgo_zerar`, `fechar_expurgo_zerar`). A regra do
 * que sai, a cópia e o desfazer são testados nos `*.db.test.ts` do banco-dados.
 */
import { ERROS_WORKER_ZERAR, TENTATIVAS_ZERAR, type LogRota } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { criarArmazenamentoEmMemoria } from '../src/arquivos';
import {
  criarWorkerZerar,
  ESPERAS_ZERAR_MS,
  LOTE_EXPURGO_ZERAR,
  SQL_EXECUTAR_ZERAR,
  SQL_FECHAR_EXPURGO_ZERAR,
  SQL_FECHAR_ZERAR,
  SQL_OBJETOS_EXPURGO_ZERAR,
  SQL_PEGAR_ZERAR,
} from '../src/empresa-zerar-worker';

const ZERAR = '9e000000-0000-4000-8000-000000000001';
const ZERAR2 = '9e000000-0000-4000-8000-000000000002';
const EMPRESA = '0a000000-0000-4000-8000-000000000001';
const FOTO = `${EMPRESA}/catalogo/2026-11/0f000000-0000-4000-8000-000000000001.jpg`;
const MINI = `${EMPRESA}/catalogo/2026-11/0f000000-0000-4000-8000-000000000001.m320.jpg`;
const ZIP1 = `${EMPRESA}/catalogo/2026-11/0f000000-0000-4000-8000-000000000002.p001.zip`;
const ZIP2 = ZIP1.replace('.p001.', '.p002.');
const ZIP3 = ZIP1.replace('.p001.', '.p003.');

const concluido = {
  id: ZERAR,
  tenant_id: EMPRESA,
  codigo: 'distrib',
  origem: 'portal',
  situacao: 'concluido',
  pedido_em: '2026-11-23T12:00:00+00:00',
  concluido_em: '2026-11-23T12:01:00+00:00',
  linhas_apagadas: 130,
  contagem: { 'core.cliente': 30, 'vendedor.pedido_item': 100 },
  copia_expira_em: '2026-11-30T12:01:00+00:00',
  erro_codigo: null,
};
const erroPg = (code: string) => Object.assign(new Error(`erro com dado sensível ${code}`), { code });

function poolFalso(o: { pedidos?: string[]; executar?: (n: number) => unknown; objetos?: { zerar_id: string; armazenamento: string | null; chave: string | null }[] }) {
  const sqls: { sql: string; args: unknown[] }[] = [];
  const pedidos = [...(o.pedidos ?? [])];
  let execucoes = 0;
  const responder = async (sql: string, args: unknown[] = []) => {
    sqls.push({ sql, args });
    if (sql === SQL_PEGAR_ZERAR) {
      const id = pedidos.shift();
      return { rows: id ? [{ id, empresa_id: EMPRESA }] : [] };
    }
    if (sql === SQL_EXECUTAR_ZERAR) {
      execucoes += 1;
      const r = o.executar?.(execucoes) ?? concluido;
      if (r instanceof Error) throw r;
      return { rows: [{ r }] };
    }
    if (sql === SQL_OBJETOS_EXPURGO_ZERAR) return { rows: o.objetos ?? [] };
    return { rows: [] };
  };
  const cliente = { query: responder, release: () => undefined };
  const pool = { query: responder, connect: async () => cliente } as unknown as Pick<pg.Pool, 'connect' | 'query'>;
  return { pool, sqls, de: (sql: string) => sqls.filter((s) => s.sql === sql) };
}

function logFalso() {
  const linhas: { nivel: string; o: Record<string, unknown> }[] = [];
  const log: LogRota = {
    info: (o) => void linhas.push({ nivel: 'info', o }),
    warn: (o) => void linhas.push({ nivel: 'warn', o }),
    error: (o) => void linhas.push({ nivel: 'error', o }),
  };
  return { log, linhas };
}

describe('worker do Zerar dados (ADR 0068)', () => {
  it('sem pedido: nada roda', async () => {
    const { pool, sqls } = poolFalso({});
    expect(await criarWorkerZerar({ pool, arquivos: null, pacotes: null }).ciclo()).toBeNull();
    expect(sqls.map((s) => s.sql)).toEqual([SQL_PEGAR_ZERAR]);
  });

  it('executa numa transação com prazo de 15 min e lock_timeout; log só com ids e contagens', async () => {
    const { pool, sqls } = poolFalso({ pedidos: [ZERAR] });
    const { log, linhas } = logFalso();
    expect(await criarWorkerZerar({ pool, arquivos: null, pacotes: null, log }).ciclo()).toBe('concluido');
    expect(sqls.map((s) => s.sql)).toEqual([
      SQL_PEGAR_ZERAR,
      'begin',
      "set local statement_timeout = '15min'",
      "set local lock_timeout = '5s'",
      SQL_EXECUTAR_ZERAR,
      'commit',
    ]);
    expect(linhas).toEqual([
      { nivel: 'info', o: { tipo: 'zerar', zerar_id: ZERAR, tenant_alvo_id: EMPRESA, tentativa: 1, situacao: 'concluido', linhas_apagadas: 130, tabelas: 2 } },
    ]);
  });

  it(`escrita concorrente: ${TENTATIVAS_ZERAR} tentativas com as esperas do desenho e, na última, fechar_zerar(ZERAR_CONCORRENCIA)`, async () => {
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: (n) => erroPg(['23503', '40P01', '55P03'][n - 1]!) });
    const esperas: number[] = [];
    const { log, linhas } = logFalso();
    const w = criarWorkerZerar({ pool, arquivos: null, pacotes: null, log, esperar: async (ms) => void esperas.push(ms) });
    expect(await w.ciclo()).toBe('falhou');
    expect(de(SQL_EXECUTAR_ZERAR)).toHaveLength(TENTATIVAS_ZERAR);
    expect(de('rollback')).toHaveLength(TENTATIVAS_ZERAR);
    expect(esperas).toEqual([...ESPERAS_ZERAR_MS]);
    expect(de(SQL_FECHAR_ZERAR).map((s) => s.args)).toEqual([[ZERAR, ERROS_WORKER_ZERAR.concorrencia]]);
    expect(JSON.stringify(linhas)).not.toContain('sensível');
  });

  it('concorrência que passa na 2ª tentativa conclui', async () => {
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: (n) => (n === 1 ? erroPg('40001') : concluido) });
    expect(await criarWorkerZerar({ pool, arquivos: null, pacotes: null, esperar: async () => undefined }).ciclo()).toBe('concluido');
    expect(de(SQL_FECHAR_ZERAR)).toEqual([]);
  });

  it('outro erro: sem nova tentativa, fechar_zerar(ZERAR_FALHOU)', async () => {
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: () => erroPg('XX000') });
    expect(await criarWorkerZerar({ pool, arquivos: null, pacotes: null }).ciclo()).toBe('falhou');
    expect(de(SQL_EXECUTAR_ZERAR)).toHaveLength(1);
    expect(de(SQL_FECHAR_ZERAR).map((s) => s.args)).toEqual([[ZERAR, ERROS_WORKER_ZERAR.falhou]]);
  });

  it('expurgo: remove original, miniatura e partes do zip e os pacotes de sync; só então fecha o zerar', async () => {
    const arquivos = criarArmazenamentoEmMemoria();
    for (const k of [FOTO, MINI, ZIP1, ZIP2, ZIP3]) await arquivos.gravar(k, new Uint8Array([1]));
    const pacotesRemovidos: string[] = [];
    const { pool, de } = poolFalso({
      objetos: [
        { zerar_id: ZERAR, armazenamento: 'arquivos', chave: FOTO },
        { zerar_id: ZERAR, armazenamento: 'arquivos', chave: ZIP1 },
        { zerar_id: ZERAR, armazenamento: 'sync_pacotes', chave: 'pacote-1' },
        { zerar_id: ZERAR2, armazenamento: null, chave: null },
      ],
    });
    const w = criarWorkerZerar({ pool, arquivos, pacotes: { remover: async (k) => void pacotesRemovidos.push(k) } });
    expect(await w.expurgar()).toEqual({ expurgados: 2, objetos: 3, pendentes: 0 });
    expect(arquivos.chaves()).toEqual([]);
    expect(pacotesRemovidos).toEqual(['pacote-1']);
    expect(de(SQL_OBJETOS_EXPURGO_ZERAR)[0]?.args).toEqual([LOTE_EXPURGO_ZERAR]);
    expect(de(SQL_FECHAR_EXPURGO_ZERAR).map((s) => s.args)).toEqual([[ZERAR], [ZERAR2]]);
  });

  it('expurgo sem o armazenamento: a cópia fica (não fecha) e o log não leva a chave', async () => {
    const { pool, de } = poolFalso({ objetos: [{ zerar_id: ZERAR, armazenamento: 'arquivos', chave: FOTO }] });
    const { log, linhas } = logFalso();
    expect(await criarWorkerZerar({ pool, arquivos: null, pacotes: null, log }).expurgar()).toEqual({ expurgados: 0, objetos: 0, pendentes: 1 });
    expect(de(SQL_FECHAR_EXPURGO_ZERAR)).toEqual([]);
    expect(JSON.stringify(linhas)).not.toContain(FOTO);
  });
});
