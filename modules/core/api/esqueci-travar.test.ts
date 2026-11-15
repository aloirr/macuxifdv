/**
 * D-01 (RN-CORE-34): o "Esqueci a senha" lê o usuário com `for update`, dentro da mesma transação (`comTenant`) que grava a
 * senha temporária; o toque duplo espera o 1º pedido e cai na regra dos 15 minutos.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EsqueciSenhaRequestSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { bancoDeTeste, contextoPublico, estadoInicial, fabricaEmMemoria, SEGREDO, senhasDeTeste } from './apoio-teste';
import { criarLimiteDeFalhas } from './limite-login';
import { repositorioTenantSql } from './repositorio';

describe('RN-CORE-34: Esqueci a senha trava a linha do usuário (D-01)', () => {
  it('RN-CORE-34: pede usuarioPorEmail com travar e grava a temporária dentro do mesmo comTenant', async () => {
    const e = await estadoInicial();
    const base = fabricaEmMemoria(e);
    const pedidos: Array<{ travar?: boolean } | undefined> = [];
    let abertos = 0;
    let gravouDentro = false;
    const repos = {
      ...base,
      doTenant: (db: ClienteBanco) => {
        const r = base.doTenant(db);
        return {
          ...r,
          usuarioPorEmail: async (email: string, o?: { travar?: boolean }) => {
            pedidos.push(o);
            return r.usuarioPorEmail(email, o);
          },
          gravarSenhaTemporaria: async (...a: Parameters<typeof r.gravarSenhaTemporaria>) => {
            gravouDentro = abertos === 1;
            return r.gravarSenhaTemporaria(...a);
          },
        };
      },
    };
    const { banco } = bancoDeTeste();
    const bancoContado = {
      ...banco,
      comTenant: async <T>(id: string, fn: (db: ClienteBanco) => Promise<T>): Promise<T> => {
        abertos++;
        try {
          return await banco.comTenant(id, fn);
        } finally {
          abertos--;
        }
      },
    };
    const t0 = new Date('2026-11-07T12:00:00Z');
    const auth = criarAutenticacao({ segredo: () => SEGREDO, repos, senhas: senhasDeTeste(), limiteLogin: criarLimiteDeFalhas(), limiteEsqueciIp: criarLimiteDeFalhas(5, 900_000), limiteEsqueciChave: criarLimiteDeFalhas(3, 3_600_000) });
    const corpo = EsqueciSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br' });
    const ctx = { ...contextoPublico(corpo, bancoContado, () => t0), email: { disponivel: () => true, enfileirar: async () => 'enfileirado' } };
    await auth.esqueciSenha(ctx as never);
    expect(pedidos).toEqual([{ travar: true }]);
    expect(gravouDentro).toBe(true);
  });

  it('RN-CORE-34: o SQL acrescenta for update só quando pedido', async () => {
    const sqls: string[] = [];
    const db = { query: async (sql: string) => (sqls.push(sql), { rows: [], rowCount: 0 }) } as unknown as ClienteBanco;
    const r = repositorioTenantSql(db);
    await r.usuarioPorEmail('a@b.com');
    await r.usuarioPorEmail('a@b.com', { travar: true });
    expect(sqls[0]).not.toMatch(/for update/);
    expect(sqls[1]).toMatch(/for update\s*$/);
  });
});
