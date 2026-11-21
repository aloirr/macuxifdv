/**
 * T-0084 critério 3 (offline) e critério 8 (promotor) — ponta a ponta no SELETOR do Novo pedido, sem rede.
 * Agente `testes`, passo 5 da ordem. Roda sem Postgres e sem Docker (node:sqlite em memória), no PC e no CI.
 *
 * Monta o aparelho como o app Campo: `criarShell('campo', ...)` do platform-sdk com os manifestos REAIS de Core, Catálogo,
 * Vendedor e Promotor; o Catálogo com as entidades, migrações, índice e as consultas do aparelho de `modules/catalogo/app/index.ts`
 * (as telas React ficam de fora: não rodam em Node); `shell.consultas` e `shell.registroSync` no motor de sync REAL sobre o
 * SQLite v3. Depois da carga, o servidor sai do ar (`online = false`) e nenhuma chamada de rede acontece até o fim.
 *
 * A busca é chamada COMO O VENDEDOR CHAMA (`buscarProdutos` de modules/vendedor/app/state/use-vendedor.ts): `ambiente.consultar(
 * catalogo.busca_produtos@1, { q: q.trim().slice(0, 200), produto_ids: ids do seletor (≤ 5.000), limite: 100 })`, e o resultado
 * passa por `resolverBusca(itens, byId, 40)` (modules/vendedor/domain/busca-seletor.ts), como em new-order-screen.tsx. A linha
 * "Serve em" é composta como o `ServeEm` de modules/vendedor/app/components/novo-pedido.tsx (`partirTrecho` + " · inclui <ano>").
 * Reserva (plano B do desenho T-0084 §C9): só em `ConsultaIndisponivel`; outro erro é falha da busca (achado T-0084-A3,
 * corrigido: a lógica é `buscarNoCatalogoComReserva` de modules/vendedor/app/lib/busca-catalogo.ts, usada aqui de verdade).
 *
 * Casos (matriz docs/testes/T-0084.md):
 *  SO-1 (c3, RN-CAT-12): "pastilha uno 2012" acha a pastilha "Fiat Uno 1.0/1.4 2010–2014; …" (texto da base demo) com
 *       "Serve em" (≤ 90, Uno marcado, " · inclui 2012"); sem chamada de rede.
 *  SO-2 (c3, RN-CAT-12): "pastilha uno 2015" traz a traseira do Uno 2015–2020 (controle positivo); SO-2b: não traz a dianteira
 *       (A4 corrigido: o "2015" do Palio 2012–2016 do mesmo texto não puxa mais o Uno); "pastilha palio 2015" traz a dianteira.
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`).
 *  SO-3 (c3): "filtro gol 2014" acha o Gol G5/G6 em 1º; produto fora da tabela do cliente não entra no seletor.
 *  SO-4 (RN-VEN-19 §12): `catalogo.textos_produto@1` devolve a aplicação só dos visíveis, offline.
 *  SO-5 (plano B): Catálogo indisponível para o usuário → `ConsultaIndisponivel` → reserva (null); erro de programação
 *       (entrada fora do contrato) NÃO é `ConsultaIndisponivel` → resultado 'erro' e log só com o nome do erro.
 *  SO-6 (c8, regra 7, RN-PRO-01): o promotor, com tudo licenciado, vê o "Serve em" pela mesma consulta (só leitura) e não
 *       recebe ação de pedido (`pedido.criar`, página novo-pedido, `produto.acoes`); controle positivo no vendedor.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_TEXTOS_PRODUTO } from '@macuxi/catalogo/contracts';
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
  modulosEfetivos,
  type AmbienteAparelho,
  type AmbienteModulo,
  type LinhaSync,
  type Manifesto,
  type ModuloId,
  type MotorSync,
  type Perfil,
  type ServidorSyncSimulado,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { consultaPrecosClienteAparelho } from '../../modules/catalogo/app/consultas';
import { INDICE_BUSCA_CATALOGO } from '../../modules/catalogo/app/indice';
import { esquecerMemoriaLocal } from '../../modules/catalogo/app/lib/local';
import { consultaSugestoesPedidoAparelho } from '../../modules/catalogo/app/sugestoes';
import { consultaBuscaProdutosAparelho, consultaTextosProdutoAparelho, esquecerMemoriaTextos } from '../../modules/catalogo/app/texto-consultas';
import { migracoesAparelho } from '../../modules/catalogo/db/aparelho';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { entidadeConcorrente } from '../../modules/promotor/contracts/entidades';
import { buscarNoCatalogoComReserva } from '../../modules/vendedor/app/lib/busca-catalogo';
import { partirTrecho, resolverBusca, type TrechoServeEm } from '../../modules/vendedor/domain/busca-seletor';
import { entidadesSyncCatalogo } from './apoio/entidades-catalogo';

const relogio = criarRelogio();
const CARGA = relogio.relativo({ horas: -3 }).toISOString();

let seq = 0;
const uid = (grupo: number) => `0f84${grupo.toString(16).padStart(4, '0')}-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const linha = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: CARGA, deleted_at: null, external_id: null, ...o }) as LinhaSync;

/** Textos da base demo (db/seeds/demo/demo.ts), os do critério 3. */
const APL = {
  unoDianteira: 'Fiat Uno 1.0/1.4 2010–2014; Fiat Palio 1.0/1.4 2012–2016',
  unoTraseira: 'Fiat Uno 1.0 2015–2020',
  gol: 'VW Gol G5/G6 1.0/1.6 2009–2016; VW Voyage 1.0/1.6 2009–2016',
  foraDaTabela: 'Fiat Uno 1.0/1.4 2010–2014',
};
const P = { unoD: uid(1), unoT: uid(1), gol: uid(1), fora: uid(1), fluido: uid(1) };
// SKUs neutros como os da base demo (PST-D01, FOL-G01): SKU com o nome do modelo ("PST-UNO-D") faz "uno" casar no CÓDIGO,
// fora da aplicação, e aí o ano pode vir de qualquer trecho (RN-CAT-12 só amarra ao trecho o termo que só a aplicação cobre).
const SKU: Record<string, string> = { [P.unoD]: 'PST-D01', [P.unoT]: 'PST-T01', [P.gol]: 'FOL-G01', [P.fora]: 'PST-C01', [P.fluido]: 'FLU-DOT4' };
const TABELA = uid(2);
const CLIENTE = uid(3);
const DEPOSITO = uid(4);

