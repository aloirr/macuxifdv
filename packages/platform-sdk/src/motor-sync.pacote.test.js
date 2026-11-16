/// <reference types="node" />
/**
 * ADR 0054 (desenho `docs/desenho/T-catalogo-pacote.md` §2.1, §2.2 e §4): pacote da primeira carga e entrada enquanto
 * carrega, sobre o adaptador SQLite real (`node:sqlite`) e arquivos de verdade num diretório temporário.
 * - Equivalência: pacote importado + incremental = pull paginado completo (`ent_*`, cursores, versões e busca).
 * - Falhas (md5, tamanho, contagem, sem espaço, sem rota, geração, arquivo corrompido) caem no pull paginado com aviso.
 * - Retomada do download pelo `.part`, troca de pacote entre passadas e rede que falha sempre.
 * - `liberado_em` (persistido) e `pendentes`/`cargaPendente` (solução 5).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync, truncateSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { definirIndiceBusca } from './busca';
import { defineModule } from './manifesto';
import { AVISO_PACOTE_FALHOU, criarMotorSync, descompactarGzip, MAX_TENTATIVAS_PACOTE, } from './motor-sync';
import { ErroPacoteSync, particaoDeFilial } from './pacotes-sync';
import { criarArmazenamentoSqlite } from './sqlite/armazenamento';
import { criarDriverNode } from './sqlite/driver-node';
import { conteudoDoPacoteSimulado, criarServidorSyncSimulado, ErroRedeSimulada } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';
// Cada cenário roda nos 3 armazenamentos com SQLite e gzip; o runner do CI é bem mais lento que a máquina local.
vi.setConfig({ testTimeout: 30_000 });
// ---------- módulos, entidades e índice de teste ----------
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'produto'] }),
    defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['tabela_preco_item'] }),
];
function registro() {
    const r = criarRegistroSync(manifestos);
    for (const [nome, modulo] of [
        ['cliente', 'core'],
        ['produto', 'core'],
        ['tabela_preco_item', 'catalogo'],
    ])
        r.registrar(definirEntidadeSync({ nome, modulo, direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }));
    return r;
}
const ENTIDADES = [
    { nome: 'cliente', modulo: 'core' },
    { nome: 'produto', modulo: 'core' },
    { nome: 'tabela_preco_item', modulo: 'catalogo' },
];
const MIGRACOES = [
    {
        versao: 1,
        sql: `
      CREATE TABLE catalogo__teste_doc (rid INTEGER PRIMARY KEY, produto_id TEXT NOT NULL UNIQUE, sku TEXT, nome TEXT);
      CREATE VIRTUAL TABLE catalogo__teste USING fts5(sku, nome, content = 'catalogo__teste_doc', content_rowid = 'rid',
        tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    `,
    },
];
const INDICE = definirIndiceBusca({
    id: 'catalogo.teste',
    modulo: 'catalogo',
    tabelaDoc: 'catalogo__teste_doc',
    tabelaFts: 'catalogo__teste',
    colunaChave: 'produto_id',
    colunas: { sku: 10, nome: 5 },
    fontes: ['produto'],
    chaveDe: (_e, l) => l.id,
    async documento(id, ler) {
        const [p] = await ler.porIds('produto', [id]);
        return p ? { sku: p.sku, nome: p.nome } : null;
    },
});
// ---------- dados do servidor ----------
const TENANT = '11111111-1111-4111-8111-111111111111';
const FILIAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILIAL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = Date.parse('2026-11-15T08:00:00Z'); // hora-fixa-ok: relógio injetado do motor e datas das linhas simuladas
const quando = (seg) => new Date(BASE + seg * 1000).toISOString();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Horizontes dos pacotes (filial B gerada depois da A). */
const H_CORE = quando(800);
const H_A = quando(600);
const H_B = quando(1_000);
function dadosIniciais() {
    const cliente = Array.from({ length: 30 }, (_, i) => ({ id: uuid(10_000 + i), updated_at: quando(i), deleted_at: null, nome: `Cliente ${i}` }));
    const produto = Array.from({ length: 600 }, (_, i) => ({
        id: uuid(20_000 + i),
        updated_at: quando(i * 2),
        deleted_at: null,
        sku: `SKU-${i}`,
        nome: i % 2 === 0 ? `Rolamento ${i}` : `Pastilha de freio ${i}`,
    }));
    const tabela_preco_item = Array.from({ length: 1_200 }, (_, i) => ({
        id: uuid(30_000 + i),
        updated_at: quando(i + 100),
        deleted_at: null,
        filial_id: i % 2 === 0 ? FILIAL_A : FILIAL_B,
        produto_id: uuid(20_000 + (i % 600)),
        preco_centavos: 1_000 + i,
    }));
    return { cliente, produto, tabela_preco_item };
}
/** Mudanças depois dos pacotes: preço alterado, item apagado, item novo e produto renomeado (chegam pelo incremental). */
function mudarDepoisDosPacotes(s) {
    const t = s.linhas.tabela_preco_item;
    const p = s.linhas.produto;
    const depois = quando(5_000);
    t[10] = { ...t[10], updated_at: depois, preco_centavos: 99_999 }; // filial A, antes de H_A
    t[11] = { ...t[11], updated_at: quando(5_001), deleted_at: quando(5_001) }; // filial B, apagado
    t.push({ id: uuid(39_999), updated_at: quando(5_002), deleted_at: null, filial_id: FILIAL_B, produto_id: uuid(20_000), preco_centavos: 7 });
    p[3] = { ...p[3], updated_at: quando(5_003), nome: 'Pastilha cerâmica renomeada' };
}
function gerarPacote(dir, s, modulo, particao, entidades, horizonte, filtro = () => true, meta = {}) {
    const conteudo = conteudoDoPacoteSimulado(s, entidades, horizonte);
    for (const e of entidades)
        conteudo.linhas[e] = conteudo.linhas[e].filter((l) => filtro(e, l));
    for (const e of conteudo.entidades)
        e.linhas = conteudo.linhas[e.nome].length;
    const id = crypto.randomUUID();
    const arquivo = join(dir, `gerador-${id}.sqlite`);
    const db = new DatabaseSync(arquivo);
    db.exec('CREATE TABLE _pacote (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    const valores = {
        formato: '1',
        tenant_id: TENANT,
        modulo,
        particao,
        horizonte,
        geracao_base: s.geracao_base ?? 'g1',
        entidades: JSON.stringify(Object.fromEntries(conteudo.entidades.map((e) => [e.nome, e.linhas]))),
        ...meta,
    };
    for (const [k, v] of Object.entries(valores))
        db.prepare('INSERT INTO _pacote VALUES (?, ?)').run(k, v);
    for (const e of entidades) {
        db.exec(`CREATE TABLE ent_${e} (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, dados TEXT NOT NULL) WITHOUT ROWID`);
        const ins = db.prepare(`INSERT INTO ent_${e} VALUES (?, ?, ?)`);
        for (const l of conteudo.linhas[e])
            ins.run(l.id, l.updated_at, JSON.stringify(l));
    }
    db.close();
    const bytes = new Uint8Array(gzipSync(readFileSync(arquivo), { level: 6 }));
    rmSync(arquivo);
    return {
        bytes,
        pacote: {
            id,
            modulo,
            particao,
            horizonte,
            bytes: bytes.length,
            md5: createHash('md5').update(bytes).digest('hex'),
            url: `https://s3.exemplo/sync-pacotes/${id}.sqlite.gz?assinatura=segredo`,
            expira_em: quando(90_000),
            entidades: conteudo.entidades,
        },
    };
}
// ---------- arquivos locais (documentos do app = diretório temporário) ----------
function arquivosLocais(dir, urls) {
    const abs = (c) => join(dir, c);
    const controle = {
        /** Corta o download depois de N bytes (no total do arquivo) e lança erro de rede. */
        cortarEm: null,
        /** Esta url sempre corta (rede que nunca completa o download dela). */
        cortarSempre: null,
        md5Nulo: false,
        espaco: null,
        downloads: [],
    };
    const arquivos = {
        async ler(c) {
            return existsSync(abs(c)) ? new Uint8Array(readFileSync(abs(c))) : null;
        },
        async remover(c) {
            rmSync(abs(c), { force: true });
        },
        async baixarPacote(url, destino, { deBytes, aoProgredir }) {
            controle.downloads.push({ url, deBytes });
            const fonte = urls.get(url);
            if (!fonte)
                throw new Error('404 do armazenamento');
            mkdirSync(dirname(abs(destino)), { recursive: true });
            if (!existsSync(abs(destino)))
                writeFileSync(abs(destino), new Uint8Array(0));
            truncateSync(abs(destino), deBytes);
            const corte = controle.cortarSempre === url ? deBytes + 100 : controle.cortarEm;
            const ate = corte !== null && corte < fonte.length ? corte : fonte.length;
            for (let i = deBytes; i < ate; i += 4096) {
                appendFileSync(abs(destino), fonte.subarray(i, Math.min(ate, i + 4096)));
                aoProgredir?.(Math.min(ate, i + 4096));
            }
            if (ate < fonte.length) {
                controle.cortarEm = null;
                throw new ErroRedeSimulada();
            }
            const lido = readFileSync(abs(destino));
            return { bytes: lido.length, md5: controle.md5Nulo ? null : createHash('md5').update(lido).digest('hex') };
        },
        async lerBloco(c, inicio, tamanho) {
            const b = readFileSync(abs(c));
            return new Uint8Array(b.subarray(inicio, inicio + tamanho));
        },
        async gravarBloco(c, bytes, { acrescentar }) {
            mkdirSync(dirname(abs(c)), { recursive: true });
            if (acrescentar)
                appendFileSync(abs(c), bytes);
            else
                writeFileSync(abs(c), bytes);
        },
        async espacoLivre() {
            return controle.espaco;
        },
    };
    return { arquivos, controle };
}
// ---------- montagem ----------
let dir;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'macuxi-pacote-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});
function abrirArmazenamento(driver) {
    return criarArmazenamentoSqlite(driver, { migracoesModulos: { catalogo: MIGRACOES }, indicesBusca: [INDICE], entidades: ENTIDADES });
}
/** Ordem do Campo depois da RN-CORE-48 revista: clientes, depois o catálogo por último. */
const ORDEM = { cliente: 1, etapa_metas: 2, produto: 3, tabela_preco_item: 3 };
const ordemDaCarga = (i) => ORDEM[i.chave] ?? 9;
function servidor(comPacotes = true) {
    const s = criarServidorSyncSimulado(registro(), {
        modulosAtivos: ['core', 'catalogo'],
        linhas: dadosIniciais(),
        comPacotes,
    });
    s.versoesEscopo = { cliente: 'carteira-v1', tabela_preco_item: 'filiais-v1' };
    s.tamanhoPagina = 200;
    s.geracao_base = 'g1';
    return s;
}
/** Os três pacotes de produção: core/tenant, catálogo filial A e filial B; mudanças no servidor depois deles. */
function publicarPacotes(s, ajuste = () => { }) {
    const ehDa = (f) => (_e, l) => l.filial_id === f;
    const arquivos = [
        gerarPacote(dir, s, 'core', 'tenant', ['produto'], H_CORE),
        gerarPacote(dir, s, 'catalogo', particaoDeFilial(FILIAL_A), ['tabela_preco_item'], H_A, ehDa(FILIAL_A)),
        gerarPacote(dir, s, 'catalogo', particaoDeFilial(FILIAL_B), ['tabela_preco_item'], H_B, ehDa(FILIAL_B)),
    ];
    ajuste(arquivos);
    s.manifestoPacotes = { geracao_base: 'g1', pacotes: arquivos.map((a) => a.pacote) };
    const urls = new Map(arquivos.map((a) => [a.pacote.url, a.bytes]));
    mudarDepoisDosPacotes(s);
    return { arquivos, urls };
}
const ETAPA_METAS = { id: 'etapa_metas', rotulo: 'Metas', modulo: 'core', async executar() { } };
async function abrirMotor(s, opcoes = {}) {
    const driver = opcoes.driver ?? criarDriverNode(':memory:', { diretorioArquivos: dir });
    const armazenamento = abrirArmazenamento(driver);
    let relogio = BASE + 10_000_000;
    const motor = criarMotorSync({
        registro: registro(),
        armazenamento,
        transporte: s,
        agora: () => new Date((relogio += 1000)),
        ...(opcoes.arquivos ? { arquivos: opcoes.arquivos } : {}),
        etapas: [ETAPA_METAS],
        ordemDaCarga,
        ...(opcoes.essenciais ? { essenciais: opcoes.essenciais } : {}),
    });
    await motor.carregar();
    if (motor.estado().modulosAtivos.length === 0)
        await motor.aplicarModulosAtivos(['core', 'catalogo']);
    return { motor, armazenamento, driver };
}
/** Foto do aparelho: linhas por entidade (id, updated_at, deleted_at, dados), cursores e versões de escopo. */
async function foto(driver) {
    const r = {};
    for (const { nome } of ENTIDADES) {
        r[`ent_${nome}`] = await driver.todas(`SELECT id, updated_at, deleted_at, dados FROM ent_${nome} ORDER BY id`);
        r[`cursor_${nome}`] = await driver.primeira(`SELECT valor FROM kv WHERE chave = ?`, [`sync:cursor:${nome}`]);
        r[`escopo_${nome}`] = await driver.primeira(`SELECT valor FROM kv WHERE chave = ?`, [`sync:escopo:${nome}`]);
    }
    return r;
}
/** Referência: o mesmo servidor (já com as mudanças), só pull paginado. */
async function referencia(s) {
    const { motor, driver } = await abrirMotor(s);
    expect(await motor.sincronizar()).toBe(true);
    return { foto: await foto(driver), motor };
}
const q = (termos) => ({ grupos: termos.map((t) => [t]), prefixoNoUltimo: false, limite: 500 });
const chaves = (rs) => (rs ?? []).map((r) => r.chave).sort();
const temporarios = () => (existsSync(join(dir, 'pacotes')) ? readdirSync(join(dir, 'pacotes')) : []);
// ---------- testes ----------
describe('ADR 0054: equivalência pacote + incremental = pull paginado', () => {
    it('ent_*, cursores, versões de escopo e busca idênticos; poucas páginas depois do pacote', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const { motor, driver } = await abrirMotor(s, { arquivos });
        const etapas = [];
        const bytes = [];
        motor.assinar((e) => {
            if (etapas.at(-1) !== e.carga.entidade && e.carga.entidade)
                etapas.push(e.carga.entidade);
            if (e.carga.bytes)
                bytes.push(e.carga.bytes.feitos);
        });
        const pullsAntes = s.chamadas.pull;
        expect(await motor.sincronizar()).toBe(true);
        const pullsComPacote = s.chamadas.pull - pullsAntes;
        const ref = await referencia(s);
        const pullsReferencia = s.chamadas.pull - pullsAntes - pullsComPacote;
        expect(await foto(driver)).toEqual(ref.foto);
        // o que mudou depois do pacote chegou pelo incremental
        const precos = await motor.linhas('tabela_preco_item');
        expect(precos.find((l) => l.id === uuid(30_010))?.preco_centavos).toBe(99_999);
        expect(precos.some((l) => l.id === uuid(30_011))).toBe(false);
        expect(precos.some((l) => l.id === uuid(39_999))).toBe(true);
        // busca: o FTS foi refeito uma vez a partir das linhas importadas
        for (const termos of [['rolamento', '100'], ['ceramica'], ['sku', '599'], ['pastilha', '3']])
            // mesmo conjunto (a ordem dos empates segue o `rowid`, que depende da ordem de gravação)
            expect(chaves(await motor.buscar(INDICE.id, q(termos)))).toEqual(chaves(await ref.motor.buscar(INDICE.id, q(termos))));
        expect(chaves(await motor.buscar(INDICE.id, q(['ceramica'])))).toEqual([uuid(20_003)]);
        // cada pacote roda antes das entidades que cobre; o download fez o percentual andar
        expect(etapas).toEqual(['cliente', 'etapa_metas', 'produto', 'tabela_preco_item']);
        expect(Math.max(...bytes)).toBeGreaterThan(0);
        expect(controle.downloads.map((d) => d.deBytes)).toEqual([0, 0, 0]);
        expect(pullsComPacote).toBeLessThan(pullsReferencia);
        expect(motor.estado().avisos).toEqual([]);
        expect(motor.estado().carga.bytes).toBeUndefined();
        expect(temporarios()).toEqual([]);
        expect(s.chamadas.pacotes).toBe(1);
    });
    it('sem as peças opcionais (sem arquivos de pacote), a carga é a de hoje: nem pede o manifesto', async () => {
        const s = servidor();
        publicarPacotes(s);
        const { motor, driver } = await abrirMotor(s, { arquivos: { ler: async () => null } });
        expect(await motor.sincronizar()).toBe(true);
        expect(s.chamadas.pacotes).toBe(0);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it('driver SQLite sem anexar/desanexar: sem importarPacote, o manifesto nem é pedido', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        delete driver.anexar;
        delete driver.desanexar;
        const { motor } = await abrirMotor(s, { arquivos: arquivosLocais(dir, urls).arquivos, driver });
        expect(await motor.sincronizar()).toBe(true);
        expect(s.chamadas.pacotes).toBe(0);
    });
    it('fora da carga inicial o manifesto não é pedido', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        const { arquivos } = arquivosLocais(dir, urls);
        const { motor } = await abrirMotor(s, { arquivos });
        expect(await motor.sincronizar()).toBe(true);
        expect(await motor.sincronizar()).toBe(true);
        expect(s.chamadas.pacotes).toBe(1);
    });
});
describe('ADR 0054: falhas caem no pull paginado e ficam no Diagnóstico', () => {
    const casos = [
        ['md5 diferente (filial B, depois da A importada)', 'md5', (_s, _c, a) => (a[2].pacote.md5 = 'f'.repeat(32))],
        ['tamanho diferente', 'tamanho', (_s, _c, a) => (a[1].pacote.bytes += 1)],
        ['contagem do manifesto diferente do arquivo', 'contagem', (_s, _c, a) => (a[0].pacote.entidades[0].linhas -= 1)],
        ['sem espaço livre', 'sem_espaco', (_s, c) => (c.espaco = 1_000)],
    ];
    it.each(casos)('%s', async (_t, codigo, ajustar) => {
        const s = servidor();
        let gerados = [];
        const { urls } = publicarPacotes(s, (a) => (gerados = a));
        const { arquivos, controle } = arquivosLocais(dir, urls);
        ajustar(s, controle, gerados);
        s.manifestoPacotes = { geracao_base: 'g1', pacotes: gerados.map((g) => g.pacote) };
        const { motor, driver } = await abrirMotor(s, { arquivos });
        expect(await motor.sincronizar()).toBe(true);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
        const avisos = motor.estado().avisos.filter((a) => a.codigo === AVISO_PACOTE_FALHOU);
        expect(avisos.length).toBeGreaterThan(0);
        expect(avisos.some((a) => a.mensagem.includes(`(${codigo})`))).toBe(true);
        // sem url (segredo) nem partição no aviso
        expect(JSON.stringify(avisos)).not.toMatch(/assinatura|filial|aaaaaaaa|bbbbbbbb/);
        expect(temporarios()).toEqual([]);
    });
    it('arquivo de outra geração (troca entre o manifesto e a importação): recusado, os dados vêm do pull', async () => {
        const s = servidor();
        s.geracao_base = 'g0';
        const { arquivos: gerados, urls } = publicarPacotes(s);
        s.geracao_base = 'g1';
        s.manifestoPacotes = { geracao_base: 'g1', pacotes: gerados.map((g) => g.pacote) };
        const { arquivos } = arquivosLocais(dir, urls);
        const { motor, driver } = await abrirMotor(s, { arquivos });
        expect(await motor.sincronizar()).toBe(true);
        // core e filial A recusados; a filial B nem é tentada (a tabela de preço já caiu no pull)
        expect(motor.estado().avisos.filter((a) => a.mensagem.includes('(geracao)'))).toHaveLength(2);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it('servidor sem a rota (erro no manifesto): pull paginado, um aviso', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        s.falhaPacotes = Object.assign(new Error('Não encontrado'), { status: 404 });
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const { motor, driver } = await abrirMotor(s, { arquivos });
        expect(await motor.sincronizar()).toBe(true);
        expect(controle.downloads).toEqual([]);
        expect(motor.estado().avisos).toEqual([expect.objectContaining({ codigo: AVISO_PACOTE_FALHOU, entidade: 'pacote:plataforma' })]);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it('manifesto vazio (desligado ou sem pacote pronto): pull paginado, sem aviso', async () => {
        const s = servidor();
        const { motor, driver } = await abrirMotor(s, { arquivos: arquivosLocais(dir, new Map()).arquivos });
        expect(await motor.sincronizar()).toBe(true);
        expect(motor.estado().avisos).toEqual([]);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it('arquivo que não é gzip: formato; md5 nulo (shell sem md5) com gzip corrompido também cai no pull', async () => {
        const s = servidor();
        const { urls, arquivos: gerados } = publicarPacotes(s);
        const lixo = new Uint8Array(gerados[0].bytes.length).fill(7);
        urls.set(gerados[0].pacote.url, lixo);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        controle.md5Nulo = true;
        const { motor, driver } = await abrirMotor(s, { arquivos });
        expect(await motor.sincronizar()).toBe(true);
        expect(motor.estado().avisos.map((a) => a.mensagem).join()).toContain('(formato)');
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
});
describe('ADR 0054: retomada do download', () => {
    it('queda no meio: a passada para; a próxima retoma do byte em que parou e termina igual ao pull', async () => {
        const s = servidor();
        const { urls, arquivos: gerados } = publicarPacotes(s);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        controle.cortarEm = 2_048;
        const m1 = await abrirMotor(s, { arquivos, driver });
        expect(await m1.motor.sincronizar()).toBe(false);
        expect(m1.motor.estado().erro).toBe('Sem conexão com o servidor.');
        expect(temporarios()).toEqual([`${gerados[0].pacote.id}.sqlite.gz.part`]);
        // app reaberto: motor novo, mesmo banco e mesmos arquivos
        const m2 = await abrirMotor(s, { arquivos, driver });
        expect(await m2.motor.sincronizar()).toBe(true);
        expect(controle.downloads.map((d) => d.deBytes)).toEqual([0, 2_048, 0, 0]);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
        expect(m2.motor.estado().avisos).toEqual([]);
        expect(temporarios()).toEqual([]);
    });
    it('pacote substituído entre as passadas: o .part antigo sai e o novo baixa do zero', async () => {
        const s = servidor();
        const { urls, arquivos: gerados } = publicarPacotes(s);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        controle.cortarEm = 1_024;
        const m1 = await abrirMotor(s, { arquivos, driver });
        expect(await m1.motor.sincronizar()).toBe(false);
        const antigo = gerados[0].pacote;
        // regerado: mesmo conteúdo, id novo (o gerador substituiu a partição)
        const novo = { ...antigo, id: crypto.randomUUID(), url: `${antigo.url}&v=2` };
        urls.set(novo.url, gerados[0].bytes);
        s.manifestoPacotes = { ...s.manifestoPacotes, pacotes: [novo, ...s.manifestoPacotes.pacotes.slice(1)] };
        const m2 = await abrirMotor(s, { arquivos, driver });
        expect(await m2.motor.sincronizar()).toBe(true);
        expect(controle.downloads.slice(1).map((d) => [d.url === novo.url, d.deBytes])).toEqual([
            [true, 0],
            [false, 0],
            [false, 0],
        ]);
        expect(temporarios()).toEqual([]);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it(`rede que nunca completa: depois de ${MAX_TENTATIVAS_PACOTE} tentativas, o pull paginado (nunca fica parado)`, async () => {
        const s = servidor();
        const { urls, arquivos: gerados } = publicarPacotes(s);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        controle.cortarSempre = gerados[0].pacote.url;
        const resultados = [];
        let ultimo = null;
        for (let i = 0; i < MAX_TENTATIVAS_PACOTE; i++) {
            ultimo = await abrirMotor(s, { arquivos, driver });
            resultados.push(await ultimo.motor.sincronizar());
        }
        expect(resultados).toEqual([false, false, true]);
        expect(ultimo.motor.estado().avisos.map((a) => a.mensagem).join()).toContain('(indisponivel)');
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
    it('filial B falha depois da A importada e o app cai antes do pull: tabela de preço recomeça do zero sem sobra', async () => {
        const s = servidor();
        const { urls, arquivos: gerados } = publicarPacotes(s);
        const { arquivos } = arquivosLocais(dir, urls);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        // 1ª passada: A importa; B cai por rede (a passada para com o cursor de A gravado)
        urls.delete(gerados[2].pacote.url);
        const m1 = await abrirMotor(s, { arquivos, driver });
        expect(await m1.motor.sincronizar()).toBe(false);
        expect(await driver.primeira(`SELECT count(*) AS n FROM ent_tabela_preco_item`)).toEqual({ n: 250 }); // filial A abaixo de H_A
        // 2ª passada: o manifesto não traz mais a filial B; a entidade não pode continuar do cursor de A
        s.manifestoPacotes = { ...s.manifestoPacotes, pacotes: s.manifestoPacotes.pacotes.slice(0, 2) };
        const m2 = await abrirMotor(s, { arquivos, driver });
        expect(await m2.motor.sincronizar()).toBe(true);
        expect(await foto(driver)).toEqual((await referencia(s)).foto);
    });
});
describe('ADR 0054 (solução 5): entrada enquanto carrega', () => {
    const essenciais = (i) => i.chave === 'cliente';
    it('libera quando os essenciais terminam; pendentes e cargaPendente acompanham até o fim', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        const { arquivos } = arquivosLocais(dir, urls);
        const { motor, armazenamento } = await abrirMotor(s, { arquivos, essenciais });
        const vistos = [];
        motor.assinar((e) => vistos.push({ entidade: e.carga.entidade, liberado: !!e.liberado_em, catalogo: motor.cargaPendente('catalogo'), pendentes: e.pendentes ?? [] }));
        expect(await motor.sincronizar()).toBe(true);
        const liberouEm = vistos.findIndex((v) => v.liberado);
        expect(vistos[liberouEm].pendentes).toEqual(['etapa_metas', 'produto', 'tabela_preco_item']);
        expect(vistos[liberouEm].catalogo).toBe(true);
        // durante o download do catálogo, a entrada já estava liberada
        expect(vistos.find((v) => v.entidade === 'tabela_preco_item')?.liberado).toBe(true);
        expect(motor.estado().pendentes).toEqual([]);
        expect(motor.cargaPendente('catalogo')).toBe(false);
        expect(motor.estado().liberado_em).not.toBeNull();
        expect(await armazenamento.ler('sync:liberado_em')).toBe(motor.estado().liberado_em);
        // no começo da carga, tudo pendente
        expect(vistos.find((v) => v.pendentes.length > 0)?.pendentes).toEqual(['cliente', 'etapa_metas', 'produto', 'tabela_preco_item']);
    });
    it('app fechado no meio, depois de liberado: reabre já liberado, com o catálogo pendente (mesmo sem sinal)', async () => {
        const s = servidor();
        const { urls } = publicarPacotes(s);
        const { arquivos, controle } = arquivosLocais(dir, urls);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        controle.cortarEm = 2_048; // cai no 1º pacote (catálogo e preços), depois de clientes e metas
        const m1 = await abrirMotor(s, { arquivos, driver, essenciais });
        expect(await m1.motor.sincronizar()).toBe(false);
        const liberado = m1.motor.estado().liberado_em;
        expect(liberado).not.toBeNull();
        s.online = false;
        const m2 = await abrirMotor(s, { arquivos, driver, essenciais });
        expect(m2.motor.estado().liberado_em).toBe(liberado);
        expect(m2.motor.estado().pendentes).toEqual(['produto', 'tabela_preco_item']);
        expect(m2.motor.cargaPendente('catalogo')).toBe(true);
        expect(m2.motor.cargaPendente('core')).toBe(true);
        expect(m2.motor.estado().sincronizado_em).toBeNull();
        s.online = true;
        expect(await m2.motor.sincronizar()).toBe(true);
        expect(m2.motor.estado().liberado_em).toBe(liberado);
        expect(m2.motor.cargaPendente('catalogo')).toBe(false);
    });
    it('sem `essenciais`, nada de liberado_em (só sincronizado_em libera); essenciais que não casam liberam no fim', async () => {
        const s1 = servidor(false);
        const a = await abrirMotor(s1);
        expect(await a.motor.sincronizar()).toBe(true);
        expect(a.motor.estado().liberado_em).toBeNull();
        expect(a.motor.estado().pendentes).toEqual([]);
        const s2 = servidor(false);
        const b = await abrirMotor(s2, { essenciais: () => false });
        const pendentesAoLiberar = [];
        b.motor.assinar((e) => {
            if (e.liberado_em && pendentesAoLiberar.length === 0)
                pendentesAoLiberar.push(e.pendentes ?? []);
        });
        expect(await b.motor.sincronizar()).toBe(true);
        expect(pendentesAoLiberar).toEqual([[]]);
        expect(b.motor.estado().liberado_em).toBe(b.motor.estado().sincronizado_em);
    });
    it('limparAparelho zera liberado_em e pendentes', async () => {
        const s = servidor(false);
        const { motor } = await abrirMotor(s, { essenciais });
        expect(await motor.sincronizar()).toBe(true);
        await motor.limparAparelho();
        expect(motor.estado().liberado_em).toBeNull();
        expect(motor.estado().pendentes).toEqual([]);
    });
});
describe('ADR 0054: importarPacote no SQLite e descompactarGzip', () => {
    function arquivoNoDisco(a) {
        const gz = join(dir, 'p.sqlite.gz');
        writeFileSync(gz, a.bytes);
        const caminho = 'p.sqlite';
        writeFileSync(join(dir, caminho), new Uint8Array(gunzipSync(a.bytes)));
        return caminho;
    }
    it('tudo ou nada: contagem errada na 2ª entidade não deixa nada da 1ª; DETACH sempre', async () => {
        const s = servidor();
        const a = gerarPacote(dir, s, 'core', 'tenant', ['cliente', 'produto'], H_CORE);
        const caminho = arquivoNoDisco(a);
        const driver = criarDriverNode(':memory:', { diretorioArquivos: dir });
        const arm = abrirArmazenamento(driver);
        const errado = a.pacote.entidades.map((e, i) => (i === 1 ? { ...e, linhas: e.linhas + 1 } : e));
        await expect(arm.linhas.importarPacote(caminho, errado)).rejects.toEqual(new ErroPacoteSync('contagem'));
        expect(await arm.linhas.contar('cliente')).toBe(0);
        expect(await arm.ler('sync:cursor:cliente')).toBeNull();
        expect(await driver.todas(`SELECT name FROM pragma_database_list WHERE name = 'pacote'`)).toEqual([]);
        // e o certo importa, com cursor e versão
        await arm.linhas.importarPacote(caminho, a.pacote.entidades, { geracao_base: 'g1', modulo: 'core', particao: 'tenant' });
        expect(await arm.linhas.contar('cliente')).toBe(30);
        expect(await arm.ler('sync:cursor:cliente')).toBe(a.pacote.entidades[0].cursor);
        expect(await arm.ler('sync:escopo:cliente')).toBe('carteira-v1');
        expect(await driver.todas(`SELECT name FROM pragma_database_list WHERE name = 'pacote'`)).toEqual([]);
    });
    it('só substitui com updated_at maior (linha mais nova já no aparelho fica)', async () => {
        const s = servidor();
        const a = gerarPacote(dir, s, 'core', 'tenant', ['produto'], H_CORE);
        const caminho = arquivoNoDisco(a);
        const arm = abrirArmazenamento(criarDriverNode(':memory:', { diretorioArquivos: dir }));
        const nova = { id: uuid(20_000), updated_at: quando(9_000), deleted_at: null, sku: 'NOVO', nome: 'Mais nova' };
        await arm.linhas.aplicar('produto', [nova], null);
        await arm.linhas.importarPacote(caminho, a.pacote.entidades);
        expect(await arm.linhas.porIds('produto', [uuid(20_000)])).toEqual([nova]);
    });
    it('recusas: arquivo que não é SQLite (quick_check), formato, módulo/partição e geração diferentes', async () => {
        const s = servidor();
        const a = gerarPacote(dir, s, 'core', 'tenant', ['produto'], H_CORE);
        const caminho = arquivoNoDisco(a);
        const arm = abrirArmazenamento(criarDriverNode(':memory:', { diretorioArquivos: dir }));
        writeFileSync(join(dir, 'lixo.sqlite'), new Uint8Array(8192).fill(3));
        await expect(arm.linhas.importarPacote('lixo.sqlite', a.pacote.entidades)).rejects.toEqual(new ErroPacoteSync('quick_check'));
        await expect(arm.linhas.importarPacote(caminho, a.pacote.entidades, { modulo: 'catalogo' })).rejects.toEqual(new ErroPacoteSync('formato'));
        await expect(arm.linhas.importarPacote(caminho, a.pacote.entidades, { geracao_base: 'g9' })).rejects.toEqual(new ErroPacoteSync('geracao'));
        const f2 = gerarPacote(dir, s, 'core', 'tenant', ['produto'], H_CORE, undefined, { formato: '2' });
        await expect(arm.linhas.importarPacote(arquivoNoDisco(f2), f2.pacote.entidades)).rejects.toEqual(new ErroPacoteSync('formato'));
        expect(await arm.linhas.contar('produto')).toBe(0);
    });
    it('descompactarGzip em blocos pequenos = gunzip; não-gzip e truncado = formato', async () => {
        const { arquivos } = arquivosLocais(dir, new Map());
        const original = new Uint8Array(200_000).map((_, i) => (i * 7919) % 251);
        writeFileSync(join(dir, 'x.gz'), gzipSync(original));
        expect(await descompactarGzip(arquivos, 'x.gz', 'x.bin', 777)).toBe(original.length);
        expect(new Uint8Array(readFileSync(join(dir, 'x.bin')))).toEqual(original);
        writeFileSync(join(dir, 'y.gz'), new Uint8Array(500).fill(1));
        await expect(descompactarGzip(arquivos, 'y.gz', 'y.bin')).rejects.toEqual(new ErroPacoteSync('formato'));
        const gz = gzipSync(original);
        writeFileSync(join(dir, 'z.gz'), gz.subarray(0, gz.length - 100));
        await expect(descompactarGzip(arquivos, 'z.gz', 'z.bin')).rejects.toEqual(new ErroPacoteSync('formato'));
        expect(statSync(join(dir, 'x.bin')).size).toBe(original.length);
    });
});
