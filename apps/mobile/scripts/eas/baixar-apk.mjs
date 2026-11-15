#!/usr/bin/env node
/**
 * Baixa o APK de um build do EAS, salva como `<Campo-Oficial-vX.Y.Z>.apk` e (opcional) publica no bucket PRIVADO com
 * link temporário (T-0109). Na pasta apps/mobile:
 *
 *   node scripts/eas/baixar-apk.mjs <campo|gestao|ambos> oficial [--build <id>] [--pasta <dir>]
 *                                   [--publicar] [--validade-horas <h>]
 *
 *  - sem --build: o último build TERMINADO do perfil (eas build:list); com --build: aquele build (eas build:view),
 *    e a variante/canal vêm do perfil do próprio build (os dois posicionais ficam opcionais);
 *  - o nome usa a versão gravada NO BUILD (appVersion), não a do versao.json de agora;
 *  - --pasta: destino (padrão dist/apk, fora do git);
 *  - --publicar: envia ao bucket (PUT assinado) em `apk/build-<versionCode>/<nome>.apk` e imprime o link de download
 *    (GET assinado) válido por --validade-horas (padrão 72; máximo 168 = 7 dias).
 *
 * Bucket por variável de ambiente (no .env da raiz, nunca no repositório; rode com `node --env-file=../../.env ...`):
 *   MACUXI_APK_S3_ENDPOINT (https://...), MACUXI_APK_S3_REGIAO, MACUXI_APK_S3_BUCKET, MACUXI_APK_S3_CHAVE,
 *   MACUXI_APK_S3_SEGREDO. Os valores nunca são impressos; o link temporário é o único dado sensível na saída.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PASTA_APP, ehPrincipal, nomes, rodarEas } from './comum.mjs';

const s3 = await import('./s3-assinado.ts');

const USO =
  'uso: node scripts/eas/baixar-apk.mjs <campo|gestao|ambos> oficial [--build <id>] [--pasta <dir>] [--publicar] [--validade-horas <h>]';

/**
 * Opções da linha de comando (puro, para teste).
 * @param {string[]} argv
 */
export function opcoesDoDownload(argv) {
  const o = { alvos: /** @type {{ variante: 'campo' | 'gestao'; perfil: 'producao' }[]} */ ([]), build: null, pasta: 'dist/apk', publicar: false, validadeHoras: 72 };
  const posicionais = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`falta o valor de ${a}\n${USO}`);
      return v;
    };
    if (a === '--build') o.build = valor();
    else if (a === '--pasta') o.pasta = valor();
    else if (a === '--publicar') o.publicar = true;
    else if (a === '--validade-horas') {
      const h = Number(valor());
      if (!Number.isInteger(h) || h < 1 || h > 168) throw new Error('--validade-horas deve ser um inteiro de 1 a 168 (7 dias)');
      o.validadeHoras = h;
    } else if (a.startsWith('-')) throw new Error(`opção desconhecida: ${a}\n${USO}`);
    else posicionais.push(a);
  }
  if (posicionais.length === 0 && o.build) return o;
  if (posicionais.length !== 2) throw new Error(USO);
  const [varianteTexto, canalTexto] = posicionais;
  const ambos = ['ambos', 'todos'].includes(varianteTexto.trim().toLowerCase());
  if (ambos && o.build) throw new Error('--build é de um build só: não combine com "ambos"');
  o.alvos = (ambos ? ['campo', 'gestao'] : [varianteTexto]).map((v) => nomes.lerAlvo(v, canalTexto));
  return o;
}

/**
 * Do JSON do eas (build:view ou item do build:list) ao que o script precisa (puro, para teste).
 * @param {any} build
 * @param {{ variante: string; perfil: string } | null} esperado alvo pedido na linha de comando (confere o perfil)
 */
export function dadosDoBuild(build, esperado) {
  if (!build || typeof build !== 'object') throw new Error('o eas não devolveu o build');
  const perfilEas = String(build.buildProfile ?? '');
  const alvo = nomes.lerPerfilEas(perfilEas);
  if (!alvo) throw new Error(`o build ${build.id ?? '?'} é do perfil "${perfilEas}", que não é campo/gestao`);
  if (esperado && (esperado.variante !== alvo.variante || esperado.perfil !== alvo.perfil)) {
    throw new Error(`o build ${build.id ?? '?'} é do perfil ${perfilEas}, não de ${nomes.perfilEas(/** @type {any} */ (esperado.variante), /** @type {any} */ (esperado.perfil))}`);
  }
  if (build.status && String(build.status).toUpperCase() !== 'FINISHED') throw new Error(`o build ${build.id ?? '?'} não terminou (status ${build.status})`);
  const url = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl;
  if (!url) throw new Error(`o build ${build.id ?? '?'} não tem APK para baixar`);
  const versao = String(build.appVersion ?? '');
  const nomeApk = nomes.nomeDoApk(alvo.variante, alvo.perfil, versao);
  const nomeBuild = nomes.nomeDoBuild(alvo.variante, alvo.perfil, versao);
  const mensagem = typeof build.message === 'string' ? build.message.trim() : '';
  return {
    id: String(build.id ?? ''),
    url: String(url),
    versao,
    versionCode: build.appBuildVersion ?? null,
    perfilEas,
    nomeApk,
    // build feito sem o build.mjs (ou com versão trocada no meio): avisa, mas o arquivo segue o nome do build real
    avisoMensagem: mensagem && mensagem !== nomeBuild ? `a mensagem do build é "${mensagem}", o nome calculado é "${nomeBuild}"` : null,
  };
}

