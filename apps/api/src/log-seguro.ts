/**
 * Erro → objeto de log sem dado pessoal (CLAUDE.md regra 8; T-0078 L1, defeito D-L1a).
 *
 * O serializador padrão do pino copia TODAS as propriedades do erro. Um `DatabaseError` do `pg` que sobe sem tratamento
 * leva `detail` (`Key (tenant_id, email)=(…, maria@…) already exists`, `Failing row contains (…)`), `where`, `hint`,
 * `internalQuery` e, em alguns drivers, `parameters`/a query com valores. Algumas mensagens do Postgres também trazem o
 * valor (`invalid input syntax for type uuid: "…"`). Por isso, para erro do Postgres só saem nomes e códigos:
 * SQLSTATE (`code`), `severity`, `constraint`, `schema`, `table`, `column`, `dataType`, `routine` e uma mensagem
 * genérica. Para os demais erros: `type`, `message`, `code`, `statusCode` e `stack`; a `cause` passa pela mesma regra.
 * O `request_id` vem do contexto do log (`req.log`), não do erro.
 */

import pg from 'pg';

const SQLSTATE = /^[0-9A-Z]{5}$/;
const PROFUNDIDADE_MAX_CAUSA = 3;
/** Campos do erro do Postgres que só têm nomes/códigos (nunca valores de linha). */
const CAMPOS_PG_SEGUROS = ['severity', 'constraint', 'schema', 'table', 'column', 'dataType', 'routine'] as const;

export interface ErroPostgresLike {
  code: string;
}

/**
 * Erro vindo do Postgres: SQLSTATE de 5 caracteres e `pg.DatabaseError` (ou, de outra cópia do driver, `severity`,
 * `detail` ou `routine`). Só o código não basta: `EPIPE`/`ECONNREFUSED` são códigos de sistema.
 */
export function ehErroPostgres(e: unknown): e is ErroPostgresLike {
  if (typeof e !== 'object' || e === null) return false;
  const { code, severity } = e as { code?: unknown; severity?: unknown };
  if (typeof code !== 'string' || !SQLSTATE.test(code)) return false;
  return e instanceof pg.DatabaseError || typeof severity === 'string' || 'detail' in e || 'routine' in e;
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Erro como sai no log. */
export interface ErroDeLog {
  type: string;
  message: string;
  [campo: string]: unknown;
}

/** Serializador `err` do pino da API e do worker. */
export function serializarErro(e: unknown, profundidade = 0): ErroDeLog {
  if (ehErroPostgres(e)) {
    const saida: ErroDeLog = { type: 'DatabaseError', code: e.code, message: `erro do Postgres (SQLSTATE ${e.code})` };
    for (const k of CAMPOS_PG_SEGUROS) {
      const v = texto((e as unknown as Record<string, unknown>)[k]);
      if (v !== undefined) saida[k] = v;
    }
    return saida;
  }
  if (!(e instanceof Error)) return { type: typeof e, message: 'valor lançado que não é Error' };
  const extra = e as Error & { code?: unknown; statusCode?: unknown; cause?: unknown };
  const saida: ErroDeLog = { type: e.constructor?.name || e.name, message: e.message };
  if (typeof extra.code === 'string' || typeof extra.code === 'number') saida.code = extra.code;
  if (typeof extra.statusCode === 'number') saida.statusCode = extra.statusCode;
  if (e.name === 'ZodError') {
    // a mensagem do ZodError é o JSON dos problemas, que pode trazer o valor recebido (`received`): só caminho e código
    const issues = (e as unknown as { issues?: { path?: unknown[]; code?: unknown }[] }).issues ?? [];
    saida.message = 'dados inválidos';
    saida.problemas = issues.slice(0, 10).map((i) => ({ caminho: (i.path ?? []).join('.'), codigo: i.code }));
  }
  // na pilha do ZodError a mensagem (JSON com `received`) vem antes dos quadros: só as linhas `at …`
  if (e.stack) saida.stack = e.name === 'ZodError' ? e.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n') : e.stack;
  if (extra.cause !== undefined && profundidade < PROFUNDIDADE_MAX_CAUSA) saida.cause = serializarErro(extra.cause, profundidade + 1);
  return saida;
}

/** Texto curto do erro para log/coluna de erro (despachante, worker, métricas): mesma regra do `serializarErro`. */
export function mensagemSegura(e: unknown): string {
  if (ehErroPostgres(e)) {
    const c = texto((e as unknown as { constraint?: unknown }).constraint);
    return `DatabaseError: erro do Postgres (SQLSTATE ${e.code}${c ? `, ${c}` : ''})`;
  }
  if (e instanceof Error) return `${e.name}: ${e.name === 'ZodError' ? 'dados inválidos' : e.message}`;
  return String(e);
}
