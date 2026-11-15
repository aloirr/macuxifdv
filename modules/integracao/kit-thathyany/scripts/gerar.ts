/**
 * T-0174 — kit da thathyany: gera os artefatos derivados do contrato canônico, para o kit nunca divergir dele.
 *   contrato.json          regras por entidade e coluna (o carga_csv.py lê; vem de dicionarioDaEntidade, o mesmo dicionário do BKO)
 *   modelos/<entidade>.csv cabeçalho + uma linha fictícia por entidade, na ordem de carga
 *   sql/criar-banco.sql    banco ERP_THATHYANY, tabelas tha_*, views vw_macuxi_*, entrada de pedidos e retorno (sem usuários)
 *   conector/conector.json conector.exemplo.json com as 16 entidades apontando para a API e para o banco local
 * Uso: pnpm --filter @macuxi/integracao exec tsx kit-thathyany/scripts/gerar.ts   (o teste do kit confere que nada ficou velho)
 * Nenhum segredo e nenhum dado pessoal: as linhas dos modelos são fictícias.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENTIDADES_ORDEM_CARGA, dicionarioDaEntidade, gerarModeloCsv } from '../../domain/modelos-csv';
import type { CampoDicionario } from '../../contracts/modelos';

export const BANCO = 'ERP_THATHYANY';
export const HUB_URL = 'https://api.macuxifdv.com.br';
export const ID_CONECTOR = 'thathyany-conector';
export const ORIGEM_CONECTOR = 'Thathyany Conector';
export const ORIGEM_API = 'Thathyany API';

const aqui = join(dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = join(aqui, '..', '..', '..');
const lerRepo = (...p: string[]): string => readFileSync(join(raizRepo, ...p), 'utf8');

export const tabelaDe = (entidade: string): string => `tha_${entidade}`;
export const colunaDe = (campo: string): string => campo.replace(/\./g, '_');

/** Colunas que só o Conector manda (JSON): não existem no CSV, ficam nulas (= o Macuxi não altera). */
const COLUNAS_SO_CONECTOR = ['contatos', 'referencias', 'oferece_junto', 'etiquetas', 'paradas'];

/** Referência a outra entidade (campo `*_external_id`): o carga_csv.py confere antes de gravar. Tabela e depósito não são entidades. */
const REFERENCIAS: Record<string, string> = {
  vendedor_external_id: 'vendedor',
  filial_external_id: 'filial',
  catalogo_no_external_id: 'catalogo_no',
  pai_external_id: 'catalogo_no',
  produto_external_id: 'produto',
  forma_external_id: 'forma_pagamento',
  cliente_external_id: 'cliente',
};

/** Ajustes finos dos exemplos (coerência entre arquivos); o resto vem do gerador de modelos do BKO. */
const EXEMPLOS = {
  'cliente.tabela_preco_external_id': ['TAB-01', 'TAB-01'],
  'cliente.canal': ['Varejo', 'Varejo'],
  'prazo_pagamento.forma_external_id': ['FPG-001', 'FPG-001'],
  'produto.aplicacao': ['', ''],
  'cliente.latitude': ['', ''],
  'cliente.longitude': ['', ''],
} as const;

export interface Regra {
  /** número inteiro? (só para tipo número) */
  inteiro?: boolean;
  min?: number;
  max?: number;
  opcoes?: string[];
  /** quantidades de dígitos aceitas (ean, documento) */
  digitos?: number[];
  /** letras maiúsculas: [min, max] */
  letras?: [number, number];
  uf?: boolean;
  uuid?: boolean;
  tamanho_exato?: number;
  lista?: { item: 'numero' | 'texto'; min_itens: number; max_itens: number; min?: number; max?: number; tamanho_item?: number; nao_decrescente?: boolean };
}

