/**
 * Backup da demo para o Object Storage (T-0074, item 5; db/backup/). Três partes:
 * 1. estático: SigV4 (vetores públicos da AWS), nomes, retenção de 7 dias e configuração sem vazar segredo;
 * 2. S3 falso em processo, que RECALCULA a assinatura de cada pedido: enviar → listar → baixar → podar;
 * 3. com Postgres: base de demo → pg_dump -Fc → enviar → baixar → pg_restore num banco novo → contagem igual
 *    (db/backup/contagem.sql: linhas por tabela, políticas, FORCE RLS e privilégios dos papéis). pg_dump/pg_restore:
 *    os do PATH se a versão principal for >= a do servidor (CI), senão os do contêiner macuxi-postgres-testes (PC).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  baixarBackup, carimbo, chaveDoBackup, enviarBackup, instanteDoBackup, lerConfigBackup, maisNovo, podar, selecionarExpirados, type ConfigBackup,
} from '../backup/backup.mjs';
import { assinarSigV4, criarClienteS3, queryCanonica, SHA256_VAZIO } from '../backup/s3.mjs';
import { carregarDemo } from '../seeds/demo/demo';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerConfigTestes, PASTA_DB, type ConfigBanco } from '../src/config';
import { localizarDocker } from '../src/docker';
import { semBanco } from './estado';

const DIA = 86_400_000;

describe('SigV4 do backup (vetores públicos da AWS, documentação do S3)', () => {
  const cred = { chaveId: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1' };
  const quando = new Date('2013-05-24T00:00:00Z'); // hora-fixa-ok: vetor de teste da AWS

  it('GET Object com Range', () => {
    const auth = assinarSigV4(
      {
        metodo: 'GET',
        caminho: '/test.txt',
        cabecalhos: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': SHA256_VAZIO, 'x-amz-date': '20130524T000000Z' },
        hashCorpo: SHA256_VAZIO,
      },
      cred,
      quando,
    );
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('GET Bucket (List Objects) com query string', () => {
    const auth = assinarSigV4(
      {
        metodo: 'GET',
        caminho: '/',
        query: { prefix: 'J', 'max-keys': '2' },
        cabecalhos: { host: 'examplebucket.s3.amazonaws.com', 'x-amz-content-sha256': SHA256_VAZIO, 'x-amz-date': '20130524T000000Z' },
        hashCorpo: SHA256_VAZIO,
      },
      cred,
      quando,
    );
    expect(auth).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
    expect(queryCanonica({ prefix: 'backups/', 'list-type': '2' })).toBe('list-type=2&prefix=backups%2F');
  });
});

describe('nomes e retenção (7 dias, nunca o mais novo, nunca fora do padrão)', () => {
  const prefixo = 'backups/';
  const agora = Date.UTC(2026, 10, 12, 6, 20, 0); // hora-fixa-ok: relógio injetado na função pura
  const diario = (diasAtras: number) => chaveDoBackup(prefixo, 'macuxi', new Date(Date.UTC(2026, 10, 12, 6, 15, 0) - diasAtras * DIA));

  it('chave em UTC e leitura de volta; recusa chave parecida', () => {
    const chave = chaveDoBackup(prefixo, 'macuxi', new Date('2026-11-04T06:15:03.456Z')); // hora-fixa-ok: formato do nome
    expect(chave).toBe('backups/macuxi-20261104T061503Z.dump');
    expect(carimbo(new Date('2026-11-04T06:15:03Z'))).toBe('20261104T061503Z'); // hora-fixa-ok: formato do nome
    expect(instanteDoBackup(chave, prefixo)).toBe(Date.UTC(2026, 10, 4, 6, 15, 3));
    for (const outra of ['arquivos/macuxi-20261104T061503Z.dump', 'backups/macuxi-20261304T061503Z.dump', 'backups/macuxi-20261104T061503Z.dump.tmp', 'backups/x/macuxi-20261104T061503Z.dump', 'backups/Macuxi-20261104T061503Z.dump']) {
      expect(instanteDoBackup(outra, prefixo), outra).toBeNull();
    }
  });

  it('um backup por dia: ficam 7 cópias (hoje e os 6 dias anteriores)', () => {
    const chaves = Array.from({ length: 10 }, (_, i) => diario(i));
    const expirados = selecionarExpirados(chaves, { prefixo, agora, dias: 7 });
    expect(expirados.sort()).toEqual([diario(7), diario(8), diario(9)].sort());
    expect(chaves.filter((c) => !expirados.includes(c))).toHaveLength(7);
  });

  it('backup parado há 20 dias: o último fica; foto e lixo no prefixo nunca saem', () => {
    const velhos = [diario(20), diario(25)];
    const outros = ['backups/LEIA-ME.txt', 'arquivos/t1/vendedor/2026-11/a.jpg', 'backups/macuxi-ontem.dump'];
    expect(selecionarExpirados([...velhos, ...outros], { prefixo, agora, dias: 7 })).toEqual([diario(25)]);
    expect(maisNovo([...velhos, ...outros], prefixo)).toBe(diario(20));
    expect(maisNovo(outros, prefixo)).toBeNull();
  });

  it('configuração: faltas citam só os nomes; MACUXI_S3_PREFIXO (fotos) não vira prefixo do backup', () => {
    const segredo = 'segredo-que-nao-pode-vazar';
    let erro = '';
    try {
      lerConfigBackup({ MACUXI_S3_SEGREDO: segredo, MACUXI_S3_CHAVE_ID: 'id' });
    } catch (e) {
      erro = (e as Error).message;
    }
    expect(erro).toContain('MACUXI_S3_ENDPOINT, MACUXI_S3_REGIAO, MACUXI_S3_BUCKET');
    expect(erro).not.toContain(segredo);
    const cfg = lerConfigBackup({
      MACUXI_S3_ENDPOINT: 'https://br-se1.magaluobjects.com/',
      MACUXI_S3_REGIAO: 'br-se1',
      MACUXI_S3_BUCKET: 'macuxi-demo-arquivos',
      MACUXI_S3_CHAVE_ID: 'id',
      MACUXI_S3_SEGREDO: segredo,
      MACUXI_S3_PREFIXO: 'arquivos/',
    });
    expect(cfg).toMatchObject({ prefixo: 'backups/', dias: 7, banco: 'macuxi', s3: { endpoint: 'https://br-se1.magaluobjects.com', estilo: 'caminho' } });
    expect(() => lerConfigBackup({ ...cfgEnv(), MACUXI_BACKUP_DIAS: '0' })).toThrow(/MACUXI_BACKUP_DIAS/);
    expect(() => lerConfigBackup({ ...cfgEnv(), MACUXI_BACKUP_PREFIXO: '../x/' })).toThrow(/MACUXI_BACKUP_PREFIXO/);
  });
});

function cfgEnv(endpoint = 'http://127.0.0.1:1'): NodeJS.ProcessEnv {
  return { MACUXI_S3_ENDPOINT: endpoint, MACUXI_S3_REGIAO: 'br-se1', MACUXI_S3_BUCKET: 'macuxi-demo-arquivos', MACUXI_S3_CHAVE_ID: 'id-teste', MACUXI_S3_SEGREDO: 'segredo-teste' };
}

/** S3 falso: guarda objetos em memória e recusa (403) pedido cuja assinatura não confere com a recalculada aqui. */
async function subirS3Falso(cred: { chaveId: string; segredo: string; regiao: string }, bucket: string) {
  const objetos = new Map<string, { corpo: Buffer; meta: Record<string, string> }>();
  const stats = { assinaturasConferidas: 0, recusados: 0 };
  const servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(partes);
      const url = new URL(req.url ?? '/', 'http://s3');
      const auth = String(req.headers.authorization ?? '');
      const assinados = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(';') ?? [];
      const hashCorpo = String(req.headers['x-amz-content-sha256'] ?? '');
      const amz = String(req.headers['x-amz-date'] ?? '');
      const quando = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
      const esperado = assinarSigV4(
        {
          metodo: req.method ?? 'GET',
          caminho: url.pathname,
          query: Object.fromEntries(url.searchParams),
          cabecalhos: Object.fromEntries(assinados.map((n) => [n, String(req.headers[n] ?? '')])),
          hashCorpo,
        },
        cred,
        quando,
      );
      const corpoOk = req.method !== 'PUT' || createHash('sha256').update(corpo).digest('hex') === hashCorpo;
      if (auth !== esperado || !assinados.includes('host') || !corpoOk) {
        stats.recusados += 1;
        res.writeHead(403).end(`<Error><Code>${corpoOk ? 'SignatureDoesNotMatch' : 'XAmzContentSHA256Mismatch'}</Code></Error>`);
        return;
      }
      stats.assinaturasConferidas += 1;
      const raiz = `/${bucket}`;
      if (url.pathname === raiz && req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefixo = url.searchParams.get('prefix') ?? '';
        const todas = [...objetos.keys()].filter((k) => k.startsWith(prefixo)).sort();
        const inicio = Number(url.searchParams.get('continuation-token') ?? '0');
        const pagina = todas.slice(inicio, inicio + 2); // página pequena: exercita a paginação
        const mais = inicio + 2 < todas.length;
        const itens = pagina.map((k) => `<Contents><Key>${k}</Key><Size>${objetos.get(k)!.corpo.length}</Size><LastModified>2026-11-04T06:15:00.000Z</LastModified></Contents>`).join(''); // hora-fixa-ok: resposta do S3 falso
        res.writeHead(200, { 'content-type': 'application/xml' }).end(
          `<ListBucketResult><IsTruncated>${mais}</IsTruncated>${mais ? `<NextContinuationToken>${inicio + 2}</NextContinuationToken>` : ''}${itens}</ListBucketResult>`,
        );
        return;
      }
      if (!url.pathname.startsWith(`${raiz}/`)) {
        res.writeHead(400).end();
        return;
      }
      const chave = decodeURIComponent(url.pathname.slice(raiz.length + 1));
      const obj = objetos.get(chave);
      if (req.method === 'PUT') {
        const meta = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-amz-meta-')).map(([k, v]) => [k, String(v)]));
        objetos.set(chave, { corpo, meta });
        res.writeHead(200).end();
      } else if (req.method === 'DELETE') {
        objetos.delete(chave);
        res.writeHead(204).end();
      } else if (!obj) {
        res.writeHead(404).end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
      } else {
        res.writeHead(200, { 'content-length': String(obj.corpo.length), ...obj.meta });
        res.end(req.method === 'HEAD' ? undefined : obj.corpo);
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;
  return { objetos, stats, endpoint: `http://127.0.0.1:${porta}`, fechar: () => new Promise<void>((ok) => servidor.close(() => ok())) };
}

/** Writable que junta tudo num Buffer. */
function coletor(): { saida: Writable; bytes: () => Buffer } {
  const partes: Buffer[] = [];
  return {
    saida: new Writable({
      write(p: Buffer, _e, feito) {
        partes.push(p);
        feito();
      },
    }),
    bytes: () => Buffer.concat(partes),
  };
}

/** "Dump" falso com a assinatura PGDMP (o conteúdo não importa para o S3). */
const dumpFalso = (n: number) => Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(n, n % 251)]);

