/**
 * Worker do "Zerar dados" (ADR 0068; desenho docs/desenho/empresa-zerar.md §3 e §5) sem banco real: o pool falso responde às
 * funções da 0100 (`pegar_zerar`, `executar_zerar`, `fechar_zerar`, `expurgar_zerar`). A regra do que sai
 * (`plataforma.limpar_cadastros`), a cópia e o restaurar são testados nos `*.db.test.ts` do banco-dados.
 */
import { CODIGOS_ZERAR_EMPRESA, ERROS_WORKER_ZERAR, TENTATIVAS_ZERAR, type LogRota } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  criarWorkerZerar,
  ESPERAS_ZERAR_MS,
  LOTE_EXPURGO_ZERAR,
  SQL_EXECUTAR_ZERAR,
  SQL_EXPURGAR_ZERAR,
  SQL_FECHAR_ZERAR,
  SQL_PEGAR_ZERAR,
} from '../src/empresa-zerar-worker';

const ZERAR = '9e000000-0000-4000-8000-000000000001';
const EMPRESA = '0a000000-0000-4000-8000-000000000001';

const concluido = {
  id: ZERAR,
  tenant_id: EMPRESA,
  codigo: 'distrib',
  entidades: ['cliente'],
  entidades_afetadas: ['cliente', 'cliente_endereco'],
  lote: '20261123T120000Z-9e000000',
  situacao: 'concluido',
  pedido_em: '2026-11-23T12:00:00+00:00',
  concluido_em: '2026-11-23T12:01:00+00:00',
  linhas_apagadas: 130,
  contagem: [
    { tabela: 'core.cliente', modo: 'soft', linhas: 30 },
    { tabela: 'vendedor.pedido_item', modo: 'soft', linhas: 100 },
  ],
  copia_expira_em: '2026-11-30T12:01:00+00:00',
  erro_codigo: null,
};
const erroPg = (code: string, hint?: string) => Object.assign(new Error(`erro com dado sensível ${code}`), { code, ...(hint ? { hint } : {}) });

