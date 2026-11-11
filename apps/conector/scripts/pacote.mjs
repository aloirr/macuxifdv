#!/usr/bin/env node
/**
 * Monta o pacote win-x64 do Conector: conector-<versão>.zip com conector.mjs, node.exe portátil, WinSW-x64.exe, exemplos/ e
 * LEIA-ME.txt; grava o .sha256 e, quando há chave de assinatura, o .sig (RSA 3072 + SHA-256, PKCS#1 v1.5, igual ao
 * docs/modulos/integracao/conector.md §7.4). Sem dependências: zip escrito/lido aqui (zlib + crc32 do Node).
 *
 * Binários de terceiros: versão FIXA e SHA-256 FIXO abaixo, conferidos depois do download (falha fechada). Para subir a versão do
 * Node, troque NODE_VERSAO + NODE_ZIP_SHA256 (vem do SHASUMS256.txt de nodejs.org/dist/vX); para o WinSW, WINSW_VERSAO + WINSW_SHA256.
 *
 * Uso: pnpm --filter @macuxi/conector build && node apps/conector/scripts/pacote.mjs [--saida <dir>] [--cache <dir>]
 * Assinatura: variável MACUXI_ASSINATURA_CHAVE_PEM (conteúdo da chave, só nos secrets do CI) ou --chave <arquivo>; nunca é impressa.
 * Sem chave, o .sig não é gerado (aviso). A publicação no bucket é do CI (pnpm --filter api publicar-pacote conector <zip> --versao X).
 */
import { createHash, createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export const NODE_VERSAO = '24.21.0';
export const NODE_ZIP_SHA256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
export const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSAO}/node-v${NODE_VERSAO}-win-x64.zip`;
export const WINSW_VERSAO = '2.12.0';
export const WINSW_SHA256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';
export const WINSW_URL = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSAO}/WinSW-x64.exe`;

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Confere o SHA-256; qualquer diferença aborta (falha fechada). */
export function conferirSha256(buf, esperado, nome) {
  const obtido = sha256(buf);
  if (obtido !== esperado) throw new Error(`SHA-256 de ${nome} não confere (esperado ${esperado}, obtido ${obtido}). Pacote não montado.`);
}

/** Zip mínimo (deflate, sem zip64, nomes UTF-8). entradas: [{ nome, dados: Buffer }]. */
export function criarZip(entradas) {
  const partes = [];
  const central = [];
  let deslocamento = 0;
  const dataDos = 0x5a21; // 2025-01-01: data fixa mantém o zip reprodutível
  for (const { nome, dados } of entradas) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comp = deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dataDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    partes.push(local, nomeBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(dataDos, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(nomeBuf.length, 28);
    c.writeUInt32LE(deslocamento, 42);
    central.push(c, nomeBuf);
    deslocamento += 30 + nomeBuf.length + comp.length;
  }
  const dirCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dirCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, dirCentral, fim]);
}

/** Lê um zip (deflate/stored, sem zip64) e devolve [{ nome, dados }]. */
export function lerZip(zip) {
  let fim = zip.length - 22;
  while (fim >= 0 && zip.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('Zip inválido (fim do diretório central não encontrado).');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida = [];
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip inválido (diretório central).');
    const metodo = zip.readUInt16LE(p + 10);
    const tamComp = zip.readUInt32LE(p + 20);
    const tamNome = zip.readUInt16LE(p + 28);
    const tamExtra = zip.readUInt16LE(p + 30);
    const tamCom = zip.readUInt16LE(p + 32);
    const posLocal = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + tamNome).toString('utf8');
    const inicio = posLocal + 30 + zip.readUInt16LE(posLocal + 26) + zip.readUInt16LE(posLocal + 28);
    const bruto = zip.subarray(inicio, inicio + tamComp);
    if (!nome.endsWith('/')) saida.push({ nome, dados: metodo === 0 ? Buffer.from(bruto) : inflateRawSync(bruto) });
    p += 46 + tamNome + tamExtra + tamCom;
  }
  return saida;
}

async function baixar(url, nome) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download de ${nome} falhou: HTTP ${r.status}.`);
  return Buffer.from(await r.arrayBuffer());
}

/** Obtém um binário de terceiro: usa o cache se o hash bater, senão baixa e confere. */
export async function obterTerceiro({ url, sha, nome, cache, baixarFn = baixar }) {
  const arq = join(cache, basename(new URL(url).pathname));
  if (existsSync(arq)) {
    const buf = readFileSync(arq);
    if (sha256(buf) === sha) return buf;
  }
  const buf = await baixarFn(url, nome);
  conferirSha256(buf, sha, nome);
  mkdirSync(cache, { recursive: true });
  writeFileSync(arq, buf);
  return buf;
}

export function leiaMe(versao) {
  return `Macuxi Conector ${versao} (Windows x64)

