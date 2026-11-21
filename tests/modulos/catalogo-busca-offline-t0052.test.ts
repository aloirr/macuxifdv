/**
 * T-0052 (Catálogo) — busca OFFLINE no aparelho com o índice FTS5 REAL do Catálogo (agente `testes`; pedido
 * R-20261102-132611-3-modulo-catalogo, item 3 "offline"). Roda sem Postgres e sem Docker (node:sqlite em memória).
 *
 * O que já está coberto e NÃO se repete aqui:
 *  - modules/catalogo/app/lib/local.test.ts: `buscarLocal` sobre um mapa de linhas e um `buscar` FALSO (sinônimo,
 *    inativo, atributo, preço da tabela do cliente, promotor sem preço, pré-seleção chamada acima do limiar);
 *  - modules/catalogo/app/indice.test.ts: colunas e `documento()` do índice;
 *  - packages/platform-sdk/src/busca.test.ts: FTS5 genérico com um índice de TESTE (sanitização, manutenção, RN-CORE-02);
 *  - tests/integracao/demo/smoke-demo.test.ts S2b: `buscarLocal` no aparelho da demo (armazenamento chave→JSON, sem FTS5).
 *
 * O que falta e entra aqui (integração entre platform-sdk, Core e Catálogo no aparelho): o motor de sync REAL com as
 * entidades REAIS (`produto` do Core; preço, atributos e sinônimos do Catálogo), o adaptador SQLite com a migração v1
 * REAL do Catálogo (`modules/catalogo/db/aparelho.ts`, dono banco-dados) e o índice REAL (`app/indice.ts`), e a busca
 * da tela (`app/lib/local.ts` → domain) num catálogo acima de `LIMIAR_PRESELECAO_FTS`, onde o FTS5 pré-seleciona os
 * candidatos de verdade:
 *  O1 sem sinal, acha pelo sinônimo do tenant, pelo atributo e pelo código digitado sem hífen, com o aviso discreto, sem
 *     nenhuma chamada ao servidor (RF-CAT-02);
 *  O2 a pré-seleção do FTS5 não perde resultado: mesmos itens, na mesma ordem, que a varredura completa do domain;
 *  O3 sinônimo removido e produto inativado no servidor saem do aparelho no próximo sync (índice e resultado; RN-CAT-01);
 *  O4 promotor: a mesma busca offline acha o produto, sem preço nem estoque, mesmo com o preço gravado no aparelho
 *     (RN-CAT-05; regra 7: o Catálogo não oferece nada de pedido — isso é do slot `produto.acoes` do Vendedor);
 *  O5 Catálogo desligado (RN-CORE-02): a FTS e os sinônimos somem do aparelho; religado, o índice volta e a busca também.
 * Defeitos corrigidos pelo modulo-catalogo (eram `it.fails`; R-20261105-131136-modulo-catalogo, viraram `it`):
 *  O2b T-0052-B2 a pré-seleção do FTS5 é a UNIÃO dos termos (antes AND): o catálogo grande dá o mesmo que o pequeno;
 *  O6  T-0052-B1 código digitado sem hífen ("pasdia150"): o domain compara a forma compacta do SKU.
 * Desempenho (T-0052-B4, R-20261105-131126-modulo-catalogo; sem asserção de tempo aqui, o orçamento fica em
 * modules/catalogo/domain/ranking.test.ts): o ranking passa só pelos candidatos do FTS5; o arquivo roda em segundos.
 * Matriz: docs/testes/T-0052.md (B-O1..B-O6).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoSqlite,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  listarObjetos,
  type ConsultaTexto,
  type LinhaSync,
  type MotorSync,
  type Perfil,
  type ServidorSyncSimulado,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { migracoesAparelho, TABELAS_BUSCA_CATALOGO } from '../../modules/catalogo/db/aparelho';
import { INDICE_BUSCA_CATALOGO } from '../../modules/catalogo/app/indice';
import { buscarLocal, ID_INDICE_BUSCA, LIMIAR_PRESELECAO_FTS, type LeitorLocal } from '../../modules/catalogo/app/lib/local';
import { AVISO_BUSCA_OFFLINE } from '../../modules/catalogo/domain/ia';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { entidadesSyncCatalogo } from './apoio/entidades-catalogo';

const relogio = criarRelogio();
/** Carga inicial 3 h atrás; mudanças do servidor 1 h atrás (cursor do pull anda para frente). */
const CARGA = relogio.relativo({ horas: -3 }).toISOString();
const MUDANCA = relogio.relativo({ horas: -1 }).toISOString();

