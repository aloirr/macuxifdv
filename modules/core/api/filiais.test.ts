import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { FiliaisDoUsuarioEntradaSchema, FiliaisDoUsuarioSaidaSchema, FiliaisEntradaSchema, FiliaisSaidaSchema } from '../contracts';
import { consultaFiliais, consultaFiliaisDoUsuario } from './filiais';

const MANAUS = '0f100000-0000-4000-8000-000000000001';
const BV = '0f100000-0000-4000-8000-000000000002';
const INATIVA = '0f100000-0000-4000-8000-000000000003';
const C1 = '0c100000-0000-4000-8000-000000000001';
const C2 = '0c100000-0000-4000-8000-000000000002';
const C3 = '0c100000-0000-4000-8000-000000000003';
const f = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({ id, codigo, nome: `Filial ${codigo}`, cidade: 'Manaus', uf: 'AM', padrao: false, ativo: true, external_id: null, ...extra });

function ctx(clientes: Array<{ id: string; filial_id: string | null }>, perfil = 'analista'): ContextoConsulta {
  const db: ClienteBanco = {
    query: async (sql: string) => {
      if (/from core\.filial f/.test(sql)) return { rows: [f(MANAUS, '0001', { padrao: true }), f(BV, '0002', { external_id: 'ERP-BV' }), f(INATIVA, '0003', { ativo: false })], rowCount: 3 } as never;
      if (/from core\.cliente where/.test(sql)) return { rows: clientes, rowCount: clientes.length } as never;
      return { rows: [], rowCount: 0 } as never;
    },
  };
  return { db, usuario: { id: 'u', tenant_id: 't', perfil }, agora: () => new Date('2026-11-10T12:00:00Z'), fuso: () => 'America/Manaus' } as unknown as ContextoConsulta;
}

describe('core.filiais@1 (RN-CORE-39)', () => {
  it('RN-CORE-39: a filial efetiva do cliente é a dele; nula, inativa ou apagada cai na padrão; a saída respeita o contrato', async () => {
    const entrada = FiliaisEntradaSchema.parse({ cliente_ids: [C1, C2, C3] });
    const r = FiliaisSaidaSchema.parse(await consultaFiliais.executar(entrada, ctx([{ id: C1, filial_id: BV }, { id: C2, filial_id: null }, { id: C3, filial_id: INATIVA }])));
    expect(r.padrao_id).toBe(MANAUS);
    expect(r.clientes).toEqual([{ cliente_id: C1, filial_id: BV }, { cliente_id: C2, filial_id: MANAUS }, { cliente_id: C3, filial_id: MANAUS }]);
    expect(r.da_carteira).toBeNull();
  });
  it('RN-CORE-39: external_ids acha só as filiais que existem (desconhecida fica de fora)', async () => {
    const r = await consultaFiliais.executar(FiliaisEntradaSchema.parse({ external_ids: ['ERP-BV', 'ERP-X'] }), ctx([]));
    expect(FiliaisSaidaSchema.parse(r).por_external_id).toEqual([{ external_id: 'ERP-BV', filial_id: BV }]);
  });
  it('RN-CORE-39: escopo carteira de analista (tenant inteiro) devolve da_carteira nulo = todas as filiais', async () => {
    const r = await consultaFiliais.executar(FiliaisEntradaSchema.parse({ escopo: 'carteira' }), ctx([], 'analista'));
    expect(FiliaisSaidaSchema.parse(r).da_carteira).toBeNull();
  });
  it('RN-CORE-39: sem filial padrão o tenant está inconsistente e a consulta recusa em português', async () => {
    const db: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) as never };
    await expect(consultaFiliais.executar(FiliaisEntradaSchema.parse({}), { db } as unknown as ContextoConsulta)).rejects.toThrow(/filial padrão/);
  });
});

describe('core.filiais_do_usuario@1 (T-0176, RN-CORE-39)', () => {
  const U = '0a100000-0000-4000-8000-000000000001';
  const ctxU = (cadastro: string | null, venda: string[]) =>
    ({
      db: {
        query: async (sql: string) => {
          const rows = /from core\.usuario where/.test(sql) ? (cadastro || venda.length ? [{ id: U, filial_cadastro_id: cadastro }] : []) : venda.map((filial_id) => ({ usuario_id: U, filial_id }));
          return { rows, rowCount: rows.length };
        },
      } as unknown as ClienteBanco,
    }) as unknown as ContextoConsulta;
  it('RN-CORE-39: devolve a filial de cadastro e todas as de venda (supervisor com várias)', async () => {
    const r = FiliaisDoUsuarioSaidaSchema.parse(await consultaFiliaisDoUsuario.executar(FiliaisDoUsuarioEntradaSchema.parse({ usuario_id: U }), ctxU(MANAUS, [MANAUS, BV])));
    expect(r).toEqual({ filial_cadastro_id: MANAUS, filial_venda_ids: [MANAUS, BV], sem_filial: false });
  });
  it('RN-CORE-39: sem filial de cadastro (ou usuário que o tenant não enxerga) volta sem_filial', async () => {
    const r = await consultaFiliaisDoUsuario.executar(FiliaisDoUsuarioEntradaSchema.parse({ usuario_id: U }), ctxU(null, []));
    expect(r).toEqual({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true });
  });
  it('RN-CORE-39: a entrada exige usuario_id uuid', () => {
    expect(() => FiliaisDoUsuarioEntradaSchema.parse({ usuario_id: 'x' })).toThrow();
  });
});
