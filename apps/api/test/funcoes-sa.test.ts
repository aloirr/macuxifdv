/**
 * T-0091 (condição da ADR 0029), sem banco: as listas de funcoes-sa.ts batem com as migrações e com o espelho do
 * scripts/deploy/producao/banco-dbaas.sh. Uma sa_* nova criada numa migração sem entrar numa das duas listas, um grant
 * do portal fora da SA_PORTAL ou o script divergindo deixam este teste vermelho (o portal.banco.test.ts confere o
 * catálogo do Postgres no CI).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SA_INTERNAS, SA_PORTAL } from './funcoes-sa';

const RAIZ = new URL('../../../', import.meta.url);
const MIGRACOES = new URL('db/migrations/', RAIZ);
const ler = (url: URL): string => readFileSync(url, 'utf8');
const ups = readdirSync(MIGRACOES)
  .filter((f) => f.endsWith('.up.sql'))
  .sort()
  .map((f) => ({ arquivo: f, sql: ler(new URL(f, MIGRACOES)) }));
const nome = (assinatura: string): string => assinatura.replace(/^plataforma\./, '').replace(/\(.*$/, '');
const ordenado = (xs: Iterable<string>): string[] => [...xs].sort();
/** Assinatura normalizada como a de oidvectortypes: "tipo, tipo". */
const normalizar = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/, '(').replace(/\s+\)/, ')');

describe('plataforma.sa_*: SA_PORTAL e SA_INTERNAS (T-0091)', () => {
  it('as listas não se cruzam nem repetem; 20 com grant e a interna sa_registrar_auditoria', () => {
    const todas = [...SA_PORTAL, ...SA_INTERNAS];
    expect(new Set(todas).size).toBe(todas.length);
    expect(SA_PORTAL).toHaveLength(20);
    expect(SA_INTERNAS).toEqual(['plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb)']);
  });

  it('toda sa_* criada nas migrações está numa das duas listas (e vice-versa)', () => {
    const criadas = new Set<string>();
    for (const { sql } of ups) {
      for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+plataforma\.(sa_\w+)\s*\(/gi)) criadas.add(m[1]!);
    }
    expect(ordenado(criadas)).toEqual(ordenado(new Set([...SA_PORTAL, ...SA_INTERNAS].map(nome))));
  });

  it('os grants ao macuxi_portal (0038) são exatamente a SA_PORTAL; nenhuma migração dá EXECUTE a uma interna', () => {
    const doPortal = new Set<string>();
    const nasInternas: string[] = [];
    for (const { arquivo, sql } of ups) {
      for (const m of sql.matchAll(/grant\s+execute\s+on\s+function\s+(plataforma\.sa_\w+\s*\([^)]*\))\s+to\s+([\w\s,]+?)\s*;/gi)) {
        const f = normalizar(m[1]!);
        if (SA_INTERNAS.includes(f)) nasInternas.push(`${arquivo}: ${f}`);
        if (/\bmacuxi_portal\b/.test(m[2]!)) doPortal.add(f);
      }
    }
    expect(ordenado(doPortal)).toEqual(ordenado(SA_PORTAL));
    expect(nasInternas).toEqual([]);
  });

  it('o espelho do banco-dbaas.sh (passo 6) tem as mesmas listas', () => {
    const sh = ler(new URL('scripts/deploy/producao/banco-dbaas.sh', RAIZ));
    const lista = (variavel: string): string[] => {
      const m = new RegExp(`^${variavel}="([^"]*)"`, 'm').exec(sh);
      expect(m, `${variavel}= no banco-dbaas.sh`).not.toBeNull();
      return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    };
    expect(lista('SA_PORTAL')).toEqual([...SA_PORTAL]);
    expect(lista('SA_INTERNAS')).toEqual([...SA_INTERNAS]);
  });
});
