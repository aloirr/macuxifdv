#!/usr/bin/env node
/**
 * T-0162 — ponto de entrada do "ERP via API" (tarefa agendada). Uma passada e sai.
 * Variáveis (o executar.ps1 as monta a partir do Gerenciador de Credenciais; segredo nunca vai a arquivo nem a log):
 *   MACUXI_HUB_URL   padrão https://api.macuxifdv.com.br/integracao/v1
 *   MACUXI_CHAVE     chave do Conector "piloto-api" (mxc_...)
 *   MACUXI_ERP_SENHA senha do usuário macuxi_api na ERP_PILOTO
 *   MACUXI_ERP_SERVIDOR (127.0.0.1), MACUXI_ERP_PORTA (1433), MACUXI_ERP_BANCO (ERP_PILOTO), MACUXI_ERP_USUARIO (macuxi_api)
 * Opção: --carga força a carga agora (ignora o intervalo de 5 minutos).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { ClienteHub, ErroHub, RejeicaoErp, lerConfig } from './cliente-hub.mjs';
import { executarCiclo } from './erp-via-api.mjs';

const pasta = dirname(fileURLToPath(import.meta.url));
const arquivoEstado = join(pasta, 'estado.json');
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

function tipoDe(nome, valor) {
  if (valor instanceof Date) return sql.DateTime2(3);
  if (nome.endsWith('uuid') || nome === 'uuid') return sql.UniqueIdentifier;
  if (nome.endsWith('_cents')) return sql.Decimal(19, 0);
  if (typeof valor === 'number') return Number.isInteger(valor) ? sql.Int : sql.Float;
  return sql.VarChar(sql.MAX);
}

async function abrirBanco(env) {
  const pool = await new sql.ConnectionPool({
    server: env.MACUXI_ERP_SERVIDOR ?? '127.0.0.1',
    port: Number(env.MACUXI_ERP_PORTA ?? 1433),
    database: env.MACUXI_ERP_BANCO ?? 'ERP_PILOTO',
    user: env.MACUXI_ERP_USUARIO ?? 'macuxi_api',
    password: env.MACUXI_ERP_SENHA,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 60_000,
  }).connect();
  return {
    async consultar(texto, params = {}) {
      const req = pool.request();
      for (const [nome, valor] of Object.entries(params)) req.input(nome, valor === undefined ? null : tipoDe(nome, valor), valor ?? null);
      const r = await req.query(texto);
      return r.recordsets.length > 0 ? r.recordsets[r.recordsets.length - 1] : [];
    },
    fechar: () => pool.close(),
  };
}

function lerEstado() {
  try {
    return JSON.parse(readFileSync(arquivoEstado, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  if (!process.env.MACUXI_ERP_SENHA) throw new Error('Falta a senha do usuário macuxi_api (rode o Instalar-Piloto.ps1 de novo).');
  const cfg = lerConfig({ MACUXI_HUB_URL: 'https://api.macuxifdv.com.br/integracao/v1', MACUXI_CONECTOR: 'piloto-api', MACUXI_INTERVALO_MS: '1000', ...process.env });
  const cliente = new ClienteHub({ ...cfg, registrar: () => {} });
  const db = await abrirBanco(process.env);
  try {
    const { estado, resumo } = await executarCiclo({
      cliente,
      db,
      deps: { RejeicaoErp, ErroHub },
      estado: lerEstado(),
      forcarCarga: process.argv.includes('--carga'),
      log,
    });
    writeFileSync(arquivoEstado, JSON.stringify(estado));
    log(`passada ok: ${JSON.stringify(resumo.pedidos)} retornos ${JSON.stringify(resumo.retornos)}`);
  } finally {
    await db.fechar();
  }
}

main().catch((e) => {
  // Mensagem do erro, sem corpo de requisição nem valores de linha.
  console.error(`${new Date().toISOString()} ERRO: ${e instanceof ErroHub ? `${e.status} ${e.codigo}` : e.message}`);
  process.exitCode = 1;
});
