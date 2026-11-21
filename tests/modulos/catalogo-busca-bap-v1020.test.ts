/**
 * v1.0.20 — busca do Catálogo, etapas 3 e 4 da auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` (§5).
 * Agente `testes`. Roda sem Postgres e sem Docker (node:sqlite em memória), na sessão e no CI.
 *
 * Mesmo arranjo do `catalogo-busca-bap-v1019.test.ts`: shell Campo (`criarShell`) com os manifestos REAIS de Core, Catálogo,
 * Vendedor e Promotor, o índice FTS5 e as consultas do aparelho, e o motor de sync REAL sobre o SQLite. A aplicação chega
 * pelo sync (`produto_conteudo`) e o "é veículo" (RN-CAT-18) sai da conta da carga do aparelho, não de um conjunto montado no
 * teste. Depois da carga o servidor sai do ar. Cada consulta roda pelos dois caminhos do vendedor:
 *  - tela do Catálogo: `buscarLocal` com o FTS5 (catálogo acima do limiar);
 *  - seletor do Novo pedido: `catalogo.busca_produtos@1` pelo SDK, como `buscarProdutos` do Vendedor, e `resolverBusca`.
 *
 * Regras (docs/produto/03-regras-de-negocio.md):
 *  RN-CAT-18 palavra inteira na aplicação; nome de veículo tirado da base (≥ 5× mais nas aplicações do que nos nomes e
 *            descrições; premissa do módulo: mínimo de 3 produtos com a palavra na aplicação, `modules/catalogo/domain/veiculos.ts`);
 *            veículo casa só inteiro e sem singular; começo de palavra só na última palavra digitada;
 *  RN-CAT-19 modelo derivado (o veículo casa a palavra grudada com outro pedaço de 3+ caracteres) e vizinhas juntas.
 * O que este arquivo cobre além de `modules/catalogo/domain/busca-bap-etapa3/4.test.ts`: a conta de "é veículo" feita na carga
 * do aparelho a partir do sync, o FTS5 acima do limiar, o seletor do pedido de ponta a ponta e o "Serve em" (valor × rótulo).
 * Matriz: docs/testes/T-0052.md (B-BAP-7..B-BAP-14).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { CONSULTA_BUSCA_PRODUTOS } from '@macuxi/catalogo/contracts';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoPromotor } from '@macuxi/promotor/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import {
  ambienteIndisponivel,
  criarArmazenamentoSqlite,
  criarMotorSync,
  criarServidorSyncSimulado,
  criarShell,
  ehConsultaIndisponivel,
  type AmbienteAparelho,
  type ConsultaTexto,
  type LinhaSync,
  type ModuloId,
  type MotorSync,
  type ServidorSyncSimulado,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { consultaPrecosClienteAparelho } from '../../modules/catalogo/app/consultas';
import { INDICE_BUSCA_CATALOGO } from '../../modules/catalogo/app/indice';
import { buscarLocal, esquecerMemoriaLocal, LIMIAR_PRESELECAO_FTS, type LeitorLocal } from '../../modules/catalogo/app/lib/local';
import { consultaSugestoesPedidoAparelho } from '../../modules/catalogo/app/sugestoes';
import { consultaBuscaProdutosAparelho, consultaTextosProdutoAparelho, esquecerMemoriaTextos } from '../../modules/catalogo/app/texto-consultas';
import { migracoesAparelho } from '../../modules/catalogo/db/aparelho';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { entidadeConcorrente } from '../../modules/promotor/contracts/entidades';
import { buscarNoCatalogoComReserva } from '../../modules/vendedor/app/lib/busca-catalogo';
import { resolverBusca, type TrechoServeEm } from '../../modules/vendedor/domain/busca-seletor';
import { entidadesSyncCatalogo } from './apoio/entidades-catalogo';

const relogio = criarRelogio();
const CARGA = relogio.relativo({ horas: -3 }).toISOString();

let seq = 0;
const uid = (grupo: number) => `0b20${grupo.toString(16).padStart(4, '0')}-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const linha = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: CARGA, deleted_at: null, external_id: null, ...o }) as LinhaSync;

interface Item {
  sku: string;
  nome: string;
  aplicacao: string;
}
const repetir = (k: number, f: (i: number) => Item): Item[] => Array.from({ length: k }, (_, i) => f(i));

/**
 * Produtos BAP do §5 da auditoria e os de enchimento que fazem da palavra um nome de veículo pela regra (contas no `it` de
 * pré-condição, feitas pelo próprio teste):
 *  gol   — 2 nomes (Gol G5, Gol KYB) × 14 aplicações (2 + 12 filtros de ar) = 7× ≥ 5×;
 *  polo  — 1 nome (Bucha Polo Classic; "polos" é outra palavra) × 7 aplicações (1 + 6 filtros de óleo) = 7×;
 *  fox   — 2 nomes (Coxim Fox e SPACE-FOX) × 13 aplicações (1 + 12 filtros de combustível) = 6,5×;
 *  golf  — 1 nome × 1 aplicação: não é veículo (e não precisa ser: "gol" não deriva "golf", o "f" tem menos de 3 letras).
 * Limites, também pela regra: siena 5 aplicações × 1 nome = 5× exato (veículo); strada 4 × 1 = 4× (não);
 * doblo 3 aplicações × 0 nome = mínimo exato (veículo); idea 2 aplicações (abaixo do mínimo, não).
 */
