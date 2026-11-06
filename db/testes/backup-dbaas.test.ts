/**
 * Backup e ensaio de restauração da PRODUÇÃO no DBaaS (T-0086; db/backup/backup-dbaas.sh e ensaio-restauracao.sh).
 * Sem banco e sem Docker:
 * 1. estático: bash -n, --enable-row-security no pg_dump, senha nunca no script, trap que apaga a base temporária,
 *    o banco em uso nunca tocado pelo ensaio e a linha "[ensaio] resultado: IGUAL|DIFERENTE";
 * 2. ponta a ponta com um "docker" falso (db/testes/backup-dbaas/docker-falso.sh) que emula o compose run dos serviços
 *    pgcliente, backup e banco: backup → bucket falso → ensaio IGUAL; contagem diferente, restauração que falha,
 *    conferir-rls com problema e backup sem contagem dão DIFERENTE e a base temporária sai sempre.
 * O caminho real (Postgres 16 com TLS e admin sem superusuário, S3 falso) é o job stack-producao do stack-isolado.yml.
 * A parte 2 roda só fora do Windows (no PC, o "bash" do PATH pode ser o do WSL); o CI roda tudo.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASTA_DB } from '../src/config';

const BACKUP = join(PASTA_DB, 'backup', 'backup-dbaas.sh');
const ENSAIO = join(PASTA_DB, 'backup', 'ensaio-restauracao.sh');
const FALSO = join(PASTA_DB, 'testes', 'backup-dbaas', 'docker-falso.sh');
const ler = (p: string) => readFileSync(p, 'utf8');
/** Linhas de código (sem os comentários de cabeçalho/linha inteira). */
const codigo = (p: string) =>
  ler(p)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const comBash = process.platform !== 'win32' && spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;

