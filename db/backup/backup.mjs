#!/usr/bin/env node
/**
 * Backup do Postgres para o Object Storage (dono: banco-dados; T-0074, ADR 0020). Node puro, sem pnpm install: roda
 * na imagem macuxi-api (`node db/backup/backup.mjs ...`) e no PC. O pg_dump/pg_restore NÃO rodam aqui (a imagem da API
 * não tem cliente do Postgres): quem chama passa o dump pelo stdin (db/backup/backup-vm.sh, no host da VM, usa o
 * pg_dump de dentro do contêiner postgres). Ver db/backup/LEIA-ME.md.
 *
 *   node db/backup/backup.mjs enviar [arquivo] [--carimbo AAAAMMDDTHHMMSSZ]
 *                                                        dump custom (-Fc) do arquivo ou do stdin → <prefixo><banco>-<UTC>.dump
 *                                                        (UTC de agora ou o --carimbo), confere tamanho e sha256 no bucket e
 *                                                        depois poda os antigos (e as contagens deles)
 *   node db/backup/backup.mjs enviar-contagem --carimbo AAAAMMDDTHHMMSSZ [arquivo]
 *                                                        contagem.sql do momento do dump (texto) → <prefixo><banco>-<UTC>.contagem.txt,
 *                                                        objeto irmão do dump de mesmo carimbo (T-0086, backup-dbaas.sh)
 *   node db/backup/backup.mjs resolver <ultimo|chave>    imprime a chave do dump (o mais novo, ou a chave conferida)
 *   node db/backup/backup.mjs baixar <ultimo|chave> [arquivo]   baixa (stdout se sem arquivo) e confere o sha256
 *   node db/backup/backup.mjs baixar-contagem <chave-do-dump> [arquivo]   contagem gravada junto do dump (sha256 conferido)
 *   node db/backup/backup.mjs listar                     backups no bucket (mais novo por último)
 *   node db/backup/backup.mjs podar [--simular]          apaga os backups com mais de MACUXI_BACKUP_DIAS dias (e as contagens)
 *
 * Variáveis (as mesmas do compose da demo; nenhuma é impressa):
 *   MACUXI_S3_ENDPOINT, MACUXI_S3_REGIAO, MACUXI_S3_BUCKET, MACUXI_S3_CHAVE_ID, MACUXI_S3_SEGREDO (obrigatórias),
 *   MACUXI_S3_ESTILO (caminho|virtual, padrão caminho), MACUXI_BACKUP_PREFIXO (padrão backups/; MACUXI_S3_PREFIXO,
 *   o das fotos, é ignorado de propósito), MACUXI_BACKUP_DIAS (padrão 7), MACUXI_PG_BANCO (nome no arquivo, padrão macuxi).
 * Retenção: só apaga objetos com o nome EXATO de backup (<prefixo><banco>-AAAAMMDDTHHMMSSZ.dump) e nunca o mais novo,
 * mesmo vencido (se o backup parar de rodar, o último fica). Fotos (arquivos/) nunca casam com o padrão. A contagem
 * (<...>.contagem.txt) sai junto do dump dela; contagem sem dump (envio do dump falhou) sai quando vence.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { criarClienteS3 } from './s3.mjs';

export const PREFIXO_PADRAO = 'backups/';
export const DIAS_PADRAO = 7;
/** Início de todo dump no formato custom do pg_dump (-Fc). */
export const MAGICA_DUMP = 'PGDMP';
const DIA_MS = 86_400_000;
/** Folga da retenção: o agendamento pode atrasar alguns minutos; um backup de "7 dias atrás" sai mesmo assim. */
const FOLGA_MS = 3_600_000;