describe('enviar → listar → baixar → podar contra o S3 falso (assinatura conferida em cada pedido)', () => {
  let s3: Awaited<ReturnType<typeof subirS3Falso>>;
  let cfg: ConfigBackup;
  beforeAll(async () => {
    const base = lerConfigBackup(cfgEnv());
    s3 = await subirS3Falso({ chaveId: base.s3.chaveId, segredo: base.s3.segredo, regiao: base.s3.regiao }, base.s3.bucket);
    cfg = lerConfigBackup(cfgEnv(s3.endpoint));
  });
  afterAll(() => s3?.fechar());

  it('envia com sha256 nos metadados, baixa o mais novo conferindo e poda só os vencidos (8 dias depois ficam 7)', async () => {
    const cliente = criarClienteS3(cfg.s3);
    s3.objetos.set('arquivos/t1/vendedor/2026-11/foto.jpg', { corpo: Buffer.from('jpg'), meta: {} });
    const inicio = Date.UTC(2026, 10, 1, 6, 15, 0); // hora-fixa-ok: relógio injetado
    let ultimo = Buffer.alloc(0);
    for (let d = 0; d < 9; d += 1) {
      ultimo = dumpFalso(1000 + d);
      const r = await enviarBackup(cliente, cfg, Readable.from([ultimo]), { agora: new Date(inicio + d * DIA) });
      expect(r.bytes).toBe(ultimo.length);
      expect(s3.objetos.get(r.chave)!.meta['x-amz-meta-sha256']).toBe(createHash('sha256').update(ultimo).digest('hex'));
    }
    const backups = [...s3.objetos.keys()].filter((k) => k.startsWith('backups/')).sort();
    expect(backups).toHaveLength(7);
    expect(backups[0]).toBe('backups/macuxi-20261103T061500Z.dump');
    expect(s3.objetos.has('arquivos/t1/vendedor/2026-11/foto.jpg')).toBe(true);

    const c = coletor();
    const baixado = await baixarBackup(cliente, cfg, 'ultimo', c.saida);
    expect(baixado).toMatchObject({ chave: 'backups/macuxi-20261109T061500Z.dump', conferido: true });
    expect(c.bytes().equals(ultimo)).toBe(true);

    expect(await podar(cliente, cfg, { agora: inicio + 30 * DIA, simular: true })).toHaveLength(6);
    expect(s3.stats.assinaturasConferidas).toBeGreaterThan(20);
    expect(s3.stats.recusados).toBe(0);
  });

  it('recusa entrada que não é dump custom (nada vai ao bucket) e detecta arquivo corrompido no bucket', async () => {
    const cliente = criarClienteS3(cfg.s3);
    const antes = s3.objetos.size;
    await expect(enviarBackup(cliente, cfg, Readable.from([Buffer.from('-- PostgreSQL database dump\ncreate table x();'.repeat(4))]))).rejects.toThrow(/não é um dump custom/);
    await expect(enviarBackup(cliente, cfg, Readable.from([]))).rejects.toThrow(/0 bytes/);
    expect(s3.objetos.size).toBe(antes);
    const chave = maisNovo([...s3.objetos.keys()], cfg.prefixo)!;
    s3.objetos.get(chave)!.corpo = dumpFalso(7);
    await expect(baixarBackup(cliente, cfg, chave, coletor().saida)).rejects.toThrow(/sha256 não confere/);
    await expect(baixarBackup(cliente, cfg, 'arquivos/t1/vendedor/2026-11/foto.jpg', coletor().saida)).rejects.toThrow(/fora do padrão/);
  });

  it('segredo errado: o S3 recusa e o erro não traz chave nem segredo', async () => {
    const cliente = criarClienteS3({ ...cfg.s3, segredo: 'outro-segredo-errado' });
    const erro = await enviarBackup(cliente, cfg, Readable.from([dumpFalso(100)])).catch((e: Error) => e);
    expect(String(erro)).toMatch(/S3 gravar: HTTP 403 \(SignatureDoesNotMatch\)/);
    expect(String(erro)).not.toMatch(/outro-segredo-errado|id-teste/);
  });
});