const ALVO: Item[] = [
  { sku: 'AMO-G01', nome: 'Amortecedor Gol G5', aplicacao: 'Volkswagen Gol G5 1.0/1.6 2014–2019' },
  { sku: 'AMO-G02', nome: 'Amortecedor Gol KYB 441126', aplicacao: 'Volkswagen Gol 2007–2011' },
  { sku: 'AMO-F03', nome: 'Amortecedor Golf', aplicacao: 'Volkswagen Golf 2010–2014' },
  { sku: 'BCH-P04', nome: 'Bucha Polo Classic', aplicacao: 'Volkswagen Polo Classic 1996–2002' },
  { sku: 'CAB-V05', nome: 'Cabo de vela 4 polos', aplicacao: 'Motor 1.0 flex' },
  { sku: 'JNT-H06', nome: 'Junta homocinética', aplicacao: 'Honda Civic 2007–2011' },
  // Palio só na aplicação: "amortecedor pal" acha pelo começo da última palavra
  { sku: 'AMO-P07', nome: 'Amortecedor dianteiro', aplicacao: 'Fiat Palio 2010–2014' },
  { sku: 'COX-F08', nome: 'Coxim Fox', aplicacao: 'Volkswagen Fox 2010–2014' },
  { sku: 'KIT-S09', nome: 'Kit amortecedor SPACE-FOX', aplicacao: '' },
  // CrossFox e SpaceFox só na aplicação (o §5 pede os dois "da aplicação")
  { sku: 'BIE-C10', nome: 'Bieleta estabilizadora', aplicacao: 'Volkswagen CrossFox 2010–2014' },
  { sku: 'BAT-S11', nome: 'Batente de suspensão', aplicacao: 'Volkswagen SpaceFox 2010–2014' },
  // limites da regra do veículo, pelo caminho do aparelho
  { sku: 'FRS-S12', nome: 'Friso Siena', aplicacao: '' },
  { sku: 'FRS-S13', nome: 'Friso lateral', aplicacao: 'Fiat Sienas 2008–2012' },
  { sku: 'FRS-T14', nome: 'Friso Strada', aplicacao: '' },
  { sku: 'FRS-T15', nome: 'Friso traseiro', aplicacao: 'Fiat Stradas 2008–2012' },
  { sku: 'TAP-D16', nome: 'Tapete de borracha', aplicacao: 'Fiat Doblos 2008–2012' },
  { sku: 'TAP-I17', nome: 'Tapete de carpete', aplicacao: 'Fiat Ideas 2008–2012' },
];
const ENCHIMENTO_VEICULOS: Item[] = [
  ...repetir(12, (i) => ({ sku: `FAR-G${i}`, nome: `Filtro de ar ${i}`, aplicacao: 'Volkswagen Gol 2008–2012' })),
  ...repetir(6, (i) => ({ sku: `FOL-P${i}`, nome: `Filtro de óleo ${i}`, aplicacao: 'Volkswagen Polo 2003–2007' })),
  ...repetir(12, (i) => ({ sku: `FCO-F${i}`, nome: `Filtro de combustível ${i}`, aplicacao: 'Volkswagen Fox 2008–2012' })),
  ...repetir(5, (i) => ({ sku: `FCA-S${i}`, nome: `Filtro de cabine ${i}`, aplicacao: 'Fiat Siena 2010–2016' })),
  ...repetir(4, (i) => ({ sku: `FCA-T${i}`, nome: `Filtro de cabine ${i}`, aplicacao: 'Fiat Strada 2010–2016' })),
  ...repetir(3, (i) => ({ sku: `PAL-D${i}`, nome: `Palheta ${i}`, aplicacao: 'Fiat Doblo 2010–2016' })),
  ...repetir(2, (i) => ({ sku: `PAL-I${i}`, nome: `Palheta ${i}`, aplicacao: 'Fiat Idea 2010–2016' })),
];
const COM_APLICACAO = [...ALVO, ...ENCHIMENTO_VEICULOS];
const ID: Record<string, string> = Object.fromEntries(COM_APLICACAO.map((p) => [p.sku, uid(1)]));
const SKU: Record<string, string> = Object.fromEntries(Object.entries(ID).map(([s, id]) => [id, s]));
const TABELA = uid(2);
const CLIENTE = uid(3);
const DEPOSITO = uid(4);
/** Acima do limiar: a tela do Catálogo pede candidatos ao FTS5 antes do ranking. */
const PARAFUSOS = LIMIAR_PRESELECAO_FTS + 150;

