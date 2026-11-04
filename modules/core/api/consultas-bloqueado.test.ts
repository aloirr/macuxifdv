import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CadastroResumoEntradaSchema, CadastroResumoSaidaSchema } from '../contracts';
import { consultaCadastroResumo } from './consultas';

const C1 = '0ea00000-0000-4000-8000-000000000001';
const cliente = (bloqueado: boolean) => ({ id: C1, razao_social: 'X', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null, inscricao_estadual: null, cep: null, cadastro_incompleto: false, cadastro_campos_faltantes: [], bloqueado });

describe('RN-VEN-13 e RN-CORE-16: core.cadastro_resumo@1 traz o bloqueio do cliente', () => {
  it('RN-VEN-13: lê o bloqueio de core.cliente_financeiro (do próprio Core), sem linha financeira = não bloqueado, e a saída respeita o contrato', async () => {
    const sqls: string[] = [];
    const db: ClienteBanco = { query: async (sql) => { sqls.push(sql); return { rows: /from core.cliente c/.test(sql) ? [cliente(true)] : [], rowCount: 1 } as never; } };
    const r = await consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse({ cliente_ids: [C1] }), { db } as unknown as ContextoConsulta);
    expect(CadastroResumoSaidaSchema.parse(r).clientes[0]).toMatchObject({ bloqueado: true, cadastro_incompleto: false });
    expect(sqls[0]).toMatch(/left join core\.cliente_financeiro f/);
    expect(sqls[0]).toMatch(/coalesce\(f\.bloqueado, false\) as bloqueado/);
    expect(sqls.join(' ')).not.toMatch(/vendedor\.|gestor\./);
  });
});
