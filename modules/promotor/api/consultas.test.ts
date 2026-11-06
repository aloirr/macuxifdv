/**
 * `promotor.concorrentes@1`: contrato (Zod), SQL montado e registro no manifesto/API. Tenant isolado pela RLS do banco
 * (consultas.db.test.ts, CI); licença do tenant pelo executor da plataforma (ADR 0012: dono sem licença = indisponível).
 */
import { consultasSemImplementacao, type ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_CONCORRENTES, ConcorrentesEntradaSchema, ConcorrentesSaidaSchema } from '../contracts';
import { manifest } from '../manifest';
import { consultaConcorrentes } from './consultas';
import { criarModuloApiPromotor } from './index';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

function executar(entrada: object, linhas: unknown[] = []) {
  const chamadas: Array<{ sql: string; params: unknown[] }> = [];
  const ctx = { db: { query: async (sql: string, params: unknown[] = []) => (chamadas.push({ sql, params }), { rows: linhas }) } } as unknown as ContextoConsulta;
  const saida = consultaConcorrentes.executar(ConcorrentesEntradaSchema.parse(entrada), ctx);
  return { saida, chamadas };
}

describe('promotor.concorrentes@1: contrato', () => {
  it('nome e versão publicados; entrada vazia vale (todos os ativos); campo desconhecido é recusado', () => {
    expect(CONSULTA_CONCORRENTES.nome).toBe('promotor.concorrentes@1');
    expect(ConcorrentesEntradaSchema.parse({})).toEqual({ incluir_inativos: false });
    expect(ConcorrentesEntradaSchema.safeParse({ x: 1 }).success).toBe(false);
  });
  it('ids: no máximo 500 e só UUID', () => {
    expect(ConcorrentesEntradaSchema.safeParse({ ids: Array.from({ length: 501 }, () => ID1) }).success).toBe(false);
    expect(ConcorrentesEntradaSchema.safeParse({ ids: ['abc'] }).success).toBe(false);
  });
  it('saída: id, nome, ativo e external_id', () => {
    expect(ConcorrentesSaidaSchema.safeParse({ concorrentes: [{ id: ID1, nome: 'Marca X', ativo: true, external_id: null }] }).success).toBe(true);
  });
});

describe('promotor.concorrentes@1: implementação', () => {
  it('entrada vazia: só ativos do schema promotor, sem apagados, ordenado por nome', async () => {
    const { saida, chamadas } = executar({}, [{ id: ID1, nome: 'Alfa', ativo: true, external_id: null }]);
    expect(await saida).toEqual({ concorrentes: [{ id: ID1, nome: 'Alfa', ativo: true, external_id: null }] });
    expect(chamadas[0]!.sql).toMatch(/from promotor\.concorrente where deleted_at is null and ativo order by lower\(nome\), id/);
    expect(chamadas[0]!.params).toEqual([]);
  });
  it('ids vazio: responde vazio sem consultar o banco', async () => {
    const { saida, chamadas } = executar({ ids: [] });
    expect(await saida).toEqual({ concorrentes: [] });
    expect(chamadas).toHaveLength(0);
  });
  it('ids + busca + inativos: parâmetros posicionais e curingas do LIKE escapados', async () => {
    const { chamadas, saida } = executar({ ids: [ID1, ID2], busca: '50%_a', incluir_inativos: true });
    await saida;
    expect(chamadas[0]!.sql).not.toMatch(/and ativo/);
    expect(chamadas[0]!.sql).toContain('id = any($1::uuid[])');
    expect(chamadas[0]!.sql).toContain('nome ilike $2');
    expect(chamadas[0]!.params).toEqual([[ID1, ID2], '%50\\%\\_a%']);
  });
  it('ids inexistentes: lista vazia (não é erro)', async () => {
    expect(await executar({ ids: [ID1] }, []).saida).toEqual({ concorrentes: [] });
  });
});

describe('promotor.concorrentes@1: registro (ADR 0012)', () => {
  it('o manifesto oferece e a API implementa, com ou sem repositório', () => {
    expect(manifest.ofereceConsultas).toContain('promotor.concorrentes@1');
    expect(consultasSemImplementacao([criarModuloApiPromotor({ repositorio: null })])).toEqual([]);
  });
});
