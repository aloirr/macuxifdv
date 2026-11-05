/**
 * T-0075, ADR 0024 itens 11 e 12: fixa no CI o "esperado" que a 3ª execução do DBaaS compara (itens A11 e A12 do
 * db/dbaas/teste-compatibilidade.ts). Roda o MESMO código (db/dbaas/referencias.ts) no Postgres do CI
 * (pgvector/pgvector:pg16: pgvector 0.8.2, locale en_US.utf8 da glibc), sempre numa transação desfeita como o admin.
 * - A11: a opclass vector_cosine_ops do HNSW usa o operador <=>; HNSW, varredura exata e o cálculo do Node dão os mesmos
 *   10 vizinhos nas 3 consultas do conjunto fixo. Sem a extensão vector no servidor, o caso pula.
 * - A12: ordem de nomes com acento (padrão e lower) igual à ORDEM_ESPERADA_NOMES, lower/upper/ILIKE com acento,
 *   catalogo.sem_acento e a busca FTS 'portuguese'. A ordem só é exigida em base en_US (a do CI e a do DBaaS); outro
 *   locale (um Postgres local de outra distribuição) pula esse caso com o motivo.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conferirColacaoReferencia, conferirVectorReferencia } from '../dbaas/referencias';
import { OPERADOR_COSSENO_ESPERADO, ORDEM_ESPERADA_NOMES, ordemBytes, NOMES_COLACAO } from '../dbaas/relatorio';
import { banco, semBanco } from './estado';

describe.skipIf(semBanco())('referências do DBaaS no CI (ADR 0024 itens 11 e 12)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('A11: vector_cosine_ops (hnsw) com <=>; HNSW = busca exata = Node no conjunto fixo; nada fica na base', async (ctx) => {
    const r = await conferirVectorReferencia(admin);
    if (r.semVector) ctx.skip(`sem a extensão vector neste Postgres: ${r.detalhe}`);
    expect(r.operador).toBe(OPERADOR_COSSENO_ESPERADO);
    expect(r.usaIndice).toBe(true);
    expect(r.peloIndice).toEqual(r.esperados);
    expect(r.exatos).toEqual(r.esperados);
    expect(r.maiorDiferenca).toBeLessThan(1e-9);
    expect(r.ok, r.subitens.join('\n')).toBe(true);
    // transação desfeita: a tabela de referência não ficou
    const sobra = await admin.query<{ r: string | null }>("select to_regclass('public.dbaas_ref_vetor')::text as r");
    expect(sobra.rows[0]!.r).toBeNull();
  });

  it('A12: lower/upper/ILIKE com acento, catalogo.sem_acento e FTS iguais ao esperado; "C" ordena por bytes', async () => {
    const r = await conferirColacaoReferencia(admin);
    for (const caso of r.casos) expect({ rotulo: caso.rotulo, obtido: caso.obtido }).toEqual({ rotulo: caso.rotulo, obtido: caso.esperado });
    expect(r.ordemC).toEqual(ordemBytes(NOMES_COLACAO));
    expect(r.colacao).not.toBeNull();
  });

  it('A12: em base en_US (CI e DBaaS), a ordem de nomes com acento é a linguística (order by nome e lower(nome))', async (ctx) => {
    const r = await conferirColacaoReferencia(admin);
    const c = r.colacao!;
    if (c.provedor !== 'libc' || !/^en_US\.utf-?8$/i.test(c.collate)) ctx.skip(`base com collate ${c.collate} (${c.provedor}): o esperado é o do en_US`);
    expect(r.ordem).toEqual(ORDEM_ESPERADA_NOMES);
    expect(r.ordemLower).toEqual(ORDEM_ESPERADA_NOMES);
    if (r.ordemIcu) expect(r.ordemIcu).toEqual(ORDEM_ESPERADA_NOMES);
    expect(r.ok, r.subitens.join('\n')).toBe(true);
  });
});
