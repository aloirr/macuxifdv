/**
 * T-0078 D-L1a (CLAUDE.md regra 8): o serializador `err` da API e do worker nunca leva `detail`, `where`, `hint`,
 * `internalQuery`, `parameters` nem a mensagem do Postgres (que pode trazer o valor) — só SQLSTATE e nomes.
 */
import { Writable } from 'node:stream';
import pg from 'pg';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { opcoesLogger } from '../src/config';
import { ehErroPostgres, mensagemSegura, serializarErro } from '../src/log-seguro';
import { registrarMetricasWorker } from '../src/observabilidade';

const EMAIL = 'maria.pessoal@exemplo.com.br';

function erroPg(code: string, mensagem: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new pg.DatabaseError(mensagem, 0, 'error'), { code, ...extra });
}

const duplicado = () =>
  erroPg('23505', 'duplicate key value violates unique constraint "cliente_contato_email_key"', {
    constraint: 'cliente_contato_email_key',
    schema: 'core',
    table: 'cliente_contato',
    routine: '_bt_check_unique',
    detail: `Key (tenant_id, email)=(0a000000-0000-4000-8000-0000000000f8, ${EMAIL}) already exists.`,
    where: `SQL function "x" statement 1 ${EMAIL}`,
    hint: EMAIL,
    internalQuery: `select '${EMAIL}'`,
    parameters: [EMAIL],
  });

describe('serializarErro (erro do Postgres)', () => {
  it('23505 com detail: só tipo, SQLSTATE, severity, constraint, schema, tabela e routine', () => {
    expect(serializarErro(duplicado())).toEqual({
      type: 'DatabaseError',
      code: '23505',
      message: 'erro do Postgres (SQLSTATE 23505)',
      constraint: 'cliente_contato_email_key',
      schema: 'core',
      table: 'cliente_contato',
      routine: '_bt_check_unique',
    });
  });

  it('22P02: a mensagem do Postgres com o valor não sai; coluna e tipo (nomes) saem', () => {
    const e = erroPg('22P02', `invalid input syntax for type uuid: "${EMAIL}"`, { column: 'cliente_id', dataType: 'uuid' });
    const s = serializarErro(e);
    expect(JSON.stringify(s)).not.toContain(EMAIL);
    expect(s).toMatchObject({ code: '22P02', column: 'cliente_id', dataType: 'uuid' });
    expect(mensagemSegura(e)).toBe('DatabaseError: erro do Postgres (SQLSTATE 22P02)');
  });

  it('erro do Postgres embrulhado em cause também passa pela regra', () => {
    const s = serializarErro(new Error('falha ao gravar', { cause: duplicado() }));
    expect(JSON.stringify(s)).not.toContain(EMAIL);
    expect(s.cause).toMatchObject({ code: '23505', constraint: 'cliente_contato_email_key' });
  });

  it('reconhece erro com SQLSTATE do driver (DatabaseError, severity ou detail); código de sistema não é do Postgres', () => {
    expect(ehErroPostgres(duplicado())).toBe(true);
    expect(ehErroPostgres(Object.assign(new Error('x'), { code: '23514', severity: 'ERROR' }))).toBe(true);
    expect(ehErroPostgres(Object.assign(new Error('x'), { code: 'EPIPE' }))).toBe(false);
    expect(ehErroPostgres(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(ehErroPostgres(null)).toBe(false);
  });
});

describe('serializarErro (demais erros)', () => {
  it('Error comum: tipo, mensagem, code, statusCode e stack', () => {
    const s = serializarErro(Object.assign(new TypeError('quebrou'), { code: 'X1', statusCode: 500, segredo: EMAIL }));
    expect(s).toMatchObject({ type: 'TypeError', message: 'quebrou', code: 'X1', statusCode: 500 });
    expect(s.stack).toContain('quebrou');
    expect(JSON.stringify(s)).not.toContain(EMAIL);
  });

  it('ZodError: só caminho e código dos problemas (o valor recebido não sai)', () => {
    const r = z.object({ tipo: z.enum(['a', 'b']) }).safeParse({ tipo: EMAIL });
    const e = r.success ? new ZodError([]) : r.error;
    const s = serializarErro(e);
    expect(JSON.stringify(s)).not.toContain(EMAIL);
    expect(s.problemas).toEqual([{ caminho: 'tipo', codigo: 'invalid_enum_value' }]);
    expect(mensagemSegura(e)).toBe('ZodError: dados inválidos');
  });

  it('não-Error: só o tipo', () => {
    expect(serializarErro(EMAIL)).toEqual({ type: 'string', message: 'valor lançado que não é Error' });
  });
});

describe('logger real (opcoesLogger) e linha de métricas do worker', () => {
  function coletar() {
    const linhas: string[] = [];
    const stream = new Writable({
      write(c: Buffer, _e, cb) {
        linhas.push(c.toString());
        cb();
      },
    });
    return { linhas, stream };
  }

  it('o pino da API usa o serializador em err', () => {
    const c = coletar();
    pino(opcoesLogger('trace'), c.stream).error({ err: duplicado() }, 'erro não tratado');
    const log = c.linhas.join('');
    expect(log).not.toContain(EMAIL);
    expect(log).toContain('"constraint":"cliente_contato_email_key"');
  });

  it('banco fora no resumo da outbox: alerta BANCO_FALHA com a mensagem segura', async () => {
    const linhas: { o: object; msg: string }[] = [];
    const log = { info: (o: object, msg: string) => linhas.push({ o, msg }), warn: (o: object, msg: string) => linhas.push({ o, msg }) };
    await registrarMetricasWorker(async () => {
      throw duplicado();
    }, log);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.msg).toBe('alerta: banco');
    expect(JSON.stringify(linhas[0]!.o)).not.toContain(EMAIL);
    expect(linhas[0]!.o).toMatchObject({ alertas: ['BANCO_FALHA'], erro: 'DatabaseError: erro do Postgres (SQLSTATE 23505, cliente_contato_email_key)' });
  });
});

describe('redação do pino (T-0093 §6: login do portal e admin inicial)', () => {
  it('senha, e-mail e hash do corpo do login e do passo Empresa nunca saem no log', () => {
    let texto = '';
    const stream = new Writable({
      write(c, _e, cb) {
        texto += String(c);
        cb();
      },
    });
    const log = pino(opcoesLogger('trace'), stream);
    log.info({ corpo: { email: EMAIL, senha: 'Segredo#2026', admin: { email: EMAIL, nome: 'Maria', senha: 'Master#2026' } } }, 'corpo');
    log.info({ email: EMAIL, senha: 'Outra#2026', senha_hash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', admin: { senha: 'X#1aaaaa' } }, 'solto');
    expect(texto).not.toContain(EMAIL);
    expect(texto).not.toMatch(/Segredo#2026|Master#2026|Outra#2026|X#1aaaaa|argon2id/);
    expect(texto).toContain('[omitido]');
  });
});
