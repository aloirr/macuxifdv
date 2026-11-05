/**
 * Conferências de referência dos itens 11 e 12 da ADR 0024 (T-0075, 3ª execução do DBaaS; dono: banco-dados). Rodam
 * numa conexão de ADMIN de uma base já migrada, dentro de uma transação SEMPRE desfeita (nada fica na base):
 *   - A11 (vector): opclass vector_cosine_ops do HNSW com o operador <=>, e HNSW × varredura exata × cálculo do Node num
 *     conjunto fixo pequeno (relatorio.ts, conjuntoReferencia);
 *   - A12 (collation e ctype): ordem de nomes com acento, lower/upper, ILIKE, catalogo.sem_acento e a busca FTS do Catálogo.
 * O mesmo código roda no CI (db/testes/dbaas-referencia.test.ts, pgvector 0.8.2 e en_US.utf8 do pgvector/pgvector:pg16),
 * que fixa o "esperado do CI", e no DBaaS (db/dbaas/teste-compatibilidade.ts, itens A11 e A12). Só importa do relatorio.ts.
 */
import type pg from 'pg';
import {
  CASOS_TEXTO,
  conjuntoReferencia,
  indicesDoPlano,
  literalVetor,
  NOMES_COLACAO,
  OPERADOR_COSSENO_ESPERADO,
  ORDEM_ESPERADA_NOMES,
  ordemBytes,
  primeiraDiferenca,
  REFERENCIA_VETORES,
  vizinhosEsperados,
} from './relatorio';

export interface ResultadoReferencia {
  ok: boolean;
  detalhe: string;
  subitens: string[];
}

export interface ResultadoVector extends ResultadoReferencia {
  /** A extensão vector não está disponível neste servidor (o CI sem pgvector pula). */
  semVector: boolean;
  versao: string | null;
  /** Operador(es) da opclass vector_cosine_ops do HNSW ("<=>(vector,vector)"). */
  operador: string | null;
  usaIndice: boolean;
  /** ids por consulta: pelo HNSW, pela varredura exata e os esperados (Node). */
  peloIndice: number[][];
  exatos: number[][];
  esperados: number[][];
  /** Maior diferença entre a distância do servidor e a do Node. */
  maiorDiferenca: number;
}

export interface ResultadoColacao extends ResultadoReferencia {
  colacao: { collate: string; ctype: string; provedor: string; versao: string | null; versaoAtual: string | null } | null;
  ordem: string[];
  ordemLower: string[];
  ordemC: string[];
  /** Ordem com collate "pt-BR-x-icu" (null = o servidor não tem a collation ICU). */
  ordemIcu: string[] | null;
  casos: Array<{ rotulo: string; obtido: string | null; esperado: string; ok: boolean }>;
  /** unaccent('Conceição Ávila') (informativo: o app usa catalogo.sem_acento, não a extensão). */
  unaccent: string | null;
}

/** Roda fn numa transação desfeita (rollback sempre). O cliente não pode estar dentro de outra transação. */
async function desfeita<T>(c: pg.ClientBase, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    return await fn();
  } finally {
    await c.query('rollback').catch(() => undefined);
  }
}

/** Tenta um comando num savepoint (o erro não aborta a transação). */
async function tentar(c: pg.ClientBase, sql: string): Promise<string | null> {
  await c.query('savepoint referencia');
  try {
    await c.query(sql);
    await c.query('release savepoint referencia');
    return null;
  } catch (e) {
    await c.query('rollback to savepoint referencia');
    return (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 200);
  }
}

const TABELA_VETOR = 'public.dbaas_ref_vetor';
const INDICE_VETOR = 'dbaas_ref_vetor_hnsw';