/** Traduz o texto de formato do dicionário em regra de máquina. Formato desconhecido falha de propósito: o contrato mudou, revise o kit. */
export function regraDoCampo(c: CampoDicionario): Regra {
  const f = c.formato;
  const regra: Regra = {};
  if (f === null || f.startsWith('AAAA-MM-DD') || f === 'sim ou não' || f.startsWith('número (decimal')) {
    if (c.tipo === 'número') regra.inteiro = false;
    return regra;
  }
  let m: RegExpExecArray | null;
  if (f === 'padrão ^[A-Z]{2}$') return { uf: true };
  if (f === 'exatamente 2 caracteres') return { uf: true };
  if ((m = /^inteiro de (-?\d+) a (-?\d+)$/.exec(f))) return { inteiro: true, min: Number(m[1]), max: Number(m[2]) };
  if ((m = /^inteiro maior ou igual a (\d+)$/.exec(f))) return { inteiro: true, min: Number(m[1]) };
  if (f === 'inteiro') return { inteiro: true };
  if ((m = /^número de (-?\d+) a (-?\d+)$/.exec(f))) return { inteiro: false, min: Number(m[1]), max: Number(m[2]) };
  if (f.startsWith('centavos inteiros')) return { inteiro: true, min: 0 };
  if (f === '8, 12, 13 ou 14 dígitos') return { digitos: [8, 12, 13, 14] };
  if (f === '14 dígitos') return { digitos: [14] };
  if (f === '1 a 4 letras maiúsculas') return { letras: [1, 4] };
  if (f.startsWith('UUID')) return { uuid: true };
  if (f.startsWith('uma destas opções: ')) return { opcoes: f.slice('uma destas opções: '.length).split(', ') };
  if ((m = /^lista de números inteiros separados por \/ \(ex\.: [\d/]+\), cada um de (\d+) a (\d+), no mínimo (\d+) e até (\d+) itens$/.exec(f))) {
    return { lista: { item: 'numero', min: Number(m[1]), max: Number(m[2]), min_itens: Number(m[3]), max_itens: Number(m[4]), nao_decrescente: true } };
  }
  if ((m = /^lista de códigos separados por \/ \(ex\.: [A-Z/]+\), cada um com até (\d+) caracteres, até (\d+) itens$/.exec(f))) {
    return { lista: { item: 'texto', tamanho_item: Number(m[1]), min_itens: 1, max_itens: Number(m[2]) } };
  }
  throw new Error(`Formato sem regra no kit da thathyany: "${f}" (${c.campo}). Atualize regraDoCampo em kit-thathyany/scripts/gerar.ts.`);
}

type Exemplos = Record<string, readonly [string, string]>;

function dicionario(entidade: (typeof ENTIDADES_ORDEM_CARGA)[number]) {
  return dicionarioDaEntidade(entidade);
}

/** Colunas do SELECT do conector.exemplo.json por entidade: a lista que cada view precisa devolver, na ordem. */
function colunasDoConector(exemplo: ConectorExemplo, entidade: string): string[] {
  const consulta = exemplo.entidades[entidade]?.consulta ?? '';
  const m = /^SELECT TOP \(:limite\) (.*?) FROM dbo\.vw_macuxi_\w+ WHERE/.exec(consulta);
  if (!m) throw new Error(`conector.exemplo.json: consulta da entidade ${entidade} fora do formato esperado.`);
  return (m[1] as string).split(',').map((s) => s.trim());
}

interface ConectorExemplo {
  hub: Record<string, unknown>;
  erp: Record<string, unknown>;
  pedidos: Record<string, unknown>;
  entidades: Record<string, { consulta: string; periodicidadeSegundos?: number } & Record<string, unknown>>;
  [k: string]: unknown;
}
const lerExemplo = (): ConectorExemplo => JSON.parse(lerRepo('apps', 'conector', 'exemplos', 'conector.exemplo.json')) as ConectorExemplo;

export function tipoSql(c: CampoDicionario, regra: Regra): string {
  if (c.campo === 'external_id') return 'VARCHAR(200) NOT NULL';
  const nulo = c.obrigatorio ? 'NOT NULL' : 'NULL';
  switch (c.tipo) {
    case 'texto': {
      const n = c.tamanho_max ?? (regra.uf ? 2 : 200);
      return `NVARCHAR(${n > 4000 ? 'MAX' : n}) ${nulo}`;
    }
    case 'número':
      return `${regra.inteiro ? 'INT' : 'DECIMAL(18, 6)'} ${nulo}`;
    case 'centavos':
      return `DECIMAL(19, 0) ${nulo}`;
    case 'sim/não':
      return c.campo === 'ativo' ? 'TINYINT NOT NULL CONSTRAINT {df_ativo} DEFAULT 1' : 'TINYINT NULL';
    case 'data':
      return `DATE ${nulo}`;
    case 'data-hora':
      return c.campo === 'alterado_em' ? 'DATETIME2(3) NOT NULL' : `DATETIME2(3) ${nulo}`;
    case 'enum':
      return `NVARCHAR(40) ${nulo}`;
    case 'lista de números':
    case 'lista de textos':
      return `NVARCHAR(MAX) ${nulo}`;
  }
}