function baseServidor(): Record<string, LinhaSync[]> {
  const produto = (id: string, nome: string, marca: string, categoria: string) => linha(id, { sku: SKU[id], ean: null, nome, marca, categoria, unidade: 'UN', ativo: true });
  const alvo = [
    produto(P.unoD, 'Pastilha de freio dianteira', 'Norfreio', 'Freios'),
    produto(P.unoT, 'Pastilha de freio traseira', 'Norfreio', 'Freios'),
    produto(P.gol, 'Filtro de óleo', 'Purifil', 'Filtros'),
    produto(P.fora, 'Pastilha de freio cerâmica', 'Norfreio', 'Freios'),
    produto(P.fluido, 'Fluido de freio DOT 4 500 ml', 'Bosch', 'Freios'),
  ];
  const enchimento = Array.from({ length: 40 }, (_, k) => linha(uid(9), { sku: `PAR-${k}`, ean: null, nome: `Parafuso sextavado M${6 + (k % 10)} x ${20 + k}`, marca: 'Ciser', categoria: 'Fixação', unidade: 'UN', ativo: true }));
  const todos = [...alvo, ...enchimento];
  const conteudo = (produtoId: string, aplicacao: string | null) => linha(uid(6), { produto_id: produtoId, descricao: null, argumentos: [], faq: [], campanha: false, aplicacao, etiquetas: [] });
  // a cerâmica NÃO está na tabela do cliente: não aparece no seletor (catalogBase do Vendedor = produtos com preço)
  const naTabela = todos.filter((p) => p.id !== P.fora);
  return {
    produto: todos,
    produto_unidade: [],
    medida: [],
    produto_atributo: [],
    sinonimo: [],
    deposito: [linha(DEPOSITO, { codigo: 'CD1', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: alvo.map((p) => linha(uid(8), { produto_id: p.id, deposito_id: DEPOSITO, quantidade: 40, atualizado_em: CARGA })),
    produto_conteudo: [conteudo(P.unoD, APL.unoDianteira), conteudo(P.unoT, APL.unoTraseira), conteudo(P.gol, APL.gol), conteudo(P.fora, APL.foraDaTabela), conteudo(P.fluido, null)],
    produto_referencia: [],
    produto_relacao: [],
    concorrente: [],
    tabela_preco: [linha(TABELA, { codigo: 'VAREJO', nome: 'Varejo', ativo: true })],
    tabela_preco_item: naTabela.map((p) => linha(uid(7), { tabela_preco_id: TABELA, produto_id: p.id, preco_cents: 1_990, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [linha(uid(7), { cliente_id: CLIENTE, tabela_preco_id: TABELA })],
  };
}

/** "Adicionar ao pedido" como o Vendedor registra (o fonte é conferido em tests/modulos/promotor-sem-pedido.test.ts). */
const ADICIONAR_AO_PEDIDO = { slot: 'produto.acoes', id: 'adicionar-ao-pedido', acao: 'pedido.criar', apps: ['campo' as const], payload: { rotulo: 'Adicionar ao pedido' } };

/** Shell do app Campo com os manifestos reais e o Catálogo montado como em modules/catalogo/app/index.ts (sem as telas; entidades lidas do fonte). */
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
    { manifesto: manifestoVendedor, extensoes: [ADICIONAR_AO_PEDIDO] },
    { manifesto: manifestoPromotor, entidadesSync: [entidadeConcorrente] },
  ]);
}

const MANIFESTOS = [manifestoCore, manifestoCatalogo, manifestoVendedor, manifestoPromotor] as Manifesto[];
const LICENCIADOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor'];
/** Módulos efetivos de verdade: licença do tenant × perfis do manifesto, com dependências (RN-CORE-01/03). */
const efetivos = (perfil: Perfil, ativos: readonly ModuloId[] = LICENCIADOS) =>
  modulosEfetivos({ manifestos: MANIFESTOS, ativosNoTenant: [...ativos], doPerfil: ativos.filter((id) => MANIFESTOS.find((m) => m.id === id)!.perfis.includes(perfil)) });

interface Aparelho {
  shell: ReturnType<typeof shellCampo>;
  motor: MotorSync;
  servidor: ServidorSyncSimulado;
  ambiente: AmbienteModulo;
  modulos: ModuloId[];
}

async function aparelho(perfil: Perfil, modulos: ModuloId[] = efetivos(perfil)): Promise<Aparelho> {
  const shell = shellCampo();
  const servidor = criarServidorSyncSimulado(shell.registroSync, { modulosAtivos: modulos, linhas: baseServidor() });
  const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
    migracoesModulos: shell.migracoesAparelho,
    indicesBusca: shell.indicesBusca,
    entidades: shell.registroSync.entidadesAtivas(LICENCIADOS).map((e) => ({ nome: e.nome, modulo: e.modulo })),
  });
  const ambienteBase: AmbienteAparelho = { ...ambienteIndisponivel(), usuario: () => ({ id: uid(5), nome: 'Teste', perfil }) };
  const motor = criarMotorSync({ registro: shell.registroSync, armazenamento, transporte: servidor, online: () => servidor.online, consultas: shell.consultas, ambiente: ambienteBase });
  await motor.aplicarModulosAtivos(modulos);
  expect(await motor.sincronizar(), 'carga inicial do aparelho').toBe(true);
  servidor.online = false;
  esquecerMemoriaLocal();
  esquecerMemoriaTextos();
  return { shell, motor, servidor, ambiente: motor.ambiente, modulos };
}

/**
 * `buscarProdutos` do Vendedor (use-vendedor.ts): a mesma chamada e a lógica REAL `buscarNoCatalogoComReserva`
 * (modules/vendedor/app/lib/busca-catalogo.ts). 'reserva' → `null` (o seletor filtra local); 'erro' → lança aqui para o
 * teste ver (no app vira "Busca indisponível"). `logs` guarda o que o Vendedor mandaria ao console.
 */
async function buscarComoVendedorResultado(ambiente: AmbienteModulo, q: string, produtoIds: string[] | null, logs: Array<{ mensagem: string; extra: { nome: string } }> = []) {
  return buscarNoCatalogoComReserva(
    () => ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: q.trim().slice(0, 200), ...(produtoIds ? { produto_ids: produtoIds } : {}), limite: 100 }),
    ehConsultaIndisponivel,
    (mensagem, extra) => logs.push({ mensagem, extra }),
  );
}