let seq = 0;
const uid = (grupo: number) => `00000000-0000-4000-8${grupo.toString(16).padStart(3, '0')}-${(++seq).toString(16).padStart(12, '0')}`;
const linha = (id: string, o: Record<string, unknown>, updated_at = CARGA): LinhaSync => ({ id, updated_at, deleted_at: null, external_id: null, ...o }) as LinhaSync;

// ---------- base do servidor ----------

const PRODUTO = {
  oleo: uid(1),
  pastilha: uid(1),
  lona: uid(1),
  fluido: uid(1),
};
const SKU: Record<string, string> = { [PRODUTO.oleo]: 'OLE-4T-1L', [PRODUTO.pastilha]: 'PAS-DIA-150', [PRODUTO.lona]: 'LON-TRA-125', [PRODUTO.fluido]: 'FLU-DOT4-500' };
const TABELA = uid(2);
const CLIENTE = uid(3);
const DEPOSITO = uid(4);
/** Acima do limiar: com o catálogo grande o `buscarLocal` pede candidatos ao FTS5 antes do ranking. */
const ENCHIMENTO = LIMIAR_PRESELECAO_FTS + 150;

function produto(id: string, sku: string, nome: string, marca: string, categoria: string, o: Partial<{ ativo: boolean; updated_at: string }> = {}): LinhaSync {
  return linha(id, { sku, ean: null, nome, marca, categoria, unidade: 'UN', ativo: o.ativo ?? true }, o.updated_at);
}

