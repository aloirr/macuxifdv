/**
 * ADR 0068 §3: prefixos reservados na raiz do `fdv.` contra os manifestos e as páginas do BKO dos módulos instalados. Um módulo
 * com id ou rota `bko`, `config`, `login`... tomaria o endereço do shell, do portal ou do Next.
 */
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';
import { MODULOS_WEB } from './modulos';
import { PREFIXOS_RESERVADOS } from './portal';

const reservado = (segmento: string) => (PREFIXOS_RESERVADOS as readonly string[]).includes(segmento.toLowerCase());
const primeiro = (caminho: string) => caminho.replace(/^\/+/, '').split('/')[0] ?? '';

describe('prefixos reservados na raiz (ADR 0068)', () => {
  it('a lista é a da ADR', () => {
    expect([...PREFIXOS_RESERVADOS].sort()).toEqual(['.well-known', '_next', 'api-proxy', 'auditoria', 'bko', 'config', 'convite', 'login', 'parametros'].sort());
  });
  it('nenhum id de módulo é prefixo reservado', () => {
    expect(MANIFESTOS_INSTALADOS.length).toBe(8);
    for (const m of MANIFESTOS_INSTALADOS) expect(reservado(m.id), m.id).toBe(false);
  });
  it('nenhuma página do BKO começa por prefixo reservado (fora as seções de Parâmetros)', () => {
    const rotas: string[] = [];
    for (const m of MODULOS_WEB) {
      for (const p of m.paginas ?? []) {
        if (p.apps && !p.apps.includes('web')) continue;
        rotas.push(p.caminho);
        // seção da página Parâmetros do shell: `parametros/<secao>`, só no grupo Parâmetros
        if (p.grupo === 'parametros' && /^parametros\/[a-z0-9-]+$/.test(p.caminho)) continue;
        expect(reservado(primeiro(p.caminho)), `${m.manifesto.id}: ${p.caminho}`).toBe(false);
      }
      for (const pp of m.paineisParametros ?? []) {
        for (const c of pp.caminhosAntigos ?? []) expect(reservado(primeiro(c)), `${m.manifesto.id}/${pp.id}: ${c}`).toBe(false);
      }
    }
    // o teste olha as páginas de verdade (o Catálogo tem as dele)
    expect(rotas).toContain('catalogo');
  });
  it('as rotas do shell que ocupam os prefixos existem como pasta do app (sem coringa de módulo por cima)', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const app = (c: string) => fileURLToPath(new URL(`../app/${c}`, import.meta.url));
    for (const c of ['(bko)/bko/page.tsx', 'config/layout.tsx', 'login/page.tsx', 'convite/page.tsx', '(bko)/auditoria/page.tsx', '(bko)/parametros']) expect(existsSync(app(c)), c).toBe(true);
  });
});
