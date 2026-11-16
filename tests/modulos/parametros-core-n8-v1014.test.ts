/**
 * v1.0.14 — painéis do Core no menu Parâmetros (#457, ADR 0060) e o "parado" só em Parâmetros › Alertas (#456 dentro do #457):
 * notas N8 do corretor. Matriz: docs/testes/v1014-parametros.md (seções "Core" e "Início × Alertas").
 * - Visão real do BKO: `SHELL_WEB.montar` (apps/web/lib/modulos.ts) com os manifestos e os `paineisParametros` reais, por perfil e
 *   por licença. O shell desenha o `Panel` com o `titulo` do painel e o componente chega com `semMoldura` (`Moldura` do Core).
 * - Contrato: `ParametrosInicioPutSchema` (corpo do PUT do Início) e `ParametroParadoMinSchema` (PUT de Parâmetros › Alertas).
 * A API real (400 do PUT do Início com `parado_min`, faixa e idempotência do `parado-min`, contagem das frases, 403) está em
 * tests/integracao/api/parametros-core-v1014.test.ts (banco). O e2e da tela está em tests/e2e/bko/menu-parametros.spec.ts.
 * Antes do #421 (SDK com `parametros` na visão) e do #457 (`moldura.tsx`, rota do parado) os blocos pulam: os tipos novos são
 * declarados aqui, sem importar símbolo que só existe nos PRs (o typecheck:tests passa no main com e sem eles).
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto com ID (quando corrigir, fica vermelho e vira `it`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';
import { SHELL_WEB } from '../../apps/web/lib/modulos';
import * as contratos from '../../modules/core/contracts';

const RAIZ = join(__dirname, '..', '..');
const MOLDURA = 'modules/core/web/components/moldura.tsx';
/** #457 no código: a moldura dos painéis do Core e a rota própria do parado no contrato. */
const TEM_457 = existsSync(join(RAIZ, MOLDURA)) && (contratos as unknown as Record<string, unknown>).CAMINHO_PARAMETRO_PARADO_MIN === 'parametros/parado-min';

interface PainelVisivel {
  modulo: ModuloId;
  id: string;
  titulo: string;
  origem: 'painel' | 'pagina';
}
interface SecaoVisivel {
  secao: string;
  bloqueado: boolean;
  paineis: PainelVisivel[];
}
interface VisaoComParametros {
  parametros?: SecaoVisivel[];
  pode(acao: string): boolean;
}
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'];
const montar = SHELL_WEB.montar as unknown as (ctx: { perfil: Perfil; modulosAtivos: readonly ModuloId[]; modulosContratados?: readonly ModuloId[] }) => VisaoComParametros;
const visao = (perfil: Perfil, modulosAtivos: readonly ModuloId[] = TODOS, modulosContratados?: readonly ModuloId[]) => {
  const v = montar({ perfil, modulosAtivos, ...(modulosContratados ? { modulosContratados } : {}) });
  return { ...v, pode: (a: string) => v.pode(a), parametros: v.parametros ?? [] };
};
const painel = (perfil: Perfil, secao: string, id: string, ativos?: readonly ModuloId[]) =>
  visao(perfil, ativos).parametros.find((s) => s.secao === secao)?.paineis.find((p) => p.id === id) ?? null;

type PropsMoldura = { sem?: boolean; title?: ReactNode; children: ReactNode };
const carregarMoldura = async () => ((await import(join(RAIZ, MOLDURA))) as { Moldura: ComponentType<PropsMoldura> }).Moldura;

/** Símbolos do contrato do Core que só existem com o #457 (lidos em tempo de execução). */
type Objeto = ZodObject<ZodRawShape>;
const contratosCore = contratos as unknown as {
  ParametrosInicioPutSchema: Objeto;
  ParametrosInicioSchema: Objeto;
  CAMPOS_PARAMETROS_INICIO: readonly string[];
  PARAMETRO_ALMOCO_PADRAO?: string;
  CAMINHO_PARAMETRO_PARADO_MIN?: string;
  ParametroParadoMinSchema: Objeto;
  ParametrosAlertasProdutividadeSchema: ZodObject<Record<string, ZodTypeAny> & { parado_entre_visitas: Objeto }>;
  paradoMinDasLinhas(linhas: readonly { modulo: string; chave: string; valor: unknown }[]): number;
};

