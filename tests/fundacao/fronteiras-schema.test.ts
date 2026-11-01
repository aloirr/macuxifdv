/**
 * T-0001 C1.3 / T-0002 — S0-014: nenhum módulo referencia tabela do schema de outro módulo
 * (CLAUDE.md regra 1; doc 04: "Nenhum módulo lê ou escreve tabela de outro schema").
 *
 * O dependency-cruiser (S0-010..013) pega import de código; isto pega o que ele não vê: SQL cru e
 * `pgSchema('<outro>')` do Drizzle dentro de modules/<m>/{db,api,domain,app,web}.
 * Permitido: o próprio schema. `plataforma` só para o core (premissa: o Core administra tenant,
 * licenças, parâmetros e auditoria — RF-CORE-03); os demais módulos chegam a ela pelo platform-sdk.
 * Os schemas conhecidos vêm das migrações (db/migrations/*.up.sql) + a tabela do doc 04.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const MODULOS_DIR = join(RAIZ, 'modules');
const PASTAS = ['db', 'api', 'domain', 'app', 'web'];

/** Doc 04, "Dados (1 schema por módulo)". */
const SCHEMAS_DOC04 = ['plataforma', 'core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'];

function schemasDasMigracoes(): string[] {
  const dir = join(RAIZ, 'db', 'migrations');
  const nomes = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.up.sql'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/create\s+schema\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) nomes.add(m[1]!.toLowerCase());
  }
  return [...nomes];
}

interface Violacao {
  schema: string;
  trecho: string;
}

/**
 * Referências a schema em SQL (FROM/JOIN/INTO/UPDATE/TABLE/REFERENCES/TRUNCATE "schema"."tabela")
 * e em Drizzle (pgSchema('schema')). Nome de evento (core.usuario.modulos_alterados@1) e de
 * permissão (pedido.criar) não casam porque exigem a palavra-chave SQL antes.
 */
function referenciasDeSchema(codigo: string, schemas: readonly string[]): Violacao[] {
  const alt = schemas.join('|');
  const sql = new RegExp(`\\b(?:from|join|into|update|table|references|truncate)\\s+(?:only\\s+)?"?(${alt})"?\\s*\\.\\s*"?[a-z_][a-z0-9_]*`, 'gi');
  const drizzle = new RegExp(`pgSchema\\(\\s*['"\`](${alt})['"\`]\\s*\\)`, 'g');
  const achados: Violacao[] = [];
  for (const re of [sql, drizzle]) for (const m of codigo.matchAll(re)) achados.push({ schema: m[1]!.toLowerCase(), trecho: m[0] });
  return achados;
}

function permitidos(modulo: string): string[] {
  return modulo === 'core' ? ['core', 'plataforma'] : [modulo];
}

function arquivos(dir: string): string[] {
  let saida: string[] = [];
  let itens: string[];
  try {
    itens = readdirSync(dir);
  } catch {
    return [];
  }
  for (const nome of itens) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida = saida.concat(arquivos(p));
    else if (/\.(ts|tsx|mts|cts|js|mjs|sql)$/.test(nome)) saida.push(p);
  }
  return saida;
}

/*
 * Sem exceções (T-0035). As temporárias da T-0029 (R-20261101-080407-testes: `from plataforma.tenant` em
 * modules/vendedor/api/pedidos.ts e `from core.cliente|produto|usuario` em pedido.db.test.ts) foram retiradas:
 * o Vendedor usa `ctx.fuso()` do platform-sdk e monta o cadastro do teste em memória (R-20261101-155708).
 * Nova exceção só com recado ao dono e ao engenheiro-software; não reabra a lista para `*.db.test.ts` semear outro schema.
 */

