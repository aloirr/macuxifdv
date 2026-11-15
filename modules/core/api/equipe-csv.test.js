import { describe, expect, it } from 'vitest';
import { ImportarEquipeRespostaSchema } from '../contracts';
import { perfisDeFabrica } from '../domain';
import { rotasDeEquipeCsv } from './equipe-csv';
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: TENANT, perfil: 'admin', modulos: ['core'], perfis: perfisDeFabrica('admin') };
const NOVO_ID = '0b000000-0000-4000-8000-000000000099';
const CSV = ['nome,email,telefone,perfil,email_superior,codigo_erp,modulos', 'Vera Campo,vera.csv@exemplo.com.br,,vendedor,,,'].join('\n');
function montar(disponivel) {
    const consultas = [];
    const auditorias = [];
    const enviados = [];
    const db = {
        query: async (sql, valores = []) => {
            consultas.push({ sql, valores });
            const rows = /insert into core.usuario/.test(sql) ? [{ id: NOVO_ID }] : /from plataforma.tenant where id/.test(sql) ? [{ nome: 'Distribuidora Alfa', codigo: 'alfa' }] : /from core.filial where deleted_at/.test(sql) ? [{ id: FILIAL_ID, codigo: '0001', external_id: null }] : [];
            return { rows: rows, rowCount: rows.length };
        },
    };
    const email = {
        disponivel: () => disponivel,
        enfileirar: async (_d, m) => {
            if (!disponivel)
                return 'indisponivel';
            enviados.push(m);
            return 'enfileirado';
        },
    };
    const tx = { publicar: async () => ({}), auditar: async (a) => void auditorias.push(a) };
    const logs = [];
    const ctx = {
        usuario: ADMIN,
        requestId: 'req',
        agora: () => new Date('2026-11-07T12:00:00Z'),
        fuso: () => 'America/Manaus',
        comTenant: (fn) => fn(db, tx),
        log: { info: (o, m) => logs.push(JSON.stringify({ o, m })), warn() { }, error() { } },
        email,
    };
    return { ctx, consultas, auditorias, enviados, logs };
}
const FILIAL_ID = '0f000000-0000-4000-8000-000000000001';
const rota = () => rotasDeEquipeCsv.find((r) => r.caminho === 'equipe/importacoes');
const importar = (ctx, modo) => rota().executar({ ...ctx, corpo: rota().corpo.parse({ csv: CSV, modo }), query: {}, params: {} });
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
        // RN-CORE-39: a pessoa nova nasce com filial de cadastro (a única da empresa) e na lista de venda
        expect(m.consultas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === FILIAL_ID)).toBe(true);
        expect(m.consultas.some((c) => /update core\.usuario set filial_cadastro_id/.test(c.sql) && c.valores[1] === FILIAL_ID)).toBe(true);
        expect(r.email_acesso).toBe('enfileirado');
        const ins = m.consultas.find((c) => /insert into core.usuario/.test(c.sql));
        expect(ins.sql).toContain('trocar_senha');
        expect(String(ins.valores[4])).toMatch(/^\$argon2id\$/);
        expect(ins.valores.find((v) => v instanceof Date)).toEqual(new Date('2026-11-10T12:00:00Z'));
        expect(m.enviados).toHaveLength(1);
        expect(m.enviados[0]).toMatchObject({ modelo: 'acesso_inicial', usuario_id: NOVO_ID, para: 'vera.csv@exemplo.com.br', dados: { empresa_nome: 'Distribuidora Alfa', codigo_empresa: 'alfa', validade_horas: 72 } });
        const senha = m.enviados[0].dados.senha;
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