// ------------------------------------------------------------------------------------------------ N8 nota 1: Frases do dia

describe.runIf(TEM_457)('Parâmetros › Início › Frases do dia (RN-CORE-41): quem vê e o rótulo × valor do título', () => {
  it('analista e admin (frase_dia.editar) veem o painel em Início; gerente, sem a ação, não (a API também nega o GET)', () => {
    for (const p of ['analista', 'admin'] as const) expect(painel(p, 'inicio', 'frases-do-dia'), p).toMatchObject({ modulo: 'core', origem: 'painel' });
    expect(painel('gerente', 'inicio', 'frases-do-dia')).toBeNull();
  });

  // N8-PAR-1 (modulo-core, média; modules/core/web/index.ts e components/frases-do-dia/frases-do-dia-panel.tsx): o contador vive
  // no `title` da `Moldura` (`Frases do dia · ${q.data.length}`), mas na página Parâmetros o painel chega com `semMoldura` e o shell
  // desenha o `Panel` com o `titulo` fixo "Frases do dia". O "· N" (número de frases cadastradas, ativas e desativadas, o que
  // GET /v1/core/frases devolve) não aparece. Pronto quando o título exibido na página trouxer o número real.
  it.fails('N8-PAR-1: na página Parâmetros o título mostra "Frases do dia · N" com N = número de frases da lista', async () => {
    const Moldura = await carregarMoldura();
    const frases = ['a', 'b', 'c'];
    const p = painel('admin', 'inicio', 'frases-do-dia');
    expect(p).not.toBeNull();
    // o que a página desenha: o título do Panel do shell + o que o componente desenha com semMoldura
    const doComponente = renderToStaticMarkup(createElement(Moldura, { sem: true, title: `Frases do dia · ${frases.length}`, children: 'lista' }));
    const exibido = `${p!.titulo} ${doComponente}`;
    expect(exibido).toContain(`Frases do dia · ${frases.length}`);
  });

  it('fora da página Parâmetros (com moldura) o componente leva o contador no título', async () => {
    const Moldura = await carregarMoldura();
    const html = renderToStaticMarkup(createElement(Moldura, { title: 'Frases do dia · 3', children: 'lista' }));
    expect(html).toContain('Frases do dia · 3');
  });
});

// ------------------------------------------------------------------------------------------------ N8 nota 1: só consulta

