/**
 * T-0091 (condição da ADR 0029), sem banco: as listas de funcoes-sa.ts batem com as migrações e com o espelho do
 * scripts/deploy/producao/banco-dbaas.sh. Uma sa_* nova criada numa migração sem entrar numa das duas listas, um grant
 * do portal fora da SA_PORTAL ou o script divergindo deixam este teste vermelho (o portal.banco.test.ts confere o
 * catálogo do Postgres no CI).
 * T-0093 (0039): as migrações são aplicadas EM ORDEM, com os `drop function` e os `revoke ... from macuxi_portal`: a 0039 apaga
 * 14 sa_* da 0035 e troca a assinatura da interna sa_registrar_auditoria.
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

/** Eventos das migrações up, em ordem de arquivo e de posição no arquivo. */
type Evento = { tipo: 'cria' | 'apaga'; nome: string; assinatura: string | null } | { tipo: 'grant' | 'revoke'; assinatura: string; papeis: string; arquivo: string };
const eventos: Evento[] = ups.flatMap(({ arquivo, sql }) => {
  const achados: { pos: number; e: Evento }[] = [];
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+plataforma\.(sa_\w+)\s*\(/gi)) achados.push({ pos: m.index!, e: { tipo: 'cria', nome: m[1]!, assinatura: null } });
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(plataforma\.(sa_\w+)\s*\([^)]*\))/gi))
    achados.push({ pos: m.index!, e: { tipo: 'apaga', nome: m[2]!, assinatura: normalizar(m[1]!) } });
  for (const m of sql.matchAll(/grant\s+execute\s+on\s+function\s+(plataforma\.sa_\w+\s*\([^)]*\))\s+to\s+([\w\s,]+?)\s*;/gi))
    achados.push({ pos: m.index!, e: { tipo: 'grant', assinatura: normalizar(m[1]!), papeis: m[2]!, arquivo } });
  for (const m of sql.matchAll(/revoke\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+(plataforma\.sa_\w+\s*\([^)]*\))\s+from\s+([\w\s,]+?)\s*;/gi))
    achados.push({ pos: m.index!, e: { tipo: 'revoke', assinatura: normalizar(m[1]!), papeis: m[2]!, arquivo } });
  return achados.sort((a, b) => a.pos - b.pos).map((x) => x.e);
});

describe('plataforma.sa_*: SA_PORTAL e SA_INTERNAS (T-0091; T-0093)', () => {
  it('as listas não se cruzam nem repetem; 27 com grant e a interna sa_registrar_auditoria de 7 argumentos', () => {
    const todas = [...SA_PORTAL, ...SA_INTERNAS];
    expect(new Set(todas).size).toBe(todas.length);
    expect(SA_PORTAL).toHaveLength(27);
    expect(SA_INTERNAS).toEqual(['plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb)']);
  });

  it('as sa_* que existem depois de todas as migrações (criadas menos apagadas) são exatamente as das duas listas', () => {
    const existem = new Set<string>();
    for (const e of eventos) {
      if (e.tipo === 'cria') existem.add(e.nome);
      // drop de uma assinatura: some o nome (uma sa_* não tem sobrecarga; a recriação vem depois, noutro evento)
      if (e.tipo === 'apaga') existem.delete(e.nome);
    }
    expect(ordenado(existem)).toEqual(ordenado(new Set([...SA_PORTAL, ...SA_INTERNAS].map(nome))));
  });

  it('os grants vivos ao macuxi_portal são exatamente a SA_PORTAL; nenhuma migração dá EXECUTE a uma interna', () => {
    const doPortal = new Set<string>();
    const nasInternas: string[] = [];
    for (const e of eventos) {
      if (e.tipo === 'grant') {
        if (SA_INTERNAS.includes(e.assinatura)) nasInternas.push(`${e.arquivo}: ${e.assinatura}`);
        if (/\bmacuxi_portal\b/.test(e.papeis)) doPortal.add(e.assinatura);
      }
      if (e.tipo === 'revoke' && /\bmacuxi_portal\b/.test(e.papeis)) doPortal.delete(e.assinatura);
      // função apagada leva os grants junto
      if (e.tipo === 'apaga' && e.assinatura) doPortal.delete(e.assinatura);
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
