/**
 * T-0028 — abas que o shell mobile monta na demo (licenças lidas do seed: hoje core, catálogo, vendedor e promotor; o
 * gestor ainda não). O shell (`criarShell` do platform-sdk) recebe os manifestos e as páginas que cada módulo declara em
 * `modules/<m>/app/index.ts` (`moduloApp.paginas`). As telas importam React Native, que não roda no Node: as páginas
 * são lidas do FONTE (id, navegacao e apps), como no shells.test.ts, e montadas no `criarShell` real.
 * Matriz: tests/plano/demo-matriz.md (D-C00 e D-G00..D-G01).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarShell, modulosEfetivos, type Manifesto, type ModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_INSTALADOS } from '../../apps/mobile/src/lib/instalados';

const RAIZ = join(__dirname, '..', '..');
/**
 * Licenças da demo lidas do FONTE do seed (`db/seeds/demo/demo.ts`: `MODULOS_DEMO` e `PERFIL_MODULOS`), para os casos
 * virarem sozinhos quando o banco-dados licenciar um módulo na demo (ex.: o Gestor, R-20261102-131601-modulo-gestor).
 */
const SEED_DEMO = readFileSync(join(RAIZ, 'db', 'seeds', 'demo', 'demo.ts'), 'utf8');
const listaDoFonte = (trecho: string | undefined) => (trecho ?? '').match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
/**
 * Seeds próprios de módulo ligados no `carregarDemo` (02/11: `db/seeds/demo/gestor.ts` e `promotor.ts`): cada um liga o
 * módulo no tenant e nos perfis da sua constante `PERFIS_<MODULO>_DEMO`. Só valem se o demo.ts os chamar.
 */
const SEEDS_DE_MODULO = [
  { modulo: 'gestor', chamada: /await\s+carregarDemoGestor\(/, arquivo: 'gestor.ts', constante: 'PERFIS_GESTOR_DEMO' },
  { modulo: 'promotor', chamada: /await\s+gravarDemoPromotor\(/, arquivo: 'promotor.ts', constante: 'PERFIS_PROMOTOR_DEMO' },
]
  .filter((s) => s.chamada.test(SEED_DEMO) && existsSync(join(RAIZ, 'db', 'seeds', 'demo', s.arquivo)))
  .map((s) => ({ modulo: s.modulo, perfis: listaDoFonte(new RegExp(`${s.constante}\\s*=\\s*\\[([^\\]]*)\\]`).exec(readFileSync(join(RAIZ, 'db', 'seeds', 'demo', s.arquivo), 'utf8'))?.[1]) }));
const LICENCIADOS_DEMO = [...new Set([...listaDoFonte(/MODULOS_DEMO\s*=\s*\[([^\]]*)\]/.exec(SEED_DEMO)?.[1]), ...SEEDS_DE_MODULO.map((s) => s.modulo)])];
/** Módulos por perfil na demo (`plataforma.perfil_modulo` do seed + seeds de módulo, docs/banco/README.md "Base de demo"). */
const DO_PERFIL: Record<string, string[]> = Object.fromEntries(
  [...(/PERFIL_MODULOS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(SEED_DEMO)?.[1] ?? '').matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)].map(([, perfil, mods]) => [
    perfil!,
    [...new Set([...listaDoFonte(mods), ...SEEDS_DE_MODULO.filter((s) => s.perfis.includes(perfil!)).map((s) => s.modulo)])],
  ]),
);

interface PaginaFonte {
  id: string;
  caminho: string;
  titulo: string;
  navegacao?: string;
  acao?: string;
  ordem?: number;
  apps: Array<'campo' | 'gestao'>;
}

/** Páginas declaradas no `moduloApp` do módulo (vazio se o módulo não tem telas: `export {}`). */
function paginasDoFonte(modulo: string): PaginaFonte[] {
  const arq = join(RAIZ, 'modules', modulo, 'app', 'index.ts');
  if (!existsSync(arq)) return [];
  const fonte = readFileSync(arq, 'utf8');
  // várias linhas (`paginas: [\n {...},\n ],`) ou uma só (`paginas: [{ ... }],`, como o Promotor)
  const bloco = /paginas:\s*\[([\s\S]*?)\n\s*\],/.exec(fonte)?.[1] ?? /paginas:\s*\[(.*)\],?\s*$/m.exec(fonte)?.[1] ?? '';
  return [...bloco.matchAll(/\{\s*id:\s*'([^']+)'([^\n]*)\}/g)].map(([, id, resto]) => {
    const campo = (k: string) => new RegExp(`(?:^|[\\s,{])${k}:\\s*'([^']+)'`).exec(resto!)?.[1];
    const apps = (/apps:\s*\[([^\]]*)\]/.exec(resto!)?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    const ordem = /(?:^|[\s,{])ordem:\s*(\d+)/.exec(resto!)?.[1];
    return { id: id!, caminho: campo('caminho')!, titulo: campo('titulo')!, navegacao: campo('navegacao'), acao: campo('acao'), ...(ordem ? { ordem: Number(ordem) } : {}), apps: apps as PaginaFonte['apps'] };
  });
}

const MODULOS: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) => ({
  manifesto: m,
  paginas: paginasDoFonte(m.id).map((p) => ({ ...p, componente: p.id })),
}));

/** Abas da variante para o perfil; `extra` = módulos ligados além da demo (tenant e perfil), como o admin faria no BKO. */
function abas(variante: 'campo' | 'gestao', perfil: Perfil, extra: string[] = []): string[] {
  const shell = criarShell<string>(variante, MODULOS);
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS as Manifesto[], ativosNoTenant: [...LICENCIADOS_DEMO, ...extra] as never, doPerfil: [...(DO_PERFIL[perfil] ?? []), ...extra] as never });
  return shell.montar({ perfil, modulosAtivos: ativos }).navegacao.map((n) => n.rotulo);
}

