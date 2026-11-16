/**
 * T-0052-B4 (R-20261105-132933, aprovada pelo gerente): leituras aditivas do motor para o módulo não ler a entidade
 * inteira a cada busca — `linhasPorCampo` (só as linhas dos candidatos), `contarLinhas` (limiar sem ler) e
 * `versaoLinhas` (memorizar derivados e só reler quando o sync mudar). Mesmos casos nos três adaptadores da suíte do
 * motor (chave→JSON em memória, `linhas` sobre chave→JSON e SQLite em `node:sqlite`); no fim, casos só do SQLite
 * (índice de expressão usado, tipos do JSON, muitos valores numa consulta só).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, valoresDeCampo, validarCampoLinha } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarArmazenamentoSqlite } from './sqlite/armazenamento';
import { criarDriverNode } from './sqlite/driver-node';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['produto'] }),
    defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['estoque_saldo'] }),
];
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const t = (n) => `2026-11-05T10:${String(n).padStart(2, '0')}:00.000Z`;
const produto = (id, n = 0, extra = {}) => ({ id, updated_at: t(n), deleted_at: null, nome: id, ...extra });
const saldo = (id, produto_id, quantidade, n = 0, lote = null) => ({
    id,
    updated_at: t(n),
    deleted_at: null,
    produto_id,
    deposito_id: 'd1',
    quantidade,
    lote,
});
describe.each(FABRICAS_ARMAZENAMENTO)('motor: leituras de linhas [%s] (T-0052-B4)', (_nome, fabrica) => {
    function montar() {
        const registro = criarRegistroSync(manifestos);
        registro.registrar(definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
        registro.registrar(definirEntidadeSync({
            nome: 'estoque_saldo',
            modulo: 'catalogo',
            direcao: 'pull',
            conflito: 'servidor_vence',
            schema: z.object({ produto_id: z.string() }),
        }));
        const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'catalogo'] });
        const armazenamento = fabrica();
        const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, agora: () => new Date('2026-11-05T12:00:00Z') });
        return { motor, servidor, armazenamento };
    }
    async function carregado() {
        const m = montar();
        await m.motor.aplicarModulosAtivos(['core', 'catalogo']);
        m.servidor.linhas.produto = [produto('p1', 1), produto('p2', 2), produto('p3', 3, { codigo: 7 })];
        m.servidor.linhas.estoque_saldo = [
            saldo('s1', 'p1', 10, 1),
            saldo('s2', 'p1', 5, 2, 'L1'),
            saldo('s3', 'p2', 0, 3),
            saldo('s4', 'p3', 8, 4),
        ];
        expect(await m.motor.sincronizar()).toBe(true);
        return m;
    }
    const ids = (ls) => ls.map((l) => l.id).sort();
    it('linhasPorCampo: só as linhas dos valores pedidos; vazio, ausente e entidade sem linhas = []', async () => {
        const { motor } = await carregado();
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['p1', 'p3', 'x']))).toEqual(['s1', 's2', 's4']);
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['p2', 'p2', 'p2']))).toEqual(['s3']);
        expect(await motor.linhasPorCampo('estoque_saldo', 'produto_id', [])).toEqual([]);
        expect(await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['x'])).toEqual([]);
        expect(await motor.linhasPorCampo('estoque_saldo', 'campo_que_nao_existe', ['p1'])).toEqual([]);
        expect(await motor.linhasPorCampo('entidade_vazia', 'produto_id', ['p1'])).toEqual([]);
        // a linha inteira, igual a `linhas`
        const [s4] = await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['p3']);
        expect(s4).toEqual(saldo('s4', 'p3', 8, 4));
    });
    it('linhasPorCampo: comparação estrita de tipo (texto × número), números, e null/NaN ignorados', async () => {
        const { motor } = await carregado();
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'quantidade', [5, 8]))).toEqual(['s2', 's4']);
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'quantidade', [5.0]))).toEqual(['s2']);
        expect(await motor.linhasPorCampo('estoque_saldo', 'quantidade', ['5', '8'])).toEqual([]);
        expect(ids(await motor.linhasPorCampo('produto', 'codigo', [7]))).toEqual(['p3']);
        expect(await motor.linhasPorCampo('produto', 'codigo', ['7'])).toEqual([]);
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'lote', ['L1']))).toEqual(['s2']);
        const hostis = [null, Number.NaN, Number.POSITIVE_INFINITY, true, { a: 1 }];
        expect(await motor.linhasPorCampo('estoque_saldo', 'lote', hostis)).toEqual([]);
        expect(await motor.linhasPorCampo('estoque_saldo', 'quantidade', hostis)).toEqual([]);
    });
    it('linhasPorCampo: campo fora de [a-z][a-z0-9_]* é erro do app (nada de injeção no caminho JSON)', async () => {
        const { motor } = await carregado();
        for (const campo of ["produto_id') OR 1=1 --", 'produto.id', 'Produto_id', '', '$.produto_id', '1campo'])
            await expect(motor.linhasPorCampo('estoque_saldo', campo, ['p1'])).rejects.toThrow(/Campo inválido/);
    });
    it('linhasPorCampo e contarLinhas acompanham o pull: removida sai, alterada muda de grupo', async () => {
        const { motor, servidor } = await carregado();
        expect(await motor.contarLinhas('estoque_saldo')).toBe(4);
        expect(await motor.contarLinhas('produto')).toBe(3);
        expect(await motor.contarLinhas('entidade_vazia')).toBe(0);
        servidor.linhas.estoque_saldo.push({ ...saldo('s1', 'p1', 10, 10), deleted_at: t(10) }, saldo('s3', 'p1', 2, 11));
        await motor.sincronizar();
        expect(await motor.contarLinhas('estoque_saldo')).toBe(3);
        expect(ids(await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['p1']))).toEqual(['s2', 's3']);
        expect(await motor.linhasPorCampo('estoque_saldo', 'produto_id', ['p2'])).toEqual([]);
    });
    it('versaoLinhas: estável sem mudança; muda só na entidade cuja página trouxe linhas', async () => {
        const { motor, servidor } = await carregado();
        const v = motor.versaoLinhas('estoque_saldo');
        const vp = motor.versaoLinhas('produto');
        expect(motor.versaoLinhas('estoque_saldo')).toBe(v);
        // sync sem novidade: nada muda
        await motor.sincronizar();
        expect(motor.versaoLinhas('estoque_saldo')).toBe(v);
        expect(motor.versaoLinhas('produto')).toBe(vp);
        // estoque mudou no servidor: só a versão do estoque muda
        servidor.linhas.estoque_saldo.push(saldo('s3', 'p2', 9, 20));
        await motor.sincronizar();
        const v2 = motor.versaoLinhas('estoque_saldo');
        expect(v2).not.toBe(v);
        expect(motor.versaoLinhas('produto')).toBe(vp);
        expect(motor.versaoLinhas('estoque_saldo')).toBe(v2);
    });
    it('versaoLinhas: o padrão de uso (versão antes das linhas) nunca guarda derivado velho com versão nova', async () => {
        const { motor, servidor } = await carregado();
        let leituras = 0;
        let memo = null;
        const totalEmEstoque = async () => {
            const versao = motor.versaoLinhas('estoque_saldo');
            if (memo?.versao === versao)
                return memo.total;
            leituras++;
            const total = (await motor.linhas('estoque_saldo')).reduce((s, l) => s + l.quantidade, 0);
            memo = { versao, total };
            return total;
        };
        expect(await totalEmEstoque()).toBe(23);
        expect(await totalEmEstoque()).toBe(23);
        expect(leituras).toBe(1);
        servidor.linhas.estoque_saldo.push(saldo('s4', 'p3', 100, 30));
        await motor.sincronizar();
        expect(await totalEmEstoque()).toBe(115);
        expect(leituras).toBe(2);
    });
    it('versaoLinhas: muda quando a ressincronização apaga o que saiu do escopo (ADR 0009 §4)', async () => {
        const { motor, servidor } = await carregado();
        servidor.versoesEscopo.estoque_saldo = 'v1';
        await motor.sincronizar();
        const v = motor.versaoLinhas('estoque_saldo');
        // nova versão do escopo, mesmas linhas menos s4 (que nem vem no pull): só a remoção do fim muda o aparelho
        servidor.versoesEscopo.estoque_saldo = 'v2';
        servidor.linhas.estoque_saldo = servidor.linhas.estoque_saldo.filter((l) => l.id !== 's4');
        await motor.sincronizar();
        expect(await motor.contarLinhas('estoque_saldo')).toBe(3);
        expect(motor.versaoLinhas('estoque_saldo')).not.toBe(v);
    });
    it('versaoLinhas: muda quando o motor apaga linhas (RN-CORE-02, troca de geração ADR 0021, RN-CORE-15)', async () => {
        const { motor, servidor } = await carregado();
        // RN-CORE-02: Catálogo desativado sem fila = linhas apagadas na hora
        let v = motor.versaoLinhas('estoque_saldo');
        await motor.aplicarModulosAtivos(['core']);
        expect(await motor.contarLinhas('estoque_saldo')).toBe(0);
        expect(motor.versaoLinhas('estoque_saldo')).not.toBe(v);
        await motor.aplicarModulosAtivos(['core', 'catalogo']);
        // ADR 0021: base recriada = cópia local apagada e recarregada
        servidor.geracao_base = G1;
        await motor.sincronizar();
        v = motor.versaoLinhas('produto');
        servidor.geracao_base = G2;
        servidor.linhas.produto = [];
        expect(await motor.sincronizar()).toBe(true);
        expect(await motor.contarLinhas('produto')).toBe(0);
        expect(motor.versaoLinhas('produto')).not.toBe(v);
        // RN-CORE-15: aparelho bloqueado
        servidor.linhas.produto = [produto('p9', 40)];
        await motor.sincronizar();
        v = motor.versaoLinhas('produto');
        await motor.limparAparelho();
        expect(await motor.contarLinhas('produto')).toBe(0);
        expect(motor.versaoLinhas('produto')).not.toBe(v);
    });
    it('versaoLinhas: dois motores (troca de usuário) nunca devolvem o mesmo número', async () => {
        const a = await carregado();
        const b = await carregado();
        expect(a.motor.versaoLinhas('produto')).not.toBe(b.motor.versaoLinhas('produto'));
    });
});
describe('leituras de linhas: auxiliares', () => {
    it('valoresDeCampo tira repetidos e o que não é texto nem número finito; validarCampoLinha devolve o campo', () => {
        const hostis = ['a', 'a', 1, 1, Number.NaN, null, true, -0, 0];
        expect(valoresDeCampo(hostis)).toEqual(['a', 1, 0]);
        expect(validarCampoLinha('produto_id')).toBe('produto_id');
        expect(() => validarCampoLinha('a b')).toThrow(/Campo inválido/);
    });
});
describe('linhasPorCampo no SQLite (node:sqlite)', () => {
    const abrir = (sql) => {
        const driver = criarDriverNode(':memory:');
        const a = criarArmazenamentoSqlite(driver, {
            entidades: [{ nome: 'estoque_saldo', modulo: 'catalogo' }],
            migracoesModulos: sql ? { catalogo: [{ versao: 1, sql }] } : {},
        });
        return { driver, a };
    };
    const INDICE = "CREATE INDEX catalogo__estoque_produto ON ent_estoque_saldo (json_extract(dados, '$.produto_id'));";
    it('com o índice de expressão do dono, o plano é SEARCH pelo índice (sem varrer a tabela)', async () => {
        const { driver, a } = abrir(INDICE);
        await a.pronto;
        await a.linhas.aplicar('estoque_saldo', [saldo('s1', 'p1', 1)], 'k');
        const plano = await driver.todas("EXPLAIN QUERY PLAN SELECT id, dados FROM ent_estoque_saldo WHERE json_extract(dados, '$.produto_id') IN (SELECT value FROM json_each(?)) ORDER BY id", ['["p1"]']);
        expect(plano.map((p) => p.detail)).toContainEqual(expect.stringMatching(/SEARCH ent_estoque_saldo USING INDEX catalogo__estoque_produto/));
    });
    it('muitos valores numa consulta só (acima do limite de parâmetros do SQLite), com e sem índice', async () => {
        for (const sql of [INDICE, undefined]) {
            const { driver, a } = abrir(sql);
            await a.pronto;
            const linhas = Array.from({ length: 3000 }, (_, i) => saldo(`s${String(i).padStart(5, '0')}`, `p${i % 1500}`, i));
            await a.linhas.aplicar('estoque_saldo', linhas, 'k');
            let consultas = 0;
            const todas = driver.todas.bind(driver);
            driver.todas = (async (q, p) => {
                if (q.includes('json_each'))
                    consultas++;
                return todas(q, p);
            });
            const pedidos = Array.from({ length: 1200 }, (_, i) => `p${i}`);
            const r = await a.linhas.porCampo('estoque_saldo', 'produto_id', pedidos);
            expect(r).toHaveLength(2400);
            expect(new Set(r.map((l) => l.produto_id)).size).toBe(1200);
            expect(consultas).toBe(1);
        }
    });
    it('direto no adaptador também valida o campo e ignora valores inúteis', async () => {
        const { a } = abrir();
        await a.linhas.aplicar('estoque_saldo', [saldo('s1', 'p1', 1)], 'k');
        await expect(a.linhas.porCampo('estoque_saldo', "x') --", ['p1'])).rejects.toThrow(/Campo inválido/);
        expect(await a.linhas.porCampo('estoque_saldo', 'produto_id', [Number.NaN])).toEqual([]);
        expect(await a.linhas.porCampo('nunca_gravada', 'produto_id', ['p1'])).toEqual([]);
    });
});
