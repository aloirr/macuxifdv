/**
 * Modelo da entrada de pedidos no ERP (`db/conector/entrada-pedido-modelo.sql`, T-0149; R-20261110-104924) contra o
 * exemplo do Conector (`apps/conector/exemplos/conector.exemplo.json`, "pedidos.gravacao.cabecalho") e os parâmetros que o
 * Conector manda (`parametrosCabecalho` em apps/conector/src/pedidos.ts). Sem banco: roda no PC e no CI.
 * - todo `@param` do EXEC do exemplo existe na procedure dbo.sp_macuxi_pedido_inserir (senão o EXEC falha por parâmetro
 *   desconhecido) e todo `:nome` dele é um parâmetro do Conector;
 * - os parâmetros além dos 9 originais têm padrão NULL (o EXEC de Conector antigo continua válido) e cada um tem a coluna do
 *   mesmo nome, NULA, em dbo.macuxi_pedido_entrada, e entra no INSERT da procedure;
 * - a idempotência pelo pedido_uuid continua (IF NOT EXISTS no cabeçalho e no item).
 * Formato: docs/banco/integracao.md ("0056 — ... entrada de pedidos").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(new URL('../conector/entrada-pedido-modelo.sql', import.meta.url), 'utf8');
const EXEMPLO = JSON.parse(readFileSync(new URL('../../apps/conector/exemplos/conector.exemplo.json', import.meta.url), 'utf8')) as unknown;
const FONTE_PEDIDOS = readFileSync(new URL('../../apps/conector/src/pedidos.ts', import.meta.url), 'utf8');

/** Os 9 parâmetros originais (obrigatórios) da procedure do cabeçalho. */
const ORIGINAIS = ['pedido_uuid', 'cliente', 'vendedor', 'condicao', 'criado_em', 'aprovado_em', 'observacao', 'desconto_total_cents', 'total_cents'];

/** Os 23 de frete, entrega e pagamento pedidos em R-20261110-104924 (Conector 1.4.0). */
const NOVOS_T0149 = [
  'frete_modalidade', 'frete_transportadora_tipo', 'frete_transportadora_id', 'frete_transportadora_external_id', 'frete_transportadora_nome',
  'frete_transportadora_cnpj', 'frete_transportadora_telefone',
  'entrega_origem', 'entrega_external_id', 'entrega_logradouro', 'entrega_numero', 'entrega_complemento', 'entrega_bairro', 'entrega_cidade',
  'entrega_uf', 'entrega_cep', 'entrega_principal',
  'pagamento_forma_codigo', 'pagamento_forma_external_id', 'pagamento_prazo_codigo', 'pagamento_prazo_external_id', 'pagamento_parcelas_dias',
  'pagamento_prazo_medio_dias',
];

function acharCabecalho(v: unknown): string | null {
  if (v === null || typeof v !== 'object') return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'cabecalho' && typeof x === 'string') return x;
    const r = acharCabecalho(x);
    if (r) return r;
  }
  return null;
}

/** Parâmetros declarados da procedure: nome -> trecho da declaração (tipo e padrão). */
function parametrosDaProcedure(): Map<string, string> {
  const m = /CREATE PROCEDURE dbo\.sp_macuxi_pedido_inserir([\s\S]*?)\nAS\n/.exec(SQL);
  if (!m) throw new Error('sp_macuxi_pedido_inserir não encontrada');
  const corpo = m[1]!.replace(/--[^\n]*/g, '');
  const mapa = new Map<string, string>();
  for (const d of corpo.matchAll(/@(\w+)\s+([^,@]+)/g)) mapa.set(d[1]!, d[2]!.trim());
  return mapa;
}

/** Colunas da tabela do cabeçalho: nome -> definição. */
function colunasDoCabecalho(): Map<string, string> {
  const m = /CREATE TABLE dbo\.macuxi_pedido_entrada \(([\s\S]*?)\n\);/.exec(SQL);
  if (!m) throw new Error('dbo.macuxi_pedido_entrada não encontrada');
  const mapa = new Map<string, string>();
  for (const linha of m[1]!.split('\n')) {
    const c = /^\s+([a-z_]+)\s+(.+?)(?:\s*--.*)?$/.exec(linha);
    if (c) mapa.set(c[1]!, c[2]!.replace(/,$/, '').trim());
  }
  return mapa;
}

/** Chaves que o Conector monta em parametrosCabecalho (texto da função). */
function parametrosDoConector(): Set<string> {
  const m = /export function parametrosCabecalho[\s\S]*?return \{([\s\S]*?)\n {2}\};/.exec(FONTE_PEDIDOS);
  if (!m) throw new Error('parametrosCabecalho não encontrada em apps/conector/src/pedidos.ts');
  return new Set([...m[1]!.matchAll(/^\s+(\w+):/gm)].map((x) => x[1]!));
}

describe('entrada de pedidos do Conector (db/conector/entrada-pedido-modelo.sql)', () => {
  const params = parametrosDaProcedure();
  const colunas = colunasDoCabecalho();

  it('o EXEC do conector.exemplo.json só usa parâmetros da procedure e valores do Conector', () => {
    const exec = acharCabecalho(EXEMPLO);
    expect(exec, 'pedidos.gravacao.cabecalho').toMatch(/^EXEC dbo\.sp_macuxi_pedido_inserir /);
    const pares = [...exec!.matchAll(/@(\w+)\s*=\s*:(\w+)/g)].map((x) => [x[1]!, x[2]!] as const);
    expect(pares.length).toBeGreaterThan(ORIGINAIS.length);
    const doConector = parametrosDoConector();
    for (const [p, v] of pares) {
      expect(params.has(p), `@${p} sem declaração na procedure`).toBe(true);
      expect(doConector.has(v), `:${v} fora do parametrosCabecalho`).toBe(true);
    }
  });

  it('os 23 de frete, entrega e pagamento: parâmetro com padrão NULL, coluna NULA do mesmo nome e no INSERT', () => {
    const insert = /INSERT INTO dbo\.macuxi_pedido_entrada\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\);/.exec(SQL);
    expect(insert).not.toBeNull();
    const colsInsert = insert![1]!.split(',').map((x) => x.trim());
    const valores = insert![2]!.split(',').map((x) => x.trim());
    expect(valores).toEqual(colsInsert.map((c) => `@${c}`));
    for (const n of NOVOS_T0149) {
      expect(params.get(n), `@${n}`).toMatch(/= NULL$/);
      expect(colunas.get(n), `coluna ${n}`).toMatch(/ NULL$/);
      expect(colsInsert, `INSERT sem ${n}`).toContain(n);
    }
    // além dos originais, todo parâmetro é opcional (padrão NULL) e tem coluna
    for (const [n, d] of params) {
      if (ORIGINAIS.includes(n)) continue;
      expect(d, `@${n}`).toMatch(/= NULL$/);
      expect(colunas.has(n), `coluna ${n}`).toBe(true);
    }
  });

  it('idempotência pelo pedido_uuid no cabeçalho e no item', () => {
    expect(SQL).toContain('IF NOT EXISTS (SELECT 1 FROM dbo.macuxi_pedido_entrada WHERE pedido_uuid = @pedido_uuid)');
    expect(SQL).toContain('IF NOT EXISTS (SELECT 1 FROM dbo.macuxi_pedido_entrada_item WHERE pedido_uuid = @pedido_uuid AND sequencia = @sequencia)');
    expect(colunas.get('pedido_uuid')).toContain('UNIQUE');
  });
});
