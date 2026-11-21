/**
 * v1.0.19 — busca do Catálogo, etapas 1 e 2 da auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` (§5).
 * Agente `testes`. Roda sem Postgres e sem Docker (node:sqlite em memória), na sessão e no CI.
 *
 * Integração entre módulos pelo caminho do aparelho: shell Campo (`criarShell`) com os manifestos REAIS de Core, Catálogo,
 * Vendedor e Promotor; o Catálogo com as entidades, migrações, índice FTS5 e consultas do aparelho; o motor de sync REAL
 * sobre o SQLite. Depois da carga o servidor sai do ar. Cada consulta é feita pelos dois caminhos que o vendedor usa:
 *  - tela do Catálogo: `buscarLocal` (modules/catalogo/app/lib/local.ts), com o FTS5 (catálogo acima do limiar);
 *  - seletor do Novo pedido: `catalogo.busca_produtos@1` pelo SDK, como `buscarProdutos` do Vendedor, e `resolverBusca`.
 *
 * Regras (docs/produto/03-regras-de-negocio.md):
 *  RN-CAT-15 apelidos de montadora (VW ↔ Volkswagen), sem sinônimo do tenant;
 *  RN-CAT-16 formatos de ano da BAP ("2007 até 2011", "2006>", "07–11", "·" separa trechos, polegada não é ano);
 *  RN-CAT-17 só quem casa todas as palavras; ninguém casa → lista vazia.
 * Matriz: docs/testes/T-0052.md (B-BAP-1..B-BAP-6).
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
const uid = (grupo: number) => `0b1a${grupo.toString(16).padStart(4, '0')}-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const linha = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: CARGA, deleted_at: null, external_id: null, ...o }) as LinhaSync;

/**
 * Produtos BAP do §5 da auditoria. SKUs neutros (sem o nome do modelo), para o veículo casar só pela aplicação.
 * Sem sinônimo do tenant: o "vw" tem de vir da lista padrão (RN-CAT-15).
 */
const ALVO = [
  { sku: 'AMO-G01', nome: 'Amortecedor dianteiro', aplicacao: 'Volkswagen Gol G5 1.0/1.6 2014–2019' },
  { sku: 'PST-C01', nome: 'Pastilha de freio dianteira', aplicacao: 'Honda Civic 1.8 2007 até 2011' },
  { sku: 'AMO-C02', nome: 'Amortecedor traseiro', aplicacao: 'Honda Civic 2006>' },
  { sku: 'DSC-C03', nome: 'Disco de freio ventilado', aplicacao: 'Honda Civic 07–11 · Honda Fit 2003>' },
  { sku: 'PST-C04', nome: 'Pastilha de freio traseira', aplicacao: 'Honda Civic 1992–1995' },
  // polegada: se o 13" virasse ano de 2 dígitos (2013), "calota gol 2013" acharia esta calota
  { sku: 'CAL-G05', nome: 'Calota', aplicacao: 'Volkswagen Gol aro 13" · Volkswagen Gol aro 14"' },
] as const;
const ID: Record<string, string> = Object.fromEntries(ALVO.map((p) => [p.sku, uid(1)]));
const SKU: Record<string, string> = Object.fromEntries(Object.entries(ID).map(([s, id]) => [id, s]));
const TABELA = uid(2);
const CLIENTE = uid(3);
const DEPOSITO = uid(4);
/** Acima do limiar: a tela do Catálogo pede candidatos ao FTS5 antes do ranking (o caminho do aparelho com catálogo real). */
const ENCHIMENTO = LIMIAR_PRESELECAO_FTS + 150;

