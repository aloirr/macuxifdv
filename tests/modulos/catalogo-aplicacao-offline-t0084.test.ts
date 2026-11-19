/**
 * T-0084 (aplicação) e T-0085 (referência cruzada) — busca OFFLINE no aparelho com o FTS5 REAL da v3 do Catálogo
 * (agente `testes`; passo 5 da ordem das duas tarefas). Roda sem Postgres e sem Docker (node:sqlite em memória), no PC e no CI.
 *
 * Integração entre platform-sdk (motor de sync + SQLite), Core (`produto`), Catálogo (migração v3 do aparelho, índice com
 * `aplicacao`/`referencias`/`codigos`, `buscarLocal`/`fichaLocal`, domain `expandirAplicacao`/ranking/`trechoServeEm`) e
 * Promotor (instalado no aparelho do perfil com o módulo). Desde a 0045 (RN-CAT-13, ADR 0034) as marcas vêm da entidade
 * `marca_concorrente` do PRÓPRIO Catálogo, com ou sem o Promotor (T-0140 lote 03). Catálogo acima de `LIMIAR_PRESELECAO_FTS`: o FTS5
 * pré-seleciona os candidatos de verdade.
 *
 * Casos (matrizes docs/testes/T-0084.md e docs/testes/T-0085.md):
 *  AO-1 (T-0084 c3, RN-CAT-12): "pastilha uno 2012" acha a pastilha "Uno 1.0/1.4 2010–2014" com "Serve em" (≤ 90, termos
 *       marcados, inclui 2012); "pastilha uno 2015" não traz; "filtro gol 2014" acha o Gol; o ano de dentro da faixa está
 *       no índice FTS5 do aparelho e o de fora não.
 *  AO-2 (T-0084 c3): "1.0/1.4" e "G5/G6" nunca viram faixa (o documento do índice só ganha os anos de 4 dígitos do meio).
 *  AO-3 (T-0084 c3): sinônimo do tenant vale na aplicação ("filtro volkswagen gol" acha "VW Gol").
 *  AO-4 (T-0084 c3): quem casa pelo nome vem antes de quem casa só pela aplicação, mesmo em campanha.
 *  AO-5 (T-0084 c4): tenant sem aplicação — a mesma lista, na mesma ordem e com as mesmas notas, com e sem linhas de
 *       conteúdo sem aplicação no aparelho.
 *  AO-6 (T-0084 c3): texto longo sem separador sai no "Serve em" com ≤ 90 caracteres e "…".
 *  RO-1 (T-0085 c4, RN-CAT-09): "cb3401", "CB-3401", "cb 3401" e "C.B.3401" acham o produto pela referência, em 1º,
 *       com "Equivale a: <marca> <código>" e o trecho marcado; o vendedor SEM o Promotor vê a marca pelo retrato `marca_nome`.
 *  RO-2 (T-0085 c4/c8; RN-CAT-13): com o cadastro de marcas do Catálogo no aparelho (`marca_concorrente`), a marca inativa
 *       tira a referência da busca e da ficha; a ativa aparece com o nome do cadastro.
 *  FO-1 (T-0084 c8, T-0085 c8): o promotor abre a ficha offline com aplicação, referências, oferece junto e etiquetas, sem
 *       preço nem estoque.
 *  CO-1 (revisão R-20261106-042958): a C9 do aparelho (`catalogo.busca_produtos@1`, registro real de consultas) dá o mesmo 1º item,
 *       "Serve em" e "Equivale a" que a aba para "pastilha uno 2012", "filtro gol 2014" e "cb3401".
 *  CO-2: com o Promotor no aparelho a C9 não lança Error e usa o retrato `marca_nome`. CO-3 (`it.fails`): marca inativa segue no
 *       "Equivale a" da C9 pelo retrato até a lápide da referência chegar (o servidor simulado não a gera; ADR 0034 §6).
 * Convenção: `it` = vale hoje; `it.fails` = defeito/divergência aberta (fica vermelho quando resolver e vira `it`).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { CONSULTA_BUSCA_PRODUTOS } from '@macuxi/catalogo/contracts';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoPromotor } from '@macuxi/promotor/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import { criarArmazenamentoSqlite, criarMotorSync, criarRegistroConsultasAparelho, criarRegistroSync, criarServidorSyncSimulado, type LinhaSync, type ModuloId, type MotorSync, type Perfil, type ServidorSyncSimulado } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { INDICE_BUSCA_CATALOGO } from '../../modules/catalogo/app/indice';
import { buscarLocal, esquecerMemoriaLocal, fichaLocal, ID_INDICE_BUSCA, LIMIAR_PRESELECAO_FTS, type LeitorLocal } from '../../modules/catalogo/app/lib/local';
import { consultaBuscaProdutosAparelho, esquecerMemoriaTextos } from '../../modules/catalogo/app/texto-consultas';
import { migracoesAparelho, TABELAS_BUSCA_CATALOGO } from '../../modules/catalogo/db/aparelho';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { entidadeConcorrente } from '../../modules/promotor/contracts/entidades';
import { entidadesSyncCatalogo } from './apoio/entidades-catalogo';

const relogio = criarRelogio();
const CARGA = relogio.relativo({ horas: -3 }).toISOString();

let seq = 0;
const uid = (grupo: number) => `00000000-0000-4000-8${grupo.toString(16).padStart(3, '0')}-${(++seq).toString(16).padStart(12, '0')}`;
const linha = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: CARGA, deleted_at: null, external_id: null, ...o }) as LinhaSync;

const P = { uno: uid(1), gol: uid(1), pastilhaUno: uid(1), pastilhaApl: uid(1), lampada: uid(1), disco: uid(1), semApl: uid(1) };
const SKU: Record<string, string> = {
  [P.uno]: 'PST-D01',
  [P.gol]: 'FOL-G01',
  [P.pastilhaUno]: 'PST-UNO',
  [P.pastilhaApl]: 'PST-APL',
  [P.lampada]: 'LAM-H4',
  [P.disco]: 'DSC-D01',
  [P.semApl]: 'FLU-DOT4',
};
const APL = {
  uno: 'Fiat Uno 1.0/1.4 2010–2014',
  gol: 'VW Gol G5/G6 1.0/1.6 2009–2016',
  lampada:
    'Faróis de carros e motos com encaixe H4 de 12 V como Fiat Uno Mille Palio Siena Strada e Fiorino VW Gol Parati Saveiro Voyage e Fox ' +
    'Chevrolet Celta Corsa Classic Prisma e Onix Ford Ka Fiesta e EcoSport Renault Clio Sandero e Logan Honda CG 125 150 e 160 Titan Fan ' +
    'e Start Yamaha Factor YBR e Fazer 250 e as demais motos de baixa cilindrada com farol H4 de 60/55 W',
};
const MARCA = { freiomax: uid(2), filtrobom: uid(2) };
const TABELA = uid(3);
const CLIENTE = uid(4);
const DEPOSITO = uid(5);
const ENCHIMENTO = LIMIAR_PRESELECAO_FTS + 50;

function produto(id: string, nome: string, marca: string, categoria: string): LinhaSync {
  return linha(id, { sku: SKU[id] ?? `PAR-${id.slice(-4)}`, ean: null, nome, marca, categoria, unidade: 'UN', ativo: true });
}

interface OpcoesBase {
  /** false = tenant sem aplicação (critério 4): nenhuma linha de conteúdo traz `aplicacao`. */
  comAplicacao?: boolean;
  /** false = nenhuma linha de produto_conteudo (o aparelho "de hoje" sem conteúdo). */
  comConteudo?: boolean;
  /** Linhas do cadastro de marcas concorrentes do Catálogo (`marca_concorrente`; RN-CAT-13, com ou sem o Promotor). */
  marcas?: LinhaSync[];
}