// ---------- restauração de verdade (Postgres) ----------

interface FerramentasPg {
  descricao: string;
  dump(banco: string): Buffer;
  restaurar(banco: string, dump: Buffer): void;
}

function rodar(exe: string, args: string[], opcoes: { input?: Buffer; env?: NodeJS.ProcessEnv } = {}): Buffer {
  const r = spawnSync(exe, args, { input: opcoes.input, env: opcoes.env, maxBuffer: 1024 * 1024 * 1024, timeout: 240_000 });
  if (r.error || r.status !== 0) throw new Error(`${exe} ${args.slice(0, 4).join(' ')} falhou: ${r.error?.message ?? r.stderr.toString().trim().slice(0, 800)}`);
  return r.stdout;
}

/** pg_dump/pg_restore: os do PATH (versão principal >= servidor) ou os do contêiner dos testes; null = pular. */
function acharFerramentas(cfg: ConfigBanco, versaoServidor: number): FerramentasPg | null {
  const restaurarArgs = (banco: string) => ['-d', banco, '--exit-on-error', '--single-transaction'];
  const local = spawnSync('pg_dump', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  const major = Number(/(\d+)(?:\.\d+)?/.exec(local.stdout ?? '')?.[1] ?? 0);
  if (!local.error && local.status === 0 && major >= versaoServidor) {
    const env = { ...process.env, PGPASSWORD: cfg.adminSenha };
    const con = ['-h', cfg.host, '-p', String(cfg.porta), '-U', cfg.adminUsuario];
    return {
      descricao: `pg_dump ${major} do PATH`,
      dump: (banco) => rodar('pg_dump', [...con, '-d', banco, '-Fc', '-Z', '6'], { env }),
      restaurar: (banco, dump) => void rodar('pg_restore', [...con, ...restaurarArgs(banco)], { input: dump, env }),
    };
  }
  const docker = cfg.servicoCompose === 'postgres-testes' ? localizarDocker() : null;
  if (docker) {
    const ativo = spawnSync(docker, ['inspect', '-f', '{{.State.Running}}', 'macuxi-postgres-testes'], { encoding: 'utf8', timeout: 20_000 });
    if (ativo.status === 0 && ativo.stdout.trim() === 'true') {
      const exec = ['exec', '-i', 'macuxi-postgres-testes'];
      return {
        descricao: 'pg_dump do contêiner macuxi-postgres-testes',
        dump: (banco) => rodar(docker, [...exec, 'pg_dump', '-U', cfg.adminUsuario, '-d', banco, '-Fc', '-Z', '6']),
        restaurar: (banco, dump) => void rodar(docker, [...exec, 'pg_restore', '-U', cfg.adminUsuario, ...restaurarArgs(banco)], { input: dump }),
      };
    }
  }
  return null;
}

/** db/backup/contagem.sql (o mesmo que o restaurar-vm.sh usa). */
async function contagem(banco: string): Promise<string[]> {
  const sql = readFileSync(join(PASTA_DB, 'backup', 'contagem.sql'), 'utf8');
  return comAdmin(banco, async (c: pg.Client) => (await c.query<Record<string, string>>(sql)).rows.map((r) => Object.values(r)[0]!), lerConfigTestes());
}

describe.skipIf(semBanco())('restauração: base de demo → pg_dump → bucket (falso) → pg_restore num banco novo, contagem igual', () => {
  let origem: BancoDeTeste | undefined;
  let destino: BancoDeTeste | undefined;
  let s3: Awaited<ReturnType<typeof subirS3Falso>> | undefined;
  afterAll(async () => {
    await destino?.apagar();
    await origem?.apagar();
    await s3?.fechar();
  });

  it('restaura tudo: linhas de cada tabela, políticas de RLS, FORCE RLS e privilégios dos papéis', async (ctx) => {
    const cfgPg = lerConfigTestes();
    const versao = await comAdmin('postgres', async (c: pg.Client) => Number((await c.query<{ v: string }>('show server_version_num')).rows[0]!.v) / 10_000, cfgPg);
    const ferramentas = acharFerramentas(cfgPg, Math.floor(versao));
    if (!ferramentas) {
      console.warn('[backup.test] sem pg_dump compatível (PATH ou contêiner macuxi-postgres-testes): restauração pulada');
      ctx.skip();
      return;
    }
    origem = await criarBancoDeTeste({ preparar: async (c) => void (await carregarDemo(c, { senha: 'senha-do-teste-backup' })) });
    destino = await criarBancoDeTeste({ migrar: false });

    const dump = ferramentas.dump(origem.nome);
    const base = lerConfigBackup(cfgEnv());
    s3 = await subirS3Falso({ chaveId: base.s3.chaveId, segredo: base.s3.segredo, regiao: base.s3.regiao }, base.s3.bucket);
    const cfg = lerConfigBackup(cfgEnv(s3.endpoint));
    const cliente = criarClienteS3(cfg.s3);
    const enviado = await enviarBackup(cliente, cfg, Readable.from([dump]));
    const c = coletor();
    const baixado = await baixarBackup(cliente, cfg, 'ultimo', c.saida);
    expect(baixado).toMatchObject({ chave: enviado.chave, bytes: dump.length, sha256: enviado.sha256, conferido: true });

    ferramentas.restaurar(destino.nome, c.bytes());

    const antes = await contagem(origem.nome);
    const depois = await contagem(destino.nome);
    expect(depois).toEqual(antes);
    const linhas = antes.filter((l) => l.startsWith('linhas|'));
    expect(linhas.length).toBeGreaterThan(50);
    const total = linhas.reduce((s, l) => s + Number(l.split('|')[2]), 0);
    expect(total).toBeGreaterThan(500);
    expect(antes.find((l) => l.startsWith('linhas|core.usuario|'))).toMatch(/\|[1-9]\d*$/);
    expect(antes.find((l) => l.startsWith('politicas|'))).toMatch(/\|[1-9]\d*$/);
    expect(antes.some((l) => l.startsWith('privilegios|macuxi_app|'))).toBe(true);
    console.info(`[backup.test] ${ferramentas.descricao}: ${linhas.length} tabelas, ${total} linhas, dump de ${(dump.length / 1024).toFixed(0)} KB restaurado igual`);

    // T-0079 (0022): o restaurar-vm.sh gira a geração da base de TODOS os tenants do restaurado (a função vem no dump);
    // a origem não muda e a contagem continua igual (só o marcador anda)
    const geracoes = (banco: string) =>
      comAdmin(banco, async (c: pg.Client) => (await c.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant order by id')).rows, lerConfigTestes());
    const daOrigem = await geracoes(origem.nome);
    expect(await geracoes(destino.nome)).toEqual(daOrigem);
    const girados = await comAdmin(destino.nome, async (c: pg.Client) => (await c.query<{ n: number }>('select plataforma.girar_geracao_base(null) as n')).rows[0]!.n, lerConfigTestes());
    expect(girados).toBe(daOrigem.length);
    const novas = await geracoes(destino.nome);
    expect(novas.map((t) => t.id)).toEqual(daOrigem.map((t) => t.id));
    for (const [i, t] of novas.entries()) expect(t.g).not.toBe(daOrigem[i]!.g);
    expect(await geracoes(origem.nome)).toEqual(daOrigem);
    expect(await contagem(destino.nome)).toEqual(antes);
  });
});
