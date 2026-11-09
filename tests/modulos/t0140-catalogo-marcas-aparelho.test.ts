/**
 * T-0140 (lote 03) — defeito possível encaminhado pelo corretor-redundancias (R-20261109-080707, §4 do
 * docs/qualidade/redundancias/2026-11-09-lote03.md): a aba Catálogo do aparelho lia as marcas concorrentes da entidade
 * `concorrente` do PROMOTOR, e não da `marca_concorrente` que o próprio sync do Catálogo entrega (RN-CAT-09, RN-CAT-13, ADR 0034).
 *
 * Veredito: DEFEITO no main 9d097404 (`modules/catalogo/app/lib/local.ts:125,135` liam `concorrente`). Desde a 0045 a API do
 * Promotor manda páginas VAZIAS de `concorrente` (`modules/promotor/api/sync-cadastros.ts`, legado até 08/12), sem lápide; o
 * aparelho que sincronizou antes da 0045 (perfil com o Promotor) guarda as linhas congeladas. Com elas o mapa de marcas não fica
 * vazio, então `nomeMarcaDaReferencia` deixa de usar o retrato `marca_nome` e:
 *  - a referência de marca criada depois da 0045 some do "Equivale a" (a marca não está no mapa congelado);
 *  - a marca renomeada no BKO continua com o nome velho;
 *  - a marca reativada depois de inativa antes da 0045 continua escondida.
 * Sem linhas de `concorrente` (vendedor, tenant sem Promotor) o retrato salvava o nome, e a lápide da referência (ADR 0034 §6)
 * escondia a marca inativa: por isso o defeito não aparecia na demo do vendedor.
 * A árvore local do lote 03 já lê `marca_concorrente` (correção do modulo-catalogo, sem commit em 09/11). Estes casos travam a
 * correção: com o `local.ts` do main, 5 dos 6 casos falham (M1 a M4 e M6; conferido em 09/11 com uma cópia temporária).
 *
 * Nível: integração no aparelho, com o motor de sync REAL do SDK, o SQLite em memória (node:sqlite) com a migração real do
 * Catálogo e as entidades reais do shell (`entidadesSync` do `modules/catalogo/app/index.ts`), servidor de sync simulado.
 * Sem banco e sem Docker: roda local e no CI. Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoSqlite,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  type LinhaSync,
  type MotorSync,
  type ServidorSyncSimulado,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { beforeEach, describe, expect, it } from 'vitest';
import { migracoesAparelho } from '../../modules/catalogo/db/aparelho';
import { INDICE_BUSCA_CATALOGO } from '../../modules/catalogo/app/indice';
import { esquecerMemoriaLocal, marcasConcorrentesLocais, produtosLocais, type LeitorLocal } from '../../modules/catalogo/app/lib/local';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { entidadesSyncCatalogo } from './apoio/entidades-catalogo';

const relogio = criarRelogio();
const CARGA = relogio.relativo({ horas: -3 }).toISOString();
const MUDANCA = relogio.relativo({ horas: -1 }).toISOString();

const PRODUTO = '0ca10000-0000-4000-8000-000000000001';
const PRODUTO_2 = '0ca10000-0000-4000-8000-000000000002';
/** Marcas do cadastro do Catálogo (0045 copiou os ids do Promotor: os mesmos ids). */
const COBREQ = '0ca10000-0000-4000-8000-0000000000a1';
const FRASLE = '0ca10000-0000-4000-8000-0000000000a2';
/** Marca criada no Catálogo DEPOIS da 0045: não existe na `concorrente` congelada do aparelho. */
const SYL = '0ca10000-0000-4000-8000-0000000000a3';

const linha = (id: string, o: Record<string, unknown>, updated_at = CARGA): LinhaSync => ({ id, updated_at, deleted_at: null, external_id: null, ...o }) as LinhaSync;
const produto = (id: string, sku: string, nome: string) => linha(id, { sku, ean: null, nome, marca: 'Fremax', categoria: 'Freios', unidade: 'UN', ativo: true });
const marca = (id: string, nome: string, ativo = true, updated_at = CARGA) => linha(id, { nome, ativo }, updated_at);
const referencia = (id: string, produtoId: string, marcaId: string, marcaNome: string | null, codigo: string, ordem: number) =>
  linha(id, { produto_id: produtoId, marca_id: marcaId, marca_nome: marcaNome, codigo, ordem });