/** Configuração do bucket a partir do ambiente (puro). Erro listando SÓ os nomes que faltam, nunca valores. */
export function configDoBucket(env) {
  const nomesVar = ['MACUXI_APK_S3_ENDPOINT', 'MACUXI_APK_S3_REGIAO', 'MACUXI_APK_S3_BUCKET', 'MACUXI_APK_S3_CHAVE', 'MACUXI_APK_S3_SEGREDO'];
  const faltam = nomesVar.filter((n) => !env[n]?.trim());
  if (faltam.length) throw new Error(`para --publicar, defina no .env: ${faltam.join(', ')}`);
  return {
    endpoint: env.MACUXI_APK_S3_ENDPOINT.trim(),
    bucket: env.MACUXI_APK_S3_BUCKET.trim(),
    prefixo: env.MACUXI_APK_S3_PREFIXO?.trim() || 'apk',
    credenciais: { regiao: env.MACUXI_APK_S3_REGIAO.trim(), chave: env.MACUXI_APK_S3_CHAVE.trim(), segredo: env.MACUXI_APK_S3_SEGREDO.trim() },
  };
}

/**
 * URLs assinadas de envio (15 min) e de download (validade pedida, com o nome do arquivo no download) — puro.
 * @param {ReturnType<typeof configDoBucket>} bucket
 */
export function urlsDoBucket(bucket, nomeApk, versionCode, validadeHoras, agora) {
  const chave = s3.chaveDoApk(nomeApk, versionCode, bucket.prefixo);
  const alvo = s3.alvoNoBucket(bucket.endpoint, bucket.bucket, chave);
  const envio = s3.urlAssinada({ ...alvo, metodo: 'PUT', credenciais: bucket.credenciais, agora, expiraEm: 15 * 60 });
  const download = s3.urlAssinada({
    ...alvo,
    metodo: 'GET',
    credenciais: bucket.credenciais,
    agora,
    expiraEm: validadeHoras * 3600,
    consulta: { 'response-content-disposition': `attachment; filename="${nomeApk}"` },
  });
  return { chave, envio, download, expiraEm: new Date(agora.getTime() + validadeHoras * 3600 * 1000) };
}

function lerJsonDoEas(args) {
  const { codigo, saida } = rodarEas([...args, '--json', '--non-interactive'], { capturar: true });
  if (codigo !== 0) throw new Error(`eas ${args[0]} saiu com ${codigo}`);
  const inicio = saida.search(/[[{]/);
  if (inicio === -1) throw new Error(`eas ${args[0]} não devolveu JSON`);
  return JSON.parse(saida.slice(inicio));
}

async function baixarUm(opcoes, alvo, bucket) {
  const build = opcoes.build
    ? lerJsonDoEas(['build:view', opcoes.build])
    : lerJsonDoEas(['build:list', '--platform', 'android', '--build-profile', nomes.perfilEas(alvo.variante, alvo.perfil), '--status', 'finished', '--limit', '1'])[0];
  if (!build) throw new Error(`nenhum build terminado do perfil ${nomes.perfilEas(alvo.variante, alvo.perfil)}`);
  const d = dadosDoBuild(build, opcoes.build && opcoes.alvos.length === 0 ? null : alvo);
  if (d.avisoMensagem) console.warn(`⚠ ${d.avisoMensagem}`);

  console.log(`\n▶ ${d.nomeApk} (build ${d.id}, perfil ${d.perfilEas}, versionCode ${d.versionCode ?? '?'})`);
  const resp = await fetch(d.url);
  if (!resp.ok) throw new Error(`download do APK falhou: HTTP ${resp.status}`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  const pasta = resolve(PASTA_APP, opcoes.pasta);
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, d.nomeApk);
  writeFileSync(arquivo, bytes);
  console.log(`  salvo em ${arquivo} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);

  if (!bucket) return;
  const u = urlsDoBucket(bucket, d.nomeApk, d.versionCode, opcoes.validadeHoras, new Date());
  const envio = await fetch(u.envio, { method: 'PUT', body: readFileSync(arquivo), headers: { 'content-type': 'application/vnd.android.package-archive' } });
  if (!envio.ok) throw new Error(`envio ao bucket falhou: HTTP ${envio.status}`);
  console.log(`  publicado em ${bucket.bucket}/${u.chave}`);
  console.log(`  link temporário (vale até ${u.expiraEm.toISOString()}):\n  ${u.download}`);
}

async function principal() {
  let opcoes;
  let bucket = null;
  try {
    opcoes = opcoesDoDownload(process.argv.slice(2));
    if (opcoes.publicar) bucket = configDoBucket(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const alvos = opcoes.alvos.length ? opcoes.alvos : [null];
  for (const alvo of alvos) {
    try {
      await baixarUm(opcoes, alvo, bucket);
    } catch (e) {
      console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }
}

if (ehPrincipal(import.meta.url)) await principal();