function baseServidor(o: OpcoesBase = {}): Record<string, LinhaSync[]> {
  const comAplicacao = o.comAplicacao ?? true;
  const alvo = [
    produto(P.uno, 'Pastilha de freio dianteira', 'Norfreio', 'Freios'),
    produto(P.gol, 'Filtro de óleo', 'Purifil', 'Filtros'),
    produto(P.pastilhaUno, 'Pastilha Uno', 'Norfreio', 'Freios'),
    produto(P.pastilhaApl, 'Pastilha', 'Norfreio', 'Freios'),
    produto(P.lampada, 'Lâmpada halógena H4 12 V', 'Vialux', 'Elétrica'),
    produto(P.disco, 'Disco de freio dianteiro ventilado', 'Norfreio', 'Freios'),
    produto(P.semApl, 'Fluido de freio DOT 4 500 ml', 'Bosch', 'Freios'),
  ];
  const enchimento = Array.from({ length: ENCHIMENTO }, (_, k) => linha(uid(9), { sku: `PAR-${k}`, ean: null, nome: `Parafuso sextavado zincado M${6 + (k % 10)} x ${20 + k}`, marca: 'Ciser', categoria: 'Fixação', unidade: 'UN', ativo: true }));
  const todos = [...alvo, ...enchimento];
  const conteudo = (produtoId: string, aplicacao: string | null, extra: Record<string, unknown> = {}) =>
    linha(uid(6), { produto_id: produtoId, descricao: null, argumentos: [], faq: [], campanha: false, aplicacao: comAplicacao ? aplicacao : null, etiquetas: [], ...extra });
  return {
    produto: todos,
    produto_unidade: [],
    medida: [],
    produto_atributo: [],
    sinonimo: [linha(uid(7), { termo: 'vw', sinonimos: ['volkswagen'], ativo: true })],
    deposito: [linha(DEPOSITO, { codigo: 'CD1', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: alvo.map((p) => linha(uid(8), { produto_id: p.id, deposito_id: DEPOSITO, quantidade: 40, atualizado_em: CARGA })),
    produto_conteudo:
      (o.comConteudo ?? true)
        ? [
            conteudo(P.uno, APL.uno, { etiquetas: ['Dianteira', 'Novo'] }),
            conteudo(P.gol, APL.gol),
            // D: só "Uno" na aplicação, EM CAMPANHA — mesmo assim vem depois do "Pastilha Uno" (nome)
            conteudo(P.pastilhaApl, 'Uno', { campanha: true }),
            conteudo(P.lampada, APL.lampada),
            conteudo(P.semApl, null),
          ]
        : [],
    produto_referencia: [
      // retrato do nome da marca (0034): o vendedor sem o Promotor lê daqui
      linha(uid(10), { produto_id: P.uno, marca_id: MARCA.freiomax, codigo: 'CB 3401', ordem: 1, marca_nome: 'Freiomax' }),
      linha(uid(10), { produto_id: P.gol, marca_id: MARCA.filtrobom, codigo: 'FB-0207', ordem: 1, marca_nome: 'Filtrobom' }),
    ],
    produto_relacao: [linha(uid(11), { produto_id: P.uno, relacionado_id: P.disco, tipo: 'complementar', ordem: 0, ativo: true })],
    marca_concorrente: o.marcas ?? [],
    // legado do Promotor (ADR 0034 §5): a API manda página vazia até a fase 2
    concorrente: [],
    tabela_preco: [linha(TABELA, { codigo: 'VAREJO', nome: 'Varejo', ativo: true })],
    tabela_preco_item: todos.map((p) => linha(uid(12), { tabela_preco_id: TABELA, produto_id: p.id, preco_cents: 1_990, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [linha(uid(12), { cliente_id: CLIENTE, tabela_preco_id: TABELA })],
  };
}

interface Aparelho {
  motor: MotorSync;
  servidor: ServidorSyncSimulado;
  driver: ReturnType<typeof criarDriverNode>;
  leitor: LeitorLocal;
}

async function aparelho(o: OpcoesBase & { promotor?: boolean } = {}): Promise<Aparelho> {
  const comPromotor = o.promotor ?? false;
  const manifestos = comPromotor ? [manifestoCore, manifestoCatalogo, manifestoPromotor] : [manifestoCore, manifestoCatalogo];
  // Catálogo como o shell real monta (`modules/catalogo/app/index.ts`): a migração do aparelho exige as tabelas de todas elas
  const entidades = [...entidadesProduto, ...entidadesSyncCatalogo(), ...(comPromotor ? [entidadeConcorrente] : [])];
  const registro = criarRegistroSync(manifestos);
  for (const e of entidades) registro.registrar(e);
  const modulos: ModuloId[] = comPromotor ? ['core', 'catalogo', 'promotor'] : ['core', 'catalogo'];
  const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: modulos, linhas: baseServidor(o) });
  const driver = criarDriverNode(':memory:');
  const armazenamento = criarArmazenamentoSqlite(driver, {
    migracoesModulos: { catalogo: migracoesAparelho },
    indicesBusca: [INDICE_BUSCA_CATALOGO],
    entidades: entidades.map((e) => ({ nome: e.nome, modulo: e.modulo })),
  });
  // consultas do aparelho (ADR 0012) como o `criarShell(...).consultas` do app: o Catálogo responde a C9; o Vendedor (instalado no
  // app Campo, mesmo sem licença para o perfil) é quem declara `usaConsultas` dela
  const consultas = criarRegistroConsultasAparelho([
    ...manifestos.map((m) => (m.id === 'catalogo' ? { manifesto: m, consultas: [consultaBuscaProdutosAparelho] } : { manifesto: m })),
    { manifesto: manifestoVendedor },
  ]).registro;
  const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, online: () => servidor.online, consultas });
  await motor.aplicarModulosAtivos(modulos);
  expect(await motor.sincronizar(), 'carga inicial do aparelho').toBe(true);
  servidor.online = false;
  // a memória do `local.ts` é por leitor/versão; cada aparelho começa limpo
  esquecerMemoriaLocal();
  esquecerMemoriaTextos();
  return { motor, servidor, driver, leitor: { linhas: (e) => motor.linhas(e), buscar: (i, c) => motor.buscar(i, c) } };
}

const busca = (ap: Aparelho, q: string, perfil: Perfil = 'vendedor', clienteId: string | null = CLIENTE) =>
  buscarLocal(ap.leitor, { perfil, parametros: {}, agora: relogio.iso(), clienteId, q, limit: 20, offset: 0, offline: true });
const skus = (r: Awaited<ReturnType<typeof busca>>) => r.items.map((i) => SKU[i.id] ?? i.erp_code);
const noIndice = async (ap: Aparelho, termo: string) => ((await ap.motor.buscar(ID_INDICE_BUSCA, { grupos: [[termo]], prefixoNoUltimo: false, limite: 500 })) ?? []).map((r) => r.chave);
/** Texto marcado do trecho (para conferir as marcas em posições do texto). */
const marcados = (t: { texto: string; marcas: ReadonlyArray<readonly [number, number]> }) => t.marcas.map(([i, f]) => t.texto.slice(i, f));

describe('T-0084/T-0085 — busca offline com aplicação e referência cruzada no aparelho (motor + SQLite v3 + domain)', { timeout: 60_000 }, () => {
  describe('vendedor sem o Promotor, tenant com aplicação', () => {
    let ap: Aparelho;
    beforeAll(async () => {
      ap = await aparelho();
    }, 60_000);

    it('AO-1 (RN-CAT-12): "pastilha uno 2012" acha a pastilha do Uno 2010–2014 com "Serve em" (≤ 90, Uno e a faixa marcados, inclui 2012); "pastilha uno 2015" não', async () => {
      const r = await busca(ap, 'pastilha uno 2012');
      expect(skus(r)).toContain('PST-D01');
      const item = r.items.find((i) => i.id === P.uno)!;
      expect(item.serve_em, 'serve_em da pastilha do Uno').toBeTruthy();
      const t = item.serve_em!;
      expect(t.texto.length).toBeLessThanOrEqual(90);
      expect(t.texto).toContain('Uno');
      expect(t.inclui_ano).toBe(2012);
      expect(marcados(t)).toEqual(expect.arrayContaining(['Uno', '2010–2014']));
      expect(r.aviso, 'aviso discreto da busca offline').not.toBeNull();

      const fora = await busca(ap, 'pastilha uno 2015');
      expect(skus(fora), '2015 está fora de 2010–2014').not.toContain('PST-D01');
      // o produto que casa "uno" pelo nome e não tem ano na aplicação não muda de comportamento
      expect(skus(fora)).toContain('PST-UNO');
    });

    it('AO-1b (RN-CAT-12): "filtro gol 2014" acha o filtro "Gol G5/G6 1.0/1.6 2009–2016" em 1º, com inclui 2014', async () => {
      const r = await busca(ap, 'filtro gol 2014');
      expect(skus(r)[0]).toBe('FOL-G01');
      expect(r.items[0]!.serve_em).toMatchObject({ inclui_ano: 2014 });
    });

    it('AO-1c (RN-CAT-12, índice v3): o FTS5 do aparelho tem o ano de dentro da faixa (2012) e não o de fora (2015)', async () => {
      expect(await noIndice(ap, '2012')).toContain(P.uno);
      expect(await noIndice(ap, '2015')).not.toContain(P.uno);
      expect(await noIndice(ap, '2015')).toContain(P.gol);
    });

    it('AO-2 (RN-CAT-12): "1.0/1.4" e "G5/G6" nunca viram faixa — o documento do índice só ganha anos de 4 dígitos', async () => {
      const docs = (await ap.driver.todas<{ produto_id: string; aplicacao: string }>(`select produto_id, aplicacao from ${TABELAS_BUSCA_CATALOGO.doc} where produto_id in (?, ?)`, [P.uno, P.gol])) as Array<{ produto_id: string; aplicacao: string }>;
      const doc = new Map(docs.map((d) => [d.produto_id, d.aplicacao]));
      const acrescimo = (id: string, original: string) => doc.get(id)!.slice(original.length).trim().split(/\s+/).filter(Boolean);
      expect(doc.get(P.uno)!.startsWith(APL.uno)).toBe(true);
      expect(acrescimo(P.uno, APL.uno)).toEqual(['2011', '2012', '2013']);
      expect(acrescimo(P.gol, APL.gol)).toEqual(['2010', '2011', '2012', '2013', '2014', '2015']);
      for (const falso of ['1.1', '1.2', '1.3', 'G4', '1.5']) expect(doc.get(P.gol)!.split(/\s+/), falso).not.toContain(falso);
    });

    it('AO-3 (RN-CAT-12): sinônimo do tenant vale na aplicação — "filtro volkswagen gol" acha "VW Gol"', async () => {
      expect(skus(await busca(ap, 'filtro volkswagen gol'))[0]).toBe('FOL-G01');
    });

    it('AO-4 (RN-CAT-12): "pastilha uno" — o nome ("Pastilha Uno") vem antes de quem casa só pela aplicação, mesmo em campanha', async () => {
      const lista = skus(await busca(ap, 'pastilha uno'));
      expect(lista).toContain('PST-APL');
      expect(lista.indexOf('PST-UNO'), lista.join(',')).toBeLessThan(lista.indexOf('PST-APL'));
      expect(lista.indexOf('PST-UNO'), lista.join(',')).toBeLessThan(lista.indexOf('PST-D01'));
    });

    it('AO-6 (RN-CAT-12 §5): aplicação longa sem separador sai no "Serve em" com ≤ 90 caracteres e "…"', async () => {
      // a janela fica em volta da PRIMEIRA marca da aplicação (desenho §5.3): só "celta" casa nela
      const r = await busca(ap, 'lampada celta');
      const item = r.items.find((i) => i.id === P.lampada)!;
      expect(item.serve_em).toBeTruthy();
      expect(item.serve_em!.texto.length).toBeLessThanOrEqual(90);
      expect(item.serve_em!.texto).toContain('…');
      expect(marcados(item.serve_em!)).toContain('Celta');
    });

    it.each(['cb3401', 'CB-3401', 'cb 3401', 'C.B.3401'])('RO-1 (RN-CAT-09): "%s" acha a pastilha pela referência, em 1º, com "Equivale a: Freiomax CB 3401" (retrato marca_nome, vendedor sem o Promotor)', async (q) => {
      const r = await busca(ap, q);
      expect(skus(r)[0]).toBe('PST-D01');
      const eq = r.items[0]!.equivale_a!;
      expect(eq).toMatchObject({ marca_id: MARCA.freiomax, marca_nome: 'Freiomax', codigo: 'CB 3401' });
      expect(eq.marcas.length).toBeGreaterThan(0);
      expect(marcados({ texto: `${eq.marca_nome} ${eq.codigo}`, marcas: eq.marcas }).join(' ')).toMatch(/CB|3401/);
    });

    it('RO-1b (RN-CAT-09): "fb0207" acha o filtro; código que ninguém tem não traz nada', async () => {
      expect(skus(await busca(ap, 'fb0207'))[0]).toBe('FOL-G01');
      expect(skus(await busca(ap, 'zz9999'))).toEqual([]);
    });
  });

  it('AO-5 (T-0084 c4): tenant sem aplicação — mesma lista, mesma ordem e mesmas notas com e sem linhas de conteúdo sem aplicação', async () => {
    const semConteudo = await aparelho({ comConteudo: false });
    const consultas = ['pastilha', 'pastilha de freio', 'filtro', 'freio dianteiro', 'lampada h4', 'fluido dot 4', 'parafuso m6 x 20'];
    // por código (os ids do enchimento mudam a cada base montada)
    const lista = (r: Awaited<ReturnType<typeof busca>>) => r.items.map((i): [string, number | undefined] => [i.erp_code, i.score]);
    const antes = new Map<string, Array<[string, number | undefined]>>();
    for (const q of consultas) antes.set(q, lista(await busca(semConteudo, q)));
    const semAplicacao = await aparelho({ comAplicacao: false });
    for (const q of consultas) {
      const r = await busca(semAplicacao, q);
      // a campanha do PST-APL vem do conteúdo e mexe na ordem por desenho (RN-CAT-08); compara sem ele
      const tira = (xs: Array<[string, number | undefined]>) => xs.filter(([codigo]) => codigo !== 'PST-APL');
      expect(tira(lista(r)), q).toEqual(tira(antes.get(q)!));
      for (const i of r.items) expect(i.serve_em ?? null, `${q}: sem aplicação não há "Serve em"`).toBeNull();
    }
  });

  describe('perfil com o Promotor no aparelho (marcas do cadastro do Catálogo, `marca_concorrente`)', () => {
    it('RO-2 (RN-CAT-09): marca ativa aparece com o nome do cadastro; marca inativa tira a referência da busca e da ficha', async () => {
      const ap = await aparelho({
        promotor: true,
        marcas: [linha(MARCA.freiomax, { nome: 'Freiomax Cadastro', ativo: true }), linha(MARCA.filtrobom, { nome: 'Filtrobom', ativo: false })],
      });
      const r = await busca(ap, 'cb3401', 'vendedor');
      expect(r.items[0]!.equivale_a).toMatchObject({ marca_nome: 'Freiomax Cadastro', codigo: 'CB 3401' });
      const inativa = await busca(ap, 'fb0207', 'vendedor');
      expect(inativa.items.find((i) => i.id === P.gol)?.equivale_a ?? null, 'marca inativa: sem "Equivale a"').toBeNull();
      const ficha = await fichaLocal(ap.leitor, { perfil: 'vendedor', parametros: {}, agora: relogio.iso(), clienteId: CLIENTE, produtoId: P.gol });
      expect(ficha!.catalogo!.referencias).toEqual([]);
    });

    it('FO-1 (T-0084 c8, T-0085 c8, RN-CAT-05 revista): o promotor abre a ficha offline com aplicação, referência, oferece junto, etiquetas e o estoque do vendedor, sem preço', async () => {
      const ap = await aparelho({ promotor: true, marcas: [linha(MARCA.freiomax, { nome: 'Freiomax', ativo: true })] });
      const entrada = { parametros: {}, agora: relogio.iso(), clienteId: CLIENTE, produtoId: P.uno };
      const ficha = await fichaLocal(ap.leitor, { ...entrada, perfil: 'promotor' });
      const doVendedor = await fichaLocal(ap.leitor, { ...entrada, perfil: 'vendedor' });
      expect(ficha).not.toBeNull();
      expect(ficha!.product).toMatchObject({ price_stock_visible: false, price: null });
      // RN-CAT-05 revista (catálogo v2, #503): o estoque é de todos os perfis; no mesmo aparelho e cliente, o mesmo do vendedor
      expect(ficha!.product.availability).not.toBeNull();
      expect(ficha!.product.availability).toEqual(doVendedor!.product.availability);
      expect(ficha!.catalogo).toMatchObject({
        aplicacao: APL.uno,
        referencias: [{ marca_id: MARCA.freiomax, marca_nome: 'Freiomax', codigo: 'CB 3401' }],
        oferece_junto: [{ produto_id: P.disco, erp_code: 'DSC-D01' }],
        etiquetas: ['Dianteira', 'Novo'],
      });
      const r = await busca(ap, 'pastilha uno 2012', 'promotor');
      expect(skus(r)).toContain('PST-D01');
      const estoqueDoVendedor = new Map((await busca(ap, 'pastilha uno 2012', 'vendedor')).items.map((i) => [i.id, i.availability] as const));
      for (const i of r.items) {
        expect(i, i.erp_code).toMatchObject({ price_stock_visible: false, price: null });
        expect(i.availability, i.erp_code).not.toBeNull();
        expect(i.availability, i.erp_code).toEqual(estoqueDoVendedor.get(i.id));
      }
    });
  });

  /**
   * Revisão R-20261106-042958 (engenheiro-software, 🟡 1): a C9 do aparelho (`catalogo.busca_produtos@1`, a busca do seletor
   * do Novo pedido) pelo registro real de consultas e `ambiente.consultar` do motor, comparada com a aba (`buscarLocal`).
   * O caminho do seletor de ponta a ponta (como o Vendedor chama) está em tests/modulos/seletor-busca-offline-t0084.test.ts.
   */
  describe('C9 do aparelho × aba Catálogo (mesmo aparelho, sem rede)', () => {
    const c9 = (ap: Aparelho, q: string) => ap.motor.ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q, limite: 100 });

    it.each(['pastilha uno 2012', 'filtro gol 2014', 'cb3401'])('CO-1 (RN-CAT-12/09): "%s" — 1º item, "Serve em" e "Equivale a" da C9 iguais aos da aba (vendedor sem o Promotor)', async (q) => {
      const ap = await aparelho();
      const aba = await busca(ap, q);
      const { itens } = await c9(ap, q);
      expect(itens[0]?.produto_id, `${q}: aba=${skus(aba).join(',')}`).toBe(aba.items[0]!.id);
      expect(itens[0]!.serve_em ?? null).toEqual(aba.items[0]!.serve_em ?? null);
      expect(itens[0]!.equivale_a ?? null).toEqual(aba.items[0]!.equivale_a ?? null);
      expect(ap.servidor.online).toBe(false);
    });

    it('CO-2 (RN-CAT-09): com o Promotor no aparelho, a C9 NÃO lança Error (não lê `concorrente`) e acha pelo texto e pela referência', async () => {
      const ap = await aparelho({ promotor: true, marcas: [linha(MARCA.freiomax, { nome: 'Freiomax Cadastro', ativo: true })] });
      const uno = await c9(ap, 'pastilha uno 2012');
      expect(uno.itens.find((i) => i.produto_id === P.uno)?.serve_em).toMatchObject({ inclui_ano: 2012 });
      const ref = await c9(ap, 'cb3401');
      expect(ref.itens[0]?.produto_id).toBe(P.uno);
      // a C9 não lê o cadastro de marcas: o nome vem do retrato `marca_nome` da referência (a aba mostra o do cadastro)
      expect(ref.itens[0]!.equivale_a).toMatchObject({ marca_nome: 'Freiomax', codigo: 'CB 3401' });
    });

    // Divergência conhecida (revisão R-20261106-042958): a C9 não lê o cadastro de marcas, então a marca INATIVA segue no
    // "Equivale a" pelo retrato até a lápide da referência chegar (em produção o pull a manda junto, ADR 0034 §6; o servidor
    // simulado não); a aba tira (RO-2). Pergunta ao modulo-catalogo em R-20261109-105246-testes. Quando resolver, vira `it`.
    it.fails('CO-3 (RN-CAT-09) DIVERGÊNCIA: marca inativa no cadastro do Catálogo some do "Equivale a" da C9 como some da aba', async () => {
      const ap = await aparelho({ promotor: true, marcas: [linha(MARCA.filtrobom, { nome: 'Filtrobom', ativo: false })] });
      const aba = await busca(ap, 'fb0207');
      expect(aba.items.find((i) => i.id === P.gol)?.equivale_a ?? null).toBeNull();
      const { itens } = await c9(ap, 'fb0207');
      expect(itens.find((i) => i.produto_id === P.gol)?.equivale_a ?? null).toBeNull();
    });
  });
});
