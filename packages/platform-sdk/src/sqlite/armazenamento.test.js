/**
 * Suíte do adaptador (desenho T-0008 §3.4; P3): semântica da base nos três adaptadores e, no SQLite, linhas por
 * página, lotes, cursor atômico, migrações por módulo, validação de dono e RN-CORE-02 (doc 03: "os dados locais dele
 * são apagados do aparelho").
 */
import { describe, expect, it } from 'vitest';
import { FABRICAS_ARMAZENAMENTO } from '../motor-sync.fabricas';
import { criarArmazenamentoSqlite, TAMANHO_LOTE_GRAVACAO } from './armazenamento';
import { criarDriverNode } from './driver-node';
import { listarObjetos, verificarDonoDasMigracoes } from './esquema';
const l = (id, updated_at = '2026-10-31T10:00:00.000Z', extra = {}) => ({
    id,
    updated_at,
    deleted_at: null,
    ...extra,
});
describe.each(FABRICAS_ARMAZENAMENTO)('contrato do armazenamento [%s]', (_nome, fabrica) => {
    it('null/undefined remove; ler devolve cópia; chaves ordenadas e só do prefixo', async () => {
        const a = fabrica();
        await a.gravar('mod:core:b', { x: 1 });
        await a.gravar('mod:core:a', [1, 2]);
        await a.gravar('mod:corex:z', 1);
        await a.gravar('sync:fila', []);
        const lido = await a.ler('mod:core:b');
        lido.x = 99;
        expect(await a.ler('mod:core:b')).toEqual({ x: 1 });
        expect(await a.chaves('mod:core:')).toEqual(['mod:core:a', 'mod:core:b']);
        await a.gravar('mod:core:a', null);
        await a.gravar('mod:core:b', undefined);
        await a.remover('mod:corex:z');
        expect(await a.chaves('mod:')).toEqual([]);
        expect(await a.ler('mod:core:a')).toBeNull();
        // prefixo com curinga do LIKE não casa por acidente
        await a.gravar('mod:core:x%y', 1);
        await a.gravar('mod:core:xzy', 1);
        expect(await a.chaves('mod:core:x%')).toEqual(['mod:core:x%y']);
    });
    it('linhas.aplicar é idempotente, apaga as com deleted_at e cursor null mantém o atual', async () => {
        const a = fabrica();
        if (!a.linhas)
            return; // caminho chave→JSON sem extensão: coberto pela suíte do motor
        await a.linhas.aplicar('cliente', [l('c1'), l('c2')], 'k1');
        await a.linhas.aplicar('cliente', [l('c1'), l('c2')], 'k1');
        expect(await a.linhas.contar('cliente')).toBe(2);
        await a.linhas.aplicar('cliente', [{ ...l('c1'), deleted_at: '2026-10-31T11:00:00.000Z' }], null);
        expect((await a.linhas.ids('cliente')).sort()).toEqual(['c2']);
        expect(await a.ler('sync:cursor:cliente')).toBe('k1');
        expect(await a.linhas.porIds('cliente', ['x', 'c2'])).toEqual([l('c2')]);
        await a.linhas.limpar('cliente');
        expect(await a.linhas.contar('cliente')).toBe(0);
        expect(await a.ler('sync:cursor:cliente')).toBeNull();
    });
});
describe('adaptador SQLite (node:sqlite)', () => {
    const abrir = (o = {}, driver = criarDriverNode(':memory:')) => ({
        driver,
        a: criarArmazenamentoSqlite(driver, o),
    });
    it('esquema da plataforma: kv, _esquema e _entidades; ent_<e> criada na primeira gravação e registrada com o dono', async () => {
        const { driver, a } = abrir({ entidades: [{ nome: 'cliente', modulo: 'core' }] });
        await a.pronto;
        expect((await listarObjetos(driver)).map((o) => o.name)).toEqual(expect.arrayContaining(['kv', '_esquema', '_entidades']));
        await a.linhas.aplicar('cliente', [l('c1')], 'k');
        expect(await driver.todas('SELECT nome, modulo FROM _entidades')).toEqual([{ nome: 'cliente', modulo: 'core' }]);
        expect(await driver.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['plataforma'])).toEqual({ versao: 1 });
        await expect(a.linhas.aplicar('Cliente; DROP TABLE kv', [], null)).rejects.toThrow(/inválida/);
    });
    it(`página grande vai em lotes de ${TAMANHO_LOTE_GRAVACAO}; o cursor só entra no último lote`, async () => {
        const { driver, a } = abrir();
        await a.pronto;
        const transacoes = [];
        const original = driver.transacaoExclusiva.bind(driver);
        driver.transacaoExclusiva = async (fn) => {
            transacoes.push('tx');
            return original(fn);
        };
        const pagina = Array.from({ length: 1200 }, (_, i) => l(`p${String(i).padStart(5, '0')}`));
        await a.linhas.aplicar('produto', pagina, 'cursor-final');
        expect(transacoes).toHaveLength(3);
        expect(await a.linhas.contar('produto')).toBe(1200);
        expect(await a.ler('sync:cursor:produto')).toBe('cursor-final');
    });
    it('falha no meio do lote = nada do lote nem o cursor (tudo ou nada); a página reaplicada converge', async () => {
        const { a } = abrir();
        await a.linhas.aplicar('produto', [l('p1')], 'k1');
        const ruim = { ...l('p3'), updated_at: undefined };
        const quebra = { ...l('p4'), dados: 1n }; // BigInt não serializa: o lote cai
        await expect(a.linhas.aplicar('produto', [l('p2'), ruim, quebra], 'k2')).rejects.toThrow();
        expect((await a.linhas.ids('produto')).sort()).toEqual(['p1']);
        expect(await a.ler('sync:cursor:produto')).toBe('k1');
        await a.linhas.aplicar('produto', [l('p2'), l('p3')], 'k2');
        expect((await a.linhas.ids('produto')).sort()).toEqual(['p1', 'p2', 'p3']);
    });
    it('emTransacao é tudo ou nada; escritas de fora esperam a vez (sem database is locked)', async () => {
        const { a } = abrir();
        await a.gravar('mod:core:x', 1);
        await expect(a.emTransacao(async (tx) => {
            await tx.gravar('mod:core:x', 2);
            await tx.linhas.aplicar('cliente', [l('c1')], 'k');
            throw new Error('caiu');
        })).rejects.toThrow('caiu');
        expect(await a.ler('mod:core:x')).toBe(1);
        expect(await a.linhas.contar('cliente')).toBe(0);
        const ordem = [];
        await Promise.all([
            a.emTransacao(async (tx) => {
                await tx.gravar('mod:core:y', 1);
                ordem.push(1);
            }),
            a.gravar('mod:core:y', 2).then(() => ordem.push(2)),
        ]);
        expect(ordem).toEqual([1, 2]);
        expect(await a.ler('mod:core:y')).toBe(2);
    });
    it('compatibilidade ent:<e>: ler monta o mapa, gravar substitui, remover apaga; chaves lista só entidades com linhas', async () => {
        const { a } = abrir();
        await a.gravar('ent:pedido', { p1: l('p1'), p2: l('p2') });
        expect(Object.keys((await a.ler('ent:pedido'))).sort()).toEqual(['p1', 'p2']);
        await a.gravar('ent:pedido', { p2: l('p2') });
        expect(Object.keys((await a.ler('ent:pedido')))).toEqual(['p2']);
        await a.gravar('ent:visita', { v1: l('v1') });
        expect(await a.chaves('ent:')).toEqual(['ent:pedido', 'ent:visita']);
        await a.remover('ent:pedido');
        expect(await a.ler('ent:pedido')).toBeNull();
        expect(await a.chaves('')).toEqual(['ent:visita']);
    });
    const MIG_CATALOGO = [
        { versao: 1, sql: 'CREATE TABLE catalogo__nota (id TEXT PRIMARY KEY, texto TEXT);' },
        { versao: 2, sql: 'CREATE INDEX catalogo__nota_texto ON catalogo__nota (texto);' },
    ];
    it('migrações por módulo: aplicadas na abertura, uma vez; reabrir não reaplica', async () => {
        const driver = criarDriverNode(':memory:');
        const { a } = abrir({ migracoesModulos: { catalogo: MIG_CATALOGO } }, driver);
        await a.pronto;
        expect(await driver.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 2 });
        const b = criarArmazenamentoSqlite(driver, { migracoesModulos: { catalogo: MIG_CATALOGO } });
        await b.pronto;
        expect(b.modulosIndisponiveis()).toEqual([]);
    });
    it('migração que falha: rollback daquela versão e módulo indisponível; plataforma e fila seguem', async () => {
        const erros = [];
        const { driver, a } = abrir({
            migracoesModulos: { promotor: [{ versao: 1, sql: 'CREATE TABLE promotor__ok (id TEXT); CREATE TABLE ERRO DE SINTAXE' }] },
            registrarErro: (m) => erros.push(m),
        });
        await a.gravar('sync:fila', [{ id: 'i1' }]);
        expect(a.modulosIndisponiveis()).toEqual(['promotor']);
        expect(erros[0]).toMatch(/promotor indisponível/);
        expect((await listarObjetos(driver)).some((o) => o.name === 'promotor__ok')).toBe(false);
        expect(await a.ler('sync:fila')).toEqual([{ id: 'i1' }]);
    });
    it('downgrade (versão do aparelho maior que a do app): objetos do módulo recriados do zero', async () => {
        const driver = criarDriverNode(':memory:');
        const a = criarArmazenamentoSqlite(driver, { migracoesModulos: { catalogo: MIG_CATALOGO } });
        await a.pronto;
        await driver.rodar("INSERT INTO catalogo__nota VALUES ('n1', 'velha')");
        const b = criarArmazenamentoSqlite(driver, { migracoesModulos: { catalogo: MIG_CATALOGO.slice(0, 1) } });
        await b.pronto;
        expect(await driver.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 1 });
        expect(await driver.todas('SELECT * FROM catalogo__nota')).toEqual([]);
        expect((await listarObjetos(driver)).some((o) => o.name === 'catalogo__nota_texto')).toBe(false);
    });
    it('validação de dono das migrações: só <m>__* e índice <m>__* sobre ent_<e> do próprio módulo', async () => {
        expect(await verificarDonoDasMigracoes(criarDriverNode(), 'catalogo', MIG_CATALOGO, [])).toEqual([]);
        expect(await verificarDonoDasMigracoes(criarDriverNode(), 'vendedor', [{ versao: 1, sql: "CREATE INDEX vendedor__tpi ON ent_tabela_preco_item (json_extract(dados, '$.produto_id'));" }], ['tabela_preco_item'])).toEqual([]);
        const problemas = await verificarDonoDasMigracoes(criarDriverNode(), 'promotor', [
            {
                versao: 1,
                sql: `CREATE TABLE produto_extra (id TEXT);
                CREATE INDEX promotor__cli ON ent_cliente (updated_at);`,
            },
        ], [], ['cliente']);
        expect(problemas).toEqual(['table produto_extra fora do prefixo promotor__', 'índice promotor__cli sobre ent_cliente, que não é do módulo promotor']);
    });
    it('RN-CORE-02: removerModulo apaga linhas das entidades do módulo (inclusive fora do registro), mod:<m>:, objetos <m>__* e _esquema', async () => {
        const { driver, a } = abrir({
            migracoesModulos: { catalogo: MIG_CATALOGO },
            entidades: [
                { nome: 'sinonimo', modulo: 'catalogo' },
                { nome: 'cliente', modulo: 'core' },
            ],
        });
        await a.linhas.aplicar('sinonimo', [l('s1')], 'k');
        await a.linhas.aplicar('cliente', [l('c1')], 'k');
        await a.gravar('mod:catalogo:destaques', [1]);
        await a.gravar('mod:core:me', { nome: 'x' });
        await a.removerModulo('catalogo');
        expect(await a.linhas.contar('sinonimo')).toBe(0);
        expect(await a.ler('sync:cursor:sinonimo')).toBeNull();
        expect(await a.linhas.contar('cliente')).toBe(1);
        expect(await a.chaves('mod:catalogo:')).toEqual([]);
        expect(await a.ler('mod:core:me')).toEqual({ nome: 'x' });
        expect((await listarObjetos(driver)).filter((o) => o.name.startsWith('catalogo__'))).toEqual([]);
        expect(await driver.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toBeNull();
    });
    it('a fila fica na kv da plataforma: apagar o módulo nunca perde item não enviado', async () => {
        const { a } = abrir({ migracoesModulos: { catalogo: MIG_CATALOGO } });
        await a.gravar('sync:fila', [{ id: 'i1', modulo: 'catalogo' }]);
        await a.removerModulo('catalogo');
        expect(await a.ler('sync:fila')).toEqual([{ id: 'i1', modulo: 'catalogo' }]);
    });
});
