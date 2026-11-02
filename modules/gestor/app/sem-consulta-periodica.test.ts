/**
 * RN-CORE-23: as telas do Gestor (app e BKO) não têm timer nem consulta periódica própria. A atualização leve é do motor
 * de sync da plataforma (`sync_auto_min`, ao abrir o app e ao voltar ao primeiro plano); puxar para baixo = Sincronizar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..');
function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return fontes(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe('RN-CORE-23: sem consulta periódica própria nas telas do Gestor', () => {
  it('nenhum setInterval, setTimeout ou recarga ao focar a aba em app/ e web/', () => {
    const achados = [...fontes(join(RAIZ, 'app')), ...fontes(join(RAIZ, 'web'))].flatMap((arq) => {
      const texto = readFileSync(arq, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      return /\bsetInterval\s*\(|\bsetTimeout\s*\(|\buseFocusEffect\b/.test(texto) ? [arq.slice(RAIZ.length + 1)] : [];
    });
    expect(achados).toEqual([]);
  });

  it('RN-CORE-23 item 6: refetchInterval só no BKO e só por intervaloSyncAutoMs (≥ 15 min)', () => {
    const usos = [...fontes(join(RAIZ, 'app')), ...fontes(join(RAIZ, 'web'))].flatMap((arq) => {
      const texto = readFileSync(arq, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      return [...texto.matchAll(/refetchInterval\s*:\s*([^,}]+)/g)].map((m) => ({ arq: arq.slice(RAIZ.length + 1), valor: m[1]!.trim() }));
    });
    for (const u of usos) {
      expect(u.arq.startsWith('web')).toBe(true);
      expect(u.valor).toMatch(/^intervaloSyncAutoMs\(/);
    }
  });
});
