#!/usr/bin/env node
/**
 * T-0162 — monta o .zip do kit do piloto (`macuxi-kit-piloto-<versao>.zip`) para o dono do produto baixar pelo navegador.
 *
 * Conteúdo do zip (nenhum segredo): Instalar-Piloto.ps1, ROTEIRO.md, dados-exemplo.json, sql/ (01 a 04), erp-via-api/ (com o
 * cliente-hub.mjs oficial), conector/conector.json (gerado do conector.exemplo.json) e, se informado, o pacote do Conector.
 *
 * Uso: node modules/integracao/kit-piloto/scripts/montar-kit.mjs [--saida <dir>] [--conector <conector-x.y.z.zip>] [--versao <x.y.z>]
 * Sem --conector o instalador avisa e pula a modalidade Conector (o zip do Conector sai de apps/conector/scripts/pacote.mjs).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarZip } from './zip.mjs';

const aqui = join(dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = join(aqui, '..', '..', '..');

export const VERSAO_KIT = '1.0.0';
export const HUB_URL_PILOTO = 'https://api.macuxifdv.com.br';
export const ID_CONECTOR_PILOTO = 'piloto-conector';
export const ID_API_PILOTO = 'piloto-api';
export const ENTIDADES_PILOTO = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'preco', 'estoque', 'cliente', 'titulo'];

/** conector.json do piloto: o exemplo oficial, só com as entidades do kit, apontando para o Hub e para a ERP_PILOTO. Sem segredo. */
export function gerarConectorJson(exemplo) {
  const cfg = structuredClone(exemplo);
  cfg.hub = { ...cfg.hub, conectorId: ID_CONECTOR_PILOTO, url: HUB_URL_PILOTO };
  cfg.erp = { tipo: 'sqlserver', host: '127.0.0.1', porta: 1433, banco: 'ERP_PILOTO', usuario: 'macuxi_conector', criptografar: true, confiarCertificado: true };
  cfg.entidades = Object.fromEntries(
    ENTIDADES_PILOTO.map((e) => {
      if (!exemplo.entidades[e]) throw new Error(`conector.exemplo.json não tem a entidade ${e}.`);
      return [e, { ...exemplo.entidades[e], periodicidadeSegundos: 120 }];
    }),
  );
  cfg.pedidos = { ...cfg.pedidos, consultaSegundos: 30, statusSegundos: 60 };
  return cfg;
}

/** Torna o db/conector/entrada-pedido-modelo.sql repetível: CREATE TABLE guardado por OBJECT_ID e CREATE OR ALTER PROCEDURE. Corpo intacto. */
export function tornarIdempotente(sqlModelo) {
  let tabelas = 0;
  const comGuarda = sqlModelo.replace(/^CREATE TABLE (dbo\.\w+) \(/gm, (_, nome) => {
    tabelas += 1;
    return `IF OBJECT_ID('${nome}', 'U') IS NULL\nCREATE TABLE ${nome} (`;
  });
  const saida = comGuarda.replace(/^CREATE PROCEDURE /gm, 'CREATE OR ALTER PROCEDURE ');
  if (tabelas !== 2 || !saida.includes('CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_inserir')) {
    throw new Error('entrada-pedido-modelo.sql mudou de forma: ajuste tornarIdempotente (esperava 2 tabelas e as procedures).');
  }
  return saida;
}

const lerTexto = (...partes) => readFileSync(join(...partes), 'utf8');
const doKit = (...partes) => readFileSync(join(aqui, ...partes));

/** Entradas do zip: [{ nome, dados }]. Sem I/O de escrita; os testes conferem a lista. */
export function montarEntradas({ conectorZip, versao = VERSAO_KIT } = {}) {
  const exemplo = JSON.parse(lerTexto(raizRepo, 'apps', 'conector', 'exemplos', 'conector.exemplo.json'));
  const entradaPedido = tornarIdempotente(lerTexto(raizRepo, 'db', 'conector', 'entrada-pedido-modelo.sql'));
  const texto = (nome, conteudo) => ({ nome, dados: Buffer.from(conteudo, 'utf8') });
  const entradas = [
    { nome: 'Instalar-Piloto.ps1', dados: doKit('Instalar-Piloto.ps1') },
    { nome: 'ROTEIRO.md', dados: doKit('ROTEIRO.md') },
    { nome: 'dados-exemplo.json', dados: doKit('dados-exemplo.json') },
    ...readdirSync(join(aqui, 'sql')).sort().map((f) => ({ nome: `sql/${f}`, dados: doKit('sql', f) })),
    texto('sql/02-entrada-pedido.sql', entradaPedido),
    texto('conector/conector.json', `${JSON.stringify(gerarConectorJson(exemplo), null, 2)}\n`),
    { nome: 'erp-via-api/cliente-hub.mjs', dados: readFileSync(join(raizRepo, 'modules/integracao/docs/exemplos/node/cliente-hub.mjs')) },
    ...['erp-via-api.mjs', 'executar.mjs', 'executar.ps1', 'Macuxi-Credencial.ps1', 'package.json'].map((f) => ({ nome: `erp-via-api/${f}`, dados: doKit('erp-via-api', f) })),
    texto('VERSAO.txt', `Kit do piloto Macuxi FDV ${versao}\n`),
  ];
  if (conectorZip) entradas.push({ nome: basename(conectorZip), dados: readFileSync(conectorZip) });
  // Nomes únicos (a 02 não pode aparecer duas vezes: o arquivo da pasta sql/ é só um marcador, se existir).
  return [...new Map(entradas.map((e) => [e.nome, e])).values()];
}

export function montarKit({ saida, conectorZip, versao = VERSAO_KIT }) {
  mkdirSync(saida, { recursive: true });
  const zip = criarZip(montarEntradas({ conectorZip, versao }));
  const destino = join(saida, `macuxi-kit-piloto-${versao}.zip`);
  writeFileSync(destino, zip);
  const sha = createHash('sha256').update(zip).digest('hex');
  writeFileSync(`${destino}.sha256`, `${sha}  ${basename(destino)}\n`);
  return { destino, sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (nome) => {
    const i = process.argv.indexOf(nome);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const conectorZip = arg('--conector');
  if (conectorZip && !existsSync(conectorZip)) throw new Error(`Pacote do Conector não encontrado: ${conectorZip}`);
  const { destino, sha } = montarKit({ saida: arg('--saida') ?? join(raizRepo, 'dist-kit-piloto'), conectorZip, versao: arg('--versao') ?? VERSAO_KIT });
  console.log(`Kit gerado: ${destino}\nSHA-256: ${sha}`);
}