function baseServidor(): Record<string, LinhaSync[]> {
  return {
    produto: [produto(PRODUTO, 'PF-001', 'Pastilha de freio dianteira'), produto(PRODUTO_2, 'PF-002', 'Pastilha de freio traseira')],
    produto_unidade: [],
    medida: [],
    produto_atributo: [],
    produto_conteudo: [],
    sinonimo: [],
    marca_concorrente: [marca(COBREQ, 'Cobreq'), marca(FRASLE, 'Fras-le'), marca(SYL, 'Syl')],
    produto_referencia: [
      referencia('0ca10000-0000-4000-8000-0000000000b1', PRODUTO, COBREQ, 'Cobreq', 'N-123', 1),
      referencia('0ca10000-0000-4000-8000-0000000000b2', PRODUTO, FRASLE, 'Fras-le', 'PD/77', 2),
      referencia('0ca10000-0000-4000-8000-0000000000b3', PRODUTO_2, SYL, 'Syl', 'SY-9', 1),
    ],
  };
}

const MANIFESTOS = [manifestoCore, manifestoCatalogo];
const ENTIDADES_APARELHO = [...entidadesProduto, ...entidadesSyncCatalogo()];

interface Aparelho {
  motor: MotorSync;
  servidor: ServidorSyncSimulado;
  leitor: LeitorLocal;
  /** Entidades que a aba Catálogo leu (para provar que não lê o Promotor). */
  lidas: string[];
}

/** Aparelho de um tenant SEM o Promotor (só Core e Catálogo): a lista de marcas tem de chegar mesmo assim (RN-CAT-13). */
async function aparelho(): Promise<Aparelho> {
  const registro = criarRegistroSync(MANIFESTOS);
  for (const e of ENTIDADES_APARELHO) registro.registrar(e);
  const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'catalogo'], linhas: baseServidor() });
  const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
    migracoesModulos: { catalogo: migracoesAparelho },
    indicesBusca: [INDICE_BUSCA_CATALOGO],
    entidades: ENTIDADES_APARELHO.map((e) => ({ nome: e.nome, modulo: e.modulo })),
  });
  const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, online: () => servidor.online });
  await motor.aplicarModulosAtivos(['core', 'catalogo']);
  expect(await motor.sincronizar(), 'carga inicial').toBe(true);
  const lidas: string[] = [];
  // o leitor da tela (o motor), com a versão das linhas: a memória da aba Catálogo é a de produção
  const leitor: LeitorLocal = {
    linhas: (e) => {
      lidas.push(e);
      return motor.linhas(e);
    },
    versaoLinhas: (e) => motor.versaoLinhas(e),
  };
  return { motor, servidor, leitor, lidas };
}

const equivaleA = async (leitor: LeitorLocal, produtoId: string) =>
  ((await produtosLocais(leitor)).find((p) => p.id === produtoId)?.referencias ?? []).map((r) => `${r.marca_nome} ${r.codigo}`);