/** Configuração pelo ambiente; erro cita só NOMES de variável, nunca valores. */
export function lerConfigBackup(env = process.env) {
  const exigidas = ['MACUXI_S3_ENDPOINT', 'MACUXI_S3_REGIAO', 'MACUXI_S3_BUCKET', 'MACUXI_S3_CHAVE_ID', 'MACUXI_S3_SEGREDO'];
  const faltando = exigidas.filter((n) => !env[n]?.trim());
  if (faltando.length) throw new Error(`[backup] faltam variáveis: ${faltando.join(', ')}`);
  const estilo = (env.MACUXI_S3_ESTILO ?? 'caminho').trim().toLowerCase() || 'caminho';
  if (estilo !== 'caminho' && estilo !== 'virtual') throw new Error('[backup] MACUXI_S3_ESTILO inválido: use caminho ou virtual');
  const prefixo = env.MACUXI_BACKUP_PREFIXO?.trim() || PREFIXO_PADRAO;
  if (!/^[a-z0-9][a-z0-9/_-]*\/$/.test(prefixo)) throw new Error('[backup] MACUXI_BACKUP_PREFIXO inválido (ex.: backups/)');
  const dias = Number(env.MACUXI_BACKUP_DIAS?.trim() || DIAS_PADRAO);
  if (!Number.isInteger(dias) || dias < 1) throw new Error('[backup] MACUXI_BACKUP_DIAS precisa ser inteiro >= 1');
  const banco = env.MACUXI_PG_BANCO?.trim() || 'macuxi';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(banco)) throw new Error('[backup] MACUXI_PG_BANCO inválido');
  const v = (n) => env[n].trim();
  return {
    s3: {
      endpoint: v('MACUXI_S3_ENDPOINT').replace(/\/$/, ''),
      regiao: v('MACUXI_S3_REGIAO'),
      bucket: v('MACUXI_S3_BUCKET'),
      chaveId: v('MACUXI_S3_CHAVE_ID'),
      segredo: v('MACUXI_S3_SEGREDO'),
      estilo,
    },
    prefixo,
    dias,
    banco,
  };
}

/** AAAAMMDDTHHMMSSZ (UTC). */
export function carimbo(quando) {
  return quando.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Chave do objeto de backup. */
export function chaveDoBackup(prefixo, banco, quando) {
  return `${prefixo}${banco}-${carimbo(quando)}.dump`;
}

/** Sufixo da contagem gravada junto do dump (objeto irmão: mesmo nome, outro sufixo). */
export const SUFIXO_CONTAGEM = '.contagem.txt';
/** Contagem maior que isso não é a saída do contagem.sql (uma linha curta por tabela). */
export const LIMITE_CONTAGEM = 4 * 1024 * 1024;

/** Chave da contagem irmã de um dump (`...Z.dump` → `...Z.contagem.txt`). */
export function chaveDaContagem(chaveDump) {
  if (!chaveDump.endsWith('.dump')) throw new Error('[backup] a contagem é irmã de uma chave .dump');
  return `${chaveDump.slice(0, -'.dump'.length)}${SUFIXO_CONTAGEM}`;
}

/** AAAAMMDDTHHMMSSZ → Date (UTC), recusando formato ou data impossível. */
export function lerCarimbo(texto) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(texto ?? '').trim());
  if (!m) throw new Error('[backup] --carimbo no formato AAAAMMDDTHHMMSSZ (UTC)');
  const [, a, me, d, h, mi, s] = m.map(Number);
  const quando = new Date(Date.UTC(a, me - 1, d, h, mi, s));
  if (carimbo(quando) !== m[0]) throw new Error('[backup] --carimbo com data impossível');
  return quando;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Instante (ms) do backup pelo nome, ou null se a chave não for EXATAMENTE de um backup deste prefixo. */
export function instanteDoBackup(chave, prefixo) {
  const m = new RegExp(`^${escapeRe(prefixo)}[a-z_][a-z0-9_]{0,62}-(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z\\.dump$`).exec(chave);
  if (!m) return null;
  const [, a, me, d, h, mi, s] = m.map(Number);
  const ms = Date.UTC(a, me - 1, d, h, mi, s);
  // data impossível (ex.: mês 13) não volta igual
  return carimbo(new Date(ms)) === chave.slice(-21, -5) ? ms : null;
}

/**
 * Backups vencidos (função pura): idade > dias × 24 h − 1 h de folga. Com um backup por dia ficam `dias` cópias.
 * Nunca devolve chave fora do padrão nem o backup mais novo.
 */