function poolFalso(o: { pedidos?: string[]; executar?: (n: number) => unknown; expurgados?: number[] }) {
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
    if (sql === SQL_EXPURGAR_ZERAR) return { rows: [{ n: o.expurgados?.shift() ?? 0 }] };
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
    expect(await criarWorkerZerar({ pool }).ciclo()).toBeNull();
    expect(sqls.map((s) => s.sql)).toEqual([SQL_PEGAR_ZERAR]);
  });

  it('executa numa transação com prazo de 15 min e lock_timeout; log só com ids e contagens', async () => {
    const { pool, sqls } = poolFalso({ pedidos: [ZERAR] });
    const { log, linhas } = logFalso();
    expect(await criarWorkerZerar({ pool, log }).ciclo()).toBe('concluido');
    expect(sqls.map((s) => s.sql)).toEqual([
      SQL_PEGAR_ZERAR,
      'begin',
      "set local statement_timeout = '15min'",
      "set local lock_timeout = '5s'",
      SQL_EXECUTAR_ZERAR,
      'commit',
    ]);
    expect(linhas).toEqual([
      { nivel: 'info', o: { tipo: 'zerar', zerar_id: ZERAR, tenant_alvo_id: EMPRESA, tentativa: 1, situacao: 'concluido', entidades: ['cliente'], entidades_afetadas: ['cliente', 'cliente_endereco'], linhas_apagadas: 130, tabelas: 2 } },
    ]);
  });

  it(`escrita concorrente: ${TENTATIVAS_ZERAR} tentativas com as esperas do desenho e, na última, fechar_zerar(ZERAR_CONCORRENCIA)`, async () => {
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: (n) => erroPg(['23503', '40P01', '55P03'][n - 1]!) });
    const esperas: number[] = [];
    const { log, linhas } = logFalso();
    const w = criarWorkerZerar({ pool, log, esperar: async (ms) => void esperas.push(ms) });
    expect(await w.ciclo()).toBe('falhou');
    expect(de(SQL_EXECUTAR_ZERAR)).toHaveLength(TENTATIVAS_ZERAR);
    expect(de('rollback')).toHaveLength(TENTATIVAS_ZERAR);
    expect(esperas).toEqual([...ESPERAS_ZERAR_MS]);
    expect(de(SQL_FECHAR_ZERAR).map((s) => s.args)).toEqual([[ZERAR, ERROS_WORKER_ZERAR.concorrencia]]);
    expect(JSON.stringify(linhas)).not.toContain('sensível');
  });

  it('concorrência que passa na 2ª tentativa conclui', async () => {
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: (n) => (n === 1 ? erroPg('40001') : concluido) });
    expect(await criarWorkerZerar({ pool, esperar: async () => undefined }).ciclo()).toBe('concluido');
    expect(de(SQL_FECHAR_ZERAR)).toEqual([]);
  });

  it('outro erro (inclusive 23505 lote repetido): sem nova tentativa, fechar_zerar(ZERAR_FALHOU)', async () => {
    for (const estado of ['XX000', '23505']) {
      const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: () => erroPg(estado) });
      expect(await criarWorkerZerar({ pool }).ciclo()).toBe('falhou');
      expect(de(SQL_EXECUTAR_ZERAR)).toHaveLength(1);
      expect(de(SQL_FECHAR_ZERAR).map((s) => s.args)).toEqual([[ZERAR, ERROS_WORKER_ZERAR.falhou]]);
    }
  });

  it('a executar_zerar recusou na conferência (fechou falhou com o código): sem fechar_zerar, log com o código', async () => {
    const recusado = { ...concluido, situacao: 'falhou', concluido_em: null, linhas_apagadas: null, contagem: null, copia_expira_em: null, entidades_afetadas: null, erro_codigo: 'BACKUP_EM_ANDAMENTO' };
    const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: () => recusado });
    const { log, linhas } = logFalso();
    expect(await criarWorkerZerar({ pool, log }).ciclo()).toBe('falhou');
    expect(de(SQL_FECHAR_ZERAR)).toHaveLength(0);
    expect(linhas).toEqual([
      { nivel: 'warn', o: { tipo: 'zerar', zerar_id: ZERAR, tenant_alvo_id: EMPRESA, tentativa: 1, situacao: 'falhou', erro_codigo: 'BACKUP_EM_ANDAMENTO' } },
    ]);
  });

  it('recusa da executar_zerar (Hub processando, volume alto): fecha com o próprio código, sem nova tentativa', async () => {
    for (const codigo of [CODIGOS_ZERAR_EMPRESA.hubProcessando, CODIGOS_ZERAR_EMPRESA.volumeAlto]) {
      const estado = codigo === CODIGOS_ZERAR_EMPRESA.hubProcessando ? '55000' : '22023';
      const { pool, de } = poolFalso({ pedidos: [ZERAR], executar: () => erroPg(estado, codigo) });
      expect(await criarWorkerZerar({ pool }).ciclo()).toBe('falhou');
      expect(de(SQL_EXECUTAR_ZERAR)).toHaveLength(1);
      expect(de(SQL_FECHAR_ZERAR).map((s) => s.args)).toEqual([[ZERAR, codigo]]);
    }
  });

  it('descarte das cópias vencidas: uma chamada com o limite; o número volta e vai ao log', async () => {
    const { pool, de } = poolFalso({ expurgados: [3] });
    const { log, linhas } = logFalso();
    expect(await criarWorkerZerar({ pool, log }).expurgar()).toBe(3);
    expect(de(SQL_EXPURGAR_ZERAR).map((s) => s.args)).toEqual([[LOTE_EXPURGO_ZERAR]]);
    expect(linhas).toEqual([{ nivel: 'info', o: { tipo: 'zerar', etapa: 'expurgo', expurgados: 3 } }]);
    const vazio = poolFalso({});
    expect(await criarWorkerZerar({ pool: vazio.pool, log }).expurgar()).toBe(0);
    expect(linhas).toHaveLength(1);
  });
});
