/**
 * Acesso do BKO (R-20261114-144500/150500) — coerência perfil × módulos (RN-CORE-01/03) e contagem de usuários por perfil.
 *
 * - Regra real: `calcularModulosEfetivos` (com os manifestos reais) e `efetivosPelasDependencias` (a da tela, com o mapa de
 *   dependências que a API devolve). Percorre combinações de módulos do perfil, do tenant e de exceções do usuário (inclusive
 *   exceção de módulo que o perfil não tem): o usuário nunca tem módulo fora do perfil (salvo o core), a exceção só remove e o
 *   core nunca sai.
 * - Contagem por perfil: oráculo que conta a lista da tela Usuários pelo `perfis[].codigo`. Com `modules/core/web/lib/acesso.ts`
 *   (estado novo), `contagemPorPerfil` tem de bater com o oráculo e as telas têm de usá-la (fonte).
 * - "Usuários e módulos": o painel "Módulos" de Parâmetros recebe o link antigo (ADR 0060); fora do menu.
 * Sem banco. A conferência pela API real fica em tests/integracao/demo/demo-matriz.test.ts (CI).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import type { UsuarioItem } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { dependenciasDosManifestos, MODULOS, type ModuloId } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { calcularModulosEfetivos, efetivosPelasDependencias } from '../../modules/core/domain/licencas';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const MANIFESTOS = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];
const INSTALADOS = MANIFESTOS.map((m) => m.id);
const DEPENDENCIAS = dependenciasDosManifestos(MANIFESTOS);
const SEM_CORE = INSTALADOS.filter((m) => m !== 'core');

/** Todos os subconjuntos de `base` (2^n). */
function subconjuntos<T>(base: readonly T[]): T[][] {
  const saida: T[][] = [];
  for (let mascara = 0; mascara < 1 << base.length; mascara++) saida.push(base.filter((_, i) => mascara & (1 << i)));
  return saida;
}

const ordenado = (xs: readonly string[]) => [...xs].sort();

describe('RN-CORE-01/03 — perfil × módulos com a regra real (calcularModulosEfetivos e efetivosPelasDependencias)', () => {
  it('os manifestos reais cobrem todos os módulos da plataforma', () => {
    expect(ordenado(INSTALADOS)).toEqual(ordenado([...MODULOS]));
  });

  it('em todas as combinações de perfil × tenant × exceções: nada fora do perfil (salvo core), exceção só remove, core nunca sai', () => {
    const perfis = subconjuntos(SEM_CORE);
    const tenants = subconjuntos(SEM_CORE);
    let casos = 0;
    const erros: string[] = [];
    for (const doPerfil of perfis) {
      const fora = SEM_CORE.filter((m) => !doPerfil.includes(m));
      // exceções: nenhuma, o próprio core (não pode sair), cada módulo isolado (inclusive fora do perfil), só os de fora do perfil, todos
      const excecoes: ModuloId[][] = [[], ['core'], ...INSTALADOS.map((m) => [m]), fora, [...INSTALADOS]];
      for (const ativosNoTenant of tenants) {
        const semExcecao = calcularModulosEfetivos({ manifestos: MANIFESTOS, ativosNoTenant, doPerfil });
        for (const removidosDoUsuario of excecoes) {
          casos++;
          const efetivos = calcularModulosEfetivos({ manifestos: MANIFESTOS, ativosNoTenant, doPerfil, removidosDoUsuario });
          const daTela = efetivosPelasDependencias({ modulos: INSTALADOS, dependencias: DEPENDENCIAS, ativosNoTenant, doPerfil, removidosDoUsuario });
          const caso = `perfil=[${doPerfil.join(',')}] tenant=[${ativosNoTenant.join(',')}] exceção=[${removidosDoUsuario.join(',')}]`;
          if (efetivos.some((m) => m !== 'core' && !doPerfil.includes(m))) erros.push(`${caso}: módulo fora do perfil ${efetivos.join(',')}`);
          if (efetivos.some((m) => !semExcecao.includes(m))) erros.push(`${caso}: a exceção acrescentou módulo`);
          if (!efetivos.includes('core')) erros.push(`${caso}: o core saiu`);
          if (removidosDoUsuario.some((m) => m !== 'core' && efetivos.includes(m))) erros.push(`${caso}: módulo removido continua efetivo`);
          if (efetivos.some((m) => m !== 'core' && !ativosNoTenant.includes(m))) erros.push(`${caso}: módulo fora do tenant`);
          // a tela (sem manifestos) e a API (com manifestos) aplicam a MESMA regra
          if (ordenado(daTela).join() !== ordenado(efetivos).join()) erros.push(`${caso}: tela [${daTela.join(',')}] × API [${efetivos.join(',')}]`);
          if (erros.length > 20) break;
        }
      }
    }
    expect(erros).toEqual([]);
    expect(casos).toBe(128 * 128 * 12);
  });
});