export function selecionarExpirados(chaves, { prefixo, agora, dias }) {
  const validos = chaves
    .map((chave) => ({ chave, ms: instanteDoBackup(chave, prefixo) }))
    .filter((b) => b.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  const maisNovo = validos.at(-1);
  return validos.filter((b) => b !== maisNovo && agora - b.ms > dias * DIA_MS - FOLGA_MS).map((b) => b.chave);
}

/** O mais novo entre os backups válidos (ou null). */
export function maisNovo(chaves, prefixo) {
  let melhor = null;
  for (const chave of chaves) {
    const ms = instanteDoBackup(chave, prefixo);
    if (ms !== null && (!melhor || ms > melhor.ms)) melhor = { chave, ms };
  }
  return melhor?.chave ?? null;
}

const log = (msg) => process.stderr.write(`[backup] ${msg}\n`);
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * Contagens que saem na poda (função pura): a irmã de cada dump que sai e a contagem órfã (sem o dump, porque o envio
 * dele falhou) já vencida pela mesma regra dos dumps. Nunca a irmã de um dump que fica.
 */
export function selecionarContagensExpiradas(chaves, { prefixo, agora, dias, removidos = [] }) {
  const presentes = new Set(chaves);
  const saem = new Set(removidos);
  return chaves.filter((chave) => {
    if (!chave.endsWith(SUFIXO_CONTAGEM)) return false;
    const dump = `${chave.slice(0, -SUFIXO_CONTAGEM.length)}.dump`;
    const ms = instanteDoBackup(dump, prefixo);
    if (ms === null) return false;
    if (saem.has(dump)) return true;
    return !presentes.has(dump) && agora - ms > dias * DIA_MS - FOLGA_MS;
  });
}

/**
 * Apaga os vencidos e as contagens deles. Devolve as chaves dos DUMPS apagados (ou que seriam, com simular); as
 * contagens apagadas vão em `opcoes.contagens` (lista preenchida aqui), se passada.
 */
export async function podar(cliente, cfg, { agora = Date.now(), simular = false, preservar = [], contagens } = {}) {
  const itens = await cliente.listar(cfg.prefixo);
  const chaves = itens.map((i) => i.chave);
  const alvos = selecionarExpirados(chaves, { prefixo: cfg.prefixo, agora, dias: cfg.dias }).filter((c) => !preservar.includes(c));
  const irmas = selecionarContagensExpiradas(chaves, { prefixo: cfg.prefixo, agora, dias: cfg.dias, removidos: alvos }).filter(
    (c) => !preservar.some((p) => p.endsWith('.dump') && chaveDaContagem(p) === c),
  );
  if (!simular) for (const chave of [...alvos, ...irmas]) await cliente.remover(chave);
  if (Array.isArray(contagens)) contagens.push(...irmas);
  return alvos;
}

/**
 * Grava a contagem do momento do dump (saída do contagem.sql, texto) como objeto irmão do dump de mesmo carimbo, com o
 * sha256 nos metadados; confere o tamanho (HEAD). Recusa o que não parece a saída do contagem.sql.
 */
export async function enviarContagem(cliente, cfg, entrada, { agora }) {
  if (!(agora instanceof Date)) throw new Error('[backup] enviar-contagem precisa do --carimbo do dump');
  const partes = [];
  let bytes = 0;
  for await (const parte of entrada) {
    bytes += parte.length;
    if (bytes > LIMITE_CONTAGEM) throw new Error(`[backup] contagem com mais de ${LIMITE_CONTAGEM} bytes: não é a saída do contagem.sql`);
    partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte));
  }
  const corpo = Buffer.concat(partes);
  if (!/^linhas\|/m.test(corpo.toString('utf8'))) throw new Error('[backup] a entrada não é a saída do contagem.sql (sem linhas "linhas|"); nada foi enviado');
  const sha256 = createHash('sha256').update(corpo).digest('hex');
  const chave = chaveDaContagem(chaveDoBackup(cfg.prefixo, cfg.banco, agora));
  await cliente.gravar(chave, corpo, { tamanho: corpo.length, hashCorpo: sha256, metadados: { sha256 } });
  const info = await cliente.info(chave);
  if (!info || info.tamanho !== corpo.length) throw new Error(`[backup] conferência falhou: o bucket tem ${info?.tamanho ?? 'nada'} bytes em ${chave}, enviados ${corpo.length}`);
  return { chave, bytes: corpo.length, sha256 };
}

/** Chave do dump: `ultimo` = o mais novo do prefixo; senão confere que é uma chave de backup deste prefixo. */
export async function resolverBackup(cliente, cfg, qual) {
  if (qual === 'ultimo') {
    const chave = maisNovo((await cliente.listar(cfg.prefixo)).map((i) => i.chave), cfg.prefixo);
    if (!chave) throw new Error(`[backup] nenhum backup em ${cfg.prefixo}`);
    return chave;
  }
  if (instanteDoBackup(qual, cfg.prefixo) === null) throw new Error(`[backup] chave fora do padrão ${cfg.prefixo}<banco>-AAAAMMDDTHHMMSSZ.dump`);
  return qual;
}

