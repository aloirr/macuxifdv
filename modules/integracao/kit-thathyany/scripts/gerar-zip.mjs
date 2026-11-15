#!/usr/bin/env node
/**
 * T-0174 — monta o zip do kit da thathyany (`macuxi-kit-thathyany-<versao>.zip` + `.sha256`) para o dono do produto baixar.
 *
 * Conteúdo (nenhum segredo, nenhum dado pessoal): Instalar-Thathyany.ps1, ROTEIRO.md, carga_csv.py, contrato.json, modelos/ (16 CSVs),
 * sql/ (criar-banco e os dois usuários), conector/conector.json e erp-via-api/ (o "ERP via API" do kit do piloto com os nomes da
 * thathyany, para a fase 2). O pacote do Conector NÃO vai no zip: na fase 1 ele é baixado pelo "Baixar o Conector" do portal.
 *
 * Uso: node modules/integracao/kit-thathyany/scripts/gerar-zip.mjs [--saida <dir>] [--versao <x.y.z>]
 * Antes, se o contrato mudou: pnpm --filter @macuxi/integracao exec tsx kit-thathyany/scripts/gerar.ts (o teste do kit acusa o atraso).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarZip } from '../../kit-piloto/scripts/zip.mjs';

const aqui = join(dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = join(aqui, '..', '..', '..');
const pilotoApi = join(aqui, '..', 'kit-piloto', 'erp-via-api');

export const VERSAO_KIT = '1.0.6';
export const ARQUIVOS_ERP_VIA_API = ['erp-via-api.mjs', 'executar.mjs', 'executar.ps1', 'Macuxi-Credencial.ps1', 'package.json'];

/** Trocas de nome do "ERP via API" do piloto para a thathyany (a mesma lógica, testada no kit do piloto). A ordem importa. */
export const TROCAS_ERP_VIA_API = [
  ['Macuxi.Piloto/', 'Macuxi.Thathyany/'],
  ['macuxi-erp-via-api-piloto', 'macuxi-erp-via-api-thathyany'],
  ['ERP via API do kit do piloto (Macuxi FDV): empresa teste Piloto API.', 'ERP via API do kit da thathyany (Macuxi FDV), fase 2.'],
  ['Instalar-Piloto.ps1', 'Instalar-Thathyany.ps1 -Fase API'],
  ['ERP_PILOTO', 'ERP_THATHYANY'],
  ['piloto-api', 'thathyany-api'],
  ['Piloto API', 'Thathyany API'],
  ['criarErpPiloto', 'criarErpLocal'],
  ['o dono do piloto', 'o dono do produto'],
  ['dono do piloto', 'dono do produto'],
  ['do kit do piloto', 'do kit da thathyany'],
  ['empresa teste ', 'empresa '],
];

/** Aplica as trocas e falha se sobrar nome do piloto que o kit da thathyany não pode levar (banco, credencial, origem). */
export function adaptarErpViaApi(nome, texto) {
  let saida = texto;
  for (const [de, para] of TROCAS_ERP_VIA_API) saida = saida.replaceAll(de, para);
  const sobra = /ERP_PILOTO|Piloto API|piloto-api|Macuxi\.Piloto|Instalar-Piloto/.exec(saida);
  if (sobra) throw new Error(`erp-via-api/${nome}: sobrou "${sobra[0]}" depois das trocas; ajuste TROCAS_ERP_VIA_API.`);
  return saida;
}

const doKit = (...p) => readFileSync(join(aqui, ...p));
const listar = (pasta, filtro) => readdirSync(join(aqui, pasta)).filter(filtro).sort();

/** Entradas do zip: [{ nome, dados }]. Sem escrita em disco; o teste confere a lista e o conteúdo. */
export function montarEntradas({ versao = VERSAO_KIT } = {}) {
  const texto = (nome, conteudo) => ({ nome, dados: Buffer.from(conteudo, 'utf8') });
  return [
    { nome: 'Instalar-Thathyany.ps1', dados: doKit('Instalar-Thathyany.ps1') },
    { nome: 'ROTEIRO.md', dados: doKit('ROTEIRO.md') },
    { nome: 'carga_csv.py', dados: doKit('carga_csv.py') },
    { nome: 'contrato.json', dados: doKit('contrato.json') },
    ...listar('modelos', (f) => f.endsWith('.csv')).map((f) => ({ nome: `modelos/${f}`, dados: doKit('modelos', f) })),
    ...listar('sql', (f) => f.endsWith('.sql')).map((f) => ({ nome: `sql/${f}`, dados: doKit('sql', f) })),
    { nome: 'conector/conector.json', dados: doKit('conector', 'conector.json') },
    { nome: 'erp-via-api/cliente-hub.mjs', dados: readFileSync(join(raizRepo, 'modules/integracao/docs/exemplos/node/cliente-hub.mjs')) },
    ...ARQUIVOS_ERP_VIA_API.map((f) => texto(`erp-via-api/${f}`, adaptarErpViaApi(f, readFileSync(join(pilotoApi, f), 'utf8')))),
    texto('VERSAO.txt', `Kit da thathyany Macuxi FDV ${versao}\n`),
  ];
}

export function gerarZip({ saida, versao = VERSAO_KIT }) {
  mkdirSync(saida, { recursive: true });
  const zip = criarZip(montarEntradas({ versao }));
  const destino = join(saida, `macuxi-kit-thathyany-${versao}.zip`);
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
  const { destino, sha } = gerarZip({ saida: arg('--saida') ?? join(raizRepo, 'dist', 'kit-thathyany'), versao: arg('--versao') ?? VERSAO_KIT });
  console.log(`Kit gerado: ${destino}\nSHA-256: ${sha}`);
}
