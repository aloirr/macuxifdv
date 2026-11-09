/**
 * Links de notificação do seed e das fixtures (T-0140): todo link gravado precisa abrir uma tela que existe.
 * O recado do Início da demo apontava para `/m/core-rota`, que não é tela de módulo (o caminho é `rota`), e o app
 * caía na central. Sem banco e sem importar `modules/<m>/app` (React/Expo): a lista de telas sai do texto das
 * `paginas` dos módulos (`caminho: '<x>'` ou `caminho: CAMINHO_X`, com as constantes de `rotas.ts`/`caminhos.ts`).
 * Formato do link: o mesmo do check `core.notificacao_link_formato` (0006), `^/m/<caminho>` e, se houver, `?query`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dadosDemo } from '../seeds/demo/demo';
import { dadosGestorDemo } from '../seeds/demo/gestor';
import { dadosPesquisaDemo } from '../seeds/demo/pesquisa';
import { dadosDemoPromotor } from '../seeds/demo/promotor';
import { dadosTreinamentoDemo } from '../seeds/demo/treinamento';
import { dadosFaseM } from '../seeds/fase-m/fase-m';
import { dadosDoisTenants } from '../seeds/fixtures/dois-tenants';
import { dadosTreinamento } from './fixture-treinamento';

const HASH = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const MODULOS = join(RAIZ, 'modules');
const SEEDS = join(RAIZ, 'db', 'seeds');
/** Formato aceito: `/m/<caminho>` com `?query` opcional; o grupo 1 é o caminho da tela. */
const FORMATO_LINK = /^\/m\/([a-z0-9-]+)(?:\?.*)?$/;

/** Caminhos de tela declarados nas `paginas` de cada módulo (só arquivos .ts do primeiro nível de `modules/<m>/app`). */
function telasDosModulos(): Map<string, string> {
  const telas = new Map<string, string>();
  for (const modulo of readdirSync(MODULOS)) {
    const dirApp = join(MODULOS, modulo, 'app');
    if (!statSync(dirApp, { throwIfNoEntry: false })?.isDirectory()) continue;
    const fontes = readdirSync(dirApp)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(join(dirApp, f), 'utf8'));
    const constantes = new Map<string, string>();
    for (const fonte of fontes) for (const m of fonte.matchAll(/export const (CAMINHO_[A-Z0-9_]+)\s*=\s*'([^']+)'/g)) constantes.set(m[1]!, m[2]!);
    for (const fonte of fontes) {
      for (const m of fonte.matchAll(/\bcaminho:\s*(?:'([^']+)'|(CAMINHO_[A-Z0-9_]+))/g)) {
        const caminho = m[1] ?? constantes.get(m[2]!);
        if (!caminho) throw new Error(`modules/${modulo}/app: constante ${m[2]} sem valor literal`);
        telas.set(caminho, modulo);
      }
    }
  }
  return telas;
}

interface LinkAchado {
  origem: string;
  onde: string;
  link: string;
}

/** Percorre os dados do seed e junta toda coluna `link` não nula e todo texto que começa com `/m`. */
function linksNosDados(origem: string, dados: unknown): LinkAchado[] {
  const achados: LinkAchado[] = [];
  const visitar = (v: unknown, onde: string, chave: string) => {
    if (typeof v === 'string') {
      if (chave === 'link' || v.startsWith('/m')) achados.push({ origem, onde, link: v });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visitar(x, `${onde}[${i}]`, chave));
    } else if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      for (const [k, x] of Object.entries(v)) visitar(x, onde ? `${onde}.${k}` : k, k);
    }
  };
  visitar(dados, '', '');
  return achados;
}

/** Literais `'/m/...'` (ou com aspas duplas/crase) nos fontes de `db/seeds`, para pegar link de seed que o teste não chama. */
function linksNosFontes(): LinkAchado[] {
  const achados: LinkAchado[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (/\.ts$/.test(nome)) {
        readFileSync(caminho, 'utf8').split('\n').forEach((linha, i) => {
          for (const m of linha.matchAll(/['"`](\/m\/[^'"`]*)['"`]/g)) achados.push({ origem: 'fonte', onde: `${caminho.slice(RAIZ.length)}:${i + 1}`, link: m[1]! });
        });
      }
    }
  };
  andar(SEEDS);
  return achados;
}

describe('links de notificação do seed e das fixtures (T-0140, estático)', () => {
  const telas = telasDosModulos();
  const links = [
    ...linksNosDados('demo', dadosDemo(HASH, { hoje: '2026-11-04' })),
    ...linksNosDados('demo-gestor', dadosGestorDemo(dadosDemo(HASH, { hoje: '2026-11-04' }))),
    ...linksNosDados('demo-pesquisa', dadosPesquisaDemo({ hoje: '2026-11-04' })),
    ...linksNosDados('demo-promotor', dadosDemoPromotor({ hoje: '2026-11-04' })),
    ...linksNosDados('demo-treinamento', dadosTreinamentoDemo({ hoje: '2026-11-04' })),
    ...linksNosDados('dois-tenants', dadosDoisTenants(HASH, { hoje: '2026-11-04' })),
    ...linksNosDados('treinamento', dadosTreinamento(new Date('2026-11-04T12:00:00Z'))), // hora-fixa-ok: só lê os links
    ...linksNosDados('fase-m', dadosFaseM(HASH)),
    ...linksNosFontes(),
  ];

  it('a lista de telas sai dos módulos e tem as telas que o seed usa', () => {
    for (const t of ['rota', 'clientes', 'cliente', 'notificacoes', 'pedido', 'pedidos', 'catalogo', 'equipe', 'aprovacoes', 'pesquisas', 'treinar', 'loja']) {
      expect(telas.has(t), `tela ${t}`).toBe(true);
    }
    expect(telas.has('core-rota')).toBe(false);
  });

  it('o seed tem link de notificação para conferir (o recado do Início da demo e o da fixture)', () => {
    expect(links.some((l) => l.origem === 'demo' && l.link === '/m/rota')).toBe(true);
    expect(links.some((l) => l.origem === 'dois-tenants' && l.link === '/m/rota')).toBe(true);
  });

  it('todo link tem o formato /m/<caminho> do check notificacao_link_formato', () => {
    const fora = links.filter((l) => !FORMATO_LINK.test(l.link)).map((l) => `${l.origem} ${l.onde}: ${l.link}`);
    expect(fora).toEqual([]);
  });

  it('todo link abre uma tela que existe nas paginas dos módulos', () => {
    const sem = links
      .filter((l) => {
        const caminho = FORMATO_LINK.exec(l.link)?.[1];
        return caminho !== undefined && !telas.has(caminho);
      })
      .map((l) => `${l.origem} ${l.onde}: ${l.link}`);
    expect(sem).toEqual([]);
  });
});