async function buscarComoVendedor(ambiente: AmbienteModulo, q: string, produtoIds: string[] | null) {
  if (!q.trim()) return null;
  const r = await buscarComoVendedorResultado(ambiente, q, produtoIds);
  if (r.tipo === 'reserva') return null;
  if (r.tipo === 'erro') throw new Error('busca do seletor falhou (resultado erro de buscarNoCatalogoComReserva)');
  return r.itens.map((i) => ({ produto_id: i.produto_id, serve_em: i.serve_em as TrechoServeEm | null }));
}

/** Produtos do seletor (catalogBase do Novo pedido = os que têm preço na tabela do cliente), lidos do aparelho. */
async function produtosDoSeletor(ap: Aparelho) {
  const itens = (await ap.motor.linhas('tabela_preco_item')) as unknown as Array<{ produto_id: string }>;
  const ids = new Set(itens.map((i) => i.produto_id));
  const produtos = ((await ap.motor.linhas('produto')) as unknown as Array<{ id: string; sku: string; nome: string }>).filter((p) => ids.has(p.id));
  return new Map(produtos.map((p) => [p.id, p] as const));
}

/** Como a tela monta: busca → resolverBusca(…, byId, 40) → linha "Serve em" do componente ServeEm. */
async function seletor(ap: Aparelho, q: string) {
  const byId = await produtosDoSeletor(ap);
  const catalogBase = [...byId.keys()];
  const itens = await buscarComoVendedor(ap.ambiente, q, catalogBase.length <= 5000 ? catalogBase : null);
  if (itens === null) return null;
  return resolverBusca(itens, byId, 40).map((r) => ({
    sku: r.produto.sku,
    id: r.produto.id,
    serveEm: r.serveEm,
    linha: r.serveEm ? `Serve em: ${partirTrecho(r.serveEm.texto, r.serveEm.marcas).map((x) => x.texto).join('')}${r.serveEm.inclui_ano ? ` · inclui ${r.serveEm.inclui_ano}` : ''}` : null,
    marcados: r.serveEm ? partirTrecho(r.serveEm.texto, r.serveEm.marcas).filter((x) => x.marcado).map((x) => x.texto) : [],
  }));
}