function baseServidor(): Record<string, LinhaSync[]> {
  const alvo = [
    produto(PRODUTO.oleo, 'OLE-4T-1L', 'Óleo para motor 4T 20W50 1 L (motos 125 a 160 cc)', 'Lubrax', 'Lubrificantes'),
    produto(PRODUTO.pastilha, 'PAS-DIA-150', 'Pastilha de freio dianteira', 'Norfreio', 'Freios'),
    produto(PRODUTO.lona, 'LON-TRA-125', 'Lona de freio traseira', 'Fras-le', 'Freios'),
    produto(PRODUTO.fluido, 'FLU-DOT4-500', 'Fluido de freio DOT 4 500 ml', 'Bosch', 'Freios'),
  ];
  const enchimento = Array.from({ length: ENCHIMENTO }, (_, k) => produto(uid(9), `PAR-${k}`, `Parafuso sextavado zincado M${6 + (k % 10)} x ${20 + k}`, 'Ciser', 'Fixação'));
  const todos = [...alvo, ...enchimento];
  return {
    produto: todos,
    produto_unidade: [],
    medida: [],
    produto_atributo: [
      linha(uid(5), { produto_id: PRODUTO.pastilha, nome: 'Cilindrada', valor: '150 cc', ordem: 1 }),
      linha(uid(5), { produto_id: PRODUTO.lona, nome: 'Material', valor: 'Cerâmica', ordem: 1 }),
    ],
    sinonimo: [
      linha(uid(6), { termo: 'pastilha', sinonimos: ['sapata'], ativo: true }),
      linha(uid(6), { termo: 'oleo', sinonimos: ['lubrificante'], ativo: true }),
      linha(uid(6), { termo: 'moto', sinonimos: ['motocicleta', 'motos'], ativo: true }),
    ],
    deposito: [linha(DEPOSITO, { codigo: 'CD1', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: alvo.map((p) => linha(uid(7), { produto_id: p.id, deposito_id: DEPOSITO, quantidade: 40, atualizado_em: CARGA })),
    produto_conteudo: [],
    tabela_preco: [linha(TABELA, { codigo: 'VAREJO', nome: 'Varejo', ativo: true })],
    tabela_preco_item: todos.map((p) => linha(uid(8), { tabela_preco_id: TABELA, produto_id: p.id, preco_cents: 1_990, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [linha(uid(8), { cliente_id: CLIENTE, tabela_preco_id: TABELA })],
  };
}

// ---------- aparelho: motor real + SQLite com a migração e o índice reais do Catálogo ----------

const MANIFESTOS = [manifestoCore, manifestoCatalogo];
/** Core: `produto`; Catálogo: o `entidadesSync` do shell real (`modules/catalogo/app/index.ts`), com as tabelas que a migração exige (v4: `produto_no` e `produto_relacao`). */
const ENTIDADES_APARELHO = [...entidadesProduto, ...entidadesSyncCatalogo()];

interface Aparelho {
  motor: MotorSync;
  servidor: ServidorSyncSimulado;
  driver: ReturnType<typeof criarDriverNode>;
  /** Chamadas do `buscarLocal` ao FTS5 (para provar a pré-seleção). */
  consultasFts: ConsultaTexto[];
  /** Leitor da tela (o motor), com o FTS5. */
  leitor: LeitorLocal;
  /** Mesmo aparelho sem o FTS5: o domain varre todos os produtos locais (referência do O2). */
  semFts: LeitorLocal;
}

async function aparelho(): Promise<Aparelho> {
  const registro = criarRegistroSync(MANIFESTOS);
  for (const e of ENTIDADES_APARELHO) registro.registrar(e);
  const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'catalogo'], linhas: baseServidor() });
  const driver = criarDriverNode(':memory:');
  const armazenamento = criarArmazenamentoSqlite(driver, {
    migracoesModulos: { catalogo: migracoesAparelho },
    indicesBusca: [INDICE_BUSCA_CATALOGO],
    entidades: ENTIDADES_APARELHO.map((e) => ({ nome: e.nome, modulo: e.modulo })),
  });
  const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, online: () => servidor.online });
  await motor.aplicarModulosAtivos(['core', 'catalogo']);
  expect(await motor.sincronizar(), 'carga inicial do aparelho').toBe(true);
  const consultasFts: ConsultaTexto[] = [];
  const leitor: LeitorLocal = {
    linhas: (e) => motor.linhas(e),
    async buscar(indice, consulta) {
      expect(indice).toBe(ID_INDICE_BUSCA);
      consultasFts.push(consulta);
      return motor.buscar(indice, consulta);
    },
  };
  return { motor, servidor, driver, consultasFts, leitor, semFts: { linhas: (e) => motor.linhas(e) } };
}

const busca = (leitor: LeitorLocal, q: string, perfil: Perfil | null = 'vendedor', clienteId: string | null = CLIENTE) =>
  buscarLocal(leitor, { perfil, parametros: {}, agora: relogio.iso(), clienteId, q, limit: 20, offset: 0, offline: true });
const skus = (r: Awaited<ReturnType<typeof busca>>) => r.items.map((i) => SKU[i.id] ?? i.erp_code);
/** Chaves que o índice FTS5 do aparelho devolve para uma consulta simples. */
const noIndice = async (motor: MotorSync, ...termos: string[]) => ((await motor.buscar(ID_INDICE_BUSCA, { grupos: termos.map((t) => [t]), prefixoNoUltimo: false, limite: 500 })) ?? []).map((r) => r.chave);

/**
 * Consultas do B-O2: sinônimo, frase e código. Sem termo de milhares de candidatos ("parafuso"): a
 * varredura completa do domain sobre 2.150 parafusos leva dezenas de segundos e deixaria o caso frágil no CI.
 */
const CONSULTAS_O2 = ['sapata', 'lubrificante para moto', 'FLU-DOT4', 'freio dianteiro'];
/**
 * Divergência medida em 05/11 (T-0052-B2, corrigida): com o FTS5 em AND, os produtos que o domain mostraria mais abaixo
 * por casar só parte da frase sumiam no catálogo grande ("pastilha de freio" = 1 item; varredura: 3, 3 e 4 itens).
 * Com a pré-seleção pela união dos termos, o FTS5 e a varredura dão a mesma lista, na mesma ordem.
 */
const CONSULTAS_O2B = ['pastilha de freio', 'sapata de freio', 'freio 150 cc'];

describe('T-0052 — busca offline do Catálogo no aparelho com o FTS5 real (motor + SQLite + domain)', { timeout: 60_000 }, () => {
  describe('aparelho carregado, sem sinal (só leitura)', () => {
    let ap: Aparelho;
    beforeAll(async () => {
      ap = await aparelho();
      ap.servidor.online = false;
    }, 60_000);

    it(`B-O1 (RF-CAT-02): sem sinal, ${ENCHIMENTO + 4} produtos no aparelho — sinônimo e atributo pelo FTS5, com o aviso e sem chamar o servidor`, async () => {
      // o índice foi montado pelo pull (fonte produto do Core + produto_atributo do Catálogo)
      const [{ n }] = (await ap.driver.todas<{ n: number }>(`select count(*) as n from ${TABELAS_BUSCA_CATALOGO.doc}`)) as [{ n: number }];
      expect(n).toBe(ENCHIMENTO + 4);
      const antes = { ...ap.servidor.chamadas };
      ap.consultasFts.length = 0;

      // sinônimo do tenant (pastilha ↔ sapata), nos dois sentidos
      const sapata = await busca(ap.leitor, 'sapata dianteira');
      expect(skus(sapata), 'sapata → pastilha').toEqual(['PAS-DIA-150']);
      expect(sapata.aviso).toBe(AVISO_BUSCA_OFFLINE);
      // a pré-seleção levou ao FTS5 os grupos da frase com o sinônimo expandido, e só eles. A forma das consultas é do
      // Catálogo (B4; T-0089: 1º o AND de todos os grupos numa consulta, e só se ele trouxer pouco, a união termo a termo),
      // por isso aqui vale o conjunto de grupos, não quantas consultas foram feitas
      const gruposFts = ap.consultasFts.flatMap((c) => c.grupos);
      const distintos = [...new Map(gruposFts.map((g) => [JSON.stringify(g), g])).values()];
      expect(distintos, 'grupos de "sapata dianteira" no FTS5').toEqual([['sapata', 'pastilha'], ['dianteira']]);
      for (const c of ap.consultasFts) expect(c.grupos.length === 1 || c.grupos.length === distintos.length, 'consulta = um termo ou a frase inteira').toBe(true);
      const porBusca = [ap.consultasFts.length];
      expect(skus(await busca(ap.leitor, 'lubrificante motocicleta')), 'lubrificante motocicleta → óleo de moto').toContain('OLE-4T-1L');
      porBusca.push(ap.consultasFts.length);
      // atributo do Catálogo (fonte de outra entidade no índice), sem acento. R-20261120-103142: a lona (freio + Cerâmica) casa
      // todas as palavras, então só ela aparece; os outros freios casam só "freio" e saem
      const ceramica = skus(await busca(ap.leitor, 'freio ceramica'));
      porBusca.push(ap.consultasFts.length);
      expect(ceramica, 'atributo "Cerâmica": só a lona, que casa todas as palavras').toEqual(['LON-TRA-125']);
      // código com o separador digitado de outro jeito
      expect(skus(await busca(ap.leitor, 'pas dia 150'))[0]).toBe('PAS-DIA-150');
      porBusca.push(ap.consultasFts.length);

      // o FTS5 pré-selecionou de verdade em cada uma das 4 buscas (catálogo acima do limiar) e nada saiu do aparelho
      porBusca.forEach((n, i) => expect(n, `busca ${i + 1} consultou o FTS5`).toBeGreaterThan(i === 0 ? 0 : porBusca[i - 1]!));
      // controle: "freio" sozinho
      expect(skus(await busca(ap.leitor, 'freio')).sort(), '"freio" traz os três freios').toEqual(['FLU-DOT4-500', 'LON-TRA-125', 'PAS-DIA-150']);
      expect(ap.servidor.chamadas).toEqual(antes);
      // vendedor com cliente em contexto vê preço da tabela e estoque local
      expect(sapata.items[0]).toMatchObject({ price_stock_visible: true });
      expect(sapata.items[0]!.price).not.toBeNull();
      expect(sapata.items[0]!.availability).not.toBeNull();
    });

    it('B-O2: a pré-seleção do FTS5 não troca o resultado — mesmo 1º item, itens e ordem contidos na varredura completa do domain', async () => {
      for (const q of CONSULTAS_O2) {
        const comFts = skus(await busca(ap.leitor, q));
        const varredura = skus(await busca(ap.semFts, q));
        expect(comFts.length, `"${q}": achou algo`).toBeGreaterThan(0);
        expect(comFts[0], `"${q}": 1º item`).toBe(varredura[0]);
        // tudo o que o FTS5 deixa passar está na varredura, na mesma ordem relativa
        expect(varredura.filter((s) => comFts.includes(s)), `"${q}": FTS5 ⊆ varredura`).toEqual(comFts);
      }
    });

    it('B-O2c (R-20261120-194335): "óleo para moto 150 cilindradas" (nenhum produto casa todas as palavras) dá lista vazia com e sem o FTS5', async () => {
      const q = 'óleo para moto 150 cilindradas';
      expect(skus(await busca(ap.leitor, q))).toEqual([]);
      expect(skus(await busca(ap.semFts, q))).toEqual([]);
    });

    // T-0052-B2 corrigido (R-20261105-131136-modulo-catalogo): era it.fails.
    it('B-O2b (T-0052-B2): acima do limiar, o FTS5 dá a mesma lista e ordem da varredura completa (catálogo pequeno)', async () => {
      for (const q of CONSULTAS_O2B) expect(skus(await busca(ap.leitor, q)), `"${q}": FTS5 × varredura`).toEqual(skus(await busca(ap.semFts, q)));
    });

    // T-0052-B1 corrigido (R-20261105-131136-modulo-catalogo): era it.fails; o índice tem a coluna `codigos` compacta
    // ("pasdia150") e o domain (`casaComCodigo`, domain/ranking.ts) compara a forma compacta do SKU.
    it('B-O6 (T-0052-B1): código digitado sem hífen ("pasdia150") acha o produto (o FTS5 acha e o domain não descarta)', async () => {
      expect(await noIndice(ap.motor, 'pasdia150'), 'o FTS5 acha pela coluna codigos').toEqual([PRODUTO.pastilha]);
      expect(skus(await busca(ap.leitor, 'pasdia150'))[0]).toBe('PAS-DIA-150');
    });

    it('B-O4 (RN-CAT-05 revista, regra 7): o promotor acha o mesmo produto offline, sem preço e com o estoque do vendedor, mesmo com o preço gravado no aparelho', async () => {
      // pior caso: o aparelho TEM as linhas de preço (o pull do servidor real nem as manda ao promotor; o estoque, sim)
      expect((await ap.motor.linhas('tabela_preco_item')).length).toBe(ENCHIMENTO + 4);
      for (const clienteId of [CLIENTE, null]) {
        const r = await busca(ap.leitor, 'sapata', 'promotor', clienteId);
        expect(skus(r)).toEqual(['PAS-DIA-150']);
        const doVendedor = (await busca(ap.leitor, 'sapata', 'vendedor', clienteId)).items[0]!;
        for (const i of r.items) {
          expect(i, `cliente ${clienteId}`).toMatchObject({ price_stock_visible: false, price: null });
          // RN-CAT-05 revista (catálogo v2, #503): o estoque é de todos os perfis; no mesmo aparelho e cliente, o mesmo do vendedor
          expect(i.availability, `cliente ${clienteId}`).not.toBeNull();
          expect(i.availability, `cliente ${clienteId}`).toEqual(doVendedor.availability);
        }
      }
      // sem usuário no aparelho (sessão perdida) a regra falha fechada: trata como quem não vê
      const semUsuario = await busca(ap.leitor, 'sapata', null);
      expect(semUsuario.items[0]).toMatchObject({ price_stock_visible: false, price: null, availability: null });
    });
  });

  it('B-O3 (RN-CAT-01): sinônimo removido e produto inativado no servidor saem do aparelho no sync seguinte (índice e resultado)', async () => {
    const ap = await aparelho();
    expect(skus(await busca(ap.leitor, 'sapata'))).toEqual(['PAS-DIA-150']);
    expect(await noIndice(ap.motor, 'fluido')).toEqual([PRODUTO.fluido]);
    // servidor: o analista apaga o sinônimo e o ERP inativa o fluido
    const sin = ap.servidor.linhas.sinonimo!.find((s) => (s as unknown as { termo: string }).termo === 'pastilha')!;
    ap.servidor.linhas.sinonimo = [...ap.servidor.linhas.sinonimo!.filter((s) => s !== sin), { ...sin, updated_at: MUDANCA, deleted_at: MUDANCA }];
    ap.servidor.linhas.produto = ap.servidor.linhas.produto!.map((p) => (p.id === PRODUTO.fluido ? { ...p, ativo: false, updated_at: MUDANCA } : p));
    expect(await ap.motor.sincronizar()).toBe(true);
    ap.servidor.online = false;

    expect((await busca(ap.leitor, 'sapata')).items, 'sinônimo removido não vale').toEqual([]);
    expect(skus(await busca(ap.leitor, 'pastilha')), 'o produto continua pelo nome').toEqual(['PAS-DIA-150']);
    expect(await noIndice(ap.motor, 'fluido'), 'inativo sai do FTS5').toEqual([]);
    expect(skus(await busca(ap.leitor, 'fluido de freio')), 'inativo não aparece').not.toContain('FLU-DOT4-500');
    expect(skus(await busca(ap.semFts, 'fluido de freio')), 'nem na varredura').not.toContain('FLU-DOT4-500');
  });

  it('B-O5 (RN-CORE-02): Catálogo desligado apaga a FTS e os sinônimos do aparelho; religado, o índice volta e a busca por sinônimo também', async () => {
    const ap = await aparelho();
    const objetosCatalogo = async () => (await listarObjetos(ap.driver)).filter((o) => o.name.startsWith('catalogo__')).map((o) => o.name);
    expect(await objetosCatalogo()).toEqual(expect.arrayContaining([TABELAS_BUSCA_CATALOGO.doc, TABELAS_BUSCA_CATALOGO.fts]));

    ap.servidor.modulosAtivos = ['core'];
    await ap.motor.aplicarModulosAtivos(['core']);
    expect(await objetosCatalogo(), 'FTS5 do Catálogo apagada').toEqual([]);
    expect(await ap.motor.linhas('sinonimo'), 'sinônimos apagados').toEqual([]);
    expect((await busca(ap.leitor, 'sapata')).items, 'sem o Catálogo, o sinônimo não existe no aparelho').toEqual([]);

    ap.servidor.modulosAtivos = ['core', 'catalogo'];
    await ap.motor.aplicarModulosAtivos(['core', 'catalogo']);
    expect(await ap.motor.sincronizar()).toBe(true);
    ap.servidor.online = false;
    // L-1: os produtos (Core, cursor intacto) não voltam pelo pull, mas o índice é refeito das linhas locais
    expect(await noIndice(ap.motor, 'pastilha')).toEqual([PRODUTO.pastilha]);
    expect(skus(await busca(ap.leitor, 'sapata'))).toEqual(['PAS-DIA-150']);
  });
});
