/**
 * v1.0.14 — painéis do Core no menu Parâmetros (#457, ADR 0060) e o "parado" só em Parâmetros › Alertas (#456 dentro do #457):
 * notas N8 do corretor. Matriz: docs/testes/v1014-parametros.md (seções "Core" e "Início × Alertas").
 * - Visão real do BKO: `SHELL_WEB.montar` (apps/web/lib/modulos.ts) com os manifestos e os `paineisParametros` reais, por perfil e
 *   por licença. O shell desenha o `Panel` com o `titulo` do painel; o componente não repete o título.
 * - Contrato: `ParametrosInicioPutSchema` (corpo do PUT do Início) e `ParametroParadoMinSchema` (PUT de Parâmetros › Alertas).
 * A API real (400 do PUT do Início com `parado_min`, faixa e idempotência do `parado-min`, contagem das frases, 403) está em
 * tests/integracao/api/parametros-core-v1014.test.ts (banco). O e2e da tela está em tests/e2e/bko/menu-parametros.spec.ts.
 * Sem o #457 (rota do parado no contrato e painéis do Core em `paineisParametros`) os blocos pulam; o #457 entrou no main
 * (squash) e os blocos rodam. Os símbolos novos seguem lidos em tempo de execução (o typecheck:tests não depende deles).
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto com ID (quando corrigir, fica vermelho e vira `it`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';
import { SHELL_WEB } from '../../apps/web/lib/modulos';
import * as contratos from '../../modules/core/contracts';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const WEB_CORE = ler('modules/core/web/index.ts');
/** #457 no código: os painéis do Core em `paineisParametros` e a rota própria do parado no contrato. */
const TEM_457 = /\bpaineisParametros\b/.test(WEB_CORE) && (contratos as unknown as Record<string, unknown>).CAMINHO_PARAMETRO_PARADO_MIN === 'parametros/parado-min';

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
const montar = SHELL_WEB.montar as unknown as (ctx: {
  perfil: Perfil;
  modulosAtivos: readonly ModuloId[];
  modulosContratados?: readonly ModuloId[];
  menuParametros?: boolean;
}) => VisaoComParametros;
/** `menuParametros: true`: o shell web com a rota `/parametros` (ADR 0060); sem ele o SDK monta o menu de antes, sem painéis. */
const visao = (perfil: Perfil, modulosAtivos: readonly ModuloId[] = TODOS, modulosContratados?: readonly ModuloId[]) => {
  const v = montar({ perfil, modulosAtivos, menuParametros: true, ...(modulosContratados ? { modulosContratados } : {}) });
  return { ...v, pode: (a: string) => v.pode(a), parametros: v.parametros ?? [] };
};
const painel = (perfil: Perfil, secao: string, id: string, ativos?: readonly ModuloId[]) =>
  visao(perfil, ativos).parametros.find((s) => s.secao === secao)?.paineis.find((p) => p.id === id) ?? null;

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

  // N8-PAR-1 (modulo-core, corrigido no #457 final): o contador "· N" vivia só no título da `Moldura` e sumia na página. O #457
  // tirou a `Moldura` e o contador: o título é o `titulo` do painel, sem número, e o componente não desenha outro título com
  // número. Rótulo × valor: nenhum número no título, logo nenhum número que possa divergir da lista.
  it('N8-PAR-1 corrigido: o título é "Frases do dia", sem contador, e o componente não desenha outro título com número', () => {
    expect(painel('admin', 'inicio', 'frases-do-dia')?.titulo).toBe('Frases do dia');
    const comp = ler('modules/core/web/components/frases-do-dia/frases-do-dia-panel.tsx');
    expect(comp).not.toMatch(/Frases do dia ·/);
    expect(comp).not.toMatch(/\bMoldura\b|semMoldura/);
  });
});

// ------------------------------------------------------------------------------------------------ N8 nota 1: só consulta

describe.runIf(TEM_457)('Perfil só consulta (P4): vê o painel em modo leitura, sem salvar', () => {
  it('analista e admin veem Medidas em Parâmetros › Produtos', () => {
    for (const p of ['analista', 'admin'] as const) expect(painel(p, 'produtos', 'medidas'), p).not.toBeNull();
  });

  // N8-PAR-2 (modulo-core, corrigido no #457 final): o painel usa `produto.editar_preco` (a mesma ação do GET /v1/core/medidas),
  // e o `MedidasPanel` trava a edição por `usePode('medida.gerenciar')` (gerente consulta, não salva).
  it('N8-PAR-2 corrigido: gerente (só consulta) vê o painel Medidas em Parâmetros › Produtos', () => {
    expect(painel('gerente', 'produtos', 'medidas')).not.toBeNull();
    expect(ler('modules/core/web/components/produtos/medidas-panel.tsx')).toMatch(/usePode\('medida\.gerenciar'\)/);
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