/** Baixa a contagem irmã do dump `qual` (`ultimo` ou a chave) para `saida`, conferindo o sha256. Sem contagem = erro. */
export async function baixarContagem(cliente, cfg, qual, saida) {
  const chave = chaveDaContagem(await resolverBackup(cliente, cfg, qual));
  const res = await cliente.ler(chave);
  if (!res) throw new Error(`[backup] não existe a contagem ${chave} (backup feito sem contagem, como o da demo)`);
  const esperado = res.headers['x-amz-meta-sha256'];
  const partes = [];
  for await (const p of res) partes.push(p);
  const corpo = Buffer.concat(partes);
  const sha256 = createHash('sha256').update(corpo).digest('hex');
  if (esperado && esperado !== sha256) throw new Error(`[backup] sha256 não confere em ${chave}: a contagem baixada está corrompida`);
  await new Promise((ok, falha) => saida.write(corpo, (e) => (e ? falha(e) : ok())));
  return { chave, bytes: corpo.length, sha256, conferido: Boolean(esperado) };
}

/**
 * Envia um dump: copia a entrada para um arquivo temporário calculando sha256 e tamanho, recusa o que não for dump
 * custom do pg_dump (PGDMP), grava no bucket com o sha256 nos metadados, confere tamanho (HEAD) e só então poda.
 */
