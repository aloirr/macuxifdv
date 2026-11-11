import type { ClienteBanco } from '@macuxi/platform-sdk';
import { completarCnpj } from '@macuxi/comum/documento';
import { describe, expect, it } from 'vitest';
import { FilialCriarSchema, FilialEditarSchema, FilialSchema } from '../contracts';
import { consumidorFilialDoErp } from './consumidores-erp-filial';
import { rotasDeFiliais } from './filiais';

const CNPJ = completarCnpj('123456780002');
const ID = '0f100000-0000-4000-8000-000000000009';
const MANAUS = '0f100000-0000-4000-8000-000000000001';
const base = { id: ID, codigo: '0004', nome: 'Santarém', cidade: 'Santarém', uf: 'PA', cnpj: CNPJ, logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '68005-000' };

interface Chamada {
  sql: string;
  params: unknown[];
}
function banco(linhas: Record<string, unknown>[]) {
  const chamadas: Chamada[] = [];
  const db: ClienteBanco = {
    query: async (sql: string, params: unknown[] = []) => {
      chamadas.push({ sql, params });
      if (/^\s*select/i.test(sql) && /from core\.filial f/.test(sql)) {
        const gravada = chamadas.some((c) => /insert into core\.filial/.test(c.sql)) ? [{ ...linhas[0], id: ID, padrao: false, codigo: '0004' }] : [];
        const rows = /f\.id = \$1/.test(sql) ? [...linhas, ...gravada].filter((l) => l.id === params[0]) : linhas;
        return { rows, rowCount: rows.length } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
  };
  return { db, chamadas };
}
const rota = (metodo: string, caminho: string) => rotasDeFiliais.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const ctxRota = (db: ClienteBanco, corpo: unknown, params: unknown = {}) =>
  ({ corpo, params, usuario: { id: 'u' }, requestId: 'r', comTenant: async (fn: (d: ClienteBanco, tx: unknown) => unknown) => fn(db, {}) }) as never;
const filialBanco = (extra: Record<string, unknown> = {}) => ({ id: MANAUS, codigo: '0001', nome: 'Manaus', cidade: 'Manaus', uf: 'AM', padrao: true, ativo: true, external_id: null, clientes_ativos: 0, cnpj: null, logradouro: null, numero: null, complemento: null, bairro: null, cep: null, telefone: null, ...extra });

describe('RN-CORE-39 (T-0159): core.filiais@1 e cadastro com CNPJ e endereço', () => {
  it('RN-CORE-39: o contrato da filial aceita os campos novos como opcionais (filial antiga continua válida)', () => {
    const antiga = { id: MANAUS, codigo: '0001', nome: 'M', cidade: null, uf: null, padrao: true, ativo: true, external_id: null };
    expect(FilialSchema.safeParse(antiga).success).toBe(true);
    expect(FilialSchema.safeParse({ ...antiga, cnpj: CNPJ, logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'B', cep: '69000000', telefone: null }).success).toBe(true);
  });
  it('RN-CORE-39: criar sem CNPJ ou endereço devolve 422 com a mensagem do que falta, sem gravar', async () => {
    const { db, chamadas } = banco([filialBanco()]);
    const corpo = FilialCriarSchema.parse({ ...base, cnpj: undefined, bairro: undefined });
    await expect(rota('POST', 'filiais').executar(ctxRota(db, corpo))).rejects.toMatchObject({ codigo: 'FILIAL_INVALIDA', message: expect.stringContaining('o CNPJ, o bairro') });
    expect(chamadas.some((c) => /insert into core\.filial/.test(c.sql))).toBe(false);
  });
  it('RN-CORE-39: criar com CNPJ de dígito errado é recusado; com tudo certo grava CNPJ e CEP só com dígitos', async () => {
    const { db, chamadas } = banco([filialBanco()]);
    const errado = CNPJ.slice(0, 13) + (CNPJ.endsWith('0') ? '1' : '0');
    await expect(rota('POST', 'filiais').executar(ctxRota(db, FilialCriarSchema.parse({ ...base, cnpj: errado })))).rejects.toMatchObject({ codigo: 'FILIAL_INVALIDA' });
    await rota('POST', 'filiais').executar(ctxRota(db, FilialCriarSchema.parse(base)));
    const ins = chamadas.find((c) => /insert into core\.filial/.test(c.sql))!;
    expect(ins.params).toEqual([ID, '0004', 'Santarém', 'Santarém', 'PA', CNPJ, 'Rua A', '10', null, 'Centro', '68005000', null]);
  });
  it('RN-CORE-39: editar a filial padrão antiga só trocando a situação não exige o cadastro; editar o nome exige', async () => {
    const { db } = banco([filialBanco({ id: ID, padrao: false })]);
    const p = { id: ID };
    await expect(rota('PUT', 'filiais/:id').executar(ctxRota(db, FilialEditarSchema.parse({ nome: 'Novo' }), p))).rejects.toMatchObject({ codigo: 'FILIAL_INVALIDA' });
    await expect(rota('PUT', 'filiais/:id').executar(ctxRota(db, FilialEditarSchema.parse({ ativo: false }), p))).resolves.toBeDefined();
  });
});

describe('RN-CORE-39 (T-0159): consumidor integracao.filial.atualizado@1 grava CNPJ e endereço do ERP', () => {
  const contexto = (propria: boolean) => {
    const chamadas: Chamada[] = [];
    const avisos: unknown[] = [];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        chamadas.push({ sql, params });
        if (/where external_id = \$1/.test(sql) && propria) return { rows: [{ id: ID }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    };
    return { ctx: { db, log: { warn: (...a: unknown[]) => avisos.push(a) } } as never, chamadas, avisos };
  };
  const evento = (registro: Record<string, unknown>) => ({ acao: 'atualizado', external_id: 'ERP-ST', registro: { codigo: '0004', nome: 'Santarém', ...registro } }) as never;

  it('RN-CORE-39: filial nova do ERP entra com CNPJ, endereço e telefone', async () => {
    const { ctx, chamadas } = contexto(false);
    await consumidorFilialDoErp.executar(evento({ cidade: 'Santarém', uf: 'PA', cnpj: CNPJ, logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '68005-000', telefone: '9330000000' }), ctx);
    const ins = chamadas.find((c) => /insert into core\.filial/.test(c.sql))!;
    expect(ins.params).toEqual(['ERP-ST', '0004', 'Santarém', 'Santarém', 'PA', CNPJ, 'Rua A', '10', null, 'Centro', '68005000', '9330000000']);
  });
  it('RN-CORE-39: filial já existente é atualizada sem apagar o que o ERP não mandou; CNPJ inválido é ignorado com aviso', async () => {
    const { ctx, chamadas, avisos } = contexto(true);
    await consumidorFilialDoErp.executar(evento({ cnpj: '123', logradouro: 'Rua B' }), ctx);
    const up = chamadas.find((c) => /update core\.filial set external_id/.test(c.sql))!;
    expect(up.sql).toContain('coalesce($7, cnpj)');
    expect(up.params.slice(6)).toEqual([null, 'Rua B', null, null, null, null, null]);
    expect(avisos).toHaveLength(1);
  });
});