// ------------------------------------------------------------------------------------------------ contagem por perfil

type ItemDaLista = Pick<UsuarioItem, 'perfil' | 'perfis' | 'ativo'>;
const perfilDe = (codigo: string) => ({ codigo, nome: codigo, base: 'vendedor' as const });
const LISTA: ItemDaLista[] = [
  { perfil: 'vendedor', ativo: true, perfis: [perfilDe('vendedor')] },
  { perfil: 'vendedor', ativo: true, perfis: [perfilDe('vendedor'), perfilDe('promotor')] },
  { perfil: 'vendedor', ativo: false, perfis: [perfilDe('vendedor'), perfilDe('vendedor-externo')] }, // inativo também conta
  { perfil: 'supervisor', ativo: true, perfis: [perfilDe('supervisor'), perfilDe('supervisor')] }, // repetido conta uma vez
  { perfil: 'admin', ativo: true, perfis: [perfilDe('admin')] },
  { perfil: 'promotor', ativo: true, perfis: [perfilDe('promotor')] },
];

/** Oráculo: quantos usuários da lista (ativos e inativos) têm o código em `perfis[]` — o que a tela Usuários mostra filtrada pelo perfil. */
const contarNaLista = (lista: readonly ItemDaLista[], codigo: string) => lista.filter((u) => u.perfis.some((p) => p.codigo === codigo)).length;

const ACESSO = 'modules/core/web/lib/acesso.ts';
const ESTADO_NOVO = existsSync(join(RAIZ, ACESSO));

/** Tipagem à mão: o arquivo não existe antes do PR do Acesso (import estático quebraria o typecheck). */
interface LibAcesso {
  contagemPorPerfil(usuarios: readonly Pick<UsuarioItem, 'perfil' | 'perfis'>[]): Record<string, number>;
  modulosForaDoPerfil(modulosDoPerfil: Iterable<string>, modulosDoUsuario: Iterable<string>): string[];
  modulosCoerentes(modulosDoPerfil: Iterable<string>, modulosDoUsuario: Iterable<string>): { id: string; nome: string }[];
  removidosDoFormulario(modulosDoPerfil: Iterable<string>, marcados: ReadonlySet<string>): string[];
}
const carregarAcesso = async (): Promise<LibAcesso> => {
  const caminho = join(RAIZ, ACESSO);
  return (await import(caminho)) as LibAcesso;
};