export async function enviarBackup(cliente, cfg, entrada, { agora = new Date() } = {}) {
  const pasta = await mkdtemp(join(tmpdir(), 'macuxi-backup-'));
  const arquivo = join(pasta, 'dump');
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    const contar = new Transform({
      transform(parte, _c, feito) {
        hash.update(parte);
        bytes += parte.length;
        feito(null, parte);
      },
    });
    await pipeline(entrada, contar, createWriteStream(arquivo, { mode: 0o600 }));
    const sha256 = hash.digest('hex');
    const inicio = Buffer.alloc(MAGICA_DUMP.length);
    const fd = await open(arquivo, 'r');
    try {
      await fd.read(inicio, 0, inicio.length, 0);
    } finally {
      await fd.close();
    }
    if (bytes < 64 || inicio.toString('latin1') !== MAGICA_DUMP) {
      throw new Error(`[backup] a entrada não é um dump custom do pg_dump (-Fc): ${bytes} bytes; nada foi enviado`);
    }
    const chave = chaveDoBackup(cfg.prefixo, cfg.banco, agora);
    await cliente.gravar(chave, createReadStream(arquivo), { tamanho: bytes, hashCorpo: sha256, metadados: { sha256 } });
    const info = await cliente.info(chave);
    if (!info || info.tamanho !== bytes) throw new Error(`[backup] conferência falhou: o bucket tem ${info?.tamanho ?? 'nada'} bytes em ${chave}, enviados ${bytes}`);
    const contagensRemovidas = [];
    const removidos = await podar(cliente, cfg, { agora: agora.getTime(), preservar: [chave], contagens: contagensRemovidas });
    return { chave, bytes, sha256, removidos, contagensRemovidas };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** Baixa um backup (`ultimo` ou a chave) para `saida`, conferindo o sha256 gravado no envio. Devolve { chave, bytes, sha256 }. */
export async function baixarBackup(cliente, cfg, qual, saida) {
  const chave = await resolverBackup(cliente, cfg, qual);
  const res = await cliente.ler(chave);
  if (!res) throw new Error(`[backup] não existe: ${chave}`);
  const esperado = res.headers['x-amz-meta-sha256'];
  const hash = createHash('sha256');
  let bytes = 0;
  const contar = new Transform({
    transform(parte, _c, feito) {
      hash.update(parte);
      bytes += parte.length;
      feito(null, parte);
    },
  });
  await pipeline(res, contar, saida);
  const sha256 = hash.digest('hex');
  if (esperado && esperado !== sha256) throw new Error(`[backup] sha256 não confere em ${chave}: o arquivo baixado está corrompido`);
  return { chave, bytes, sha256, conferido: Boolean(esperado) };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { simular: { type: 'boolean', default: false }, carimbo: { type: 'string' } },
  });
  const [comando, a1, a2] = positionals;
  const cfg = lerConfigBackup();
  const cliente = criarClienteS3(cfg.s3);
  const onde = `${new URL(cfg.s3.endpoint).host}/${cfg.s3.bucket}/${cfg.prefixo}`;
  switch (comando) {
    case 'enviar': {
      const entrada = a1 && a1 !== '-' ? createReadStream(a1) : process.stdin;
      const r = await enviarBackup(cliente, cfg, entrada, values.carimbo ? { agora: lerCarimbo(values.carimbo) } : {});
      log(`enviado ${r.chave} (${mb(r.bytes)}, sha256 ${r.sha256.slice(0, 12)}…) para ${onde}`);
      log(`retenção ${cfg.dias} dias: ${r.removidos.length ? `apagados ${r.removidos.join(', ')}` : 'nada a apagar'}${r.contagensRemovidas.length ? ` (e ${r.contagensRemovidas.length} contagem(ns))` : ''}`);
      return;
    }
    case 'enviar-contagem': {
      if (!values.carimbo) throw new Error('use: enviar-contagem --carimbo AAAAMMDDTHHMMSSZ [arquivo]');
      const entrada = a1 && a1 !== '-' ? createReadStream(a1) : process.stdin;
      const r = await enviarContagem(cliente, cfg, entrada, { agora: lerCarimbo(values.carimbo) });
      log(`contagem enviada ${r.chave} (${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}…) para ${onde}`);
      return;
    }
    case 'resolver': {
      if (!a1) throw new Error('use: resolver <ultimo|chave>');
      process.stdout.write(`${await resolverBackup(cliente, cfg, a1)}\n`);
      return;
    }
    case 'baixar-contagem': {
      if (!a1) throw new Error('use: baixar-contagem <ultimo|chave-do-dump> [arquivo]');
      const arquivo = a2 && a2 !== '-' ? a2 : null;
      const saida = arquivo ? createWriteStream(arquivo, { mode: 0o600 }) : process.stdout;
      const r = await baixarContagem(cliente, cfg, a1, saida);
      if (arquivo) await new Promise((ok, falha) => saida.end((e) => (e ? falha(e) : ok())));
      log(`contagem baixada ${r.chave} (${r.bytes} bytes; sha256 ${r.conferido ? 'conferido' : 'sem metadado para conferir'})`);
      return;
    }
    case 'baixar': {
      if (!a1) throw new Error('use: baixar <ultimo|chave> [arquivo]');
      const saida = a2 && a2 !== '-' ? createWriteStream(a2, { mode: 0o600 }) : process.stdout;
      const r = await baixarBackup(cliente, cfg, a1, saida);
      log(`baixado ${r.chave} (${mb(r.bytes)}; sha256 ${r.conferido ? 'conferido' : 'sem metadado para conferir'})`);
      if (a2 && a2 !== '-') log(`arquivo: ${resolve(a2)} (${mb((await stat(a2)).size)})`);
      return;
    }
    case 'listar': {
      const itens = (await cliente.listar(cfg.prefixo)).filter((i) => instanteDoBackup(i.chave, cfg.prefixo) !== null);
      itens.sort((x, y) => instanteDoBackup(x.chave, cfg.prefixo) - instanteDoBackup(y.chave, cfg.prefixo));
      log(`${itens.length} backup(s) em ${onde}`);
      for (const i of itens) process.stdout.write(`${i.chave}\t${i.tamanho}\n`);
      return;
    }
    case 'podar': {
      const contagens = [];
      const r = await podar(cliente, cfg, { simular: values.simular, contagens });
      log(`retenção ${cfg.dias} dias${values.simular ? ' (simulação)' : ''}: ${r.length ? r.join(', ') : 'nada a apagar'}${contagens.length ? ` (e ${contagens.length} contagem(ns))` : ''}`);
      return;
    }
    default:
      throw new Error(
        'comandos: enviar [arquivo] [--carimbo C] | enviar-contagem --carimbo C [arquivo] | resolver <ultimo|chave> | baixar <ultimo|chave> [arquivo] | baixar-contagem <ultimo|chave> [arquivo] | listar | podar [--simular]',
      );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    log(e.message.replace(/^\[backup\] /, ''));
    process.exitCode = 1;
  });
}