describe('T-0140 lote 03 — marcas concorrentes no aparelho: a aba Catálogo lê a marca_concorrente do próprio Catálogo (RN-CAT-09/13, ADR 0034)', () => {
  beforeEach(() => esquecerMemoriaLocal());

  it('M1. tenant sem o Promotor: a marca_concorrente chega pelo sync e o "Equivale a" mostra as marcas, sem ler a entidade do Promotor', async () => {
    const ap = await aparelho();
    expect((await ap.motor.linhas('marca_concorrente')).map((m) => m.id).sort()).toEqual([COBREQ, FRASLE, SYL].sort());
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Cobreq N-123', 'Fras-le PD/77']);
    expect(await equivaleA(ap.leitor, PRODUTO_2)).toEqual(['Syl SY-9']);
    expect(ap.lidas).toContain('marca_concorrente');
    expect(ap.lidas).not.toContain('concorrente');
  });

  it('M2. marca renomeada no BKO: o nome vivo do cadastro manda, mesmo antes de o retrato marca_nome da referência chegar (memória relida pela versão)', async () => {
    const ap = await aparelho();
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Cobreq N-123', 'Fras-le PD/77']); // memoriza
    // só a marca muda nesta página (a referência com o retrato novo pode vir em página seguinte)
    ap.servidor.linhas.marca_concorrente = ap.servidor.linhas.marca_concorrente!.map((m) => (m.id === COBREQ ? { ...m, nome: 'Cobreq Freios', updated_at: MUDANCA } : m));
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Cobreq Freios N-123', 'Fras-le PD/77']);
  });

  it('M3. marca inativada no BKO: a referência sai do "Equivale a" do aparelho já com a marca, sem depender da lápide da referência', async () => {
    const ap = await aparelho();
    ap.servidor.linhas.marca_concorrente = ap.servidor.linhas.marca_concorrente!.map((m) => (m.id === FRASLE ? { ...m, ativo: false, updated_at: MUDANCA } : m));
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Cobreq N-123']);
    // reativada: volta
    ap.servidor.linhas.marca_concorrente = ap.servidor.linhas.marca_concorrente!.map((m) => (m.id === FRASLE ? { ...m, ativo: true, updated_at: relogio.relativo({ minutos: -30 }).toISOString() } : m));
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Cobreq N-123', 'Fras-le PD/77']);
  });

  it('M4. aparelho com linhas antigas da `concorrente` do Promotor (sync de antes da 0045, congeladas): nada delas vale; marca nova, nome novo e reativação aparecem', async () => {
    const ap = await aparelho();
    // o que um aparelho de promotor guardou antes da 0045: mesmos ids, nome velho, Fras-le inativa, sem a Syl (criada depois)
    const congeladas = [marca(COBREQ, 'Cobreq (antiga)'), marca(FRASLE, 'Fras-le', false)];
    const leitor: LeitorLocal = {
      linhas: async <L extends LinhaSync>(e: string) => (e === 'concorrente' ? (congeladas as L[]) : ap.motor.linhas<L>(e)),
    };
    expect(await equivaleA(leitor, PRODUTO)).toEqual(['Cobreq N-123', 'Fras-le PD/77']);
    expect(await equivaleA(leitor, PRODUTO_2)).toEqual(['Syl SY-9']);
    const mapa = await marcasConcorrentesLocais(leitor);
    expect([...mapa.keys()].sort()).toEqual([COBREQ, FRASLE, SYL].sort());
  });

  it('M5. primeiro sync sem nenhuma marca no aparelho (lista vazia ou entidade ilegível): cai no retrato marca_nome; sem retrato, a referência não aparece', async () => {
    const ap = await aparelho();
    const semMarcas = (falhar: boolean): LeitorLocal => ({
      linhas: async <L extends LinhaSync>(e: string) => {
        if (e === 'marca_concorrente') {
          if (falhar) throw new Error('entidade ainda não criada no aparelho');
          return [] as L[];
        }
        const l = await ap.motor.linhas<L>(e);
        // a referência da Syl sem retrato (linha antiga do ERP)
        return e === 'produto_referencia' ? (l.map((x) => ((x as unknown as { marca_id: string }).marca_id === SYL ? { ...x, marca_nome: null } : x)) as L[]) : l;
      },
    });
    for (const falhar of [false, true]) {
      esquecerMemoriaLocal();
      expect(await equivaleA(semMarcas(falhar), PRODUTO)).toEqual(['Cobreq N-123', 'Fras-le PD/77']);
      expect(await equivaleA(semMarcas(falhar), PRODUTO_2)).toEqual([]);
    }
  });

  it('M6. marca apagada (lápide da marca_concorrente): a referência dela some, as outras ficam', async () => {
    const ap = await aparelho();
    ap.servidor.linhas.marca_concorrente = ap.servidor.linhas.marca_concorrente!.map((m) => (m.id === COBREQ ? { ...m, deleted_at: MUDANCA, updated_at: MUDANCA } : m));
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await equivaleA(ap.leitor, PRODUTO)).toEqual(['Fras-le PD/77']);
  });
});