/**
 * T-0052 (Catálogo, PR #45 + 2ª etapa): a aba Catálogo entra quando `modules/catalogo/app/index.ts` declarar a página com
 * `navegacao` (manifesto: `apps.campo.abas` e `apps.gestao.abas` = ['Catálogo'], RN-CAT-04: todos os perfis do módulo).
 * Enquanto não houver, D-C00c segue `it.fails` e D-G00 espera só Clientes e Pedidos; quando houver, D-C00c vira `it` e
 * D-G00 passa a esperar também o Catálogo — sem editar este arquivo no merge (a virada é pelo fonte do módulo).
 */
const CATALOGO_TEM_ABA = paginasDoFonte('catalogo').some((p) => p.navegacao === 'Catálogo');
const seCatalogo = CATALOGO_TEM_ABA ? it : it.fails;
/** T-0055 (PR #40, no main): telas do Gestor prontas; na demo, só quando o seed licenciar o módulo para a supervisora. */
const ABAS_GESTOR = ['Equipe', 'Aprovações', 'Alertas'];
const GESTOR_NA_DEMO = LICENCIADOS_DEMO.includes('gestor') && (DO_PERFIL.supervisor ?? []).includes('gestor');
const seGestor = GESTOR_NA_DEMO ? it : it.fails;
/** T-0056: a aba Loja vem da página do Promotor com `navegacao: 'Loja'` e da licença do Promotor para o perfil promotor. */
const LOJA_NA_DEMO = paginasDoFonte('promotor').some((p) => p.navegacao === 'Loja') && LICENCIADOS_DEMO.includes('promotor') && (DO_PERFIL.promotor ?? []).includes('promotor');
const seLoja = LOJA_NA_DEMO ? it : it.fails;

describe('T-0028 — abas do app na demo (shell real, páginas do fonte)', () => {
  it('D-C00: Campo do vendedor tem Rota, Clientes, Metas e Pedidos; o do promotor não tem Pedidos (RN-PRO-01)', () => {
    const v = abas('campo', 'vendedor');
    for (const a of ['Rota', 'Clientes', 'Metas', 'Pedidos']) expect(v, `vendedor: ${a}`).toContain(a);
    const p = abas('campo', 'promotor');
    for (const a of ['Rota', 'Clientes', 'Metas']) expect(p, `promotor: ${a}`).toContain(a);
    expect(p).not.toContain('Pedidos');
  });

  seLoja(`D-C00b${LOJA_NA_DEMO ? '' : ' NÃO EXISTE'}: o promotor tem a aba Loja (trade: gôndola, share, preço, ruptura; T-0056) e continua sem Pedidos`, () => {
    expect(abas('campo', 'promotor')).not.toContain('Pedidos');
    expect(abas('campo', 'promotor')).toContain('Loja');
  });

  seCatalogo(`D-C00c${CATALOGO_TEM_ABA ? '' : ' NÃO EXISTE'}: a aba Catálogo no Campo do vendedor e do promotor (RN-CAT-04; T-0052)`, () => {
    expect(abas('campo', 'vendedor')).toContain('Catálogo');
    expect(abas('campo', 'promotor')).toContain('Catálogo');
  });

  it(`D-G00: o Gestão da supervisora monta Clientes${CATALOGO_TEM_ABA ? ', Catálogo' : ''} e Pedidos${GESTOR_NA_DEMO ? ', Equipe, Aprovações e Alertas' : ''} (o Início é do shell; T-0029 §7)`, () => {
    const esperadas = [...(CATALOGO_TEM_ABA ? ['Catálogo', 'Clientes', 'Pedidos'] : ['Clientes', 'Pedidos']), ...(GESTOR_NA_DEMO ? ABAS_GESTOR : [])];
    expect([...abas('gestao', 'supervisor')].sort()).toEqual(esperadas.sort());
  });

  it('D-G01 (T-0029): o Gestão tem a aba Pedidos (manifesto do Vendedor com apps.gestao; páginas pedidos/pedido em [campo, gestao]); novo-pedido só no Campo', () => {
    expect(abas('gestao', 'supervisor')).toContain('Pedidos');
    expect(paginasDoFonte('vendedor').find((p) => p.id === 'novo-pedido')?.apps).toEqual(['campo']);
  });

  it('D-G05a (T-0055): com o Gestor ligado (tenant + perfil), o Gestão da supervisora e do gerente tem Equipe, Aprovações e Alertas, Equipe antes de Aprovações; o Campo nunca tem', () => {
    for (const perfil of ['supervisor', 'gerente'] as const) {
      const g = abas('gestao', perfil, ['gestor']);
      for (const a of ABAS_GESTOR) expect(g, `${perfil}: ${a}`).toContain(a);
      expect(g.indexOf('Equipe')).toBeLessThan(g.indexOf('Aprovações'));
    }
    for (const perfil of ['vendedor', 'promotor'] as const) {
      const c = abas('campo', perfil, ['gestor']);
      for (const a of ABAS_GESTOR) expect(c, `Campo do ${perfil}: ${a}`).not.toContain(a);
    }
  });

  seGestor(`D-G05${GESTOR_NA_DEMO ? '' : ' NÃO LICENCIADO'}: na base demo o Gestão da supervisora tem Equipe e Aprovações (Gestor em MODULOS_DEMO e no perfil — R-20261102-131601-modulo-gestor ao banco-dados)`, () => {
    const g = abas('gestao', 'supervisor');
    expect(g).toContain('Equipe');
    expect(g).toContain('Aprovações');
  });
});