/** A11: opclass e operador do HNSW de cosseno; HNSW, varredura exata e Node dão os mesmos vizinhos no conjunto fixo. */
export async function conferirVectorReferencia(c: pg.ClientBase): Promise<ResultadoVector> {
  const vazio = { versao: null, operador: null, usaIndice: false, peloIndice: [], exatos: [], esperados: [], maiorDiferenca: Number.NaN };
  const disponivel = await c.query("select 1 from pg_available_extensions where name = 'vector'");
  if (disponivel.rowCount === 0) return { ok: false, semVector: true, detalhe: 'vector não existe neste servidor', subitens: [], ...vazio };
  return desfeita(c, async () => {
    const erroExt = await tentar(c, 'create extension if not exists vector');
    if (erroExt) return { ok: false, semVector: true, detalhe: `create extension vector: ${erroExt}`, subitens: [], ...vazio };
    const versao = (await c.query<{ v: string }>("select extversion as v from pg_extension where extname = 'vector'")).rows[0]?.v ?? null;
    const op = await c.query<{ ops: string | null }>(
      `select string_agg(o.oprname || '(' || tl.typname || ',' || tr.typname || ')', ' ' order by ao.amopstrategy) as ops
         from pg_opclass oc
         join pg_am am on am.oid = oc.opcmethod
         join pg_amop ao on ao.amopfamily = oc.opcfamily and ao.amoplefttype = oc.opcintype
         join pg_operator o on o.oid = ao.amopopr
         join pg_type tl on tl.oid = o.oprleft
         join pg_type tr on tr.oid = o.oprright
        where am.amname = 'hnsw' and oc.opcname = 'vector_cosine_ops'`,
    );
    const operador = op.rows[0]?.ops ?? null;
    const subitens: string[] = [`vector ${versao ?? '?'} · opclass vector_cosine_ops (hnsw): operador ${operador ?? 'NÃO existe'} (esperado ${OPERADOR_COSSENO_ESPERADO})`];
    // catalogo.produto_embedding ainda não existe (0013: "fica para depois"); quando existir, as opclasses dos índices dela
    const pe = await c.query<{ opclasses: string | null }>(
      `select string_agg(distinct oc.opcname || ' (' || am.amname || ')', ', ') as opclasses
         from pg_index i
         join pg_class ic on ic.oid = i.indexrelid
         join pg_am am on am.oid = ic.relam
         cross join lateral unnest(i.indclass) as k(oid)
         join pg_opclass oc on oc.oid = k.oid
        where i.indrelid = to_regclass('catalogo.produto_embedding') and am.amname in ('hnsw', 'ivfflat')`,
    );
    const existeTabela = (await c.query<{ r: string | null }>("select to_regclass('catalogo.produto_embedding')::text as r")).rows[0]?.r ?? null;
    subitens.push(
      existeTabela
        ? `catalogo.produto_embedding: índices vetoriais ${pe.rows[0]?.opclasses ?? 'nenhum'}`
        : 'catalogo.produto_embedding ainda não existe (0013: entra com o ranking semântico, RN-CAT-08); conferida a forma prevista (vector_cosine_ops + <=>, a mesma do C4)',
    );
    const { vetores, consultas } = conjuntoReferencia();
    const { dimensao, k } = REFERENCIA_VETORES;
    await c.query(`create table ${TABELA_VETOR} (id int primary key, embedding vector(${dimensao}) not null)`);
    await c.query(`insert into ${TABELA_VETOR} (id, embedding) select i, v::vector from unnest($1::int[], $2::text[]) as t(i, v)`, [
      vetores.map((_, i) => i + 1),
      vetores.map(literalVetor),
    ]);
    await c.query(`create index ${INDICE_VETOR} on ${TABELA_VETOR} using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64)`);
    await c.query(`analyze ${TABELA_VETOR}`);
    // ef_search maior que o conjunto: no grafo pequeno, o HNSW tem de achar os vizinhos exatos
    await c.query('set local hnsw.ef_search = 200');
    const sql = `select id, embedding <=> $1::vector as d from ${TABELA_VETOR} order by embedding <=> $1::vector limit ${k}`;
    const peloIndice: number[][] = [];
    const exatos: number[][] = [];
    const esperados: number[][] = [];
    let usaIndice = true;
    let maiorDiferenca = 0;
    for (const q of consultas) {
      const lit = literalVetor(q);
      const esperado = vizinhosEsperados(vetores, q, k);
      esperados.push(esperado.map((x) => x.id));
      await c.query('set local enable_seqscan = off');
      await c.query('set local enable_indexscan = on');
      const plano = await c.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${sql}`, [lit]);
      usaIndice &&= indicesDoPlano(plano.rows[0]?.['QUERY PLAN']).includes(INDICE_VETOR);
      const ri = await c.query<{ id: number; d: number }>(sql, [lit]);
      peloIndice.push(ri.rows.map((r) => r.id));
      await c.query('set local enable_seqscan = on');
      await c.query('set local enable_indexscan = off');
      await c.query('set local enable_bitmapscan = off');
      const re = await c.query<{ id: number; d: number }>(sql, [lit]);
      exatos.push(re.rows.map((r) => r.id));
      re.rows.forEach((r, i) => {
        maiorDiferenca = Math.max(maiorDiferenca, Math.abs(Number(r.d) - (esperado[i]?.distancia ?? Number.NaN)));
      });
    }
    const iguais = (a: number[][], b: number[][]) => a.length === b.length && a.every((x, i) => x.join(',') === b[i]!.join(','));
    const indiceIgual = iguais(peloIndice, esperados);
    const exatoIgual = iguais(exatos, esperados);
    const distanciasIguais = maiorDiferenca < 1e-9;
    const ok = operador === OPERADOR_COSSENO_ESPERADO && usaIndice && indiceIgual && exatoIgual && distanciasIguais;
    consultas.forEach((_, i) => {
      subitens.push(`consulta ${i + 1}: HNSW ${peloIndice[i]!.join(',')} · exata ${exatos[i]!.join(',')} · esperada ${esperados[i]!.join(',')}`);
    });
    return {
      ok,
      semVector: false,
      detalhe:
        `vector ${versao ?? '?'} · ${vetores.length} vetores × ${consultas.length} consultas (dim ${dimensao}, k ${k}) · ` +
        `HNSW ${indiceIgual ? '=' : '≠'} esperado · exata ${exatoIgual ? '=' : '≠'} esperado · ${usaIndice ? 'o EXPLAIN usa o HNSW' : 'o EXPLAIN NÃO usa o HNSW'} · ` +
        `maior diferença de distância ${maiorDiferenca.toExponential(1)}`,
      subitens,
      versao,
      operador,
      usaIndice,
      peloIndice,
      exatos,
      esperados,
      maiorDiferenca,
    };
  });
}

/** A12: collation e ctype da base, ordem de nomes com acento e a busca sem acento que o app usa. */
export async function conferirColacaoReferencia(c: pg.ClientBase): Promise<ResultadoColacao> {
  return desfeita(c, async () => {
    const info = await c.query<{ collate: string; ctype: string; provedor: string; versao: string | null; versao_atual: string | null }>(
      `select datcollate as collate, datctype as ctype,
              case datlocprovider when 'c' then 'libc' when 'i' then 'icu' else datlocprovider::text end as provedor,
              datcollversion as versao, pg_database_collation_actual_version(oid) as versao_atual
         from pg_database where datname = current_database()`,
    );
    const i = info.rows[0];
    const colacao = i ? { collate: i.collate, ctype: i.ctype, provedor: i.provedor, versao: i.versao, versaoAtual: i.versao_atual } : null;
    const ordenar = async (expr: string) =>
      (await c.query<{ l: string[] }>(`select array_agg(nome order by ${expr}) as l from unnest($1::text[]) as t(nome)`, [NOMES_COLACAO])).rows[0]?.l ?? [];
    const ordem = await ordenar('nome');
    const ordemLower = await ordenar('lower(nome)');
    const ordemC = await ordenar('nome collate "C"');
    const temIcu = ((await c.query("select 1 from pg_collation where collname = 'pt-BR-x-icu'")).rowCount ?? 0) > 0;
    const ordemIcu = temIcu ? await ordenar('nome collate "pt-BR-x-icu"') : null;
    const temCatalogo = (await c.query<{ r: string | null }>("select to_regprocedure('catalogo.sem_acento(text)')::text as r")).rows[0]?.r != null;
    const casos: ResultadoColacao['casos'] = [];
    for (const caso of CASOS_TEXTO) {
      if (caso.catalogo && !temCatalogo) {
        casos.push({ rotulo: caso.rotulo, obtido: null, esperado: caso.esperado, ok: false });
        continue;
      }
      const v = (await c.query<{ v: string | null }>(`select (${caso.sql})::text as v`)).rows[0]?.v ?? null;
      casos.push({ rotulo: caso.rotulo, obtido: v, esperado: caso.esperado, ok: v === caso.esperado });
    }
    // unaccent: informativo (trusted no PG 13+; o app não depende dela)
    let unaccent: string | null = null;
    const erroUnaccent = await tentar(c, 'create extension if not exists unaccent');
    if (!erroUnaccent) unaccent = (await c.query<{ v: string }>("select unaccent('Conceição Ávila') as v")).rows[0]?.v ?? null;

    const difOrdem = primeiraDiferenca(ordem, ORDEM_ESPERADA_NOMES);
    const difLower = primeiraDiferenca(ordemLower, ORDEM_ESPERADA_NOMES);
    const cBytes = primeiraDiferenca(ordemC, ordemBytes(NOMES_COLACAO)) === null;
    const difIcu = ordemIcu ? primeiraDiferenca(ordemIcu, ORDEM_ESPERADA_NOMES) : null;
    const casosOk = casos.every((x) => x.ok);
    const ok = difOrdem === null && difLower === null && casosOk;
    const precisa =
      difOrdem === null && difLower === null
        ? 'não precisa de COLLATE "C" nem de ICU: a ordem padrão da base é a do CI (o "C" só serve a chave e cursor, como o cursor_external_id da 0010)'
        : `a ordem padrão diverge do CI${ordemIcu && difIcu === null ? '; com collate "pt-BR-x-icu" fica igual: ordenar com ele onde a tela ordena nomes' : ''}`;
    const subitens = [
      `order by nome: ${ordem.join(', ')}${difOrdem ? ` (${difOrdem})` : ' (igual ao esperado do CI)'}`,
      `order by lower(nome): ${difLower ?? 'igual ao esperado do CI'}`,
      `order by nome collate "C" (bytes): ${ordemC.join(', ')}${cBytes ? '' : ' (≠ ordem por bytes do Node)'} — por isso o "C" não serve para nome na tela`,
      `collate "pt-BR-x-icu": ${ordemIcu ? (difIcu ?? 'igual ao esperado do CI') : 'não existe neste servidor'}`,
      ...casos.map((x) => `${x.ok ? '✅' : '❌'} ${x.rotulo}: ${x.obtido ?? (x.esperado && !temCatalogo ? 'sem catalogo.sem_acento (base não migrada)' : 'null')}${x.ok ? '' : ` (esperado ${x.esperado})`}`),
      `unaccent (informativo; o app usa catalogo.sem_acento): ${unaccent ?? `não criada (${erroUnaccent ?? '?'})`}`,
    ];
    return {
      ok,
      detalhe: `${colacao ? `collate ${colacao.collate} · ctype ${colacao.ctype} · provedor ${colacao.provedor} · versão ${colacao.versao ?? '?'}${colacao.versaoAtual && colacao.versaoAtual !== colacao.versao ? ` (atual ${colacao.versaoAtual})` : ''}` : 'sem pg_database'} · ${precisa}${casosOk ? '' : ` · ${casos.filter((x) => !x.ok).length} caso(s) de texto ≠ CI`}`,
      subitens,
      colacao,
      ordem,
      ordemLower,
      ordemC,
      ordemIcu,
      casos,
      unaccent,
    };
  });
}