describe('backup-dbaas.sh e ensaio-restauracao.sh: estático', () => {
  it('arquivos com LF e cabeçalho bash estrito', () => {
    for (const p of [BACKUP, ENSAIO, FALSO]) {
      const t = ler(p);
      expect(t.startsWith('#!/usr/bin/env bash\n'), p).toBe(true);
      expect(t.includes('\r'), `${p} com CRLF`).toBe(false);
    }
    expect(codigo(BACKUP)).toContain('set -euo pipefail');
    expect(codigo(ENSAIO)).toContain('set -euo pipefail');
  });

  it.skipIf(!comBash)('bash -n (sintaxe)', () => {
    for (const p of [BACKUP, ENSAIO, FALSO]) {
      const r = spawnSync('bash', ['-n', p], { encoding: 'utf8' });
      expect(r.status, `${p}: ${r.stderr}`).toBe(0);
    }
  });

  it('backup: pg_dump -Fc --enable-row-security pelo pgcliente, contagem e dump no bucket pelo serviço backup', () => {
    const c = codigo(BACKUP);
    expect(c).toMatch(/pgc pg_dump --no-password -d "\$BANCO" -Fc -Z 6 --enable-row-security > "\$tmp\/dump"/);
    expect(c).toContain('dc run --rm --no-deps -T pgcliente');
    expect(c).toMatch(/pgc pg_restore -l < "\$tmp\/dump"/);
    expect(c).toMatch(/backup enviar-contagem --carimbo "\$CARIMBO"[\s\S]*backup enviar --carimbo "\$CARIMBO"/);
    expect(c).toContain('--profile ferramentas');
    expect(c).toMatch(/log "pronto: /);
    expect(c).toContain('macuxi_manutencao');
  });

  it('nenhum dos dois lê senha, admin.env ou segredos (tudo chega aos contêineres pelo env_file do compose)', () => {
    for (const p of [BACKUP, ENSAIO]) {
      const c = codigo(p);
      expect(c, p).not.toMatch(/PGPASSWORD|SENHA|SEGREDO|password=|source |\. \.\/|cat [^|]*admin\.env|cat [^|]*segredos\.env/i);
      expect(c, p).not.toMatch(/set -x|xtrace/);
    }
  });

  it('ensaio: restauração numa base macuxi_ensaio_<UTC>, trap que apaga sempre, banco em uso nunca tocado', () => {
    const c = codigo(ENSAIO);
    expect(c).toContain('DESTINO="macuxi_ensaio_$(date -u +%Y%m%d%H%M%S)"');
    expect(c).toContain('[[ "$DESTINO" =~ ^macuxi_ensaio_[0-9]{14}$ ]]');
    expect(c).toContain('trap finalizar EXIT');
    expect(c).toContain('drop database if exists $DESTINO with (force)');
    expect(c).toMatch(/pg_restore --no-password --exit-on-error --single-transaction -d "\$DESTINO" -L \/trabalho\/lista \/trabalho\/dump/);
    expect(c).toMatch(/CRIADA=1[^\n]*\npsqlc -d postgres -c "create database \$DESTINO"/);
    // só postgres (create/drop) e a temporária: nunca -d macuxi, nem drop/alter/rename de outro nome
    const conexoes = c
      .split('\n')
      .filter((l) => /\b(psqlc|pg_restore)\b/.test(l))
      .join('\n');
    const alvos = [...conexoes.matchAll(/ -d ("?\$?\w+"?)/g)].map((m) => m[1]!.replaceAll('"', ''));
    expect(new Set(alvos)).toEqual(new Set(['postgres', '$DESTINO']));
    expect(c).not.toMatch(/drop database (?!if exists \$DESTINO with \(force\))/);
    expect(c).not.toMatch(/alter database|rename to/i);
    expect(c).toContain('echo "[ensaio] resultado: $RESULTADO $DETALHE"');
    // filtro do A9 (db/dbaas/relatorio.ts, filtrarListaRestauracao): pgaudit, gatilhos de evento e COMMENT ON EXTENSION
    expect(c).toContain('/ EVENT TRIGGER / || /(^|[^A-Za-z0-9_])pgaudit_/ || / COMMENT - EXTENSION /');
  });
});

interface Rodada {
  codigo: number | null;
  saida: string;
  ultima: string;
}

describe.skipIf(!comBash)('ponta a ponta com docker falso: backup → bucket → ensaio', () => {
  let raiz = '';
  let falso = '';
  let trabalho = '';
  let ambiente: NodeJS.ProcessEnv = {};

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'macuxi-t0086-'));
    const bin = join(raiz, 'bin');
    const vm = join(raiz, 'vm');
    falso = join(raiz, 'falso');
    trabalho = join(raiz, 'trabalho');
    for (const d of [bin, vm, falso, trabalho]) mkdirSync(d, { recursive: true });
    copyFileSync(FALSO, join(bin, 'docker'));
    chmodSync(join(bin, 'docker'), 0o755);
    for (const f of ['.env', 'imagens.env', 'banco.env', 'admin.env']) writeFileSync(join(vm, f), 'X=1\n', { mode: 0o600 });
    ambiente = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: raiz,
      TMPDIR: raiz,
      MACUXI_DIR: vm,
      MACUXI_ENSAIO_TMP: trabalho,
      MACUXI_BACKUP_PAUSA_S: '0',
      FALSO_DIR: falso,
      FALSO_TRABALHO: trabalho,
    };
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  const rodar = (script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}): Rodada => {
    const r = spawnSync('bash', [script, ...args], { env: { ...ambiente, ...extra }, encoding: 'utf8', timeout: 120_000 });
    const saida = `${r.stdout}${r.stderr}`;
    const linhas = r.stdout.trim().split('\n');
    return { codigo: r.status, saida, ultima: linhas.at(-1) ?? '' };
  };
  const arquivo = (nome: string) => (existsSync(join(falso, nome)) ? readFileSync(join(falso, nome), 'utf8') : '');
  const objetos = () => (existsSync(join(falso, 's3')) ? readdirSync(join(falso, 's3')).sort() : []);

  it('backup: dump com --enable-row-security, contagem estável e os dois objetos com o mesmo carimbo', () => {
    const r = rodar(BACKUP);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.ultima).toMatch(/^\[backup-dbaas\] .* pronto: backups\/macuxi-\d{8}T\d{6}Z\.dump/);
    expect(arquivo('dump.log').trim()).toBe('pg_dump --no-password -d macuxi -Fc -Z 6 --enable-row-security');
    const [contagem, dump] = objetos();
    expect(dump).toMatch(/^macuxi-\d{8}T\d{6}Z\.dump$/);
    expect(contagem).toBe(dump!.replace(/\.dump$/, '.contagem.txt'));
    const texto = arquivo(join('s3', contagem!));
    expect(texto.split('\n')[0]).toMatch(/^# contagem\.sql de macuxi .* estavel=sim$/);
    expect(texto).toContain('linhas|core.usuario|4');
    // a contagem vai antes do dump: se o dump falhar, sobra só a contagem órfã (a poda a apaga quando vencer)
    expect(arquivo('s3.log').trim().split('\n').map((l) => l.split(' ')[0])).toEqual(['enviar-contagem', 'enviar']);
  });

  it('backup: admin que não herda o macuxi_manutencao para com código 2 e nada vai ao bucket', () => {
    const r = rodar(BACKUP, [], { FALSO_SEM_MANUTENCAO: '1' });
    expect(r.codigo).toBe(2);
    expect(r.saida).toMatch(/não herda o macuxi_manutencao/);
    expect(arquivo('dump.log')).toBe('');
    expect(objetos()).toEqual([]);
  });

  it('backup: contagem que muda durante o dump repete e, no fim, segue marcada estavel=nao', () => {
    const r = rodar(BACKUP, [], { FALSO_INSTAVEL: '1', MACUXI_BACKUP_TENTATIVAS: '2' });
    expect(r.codigo, r.saida).toBe(0);
    expect(arquivo('dump.log').trim().split('\n')).toHaveLength(2);
    expect(r.saida).toMatch(/a contagem mudou durante o dump/);
    const contagem = objetos().find((o) => o.endsWith('.contagem.txt'))!;
    expect(arquivo(join('s3', contagem)).split('\n')[0]).toMatch(/estavel=nao$/);
  });

  it('ensaio: IGUAL, código 0, base temporária criada e apagada, lista sem os objetos do provedor', () => {
    expect(rodar(BACKUP).codigo).toBe(0);
    // o chamadas.log acumula o backup (que conecta, sim, na macuxi: papel, contagem e pg_dump) e o ensaio; só a fatia
    // do ensaio interessa aqui
    const antesDoEnsaio = arquivo('chamadas.log').length;
    const r = rodar(ENSAIO, ['ultimo']);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.ultima).toMatch(/^\[ensaio\] resultado: IGUAL \(3 tabelas, 72 linhas, 6 políticas; conferir-rls: 0 problemas; backup backups\/macuxi-\d{8}T\d{6}Z\.dump/);
    const bancos = arquivo('bancos.log').trim().split('\n');
    expect(bancos).toHaveLength(2);
    expect(bancos[0]).toMatch(/^criou macuxi_ensaio_\d{14}$/);
    expect(bancos[1]).toBe(bancos[0]!.replace('criou', 'apagou'));
    // o ensaio só conecta em "postgres" (checagem do papel, sobras, CREATE/DROP DATABASE da temporária) e na própria
    // temporária (vector, pg_restore, contagem, conferir-rls): nunca na macuxi
    const chamadasEnsaio = arquivo('chamadas.log').slice(antesDoEnsaio);
    const alvosEnsaio = [...chamadasEnsaio.matchAll(/^psql -d (\S+)$/gm)].map((m) => m[1]!);
    expect(alvosEnsaio.length).toBeGreaterThan(0);
    expect(new Set(alvosEnsaio)).toEqual(new Set(['postgres', bancos[0]!.slice('criou '.length)]));
    expect(chamadasEnsaio).not.toMatch(/ -d macuxi( |$)/m);
    const lista = arquivo('lista-usada.txt');
    expect(lista).toContain('TABLE DATA core usuario');
    expect(lista).not.toMatch(/COMMENT - EXTENSION|EVENT TRIGGER|pgaudit_/);
    expect(arquivo('restore-args.log').split('\n')).toEqual(expect.arrayContaining(['--exit-on-error', '--single-transaction']));
    expect(readdirSync(trabalho)).toEqual([]);
  });

  it('ensaio: chave explícita também serve; chave fora do padrão é recusada sem criar nada', () => {
    expect(rodar(BACKUP).codigo).toBe(0);
    const dump = objetos().find((o) => o.endsWith('.dump'))!;
    expect(rodar(ENSAIO, [`backups/${dump}`]).ultima).toMatch(/^\[ensaio\] resultado: IGUAL /);
    const ruim = rodar(ENSAIO, ['backups/../macuxi.dump']);
    expect(ruim.codigo).toBe(2);
    expect(arquivo('bancos.log').trim().split('\n')).toHaveLength(2);
  });

  it.each([
    ['contagem restaurada diferente', { FALSO_RESTAURADA_DIFERE: '1' }, /linha\(s\) diferentes da contagem gravada/],
    ['pg_restore que falha', { FALSO_RESTORE_FALHA: '1' }, /a restauração de .* falhou/],
    ['conferir-rls com problema na restaurada', { FALSO_RLS_PROBLEMA: '1' }, /conferir-rls\.sql achou 1 problema/],
  ])('ensaio: %s → DIFERENTE, código != 0 e a base temporária sai', (_nome, extra, detalhe) => {
    expect(rodar(BACKUP).codigo).toBe(0);
    const r = rodar(ENSAIO, [], extra);
    expect(r.codigo).not.toBe(0);
    expect(r.ultima).toMatch(/^\[ensaio\] resultado: DIFERENTE /);
    expect(r.ultima).toMatch(detalhe);
    const bancos = arquivo('bancos.log').trim().split('\n');
    expect(bancos[0]).toMatch(/^criou macuxi_ensaio_\d{14}$/);
    expect(bancos[1]).toBe(bancos[0]!.replace('criou', 'apagou'));
    expect(existsSync(join(falso, 'bancos', bancos[0]!.slice('criou '.length)))).toBe(false);
  });

  it('ensaio: backup sem contagem gravada → DIFERENTE sem criar base', () => {
    expect(rodar(BACKUP).codigo).toBe(0);
    for (const o of objetos().filter((x) => x.endsWith('.contagem.txt'))) unlinkSync(join(falso, 's3', o));
    const r = rodar(ENSAIO);
    expect(r.codigo).not.toBe(0);
    expect(r.ultima).toMatch(/^\[ensaio\] resultado: DIFERENTE \(o backup .* não tem a contagem gravada/);
    expect(arquivo('bancos.log')).toBe('');
  });
});