describe('Perfis de acesso — contagem de usuários por perfil × lista de Usuários', () => {
  it('oráculo: conta pelo perfis[].codigo, inativo conta, código repetido conta uma vez', () => {
    expect(['vendedor', 'promotor', 'vendedor-externo', 'supervisor', 'admin', 'gerente'].map((c) => contarNaLista(LISTA, c))).toEqual([3, 2, 1, 1, 1, 0]);
  });

  it.runIf(ESTADO_NOVO)('contagemPorPerfil (lib/acesso.ts) = oráculo, para todo perfil da lista', async () => {
    const { contagemPorPerfil } = await carregarAcesso();
    const contagem = contagemPorPerfil(LISTA);
    const codigos = new Set(LISTA.flatMap((u) => u.perfis.map((p) => p.codigo)));
    for (const c of codigos) expect(contagem[c] ?? 0, c).toBe(contarNaLista(LISTA, c));
    expect(contagem.gerente ?? 0).toBe(0);
  });

  it.runIf(ESTADO_NOVO)('a tela Perfis de acesso conta com contagemPorPerfil sobre a lista de GET /core/usuarios', () => {
    const tela = ler('modules/core/web/components/perfis/perfis-page.tsx');
    expect(tela).toMatch(/import \{[^}]*\bcontagemPorPerfil\b[^}]*\} from '\.\.\/\.\.\/lib\/acesso'/);
    expect(tela).toMatch(/api\('\/core\/usuarios'\)/);
    expect(tela).toMatch(/contagemPorPerfil\(/);
  });

  it.runIf(ESTADO_NOVO)('a tela Usuários grava as exceções com removidosDoFormulario (só remove módulo do perfil)', async () => {
    const tela = ler('modules/core/web/components/usuarios/usuarios-page.tsx');
    expect(tela).toMatch(/\bremovidosDoFormulario\(/);
    const { removidosDoFormulario, modulosForaDoPerfil, modulosCoerentes } = await carregarAcesso();
    // só sai o que o perfil tem e o admin desmarcou; módulo fora do perfil nunca vira exceção nem aparece no usuário
    expect(removidosDoFormulario(['vendedor', 'promotor'], new Set(['vendedor']))).toEqual(['promotor']);
    expect(removidosDoFormulario(['vendedor'], new Set(['vendedor', 'gestor']))).toEqual([]);
    expect(modulosForaDoPerfil(['vendedor'], ['vendedor', 'gestor'])).toEqual(['gestor']);
    expect(modulosCoerentes(['vendedor'], ['vendedor', 'gestor']).map((m) => m.id)).toEqual(['vendedor']);
  });
});

// ------------------------------------------------------------------------------------------------ rota por URL

describe('"Usuários e módulos" — o link antigo segue por URL (vai para Parâmetros, ADR 0060); fora do menu', () => {
  const web = ler('modules/core/web/index.ts');
  const bloco = /\{\s*id: 'usuarios-e-modulos',[\s\S]*?componente: \w+,?\s*\}/.exec(web)?.[0] ?? '';

  // ADR 0060 (#457): a página virou o painel "Módulos" de /parametros/acesso; o shell redireciona /usuarios-e-modulos pelos `caminhosAntigos`
  it('o painel segue registrado (id `usuarios-e-modulos`, seção acesso, caminho antigo `usuarios-e-modulos`, ação modulo.gerir_licencas)', () => {
    expect(bloco, 'modules/core/web/index.ts: painel usuarios-e-modulos').not.toBe('');
    expect(bloco).toMatch(/secao: 'acesso'/);
    expect(bloco).toMatch(/caminhosAntigos: \[[^\]]*'usuarios-e-modulos'[^\]]*\]/);
    expect(bloco).toMatch(/acao: 'modulo\.gerir_licencas'/);
  });

  it('menu × manifesto: o item existe nos dois ou em nenhum; no estado novo, em nenhum', () => {
    const noMenu = /^\s*navegacao: 'Usuários e módulos'/m.test(bloco);
    const noManifesto = core.apps.web?.menus?.includes('Usuários e módulos') ?? false;
    expect(noMenu).toBe(noManifesto);
    if (ESTADO_NOVO) expect([noMenu, noManifesto]).toEqual([false, false]);
    // os itens que ficam no menu Acesso
    expect(core.apps.web?.menus).toEqual(expect.arrayContaining(['Usuários', 'Perfis de acesso']));
  });

  it('sem página paralela nem item de menu "Usuários e módulos" (uma informação, um lugar)', () => {
    const paginas = /\bpaginas: \[[\s\S]*?\n {2}\],/.exec(web)?.[0] ?? '';
    expect(paginas, 'modules/core/web/index.ts: bloco paginas').not.toBe('');
    expect(paginas).not.toMatch(/caminho: 'usuarios-e-modulos'/);
    expect(core.apps.web?.menus ?? []).not.toContain('Usuários e módulos');
    if (ESTADO_NOVO) expect(web).not.toMatch(/navegacao: 'Usuários e módulos'/);
  });
});