export interface CampoContrato extends CampoDicionario {
  coluna: string;
  tipo_sql: string;
  regra: Regra;
  referencia?: string;
}
export interface EntidadeContrato {
  entidade: string;
  ordem: number;
  depende_de: string[];
  opcional: boolean;
  tabela: string;
  campos: CampoContrato[];
  colunas_so_conector: string[];
}

export function contratoDoKit(): { versao: number; banco: string; entidades: EntidadeContrato[] } {
  const exemplo = lerExemplo();
  const entidades = ENTIDADES_ORDEM_CARGA.map((e): EntidadeContrato => {
    const d = dicionario(e);
    const campos = d.campos.map((c): CampoContrato => {
      const regra = regraDoCampo(c);
      const ref = REFERENCIAS[c.campo];
      return { ...c, coluna: colunaDe(c.campo), tipo_sql: tipoSql(c, regra), regra, ...(ref ? { referencia: ref } : {}) };
    });
    const extras = colunasDoConector(exemplo, e).filter((col) => COLUNAS_SO_CONECTOR.includes(col));
    const faltando = colunasDoConector(exemplo, e).filter((col) => !campos.some((c) => c.coluna === col) && !extras.includes(col));
    if (faltando.length > 0) throw new Error(`conector.exemplo.json pede colunas fora do contrato em ${e}: ${faltando.join(', ')}.`);
    return { entidade: e, ordem: d.ordem, depende_de: d.depende_de, opcional: d.opcional, tabela: tabelaDe(e), campos, colunas_so_conector: extras };
  });
  return { versao: 1, banco: BANCO, entidades };
}

export function modelosCsv(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const e of ENTIDADES_ORDEM_CARGA) {
    const { csv } = gerarModeloCsv(e, undefined, EXEMPLOS as unknown as Exemplos);
    // BOM + cabeçalho + 1ª linha (a 2ª linha do gerador do BKO não entra: "uma linha fictícia por entidade").
    const linhas = csv.split('\r\n');
    saida[`${e}.csv`] = `${linhas[0]}\r\n${linhas[1]}\r\n`;
  }
  return saida;
}

/** `CREATE TABLE` de uma entidade (idempotente). */
function sqlTabela(ent: EntidadeContrato): string {
  const t = ent.tabela;
  const linhas = ent.campos.map((c) => `    ${c.coluna} ${c.tipo_sql.replace('{df_ativo}', `df_${t}_ativo`)}`);
  for (const extra of ent.colunas_so_conector) linhas.push(`    ${extra} NVARCHAR(MAX) NULL`);
  linhas.push('    linha_hash CHAR(64) NULL');
  linhas.push(`    CONSTRAINT pk_${t} PRIMARY KEY (external_id)`);
  return `IF OBJECT_ID('dbo.${t}', 'U') IS NULL\nCREATE TABLE dbo.${t} (\n${linhas.join(',\n')});\nGO\nIF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_${t}_alterado' AND object_id = OBJECT_ID('dbo.${t}'))\nCREATE INDEX ix_${t}_alterado ON dbo.${t} (alterado_em, external_id);\nGO`;
}

/** View vw_macuxi_<entidade>: as colunas do SELECT do conector.exemplo.json (nomes do contrato; data civil como texto AAAA-MM-DD; horário já em UTC). */
function sqlView(ent: EntidadeContrato, colunas: string[]): string {
  const itens = colunas.map((col) => {
    const campo = ent.campos.find((c) => c.coluna === col);
    return campo?.tipo === 'data' ? `CONVERT(CHAR(10), ${col}, 23) AS ${col}` : col;
  });
  return `CREATE OR ALTER VIEW dbo.vw_macuxi_${ent.entidade} AS\nSELECT ${itens.join(', ')}\nFROM dbo.${ent.tabela};\nGO`;
}