describe('T-0084 — seletor do Novo pedido offline: catalogo.busca_produtos@1 pelo SDK, como o Vendedor chama (motor + SQLite v3 + shell Campo)', { timeout: 60_000 }, () => {
  describe('vendedor no Campo, sem rede', () => {
    let ap: Aparelho;
    let chamadasAntes: string;
    beforeAll(async () => {
      ap = await aparelho('vendedor');
      chamadasAntes = JSON.stringify(ap.servidor.chamadas);
    }, 60_000);

    it('pré-condição: o vendedor tem Core, Catálogo e Vendedor efetivos; o aparelho está sem rede', () => {
      expect(ap.modulos).toEqual(expect.arrayContaining(['core', 'catalogo', 'vendedor']));
      expect(ap.modulos).not.toContain('promotor');
      expect(ap.servidor.online).toBe(false);
    });

    it('SO-1 (c3, RN-CAT-12): "pastilha uno 2012" acha a pastilha do Uno 2010–2014 com "Serve em" (≤ 90, Uno marcado, " · inclui 2012")', async () => {
      const r = (await seletor(ap, 'pastilha uno 2012'))!;
      expect(r, 'a consulta respondeu no aparelho (não caiu na reserva)').not.toBeNull();
      const uno = r.find((x) => x.id === P.unoD);
      expect(uno, r.map((x) => x.sku).join(',')).toBeDefined();
      expect(uno!.serveEm!.texto.length).toBeLessThanOrEqual(90);
      expect(uno!.serveEm!.texto).toContain('Uno');
      expect(uno!.serveEm!.inclui_ano).toBe(2012);
      expect(uno!.marcados).toEqual(expect.arrayContaining(['Uno']));
      expect(uno!.linha).toMatch(/^Serve em: .*Uno.*2010–2014.* · inclui 2012$/);
      // a traseira (2015–2020) não serve em 2012
      expect(r.map((x) => x.id)).not.toContain(P.unoT);
    });

    it('SO-2 (c3, RN-CAT-12): "pastilha uno 2015" traz a traseira do Uno 2015–2020 (controle positivo); "2017" vem da faixa (inclui 2017)', async () => {
      const r = (await seletor(ap, 'pastilha uno 2015'))!;
      expect(r).not.toBeNull();
      const tras = r.find((x) => x.id === P.unoT);
      expect(tras, r.map((x) => x.sku).join(',')).toBeDefined();
      expect(tras!.serveEm?.texto).toContain('2015–2020');
      // 2015 está escrito no texto (não veio da faixa): sem "inclui"; 2017 só existe pela faixa
      const meio = (await seletor(ap, 'pastilha uno 2017'))!;
      expect(meio.find((x) => x.id === P.unoT)?.linha).toMatch(/ · inclui 2017$/);
      expect(meio.map((x) => x.sku)).not.toContain('PST-D01');
    });

    // T-0084-A4 (corrigido pelo modulo-catalogo em domain/ranking.ts): com ano na consulta, veículo/modelo e ano têm de casar no
    // MESMO trecho (;) da aplicação. No texto da base demo, "2015" só está no "Fiat Palio … 2012–2016" e "uno" no "Fiat Uno … 2010–2014".
    it('SO-2b (c3, RN-CAT-12, A4): "pastilha uno 2015" não traz a dianteira "Fiat Uno … 2010–2014; Fiat Palio … 2012–2016"', async () => {
      const r = (await seletor(ap, 'pastilha uno 2015'))!;
      expect(r).not.toBeNull();
      expect(r.map((x) => x.sku)).not.toContain('PST-D01');
    });

    it('SO-2c (c3, RN-CAT-12, A4 controle positivo): "pastilha palio 2015" traz a dianteira pelo trecho do Palio (inclui 2015)', async () => {
      const r = (await seletor(ap, 'pastilha palio 2015'))!;
      expect(r).not.toBeNull();
      const d = r.find((x) => x.id === P.unoD);
      expect(d, r.map((x) => x.sku).join(',')).toBeDefined();
      expect(d!.serveEm?.texto).toContain('Palio');
      expect(d!.marcados).toEqual(expect.arrayContaining(['Palio']));
      expect(d!.serveEm?.inclui_ano).toBe(2015);
      // R-20261120-194335: o ano fora da faixa do Palio (2011) não casa em trecho nenhum que tenha "palio"; ninguém casa as 3 palavras
      const fora = (await seletor(ap, 'pastilha palio 2011'))!;
      expect(fora.map((x) => x.sku), JSON.stringify(fora.map((x) => [x.sku, x.serveEm]))).toEqual([]);
    });

    it('SO-3 (c3): "filtro gol 2014" acha o Gol G5/G6 em 1º com inclui 2014; o produto fora da tabela do cliente não entra no seletor', async () => {
      const gol = (await seletor(ap, 'filtro gol 2014'))!;
      expect(gol[0]?.sku).toBe('FOL-G01');
      expect(gol[0]!.serveEm?.inclui_ano).toBe(2014);
      // a cerâmica (Uno 2010–2014) casaria, mas não tem preço para o cliente: nem a consulta (produto_ids) nem o resolverBusca a mostram
      const uno = (await seletor(ap, 'pastilha uno 2012'))!;
      expect(uno.map((x) => x.sku)).not.toContain('PST-C01');
      // controle: sem produto_ids, a consulta acha a cerâmica (é o recorte do seletor que tira)
      const solta = await buscarComoVendedor(ap.ambiente, 'pastilha uno 2012', null);
      expect(solta!.map((x) => x.produto_id)).toContain(P.fora);
    });

    it('SO-4 (RN-VEN-19 §12): catalogo.textos_produto@1 devolve a aplicação só dos visíveis, offline', async () => {
      const r = await ap.ambiente.consultar(CONSULTA_TEXTOS_PRODUTO, { produto_ids: [P.unoD, P.fluido] });
      const porId = new Map(r.itens.map((i) => [i.produto_id, i.aplicacao] as const));
      expect(porId.get(P.unoD)).toBe(APL.unoDianteira);
      expect(porId.get(P.fluido) ?? null).toBeNull();
      expect(r.itens.map((i) => i.produto_id)).not.toContain(P.gol);
    });

    it('sem rede do começo ao fim: nenhuma chamada ao servidor durante as buscas', () => {
      expect(JSON.stringify(ap.servidor.chamadas)).toBe(chamadasAntes);
    });

    it('SO-5 (plano B): erro de programação (entrada fora do contrato) NÃO é ConsultaIndisponivel — não deve cair na reserva em silêncio', async () => {
      const erro = await ap.ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: 'pastilha', limite: 500 } as never).then(
        () => null,
        (e: unknown) => e,
      );
      expect(erro).not.toBeNull();
      expect(ehConsultaIndisponivel(erro)).toBe(false);
    });

    it('SO-5b (A3 corrigido): erro que não é ConsultaIndisponivel → resultado "erro" (não reserva) e o log leva só o nome do erro', async () => {
      const logs: Array<{ mensagem: string; extra: { nome: string } }> = [];
      const r = await buscarNoCatalogoComReserva(
        () => ap.ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: 'pastilha uno 2012 cliente-secreto', limite: 500 } as never),
        ehConsultaIndisponivel,
        (mensagem, extra) => logs.push({ mensagem, extra }),
      );
      expect(r.tipo).toBe('erro');
      expect(logs).toHaveLength(1);
      expect(Object.keys(logs[0]!.extra)).toEqual(['nome']);
      expect(JSON.stringify(logs)).not.toContain('cliente-secreto');
      // e com a consulta certa o resultado é 'ok' pela mesma função
      const ok = await buscarComoVendedorResultado(ap.ambiente, 'pastilha uno 2012', null);
      expect(ok.tipo).toBe('ok');
    });
  });

  it('SO-5 (plano B): Catálogo indisponível para o usuário → ConsultaIndisponivel → o seletor usa a reserva (null), sem erro', async () => {
    const ap = await aparelho('vendedor', ['core']);
    const erro = await ap.ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: 'pastilha uno 2012', limite: 100 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(ehConsultaIndisponivel(erro)).toBe(true);
    expect(await buscarComoVendedor(ap.ambiente, 'pastilha uno 2012', null)).toBeNull();
  });

  describe('SO-6 (c8, regra 7, RN-PRO-01): promotor com tudo licenciado no tenant', () => {
    let ap: Aparelho;
    beforeAll(async () => {
      ap = await aparelho('promotor');
    }, 60_000);

    it('o Vendedor não é efetivo para o promotor; Catálogo e Promotor são', () => {
      expect(ap.modulos).toEqual(expect.arrayContaining(['core', 'catalogo', 'promotor']));
      expect(ap.modulos).not.toContain('vendedor');
    });

    it('vê a aplicação pela mesma consulta, offline e só leitura ("Serve em" com inclui 2012)', async () => {
      const r = await buscarComoVendedor(ap.ambiente, 'pastilha uno 2012', null);
      const uno = r!.find((x) => x.produto_id === P.unoD);
      expect(uno?.serve_em).toMatchObject({ inclui_ano: 2012 });
      expect(ap.servidor.online).toBe(false);
    });

    it('não recebe ação de pedido: sem pedido.criar, sem a página novo-pedido e sem "Adicionar ao pedido" em produto.acoes', () => {
      const v = ap.shell.montar({ perfil: 'promotor', modulosAtivos: ap.modulos });
      expect(v.pode('pedido.criar')).toBe(false);
      expect(v.pagina('novo-pedido')).toBeNull();
      expect(v.extensoes('produto.acoes')).toEqual([]);
      // pior caso: mesmo com o Vendedor na sessão, a ação pedido.criar barra (RN-PRO-01 independe da licença)
      const pior = ap.shell.montar({ perfil: 'promotor', modulosAtivos: LICENCIADOS });
      expect(pior.pode('pedido.criar')).toBe(false);
      expect(pior.extensoes('produto.acoes')).toEqual([]);
    });

    it('controle positivo: o vendedor recebe "Adicionar ao pedido" e pode pedido.criar', () => {
      const v = ap.shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos('vendedor') });
      expect(v.pode('pedido.criar')).toBe(true);
      expect(v.extensoes('produto.acoes').map((e) => `${e.modulo}/${e.id}`)).toEqual(['vendedor/adicionar-ao-pedido']);
    });
  });
});