function baseServidor(): Record<string, LinhaSync[]> {
  const produto = (id: string, sku: string, nome: string, marca: string, categoria: string) => linha(id, { sku, ean: null, nome, marca, categoria, unidade: 'UN', ativo: true });
  const bap = COM_APLICACAO.map((p) => produto(ID[p.sku]!, p.sku, p.nome, 'BAP', 'Autopeças'));
  const parafusos = Array.from({ length: PARAFUSOS }, (_, k) => produto(uid(9), `PAR-${k}`, `Parafuso sextavado zincado M${6 + (k % 10)} x ${20 + k}`, 'Ciser', 'Fixação'));
  const todos = [...bap, ...parafusos];
  const conteudo = (produtoId: string, aplicacao: string) => linha(uid(6), { produto_id: produtoId, descricao: null, argumentos: [], faq: [], campanha: false, aplicacao, etiquetas: [] });
  return {
    produto: todos,
    produto_unidade: [],
    medida: [],
    produto_atributo: [],
    sinonimo: [],
    deposito: [linha(DEPOSITO, { codigo: 'CD1', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: bap.map((p) => linha(uid(8), { produto_id: p.id, deposito_id: DEPOSITO, quantidade: 40, atualizado_em: CARGA })),
    produto_conteudo: COM_APLICACAO.filter((p) => p.aplicacao !== '').map((p) => conteudo(ID[p.sku]!, p.aplicacao)),
    produto_referencia: [],
    produto_relacao: [],
    concorrente: [],
    tabela_preco: [linha(TABELA, { codigo: 'VAREJO', nome: 'Varejo', ativo: true })],
    tabela_preco_item: todos.map((p) => linha(uid(7), { tabela_preco_id: TABELA, produto_id: p.id, preco_cents: 1_990, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [linha(uid(7), { cliente_id: CLIENTE, tabela_preco_id: TABELA })],
  };
}

function shellCampo() {
  return criarShell<string>('campo', [
    { manifesto: manifestoCore, entidadesSync: entidadesProduto },
    {
      manifesto: manifestoCatalogo,
      entidadesSync: entidadesSyncCatalogo(),
      consultas: [consultaPrecosClienteAparelho, consultaSugestoesPedidoAparelho, consultaTextosProdutoAparelho, consultaBuscaProdutosAparelho],
      migracoesAparelho,
      indicesBusca: [INDICE_BUSCA_CATALOGO],
    },
    { manifesto: manifestoVendedor },
    { manifesto: manifestoPromotor, entidadesSync: [entidadeConcorrente] },
  ]);
}

const MODULOS: ModuloId[] = ['core', 'catalogo', 'vendedor'];
const LICENCIADOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor'];

interface Aparelho {
  motor: MotorSync;
  servidor: ServidorSyncSimulado;
  consultasFts: ConsultaTexto[];
  leitor: LeitorLocal;
}

async function aparelho(): Promise<Aparelho> {
  const shell = shellCampo();
  const servidor = criarServidorSyncSimulado(shell.registroSync, { modulosAtivos: MODULOS, linhas: baseServidor() });
  const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
    migracoesModulos: shell.migracoesAparelho,
    indicesBusca: shell.indicesBusca,
    entidades: shell.registroSync.entidadesAtivas(LICENCIADOS).map((e) => ({ nome: e.nome, modulo: e.modulo })),
  });
  const ambienteBase: AmbienteAparelho = { ...ambienteIndisponivel(), usuario: () => ({ id: uid(5), nome: 'Teste', perfil: 'vendedor' }) };
  const motor = criarMotorSync({ registro: shell.registroSync, armazenamento, transporte: servidor, online: () => servidor.online, consultas: shell.consultas, ambiente: ambienteBase });
  await motor.aplicarModulosAtivos(MODULOS);
  expect(await motor.sincronizar(), 'carga inicial do aparelho').toBe(true);
  servidor.online = false;
  esquecerMemoriaLocal();
  esquecerMemoriaTextos();
  const consultasFts: ConsultaTexto[] = [];
  const leitor: LeitorLocal = {
    linhas: (e) => motor.linhas(e),
    async buscar(indice, consulta) {
      consultasFts.push(consulta);
      return motor.buscar(indice, consulta);
    },
  };
  return { motor, servidor, consultasFts, leitor };
}

interface Achado {
  sku: string;
  serveEm: TrechoServeEm | null;
}

/** Tela do Catálogo no aparelho (vendedor, sem rede). */
async function tela(ap: Aparelho, q: string): Promise<Achado[]> {
  const r = await buscarLocal(ap.leitor, { perfil: 'vendedor', parametros: {}, agora: relogio.iso(), clienteId: CLIENTE, q, limit: 40, offset: 0, offline: true });
  return r.items.map((i) => ({ sku: SKU[i.id] ?? i.erp_code, serveEm: (i.serve_em ?? null) as TrechoServeEm | null }));
}

/** Seletor do Novo pedido: `buscarProdutos` do Vendedor (use-vendedor.ts) → `resolverBusca(…, byId, 40)` (new-order-screen.tsx). */
async function seletor(ap: Aparelho, q: string): Promise<Achado[]> {
  const itensPreco = (await ap.motor.linhas('tabela_preco_item')) as unknown as Array<{ produto_id: string }>;
  const comPreco = new Set(itensPreco.map((i) => i.produto_id));
  const produtos = ((await ap.motor.linhas('produto')) as unknown as Array<{ id: string; sku: string; nome: string }>).filter((p) => comPreco.has(p.id));
  const byId = new Map(produtos.map((p) => [p.id, p] as const));
  const r = await buscarNoCatalogoComReserva(
    () => ap.motor.ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: q.trim().slice(0, 200), produto_ids: [...byId.keys()], limite: 100 }),
    ehConsultaIndisponivel,
    () => undefined,
  );
  if (r.tipo !== 'ok') throw new Error(`seletor: resultado ${r.tipo} (esperado ok, a consulta responde no aparelho)`);
  const itens = r.itens.map((i) => ({ produto_id: i.produto_id, serve_em: i.serve_em as TrechoServeEm | null }));
  return resolverBusca(itens, byId, 40).map((x) => ({ sku: x.produto.sku, serveEm: x.serveEm }));
}

const CAMINHOS = [
  ['tela do Catálogo', tela],
  ['seletor do Novo pedido', seletor],
] as const;
const skus = (r: Achado[]) => r.map((x) => x.sku).sort();

/* ---------- Oráculo do teste: a regra escrita de novo, sem o código do módulo ---------- */

/** Palavras inteiras, sem acento e em minúsculas (o hífen e a barra separam: "SPACE-FOX" = "space" + "fox"). */
const palavras = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** RN-CAT-18: produtos com a palavra (só letras, 3+), contada uma vez por produto, nos nomes e nas aplicações. */
function contagem(w: string): { nomes: number; aplicacoes: number } {
  let nomes = 0;
  let aplicacoes = 0;
  for (const p of COM_APLICACAO) {
    if (palavras(p.nome).includes(w)) nomes++;
    if (palavras(p.aplicacao).includes(w)) aplicacoes++;
  }
  return { nomes, aplicacoes };
}
const RAZAO = 5; // RN-CAT-18 (doc 03)
const MINIMO = 3; // premissa do módulo
const ehVeiculo = (w: string) => {
  const c = contagem(w);
  return c.aplicacoes >= MINIMO && c.aplicacoes >= RAZAO * c.nomes;
};
/** RN-CAT-19: a palavra da base que é o veículo grudado a outro pedaço de 3+ caracteres, antes ou depois. */
const derivadaDe = (v: string, w: string) => w !== v && w.length - v.length >= 3 && (w.startsWith(v) || w.endsWith(v));
/** Esperado para a busca de um nome de veículo: quem tem a palavra inteira ou uma derivada dela em algum campo. */
const esperadoVeiculo = (v: string) =>
  COM_APLICACAO.filter((p) => [...palavras(p.nome), ...palavras(p.aplicacao)].some((w) => w === v || derivadaDe(v, w)))
    .map((p) => p.sku)
    .sort();

describe('v1.0.20 — busca do Catálogo no aparelho, etapas 3 e 4 (RN-CAT-18, RN-CAT-19)', { timeout: 60_000 }, () => {
  let ap: Aparelho;
  beforeAll(async () => {
    ap = await aparelho();
  }, 60_000);

  it('pré-condição: aparelho sem rede, catálogo acima do limiar (a tela usa o FTS5), nenhum sinônimo do tenant', async () => {
    expect(ap.servidor.online).toBe(false);
    expect((await ap.motor.linhas('produto')).length).toBeGreaterThan(LIMIAR_PRESELECAO_FTS);
    expect(await ap.motor.linhas('sinonimo')).toEqual([]);
    const antes = ap.consultasFts.length;
    await tela(ap, 'gol');
    expect(ap.consultasFts.length, 'a tela pediu candidatos ao FTS5').toBeGreaterThan(antes);
  });

  it('pré-condição (valor × regra RN-CAT-18): a massa faz de gol, polo e fox nomes de veículo pela razão ≥ 5× e o mínimo de 3; golf não', () => {
    expect(contagem('gol')).toEqual({ nomes: 2, aplicacoes: 14 });
    expect(contagem('polo')).toEqual({ nomes: 1, aplicacoes: 7 });
    expect(contagem('polos')).toEqual({ nomes: 1, aplicacoes: 0 });
    expect(contagem('fox')).toEqual({ nomes: 2, aplicacoes: 13 });
    expect(contagem('golf')).toEqual({ nomes: 1, aplicacoes: 1 });
    for (const v of ['gol', 'polo', 'fox']) expect(ehVeiculo(v), v).toBe(true);
    for (const v of ['golf', 'polos', 'crossfox', 'spacefox', 'homocinetica']) expect(ehVeiculo(v), v).toBe(false);
    // limites: 5× exato e mínimo exato viram veículo; 4× e 2 aplicações não
    expect(contagem('siena')).toEqual({ nomes: 1, aplicacoes: 5 });
    expect(contagem('strada')).toEqual({ nomes: 1, aplicacoes: 4 });
    expect(contagem('doblo')).toEqual({ nomes: 0, aplicacoes: 3 });
    expect(contagem('idea')).toEqual({ nomes: 0, aplicacoes: 2 });
    expect([ehVeiculo('siena'), ehVeiculo('strada'), ehVeiculo('doblo'), ehVeiculo('idea')]).toEqual([true, false, true, false]);
  });

  for (const [caminho, buscar] of CAMINHOS) {
    describe(caminho, () => {
      it('B-BAP-7 (RN-CAT-18): "gol" traz o Gol G5 e o Gol KYB (e os filtros do Gol), sem o Golf; o "Serve em" mostra o Gol', async () => {
        const r = await buscar(ap, 'gol');
        const esperado = esperadoVeiculo('gol');
        expect(esperado).toEqual(expect.arrayContaining(['AMO-G01', 'AMO-G02']));
        expect(esperado).not.toContain('AMO-F03');
        expect(skus(r), JSON.stringify(skus(r))).toEqual(esperado);
        // valor × rótulo: o trecho destacado é o do Gol, não "Golf"
        for (const x of r) {
          expect(x.serveEm?.texto ?? '', x.sku).toMatch(/\bGol\b/);
          expect(x.serveEm?.texto ?? '', x.sku).not.toMatch(/Golf/);
        }
      });

      it('B-BAP-8 (RN-CAT-18): "polo" traz a Bucha Polo Classic (e os filtros do Polo), sem o "Cabo de vela 4 polos"; "polos" não vira "polo" no nome', async () => {
        const r = await buscar(ap, 'polo');
        const esperado = esperadoVeiculo('polo');
        expect(esperado).toContain('BCH-P04');
        expect(esperado).not.toContain('CAB-V05');
        expect(skus(r), JSON.stringify(skus(r))).toEqual(esperado);
        // dos produtos do §5, só a bucha
        expect(skus(r).filter((s) => ALVO.some((a) => a.sku === s))).toEqual(['BCH-P04']);
      });

      it('B-BAP-9 (RN-CAT-18): "homoc" acha a junta homocinética (começo da última palavra); "homoc junta" não acha (não é a última)', async () => {
        expect(skus(await buscar(ap, 'homoc'))).toEqual(['JNT-H06']);
        expect(skus(await buscar(ap, 'junta homoc'))).toEqual(['JNT-H06']);
        expect(skus(await buscar(ap, 'homoc junta'))).toEqual([]);
      });

      it('B-BAP-10 (RN-CAT-18): "amortecedor para gol" = "amortecedor gol" = Gol G5 e Gol KYB, sem o Golf', async () => {
        const comPara = skus(await buscar(ap, 'amortecedor para gol'));
        const sem = skus(await buscar(ap, 'amortecedor gol'));
        expect(sem).toEqual(['AMO-G01', 'AMO-G02']);
        expect(comPara).toEqual(sem);
      });

      it('B-BAP-11 (RN-CAT-18): "amortecedor pal" acha o Palio (só na aplicação, começo da última palavra); "pal amortecedor" não', async () => {
        const r = await buscar(ap, 'amortecedor pal');
        expect(skus(r)).toEqual(['AMO-P07']);
        expect(r[0]!.serveEm?.texto ?? '').toContain('Palio');
        expect(skus(await buscar(ap, 'pal amortecedor'))).toEqual([]);
      });

      it('B-BAP-12 (RN-CAT-19): "fox" traz Fox, CrossFox e SpaceFox (estes dois só da aplicação) e o SPACE-FOX do nome', async () => {
        const r = await buscar(ap, 'fox');
        const esperado = esperadoVeiculo('fox');
        expect(esperado).toEqual(expect.arrayContaining(['COX-F08', 'KIT-S09', 'BIE-C10', 'BAT-S11']));
        expect(skus(r), JSON.stringify(skus(r))).toEqual(esperado);
        // valor × rótulo: o "Serve em" dos dois da aplicação mostra o modelo derivado
        expect(r.find((x) => x.sku === 'BIE-C10')!.serveEm?.texto ?? '').toContain('CrossFox');
        expect(r.find((x) => x.sku === 'BAT-S11')!.serveEm?.texto ?? '').toContain('SpaceFox');
      });

      it('B-BAP-13 (RN-CAT-19): "space fox" traz os dois SpaceFox (o "SPACE-FOX" do nome e o "SpaceFox" da aplicação), sem o Fox e o CrossFox', async () => {
        expect(skus(await buscar(ap, 'space fox'))).toEqual(['BAT-S11', 'KIT-S09']);
      });

      it('B-BAP-14 (RN-CAT-18, limites da regra na carga do aparelho): 5× exato e o mínimo de 3 viram veículo (sem "Sienas"/"Doblos"); 4× e 2 aplicações não', async () => {
        // veículo: casa só inteiro, sem singular nem começo de palavra — a aplicação "Fiat Sienas" fica de fora
        expect(skus(await buscar(ap, 'friso siena'))).toEqual(['FRS-S12']);
        expect(skus(await buscar(ap, 'tapete doblo'))).toEqual([]);
        // não é veículo: a última palavra casa pelo começo (e pelo singular) — "Fiat Stradas" e "Fiat Ideas" entram
        expect(skus(await buscar(ap, 'friso strada'))).toEqual(['FRS-T14', 'FRS-T15']);
        expect(skus(await buscar(ap, 'tapete idea'))).toEqual(['TAP-I17']);
      });
    });
  }
});