describe('S0-014 módulo não referencia tabela do schema de outro módulo', () => {
  const schemas = [...new Set([...SCHEMAS_DOC04, ...schemasDasMigracoes()])];

  it('as migrações criam os schemas plataforma e core (base da varredura)', () => {
    expect(schemasDasMigracoes()).toEqual(expect.arrayContaining(['plataforma', 'core']));
  });

  describe('detector (casos sintéticos)', () => {
    it.each([
      ['select * from core.usuario', 'core'],
      ['SELECT x FROM "vendedor"."pedido" p', 'vendedor'],
      ['select 1 from a join catalogo.estoque_saldo e on true', 'catalogo'],
      ['insert into promotor.foto (id) values ($1)', 'promotor'],
      ['update plataforma.tenant_modulo set ativo = false', 'plataforma'],
      ['delete from integracao.lote where id = $1', 'integracao'],
      ['truncate only gestor.alerta', 'gestor'],
      ['references core.cliente (tenant_id, id)', 'core'],
      ["export const s = pgSchema('pesquisa');", 'pesquisa'],
      ['sql`select * from ${x} join treinamento.trilha t on t.id = x.id`', 'treinamento'],
    ])('acha a referência em %s', (codigo, schema) => {
      expect(referenciasDeSchema(codigo, schemas).map((v) => v.schema)).toEqual([schema]);
    });

    it.each([
      "emitir('core.usuario.modulos_alterados@1', payload)",
      "acoes: ['pedido.criar', 'pedido.cancelar']",
      "slot: 'cliente.abas'",
      'import { x } from "@macuxi/core/contracts"',
      "const t = 'vendedor.pedido_item'",
      'select * from pedido where tenant_id = $1',
    ])('não confunde com nome de evento, ação, extensão, import ou tabela sem schema: %s', (codigo) => {
      expect(referenciasDeSchema(codigo, schemas)).toEqual([]);
    });

    /**
     * T-0035: `plataforma.tenant_atual()` é FUNÇÃO de infraestrutura do RLS (db/migrations/0001_plataforma.up.sql:
     * `select nullif(current_setting('app.tenant_id', true), '')::uuid`), não lê tabela; todo schema de módulo a usa nas
     * políticas e no default de tenant_id. A regra 1 do CLAUDE.md proíbe LER/ESCREVER TABELA de outro schema, então ela não
     * é violação. O detector já não a acusa (exige from/join/into/... antes do schema) e estes casos travam isso.
     * Já `insert into plataforma.x` ou `from plataforma.tenant` continuam violação (casos acima).
     */
    it.each([
      "insert into vendedor.pedido (tenant_id, id) values (plataforma.tenant_atual(), $1)",
      "using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual())",
      "where tenant_id = plataforma.tenant_atual()",
    ])('T-0035: plataforma.tenant_atual() (função do RLS) não é referência a tabela de outro schema: %s', (codigo) => {
      expect(referenciasDeSchema(codigo, schemas).map((v) => v.schema)).not.toContain('plataforma');
    });

    it('core pode usar plataforma; os demais só o próprio schema', () => {
      expect(permitidos('core')).toEqual(['core', 'plataforma']);
      expect(permitidos('vendedor')).toEqual(['vendedor']);
    });
  });

  it('nenhum arquivo de modules/<m>/{db,api,domain,app,web} referencia schema de outro módulo', () => {
    const modulos = readdirSync(MODULOS_DIR).filter((m) => statSync(join(MODULOS_DIR, m)).isDirectory());
    expect(modulos.length).toBeGreaterThanOrEqual(8);
    const violacoes: string[] = [];
    let varridos = 0;
    for (const m of modulos) {
      for (const pasta of PASTAS) {
        for (const arq of arquivos(join(MODULOS_DIR, m, pasta))) {
          varridos++;
          const codigo = readFileSync(arq, 'utf8');
          for (const v of referenciasDeSchema(codigo, schemas)) {
            if (!permitidos(m).includes(v.schema)) violacoes.push(`${relative(RAIZ, arq).split(sep).join('/')}: ${v.trecho}`);
          }
        }
      }
    }
    expect(varridos).toBeGreaterThan(0);
    expect(violacoes).toEqual([]);
  });

  it('o Drizzle de cada módulo declara só o próprio schema (modules/core/db/nuvem.ts -> core)', () => {
    const nuvem = readFileSync(join(MODULOS_DIR, 'core', 'db', 'nuvem.ts'), 'utf8');
    expect(referenciasDeSchema(nuvem, schemas).filter((v) => v.trecho.startsWith('pgSchema')).map((v) => v.schema)).toEqual(['core']);
  });
});
