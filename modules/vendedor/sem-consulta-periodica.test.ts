/**
 * RN-CORE-23 (T-0054): as telas do Vendedor (app e BKO) não fazem consulta periódica própria nem disparam sync por
 * timer — o pull é do motor de sync da plataforma (a cada `sync_auto_min`, ao abrir o app, ao voltar ao primeiro plano
 * depois de 30 min; puxar para baixo = Sincronizar). Varre o código das telas: `setInterval` e `refetchInterval` proibidos.
 * O `setTimeout` curto que só esconde um aviso na tela (sem rede) é permitido.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = __dirname;
function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const p = join(pasta, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : arquivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('RN-CORE-23: sem consulta periódica própria nas telas do Vendedor', () => {
  it('RN-CORE-23: nenhum setInterval nem refetchInterval em app/ e web/ (o pull é do motor de sync da plataforma)', () => {
    const achados = ['app', 'web']
      .flatMap((p) => arquivos(join(RAIZ, p)))
      .flatMap((f) => (/\bsetInterval\s*\(|\brefetchInterval\b/.test(readFileSync(f, 'utf8')) ? [relative(RAIZ, f)] : []));
    expect(achados).toEqual([]);
  });
});