/** Torna o db/conector/entrada-pedido-modelo.sql repetível (mesma regra do kit do piloto): CREATE TABLE guardado e CREATE OR ALTER PROCEDURE. */
export function tornarIdempotente(sqlModelo: string): string {
  let tabelas = 0;
  const comGuarda = sqlModelo.replace(/^CREATE TABLE (dbo\.\w+) \(/gm, (_m, nome: string) => {
    tabelas += 1;
    return `IF OBJECT_ID('${nome}', 'U') IS NULL\nCREATE TABLE ${nome} (`;
  });
  const saida = comGuarda.replace(/^CREATE PROCEDURE /gm, 'CREATE OR ALTER PROCEDURE ');
  if (tabelas !== 2 || !saida.includes('CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_inserir')) {
    throw new Error('entrada-pedido-modelo.sql mudou de forma: ajuste tornarIdempotente (esperava 2 tabelas e as procedures).');
  }
  return saida;
}

/** Complementos do retorno do pedido: o 03 do kit do piloto, com os nomes da thathyany. */
export function extensaoPedido(): string {
  const base = readFileSync(join(aqui, '..', 'kit-piloto', 'sql', '03-pedido-extensao.sql'), 'utf8');
  return base
    .replaceAll("'Piloto Conector'", `'${ORIGEM_CONECTOR}'`)
    .replaceAll('ERP_PILOTO', BANCO)
    .replaceAll('vw_piloto_pedidos', 'vw_thathyany_pedidos')
    .replaceAll('Kit do piloto (T-0162)', 'Kit da thathyany (T-0174)')
    .replaceAll('dono do piloto', 'dono do produto')
    .replaceAll('o dono do piloto', 'o dono do produto')
    .replaceAll('Conferência do dono do produto', 'Conferência do teste')
    .replaceAll('Piloto API', ORIGEM_API)
    .replaceAll('empresa teste', 'empresa');
}

export function sqlCriarBanco(): string {
  const contrato = contratoDoKit();
  const exemplo = lerExemplo();
  const partes: string[] = [
    `-- =====================================================================================================================
-- Macuxi FDV — kit da thathyany (T-0174): banco local ${BANCO} para o SQL Server Express. GERADO por kit-thathyany/scripts/gerar.ts: não edite.
-- Roda quantas vezes precisar (idempotente). Cria o banco, as tabelas ${'tha_*'} (as colunas são os campos do contrato canônico),
-- as views vw_macuxi_* que o Conector lê (mesmos nomes e colunas de db/conector/views-modelo.sql; os horários já estão em UTC, a variante
-- "coluna do ERP já está em UTC" do modelo), a entrada de pedidos (db/conector/entrada-pedido-modelo.sql) e as views do retorno do pedido.
-- Os usuários restritos vêm em sql/usuario-conector.sql e sql/usuario-api.sql (senha pedida na hora). Sem segredo e sem dado pessoal aqui.
-- =====================================================================================================================
SET NOCOUNT ON;
GO
IF DB_ID(N'${BANCO}') IS NULL CREATE DATABASE ${BANCO};
GO
USE ${BANCO};
GO`,
  ];
  for (const ent of contrato.entidades) partes.push(sqlTabela(ent));
  partes.push('-- ----- views que o Conector lê (uma por entidade, na ordem de carga) -----');
  for (const ent of contrato.entidades) partes.push(sqlView(ent, colunasDoConector(exemplo, ent.entidade)));
  partes.push('-- ----- entrada de pedidos (Macuxi -> ERP): db/conector/entrada-pedido-modelo.sql -----');
  partes.push(tornarIdempotente(lerRepo('db', 'conector', 'entrada-pedido-modelo.sql')));
  partes.push('-- ----- retorno do pedido (ERP -> Macuxi): situação, nota e itens faturados -----');
  partes.push(extensaoPedido());
  return `${partes.join('\n')}\n`;
}

export function conectorJson(): string {
  const cfg = structuredClone(lerExemplo());
  cfg.hub = { ...cfg.hub, conectorId: ID_CONECTOR, url: HUB_URL };
  cfg.erp = { tipo: 'sqlserver', host: '127.0.0.1', porta: 1433, banco: BANCO, usuario: 'macuxi_conector', criptografar: true, confiarCertificado: true };
  cfg.entidades = Object.fromEntries(Object.entries(cfg.entidades).map(([e, v]) => [e, { ...v, periodicidadeSegundos: 120 }]));
  cfg.pedidos = { ...cfg.pedidos, consultaSegundos: 30, statusSegundos: 60 };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/** Todos os artefatos gerados: caminho relativo ao kit -> conteúdo. */
export function artefatos(): Record<string, string> {
  const saida: Record<string, string> = {
    'contrato.json': `${JSON.stringify(contratoDoKit(), null, 2)}\n`,
    'sql/criar-banco.sql': sqlCriarBanco(),
    'conector/conector.json': conectorJson(),
  };
  for (const [nome, csv] of Object.entries(modelosCsv())) saida[`modelos/${nome}`] = csv;
  return saida;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [rel, conteudo] of Object.entries(artefatos())) {
    const destino = join(aqui, rel);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, conteudo);
    console.log(`gravado: kit-thathyany/${rel}`);
  }
}