describe.runIf(TEM_457)('Perfil só consulta (P4): vê o painel em modo leitura, sem salvar', () => {
  it('analista e admin (medida.gerenciar) veem Medidas em Parâmetros › Produtos', () => {
    for (const p of ['analista', 'admin'] as const) expect(painel(p, 'produtos', 'medidas'), p).not.toBeNull();
  });

  // N8-PAR-2 (modulo-core, média; modules/core/web/index.ts, painel `medidas`): antes do #457 o gerente abria Medidas na aba de
  // Preço e custo (página com `produto.editar_preco`) e via a lista em modo consulta ("Você pode consultar", botões desligados);
  // `GET /v1/core/medidas` segue com `produto.editar_preco` (gerente, analista, admin). O painel novo exige `medida.gerenciar`
  // (analista, admin) e o gerente perde a tela. Pronto quando o painel usar a ação de leitura (o `MedidasPanel` já trava a edição
  // por `usePode('medida.gerenciar')`).
  it.fails('N8-PAR-2: gerente (só consulta) vê o painel Medidas em Parâmetros › Produtos', () => {
    expect(painel('gerente', 'produtos', 'medidas')).not.toBeNull();
  });

  it('gerente não ganha ação de edição: medida.gerenciar, frase_dia.editar e parametro.inicio seguem fora do perfil', () => {
    const v = visao('gerente');
    expect(['medida.gerenciar', 'frase_dia.editar', 'parametro.inicio', 'parametro.alertas_produtividade'].filter((a) => v.pode(a))).toEqual([]);
    expect(v.pode('produto.editar_preco')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ módulo e licença

describe.runIf(TEM_457)('Perfil sem o módulo e empresa sem licença (RN-CORE-01/03)', () => {
  it('perfil sem o Vendedor não vê Parâmetros › Pedidos (Alçadas); sem o Promotor, não vê Trade', () => {
    const semVendedor = visao('admin', TODOS.filter((m) => m !== 'vendedor'));
    expect(semVendedor.parametros.find((s) => s.secao === 'pedidos')?.paineis.some((p) => p.modulo === 'vendedor') ?? false).toBe(false);
    const semPromotor = visao('admin', TODOS.filter((m) => m !== 'promotor'), TODOS);
    expect(semPromotor.parametros.find((s) => s.secao === 'trade')).toBeUndefined();
  });

  it('empresa sem Pesquisa: a seção vem bloqueada e sem painéis (vitrine; a API responde 403 MODULO_INATIVO)', () => {
    const v = visao('admin', TODOS.filter((m) => m !== 'pesquisa'), TODOS.filter((m) => m !== 'pesquisa'));
    expect(v.parametros.find((s) => s.secao === 'pesquisa')).toMatchObject({ bloqueado: true, paineis: [] });
  });

  it('os painéis do Core não dependem de licença (o Core nunca sai: RN-CORE-03) e aparecem uma vez cada', () => {
    const v = visao('admin', ['core']);
    const core = v.parametros.flatMap((s) => s.paineis.filter((p) => p.modulo === 'core').map((p) => `${s.secao}/${p.id}`));
    expect(core).toEqual(expect.arrayContaining(['inicio/inicio', 'inicio/frases-do-dia', 'produtos/medidas', 'calendario/almoco']));
    expect(new Set(core).size).toBe(core.length);
  });
});

// ------------------------------------------------------------------------------------------------ N8 nota 2: Início × Alertas

describe.runIf(TEM_457)('Início × Alertas (RN-CORE-26): o "parado" mora só em Parâmetros › Alertas', () => {
  it('PUT do Início: corpo só com dias_uteis_semana; parado_min recusado (strict)', () => {
    const s = contratosCore.ParametrosInicioPutSchema;
    expect(Object.keys(s.shape)).toEqual(['dias_uteis_semana']);
    expect(s.safeParse({ dias_uteis_semana: [1, 2, 3, 4, 5] }).success).toBe(true);
    const r = s.safeParse({ dias_uteis_semana: [1, 2, 3, 4, 5], parado_min: 45 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['parado_min'] });
    expect(contratosCore.CAMPOS_PARAMETROS_INICIO).toEqual(['dias_uteis_semana']);
  });

  it('contrato do Início sem almoco_corte nem janela (o almoço é Parâmetros › Calendário, jornada.almoco_padrao)', () => {
    const chaves = [...Object.keys(contratosCore.ParametrosInicioPutSchema.shape), ...Object.keys(contratosCore.ParametrosInicioSchema.shape)];
    expect(chaves.filter((k) => /almoco|janela/.test(k))).toEqual([]);
    expect(contratosCore.PARAMETRO_ALMOCO_PADRAO).toBe('jornada.almoco_padrao');
  });

  it('Parâmetros › Alertas: rota própria do parado ({ parado_min }, strict) e faixa única 15..480 com padrão 60', () => {
    expect(contratosCore.CAMINHO_PARAMETRO_PARADO_MIN).toBe('parametros/parado-min');
    const s = contratosCore.ParametroParadoMinSchema;
    expect(s.safeParse({ parado_min: 45 }).success).toBe(true);
    expect(s.safeParse({ parado_min: 45, dias_uteis_semana: [1] }).success).toBe(false);
    expect(contratosCore.paradoMinDasLinhas([])).toBe(60);
    expect(contratosCore.paradoMinDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 14 }])).toBe(60);
    expect(contratosCore.paradoMinDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 15 }])).toBe(15);
    expect(contratosCore.paradoMinDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 480 }])).toBe(480);
    expect(contratosCore.paradoMinDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 481 }])).toBe(60);
  });

  it('o parâmetro dos alertas não guarda o parado (um valor, um lugar)', () => {
    const s = contratosCore.ParametrosAlertasProdutividadeSchema;
    expect(JSON.stringify(Object.keys(s.shape))).not.toMatch(/parado_min/);
    expect(Object.keys(s.shape.parado_entre_visitas.shape)).not.toContain('parado_min');
  });
});
