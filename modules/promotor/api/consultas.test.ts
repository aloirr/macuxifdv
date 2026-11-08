/**
 * `promotor.concorrentes@1`: contrato (Zod), registro no manifesto/API e deprecação (T-0113, ADR 0034): a lista de marcas é do
 * Catálogo, então a consulta não lê tabela e responde `ConsultaIndisponivel` apontando `catalogo.marcas@1`.
 */
import { ConsultaIndisponivel, consultasSemImplementacao, type ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_CONCORRENTES, ConcorrentesEntradaSchema, ConcorrentesSaidaSchema } from '../contracts';
import { manifest } from '../manifest';
import { consultaConcorrentes } from './consultas';
import { criarModuloApiPromotor } from './index';

const ID1 = '00000000-0000-4000-8000-000000000001';

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

describe('promotor.concorrentes@1: deprecada (ADR 0034)', () => {
  it('não lê tabela do Promotor nem do Catálogo: responde ConsultaIndisponivel apontando catalogo.marcas@1', async () => {
    let tocouBanco = false;
    const ctx = { db: { query: async () => ((tocouBanco = true), { rows: [] }) } } as unknown as ContextoConsulta;
    const r = consultaConcorrentes.executar(ConcorrentesEntradaSchema.parse({}), ctx);
    await expect(r).rejects.toBeInstanceOf(ConsultaIndisponivel);
    await expect(r).rejects.toThrow(/catalogo\.marcas@1/);
    expect(tocouBanco).toBe(false);
  });
  it('continua oferecida pelo manifesto, e catalogo.marcas@1 passa a ser usada', () => {
    expect(manifest.ofereceConsultas).toContain('promotor.concorrentes@1');
    expect(manifest.usaConsultas).toContain('catalogo.marcas@1');
  });
});

describe('promotor.concorrentes@1: registro (ADR 0012)', () => {
  it('o manifesto oferece e a API implementa, com ou sem repositório', () => {
    expect(consultasSemImplementacao([criarModuloApiPromotor({ repositorio: null })])).toEqual([]);
  });
});