ANTES DE INSTALAR: confira o SHA-256 (conector-${versao}.zip.sha256) e a assinatura (.sig) do pacote.
Passo a passo: docs/modulos/integracao/conector.md, secoes 3, 7.2 e 7.4 (PowerShell, sem instalar nada).

1. Descompacte em C:\\ProgramData\\Macuxi\\Conector\\.
2. Copie exemplos\\conector.exemplo.json para conector.json e preencha tenant, URL do Hub, credencial e conexao com o ERP.
3. PowerShell como administrador, na pasta do Conector:
   .\\node.exe conector.mjs validar --config conector.json
   .\\node.exe conector.mjs instalar-servico --winsw .\\WinSW-x64.exe --config conector.json
4. O servico "Macuxi Conector" inicia sozinho. Logs na pasta logs\\.

O node.exe (Node ${NODE_VERSAO}) e o WinSW ${WINSW_VERSAO} vao no pacote: nao e preciso instalar Node no servidor.
`;
}

/** Monta o pacote em memória (sem rede): recebe os binários já conferidos. */
export function montarEntradas({ versao, conector, nodeExe, winsw, exemplos }) {
  return [
    { nome: 'conector.mjs', dados: conector },
    { nome: 'node.exe', dados: nodeExe },
    { nome: 'WinSW-x64.exe', dados: winsw },
    ...exemplos.map((e) => ({ nome: `exemplos/${e.nome}`, dados: e.dados })),
    { nome: 'LEIA-ME.txt', dados: Buffer.from(leiaMe(versao), 'utf8') },
  ];
}

export function assinar(zip, chavePem) {
  return createSign('RSA-SHA256').update(zip).sign(chavePem);
}

export async function montarPacote({ saida, cache, chavePem, baixarFn }) {
  const versao = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
  const caminhoConector = join(raiz, 'dist/conector.mjs');
  if (!existsSync(caminhoConector)) throw new Error('dist/conector.mjs não existe: rode "pnpm --filter @macuxi/conector build" antes.');
  const zipNode = await obterTerceiro({ url: NODE_ZIP_URL, sha: NODE_ZIP_SHA256, nome: `Node ${NODE_VERSAO}`, cache, baixarFn });
  const nodeExe = lerZip(zipNode).find((e) => e.nome === `node-v${NODE_VERSAO}-win-x64/node.exe`);
  if (!nodeExe) throw new Error('node.exe não encontrado no zip do Node.');
  const winsw = await obterTerceiro({ url: WINSW_URL, sha: WINSW_SHA256, nome: `WinSW ${WINSW_VERSAO}`, cache, baixarFn });
  const dirEx = join(raiz, 'exemplos');
  const exemplos = readdirSync(dirEx).sort().map((nome) => ({ nome, dados: readFileSync(join(dirEx, nome)) }));
  const zip = criarZip(montarEntradas({ versao, conector: readFileSync(caminhoConector), nodeExe: nodeExe.dados, winsw, exemplos }));
  mkdirSync(saida, { recursive: true });
  const arquivo = `conector-${versao}.zip`;
  const caminho = join(saida, arquivo);
  writeFileSync(caminho, zip);
  writeFileSync(`${caminho}.sha256`, `${sha256(zip)}  ${arquivo}\n`);
  if (chavePem) writeFileSync(`${caminho}.sig`, assinar(zip, chavePem));
  return { caminho, versao, sha256: sha256(zip), assinado: Boolean(chavePem) };
}

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chaveArq = arg('--chave');
  const chavePem = process.env.MACUXI_ASSINATURA_CHAVE_PEM || (chaveArq ? readFileSync(chaveArq, 'utf8') : undefined);
  const r = await montarPacote({ saida: arg('--saida') ?? join(raiz, 'dist/pacote'), cache: arg('--cache') ?? join(raiz, 'dist/.cache-terceiros'), chavePem });
  console.log(`Pacote: ${r.caminho}\nSHA-256: ${r.sha256}\nAssinatura: ${r.assinado ? 'gerada (.sig)' : 'NÃO gerada (sem chave); publique só depois de assinar'}`);
}
