/**
 * T-0094 (RN-CORE-34): Equipe por CSV sem convite, com banco falso (o teste de banco real está em `equipe-csv.db.test.ts`, no CI).
 * Sem e-mail configurado o `gravar` com gente nova responde 503 ANTES de gravar; com e-mail, cada pessoa nova nasce com senha
 * temporária (hash, `trocar_senha`, 72 h) e a senha só aparece na mensagem de e-mail.
 */
import type { ClienteBanco, ContextoBase, RotaModulo, TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ImportarEquipeRespostaSchema } from '../contracts';
import type { MensagemEmail, ServicoEmail } from './email';
import { perfisDeFabrica } from '../domain';
import { rotasDeEquipeCsv } from './equipe-csv';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: TENANT, perfil: 'admin' as const, modulos: ['core' as const], perfis: perfisDeFabrica('admin') };
const NOVO_ID = '0b000000-0000-4000-8000-000000000099';
const CSV = ['nome,email,telefone,perfil,email_superior,codigo_erp,modulos', 'Vera Campo,vera.csv@exemplo.com.br,,vendedor,,,'].join('\n');

function montar(disponivel: boolean) {
  const consultas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const auditorias: unknown[] = [];
  const enviados: MensagemEmail[] = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      consultas.push({ sql, valores });
      const rows = /insert into core.usuario/.test(sql) ? [{ id: NOVO_ID }] : /from plataforma.tenant where id/.test(sql) ? [{ nome: 'Distribuidora Alfa', codigo: 'AM4821' }] : [];
      return { rows: rows as never[], rowCount: rows.length };
    },
  };
  const email: ServicoEmail = {
    disponivel: () => disponivel,
    enfileirar: async (_d, m) => {
      if (!disponivel) return 'indisponivel';
      enviados.push(m);
      return 'enfileirado';
    },
  };
  const tx = { publicar: async () => ({}), auditar: async (a: unknown) => void auditorias.push(a) } as unknown as TransacaoTenant;
  const logs: string[] = [];
  const ctx = {
    usuario: ADMIN,
    requestId: 'req',
    agora: () => new Date('2026-11-07T12:00:00Z'),
    fuso: () => 'America/Manaus',
    comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
    log: { info: (o: unknown, m: string) => logs.push(JSON.stringify({ o, m })), warn() {}, error() {} },
    email,
  } as unknown as ContextoBase;
  return { ctx, consultas, auditorias, enviados, logs };
}

const rota = (): RotaModulo => rotasDeEquipeCsv.find((r) => r.caminho === 'equipe/importacoes')!;
const importar = (ctx: ContextoBase, modo: 'conferir' | 'gravar') => rota().executar({ ...ctx, corpo: rota().corpo!.parse({ csv: CSV, modo }), query: {}, params: {} } as never);

describe('RN-CORE-34: Equipe por CSV sem convite', () => {
  it('RN-CORE-34: sem e-mail configurado, gravar com pessoa nova é 503 EMAIL_INDISPONIVEL e não grava nada', async () => {
    const m = montar(false);
    await expect(importar(m.ctx, 'gravar')).rejects.toMatchObject({ status: 503, codigo: 'EMAIL_INDISPONIVEL' });
    expect(m.consultas.some((c) => /insert into|update core\./.test(c.sql))).toBe(false);
    expect(m.auditorias).toHaveLength(0);
  });

  it('RN-CORE-34: conferir funciona sem e-mail e não grava', async () => {
    const m = montar(false);
    const r = ImportarEquipeRespostaSchema.parse(await importar(m.ctx, 'conferir'));
    expect(r.erros).toEqual([]);
    expect(r.gravado).toBe(false);
    expect(r.acessos_enviados).toBe(0);
    expect(m.consultas.some((c) => /insert into/.test(c.sql))).toBe(false);
  });

  it('RN-CORE-34: gravar cria a pessoa com senha temporária (hash, trocar_senha, 72 h) e manda a senha só pelo e-mail', async () => {
    const m = montar(true);
    const r = ImportarEquipeRespostaSchema.parse(await importar(m.ctx, 'gravar'));
    expect(r.gravado).toBe(true);
    expect(r.acessos_enviados).toBe(1);
    expect(r.email_acesso).toBe('enfileirado');
    const ins = m.consultas.find((c) => /insert into core.usuario/.test(c.sql))!;
    expect(ins.sql).toContain('trocar_senha');
    expect(String(ins.valores[4])).toMatch(/^\$argon2id\$/);
    expect(ins.valores.find((v) => v instanceof Date)).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ modelo: 'acesso_inicial', usuario_id: NOVO_ID, para: 'vera.csv@exemplo.com.br', dados: { empresa_nome: 'Distribuidora Alfa', codigo_empresa: 'AM4821', validade_horas: 72 } });
    const senha = m.enviados[0]!.dados.senha;
    expect(senha).toHaveLength(12);
    const tudo = JSON.stringify([m.auditorias, m.logs, m.consultas.map((c) => c.valores)]);
    expect(tudo).not.toContain(senha);
    expect(JSON.stringify(m.auditorias)).not.toContain('vera.csv@exemplo.com.br');
    expect(JSON.stringify(m.auditorias)).toContain('"trocar_senha":true');
  });

  it('RN-CORE-33/34: nenhuma rota de convite existe e todas as rotas são do BKO', () => {
    expect(rotasDeEquipeCsv.map((r) => r.caminho)).toEqual(['equipe/modelo.csv', 'equipe/importacoes']);
    expect(rotasDeEquipeCsv.every((r) => r.superficie === 'bko')).toBe(true);
  });
});