function baseServidor(): Record<string, LinhaSync[]> {
  const produto = (id: string, sku: string, nome: string, marca: string, categoria: string) => linha(id, { sku, ean: null, nome, marca, categoria, unidade: 'UN', ativo: true });
  const alvo = ALVO.map((p) => produto(ID[p.sku]!, p.sku, p.nome, 'BAP', 'Autopeças'));
  const enchimento = Array.from({ length: ENCHIMENTO }, (_, k) => produto(uid(9), `PAR-${k}`, `Parafuso sextavado zincado M${6 + (k % 10)} x ${20 + k}`, 'Ciser', 'Fixação'));
  const todos = [...alvo, ...enchimento];
  const conteudo = (produtoId: string, aplicacao: string) => linha(uid(6), { produto_id: produtoId, descricao: null, argumentos: [], faq: [], campanha: false, aplicacao, etiquetas: [] });
  return {
    produto: todos,
    produto_unidade: [],
    medida: [],
    produto_atributo: [],
    sinonimo: [],
    deposito: [linha(DEPOSITO, { codigo: 'CD1', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: alvo.map((p) => linha(uid(8), { produto_id: p.id, deposito_id: DEPOSITO, quantidade: 40, atualizado_em: CARGA })),
    produto_conteudo: ALVO.map((p) => conteudo(ID[p.sku]!, p.aplicacao)),
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
  const r = await buscarLocal(ap.leitor, { perfil: 'vendedor', parametros: {}, agora: relogio.iso(), clienteId: CLIENTE, q, limit: 20, offset: 0, offline: true });
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
const skus = (r: Achado[]) => r.map((x) => x.sku);

describe('v1.0.19 — busca do Catálogo no aparelho, etapas 1 e 2 (RN-CAT-15, RN-CAT-16, RN-CAT-17)', { timeout: 60_000 }, () => {
  let ap: Aparelho;
  beforeAll(async () => {
    ap = await aparelho();
  }, 60_000);

  it('pré-condição: aparelho sem rede, catálogo acima do limiar (a tela usa o FTS5), nenhum sinônimo do tenant', async () => {
    expect(ap.servidor.online).toBe(false);
    expect((await ap.motor.linhas('produto')).length).toBeGreaterThan(LIMIAR_PRESELECAO_FTS);
    expect(await ap.motor.linhas('sinonimo')).toEqual([]);
    const antes = ap.consultasFts.length;
    await tela(ap, 'amortecedor');
    expect(ap.consultasFts.length, 'a tela pediu candidatos ao FTS5').toBeGreaterThan(antes);
  });

  for (const [caminho, buscar] of CAMINHOS) {
    describe(caminho, () => {
      it('B-BAP-1 (RN-CAT-15 + RN-CAT-17): "vw gol 2018" e "2018 gol vw" acham só o amortecedor do Gol cadastrado como Volkswagen, com "inclui 2018"', async () => {
        for (const q of ['vw gol 2018', '2018 gol vw']) {
          const r = await buscar(ap, q);
          expect(skus(r), q).toEqual(['AMO-G01']);
          // valor × rótulo: o "Serve em" mostra o trecho do Gol e o ano que veio da faixa 2014–2019
          expect(r[0]!.serveEm?.texto, q).toContain('Gol');
          expect(r[0]!.serveEm?.inclui_ano, q).toBe(2018);
        }
      });

      it('B-BAP-2 (RN-CAT-16 + RN-CAT-17): "civic 2008" acha "Civic 2007 até 2011" (inclui 2008), "Civic 2006>" e o disco "Civic 07–11"; não acha o Civic 1992–1995', async () => {
        const r = await buscar(ap, 'civic 2008');
        expect([...skus(r)].sort(), JSON.stringify(r)).toEqual(['AMO-C02', 'DSC-C03', 'PST-C01']);
        const ate = r.find((x) => x.sku === 'PST-C01')!;
        expect(ate.serveEm?.texto).toContain('2007 até 2011');
        expect(ate.serveEm?.inclui_ano, '2008 vem da faixa "2007 até 2011"').toBe(2008);
        // o disco: o 2008 vem do trecho do Civic (07–11), nunca do "Fit 2003>"
        const disco = r.find((x) => x.sku === 'DSC-C03')!;
        expect(disco.serveEm?.texto).toContain('Civic');
        expect(disco.serveEm?.texto ?? '').not.toContain('Fit');
      });

      it('B-BAP-3 (RN-CAT-16 + RN-CAT-17): "civic 2015" acha só o "Civic 2006>" (faixa aberta); a faixa fechada 2007 até 2011, o "07–11" (o "Fit 2003>" é outro trecho) e o 1992–1995 ficam de fora', async () => {
        const r = await buscar(ap, 'civic 2015');
        expect(skus(r), JSON.stringify(r)).toEqual(['AMO-C02']);
        expect(r[0]!.serveEm?.inclui_ano).toBe(2015);
      });

      it('B-BAP-4 (RN-CAT-17): "xyzqwk amortecedor" dá lista vazia (os amortecedores não vêm como "mais próximos")', async () => {
        expect(skus(await buscar(ap, 'xyzqwk amortecedor'))).toEqual([]);
        // controle positivo: sem a palavra que não casa, os dois amortecedores vêm
        expect([...skus(await buscar(ap, 'amortecedor'))].sort()).toEqual(['AMO-C02', 'AMO-G01']);
      });

      it('B-BAP-6 (RN-CAT-17): código exato + palavra que não casa: o código exato conta como casa-tudo, o produto aparece (só ele, nas duas ordens)', async () => {
        // RN-CAT-17: "o código exato (SKU, EAN, código ERP, referência) conta como casa-tudo"; "xyzqwk" não casa em campo nenhum
        for (const q of ['AMO-G01 xyzqwk', 'xyzqwk AMO-G01', 'amo-g01 xyzqwk']) {
          expect(skus(await buscar(ap, q)), q).toEqual(['AMO-G01']);
        }
        // o outro amortecedor casa "amortecedor", mas não o código "AMO-G01": fica de fora (não casa todas as palavras)
        expect(skus(await buscar(ap, 'AMO-G01 amortecedor'))).toEqual(['AMO-G01']);
      });

      it('B-BAP-5 (RN-CAT-16): polegada não vira ano: "calota gol 2013" e "calota gol 2014" dão lista vazia; "calota gol" acha a calota, sem "inclui"', async () => {
        // 13" e 14" lidos como ano de 2 dígitos seriam 2013 e 2014
        expect(skus(await buscar(ap, 'calota gol 2013'))).toEqual([]);
        expect(skus(await buscar(ap, 'calota gol 2014'))).toEqual([]);
        const r = await buscar(ap, 'calota gol');
        expect(skus(r)).toEqual(['CAL-G05']);
        expect(r[0]!.serveEm?.inclui_ano ?? null).toBeNull();
      });
    });
  }
});
