/**
 * Busca textual no aparelho (desenho T-0008 §2; P5) com um índice de TESTE (sem o Catálogo): sanitização da consulta,
 * normalização igual à do tokenizer, mesmos resultados (conjunto) nos três adaptadores, manutenção no pull (carga em
 * massa + `rebuild` e incremental), RN-CORE-02 (doc 03: dados locais do módulo desativado apagados — inclusive a FTS)
 * e validação do índice no shell.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comBuscaEmJs,
  definirIndiceBusca,
  montarConsultaFts,
  normalizarBusca,
  type ConsultaTexto,
  type IndiceBusca,
} from './busca';
import { defineModule } from './manifesto';
import { comLinhasEmChaveJson, criarArmazenamentoEmMemoria, criarMotorSync, type ArmazenamentoSync } from './motor-sync';
import { criarShell, definirModuloShell } from './shell';
import { criarArmazenamentoSqlite } from './sqlite/armazenamento';
import { criarDriverNode } from './sqlite/driver-node';
import { listarObjetos, type MigracaoAparelho } from './sqlite/esquema';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync, type LinhaSync } from './sync';

// ---------- índice de teste (o real é do Catálogo, T-0021) ----------

const MIGRACOES: MigracaoAparelho[] = [
  {
    versao: 1,
    sql: `
      CREATE TABLE catalogo__teste_doc (rid INTEGER PRIMARY KEY, produto_id TEXT NOT NULL UNIQUE,
        sku TEXT, codigos TEXT, nome TEXT, marca TEXT, atributos TEXT);
      CREATE VIRTUAL TABLE catalogo__teste USING fts5(sku, codigos, nome, marca, atributos,
        content = 'catalogo__teste_doc', content_rowid = 'rid',
        tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
      CREATE INDEX catalogo__teste_attr ON ent_produto_atributo (json_extract(dados, '$.produto_id'));
    `,
  },
];

interface Produto extends LinhaSync {
  sku: string;
  nome: string;
  marca: string;
}
interface Atributo extends LinhaSync {
  produto_id: string;
  valor: string;
}

const INDICE = definirIndiceBusca({
  id: 'catalogo.teste',
  modulo: 'catalogo',
  tabelaDoc: 'catalogo__teste_doc',
  tabelaFts: 'catalogo__teste',
  colunaChave: 'produto_id',
  colunas: { sku: 10, codigos: 8, nome: 5, marca: 3, atributos: 1 },
  fontes: ['produto', 'produto_atributo'],
  chaveDe: (e, l) => (e === 'produto' ? l.id : ((l as Atributo).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<Produto>('produto', [id]);
    if (!p) return null;
    const attrs = await ler.porCampo<Atributo>('produto_atributo', 'produto_id', id);
    return {
      sku: p.sku,
      codigos: p.sku.toLowerCase().replace(/[^a-z0-9]/g, ''),
      nome: p.nome,
      marca: p.marca,
      atributos: attrs.map((a) => a.valor).sort().join(' '),
    };
  },
});

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['produto'] }),
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['produto_atributo'] }),
];
function registro() {
  const r = criarRegistroSync(manifestos);
  r.registrar(definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }));
  r.registrar(
    definirEntidadeSync({ nome: 'produto_atributo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }),
  );
  return r;
}

const T0 = '2026-10-31T10:00:00.000Z';
const prod = (n: number, sku: string, nome: string, marca: string, updated_at = T0): Produto => ({
  id: `p${n}`,
  updated_at,
  deleted_at: null,
  sku,
  nome,
  marca,
});
const attr = (n: number, produto: number, valor: string, updated_at = T0): Atributo => ({
  id: `a${n}`,
  updated_at,
  deleted_at: null,
  produto_id: `p${produto}`,
  valor,
});

const PRODUTOS = [
  prod(1, '6203-2RS', 'Rolamento rígido de esferas', 'SKF'),
  prod(2, '6203-ZZ', 'Rolamento blindado', 'NSK'),
  prod(3, 'PF-100', 'Pastilha de freio a disco dianteira', 'Cobreq'),
  prod(4, 'LN-200', 'Lona de freio a tambor', 'Fras-le'),
  prod(5, 'AÇ-01', 'Ação rápida — óleo lubrificante 1L', 'Lubrax'),
  prod(6, 'FR-77', 'Freio de mão completo', 'Cofap'),
  prod(7, 'NEAR-1', 'Cabo near teste "aspas"', 'Marca*'),
];
const ATRIBUTOS = [attr(1, 3, 'cerâmica'), attr(2, 4, 'traseira'), attr(3, 1, 'vedação dupla'), attr(4, 6, 'cerâmica')];

const ENTIDADES = [
  { nome: 'produto', modulo: 'core' },
  { nome: 'produto_atributo', modulo: 'catalogo' },
] as const;

type Fabrica = readonly [string, () => ArmazenamentoSync];
const FABRICAS: readonly Fabrica[] = [
  ['chave→JSON + busca em JS', () => comBuscaEmJs(criarArmazenamentoEmMemoria(), [INDICE])],
  ['linhas + busca em JS', () => comBuscaEmJs(comLinhasEmChaveJson(criarArmazenamentoEmMemoria()), [INDICE])],
  [
    'SQLite FTS5',
    () =>
      criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
        migracoesModulos: { catalogo: MIGRACOES },
        indicesBusca: [INDICE],
        entidades: ENTIDADES,
      }),
  ],
];

async function carregado(fabrica: () => ArmazenamentoSync) {
  const reg = registro();
  const servidor = criarServidorSyncSimulado(reg, {
    modulosAtivos: ['core', 'catalogo'],
    linhas: { produto: [...PRODUTOS], produto_atributo: [...ATRIBUTOS] },
  });
  const armazenamento = fabrica();
  const motor = criarMotorSync({ registro: reg, armazenamento, transporte: servidor, agora: () => new Date(T0) });
  await motor.aplicarModulosAtivos(['core', 'catalogo']);
  expect(await motor.sincronizar()).toBe(true);
  const buscar = async (c: ConsultaTexto) => ((await motor.buscar(INDICE.id, c)) ?? []).map((r) => r.chave).sort();
  return { motor, servidor, armazenamento, buscar };
}

const q = (...grupos: string[][]): ConsultaTexto => ({ grupos, prefixoNoUltimo: false });
const qp = (...grupos: string[][]): ConsultaTexto => ({ grupos, prefixoNoUltimo: true });

/** Consultas típicas (prefixo, frase, OR de sinônimos, acento, código com separador) e o conjunto esperado. */
const CASOS: ReadonlyArray<readonly [string, ConsultaTexto, string[]]> = [
  ['termo simples', q(['rolamento']), ['p1', 'p2']],
  ['prefixo no último termo', qp(['rol']), ['p1', 'p2']],
  ['dois termos (AND)', q(['freio'], ['disco']), ['p3']],
  ['OR de sinônimos', q(['freio'], ['disco', 'tambor']), ['p3', 'p4']],
  ['sem acento acha com acento (remove_diacritics 2)', q(['acao']), ['p5']],
  ['com acento acha sem acento', q(['ÓLEO']), ['p5']],
  ['frase', q(['freio a disco']), ['p3']],
  ['código com separador, digitado de outro jeito', q(['6203 2rs']), ['p1']],
  ['código compacto por prefixo', qp(['62032']), ['p1']],
  ['atributo de outra entidade (fonte do Catálogo)', q(['ceramica']), ['p3', 'p6']],
  ['marca', q(['skf']), ['p1']],
  ['nada', q(['inexistente']), []],
];

describe('consulta FTS sanitizada (desenho T-0008 §2.7)', () => {
  it('grupos com AND explícito, alternativas com OR entre parênteses, prefixo só no último', () => {
    expect(montarConsultaFts(q(['freio'], ['disco', 'tambor']))).toBe('"freio" AND ("disco" OR "tambor")');
    expect(montarConsultaFts(qp(['freio'], ['dis']))).toBe('"freio" AND "dis"*');
    expect(montarConsultaFts(q(['freio a disco']))).toBe('"freio a disco"');
    expect(montarConsultaFts(q(['6203-2RS']))).toBe('("6203 2rs" OR "62032rs")');
  });

  it('1 letra não consulta; prefixo exige 2 caracteres; vazio = null', () => {
    expect(montarConsultaFts(qp(['a']))).toBeNull();
    expect(montarConsultaFts(q([]))).toBeNull();
    expect(montarConsultaFts(q(['  ', '!!']))).toBeNull();
    expect(montarConsultaFts(qp(['freio'], ['d']))).toBe('"freio" AND "d"');
  });

  it('limites: 8 grupos, 10 alternativas, 40 caracteres por termo', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => [`g${i}x`]);
    expect(montarConsultaFts(q(...muitos))!.split(' AND ')).toHaveLength(8);
    const alts = Array.from({ length: 15 }, (_, i) => `alt${i}`);
    expect(montarConsultaFts(q(alts))!.split(' OR ')).toHaveLength(10);
    expect(montarConsultaFts(q(['x'.repeat(500)]))).toBe(`"${'x'.repeat(40)}"`);
  });

  const HOSTIS = ['"', '""', '*', '"*"', 'NEAR', 'NEAR(a b)', 'nome:freio', ':', '(', ')', '^freio', '-freio', 'AND', 'OR NOT', 'a', '\u0000', 'x'.repeat(500), "'; DROP TABLE kv; --", '{nome}: x'];

  it('entrada hostil nunca sai com sintaxe FTS: só termos entre aspas', () => {
    for (const h of HOSTIS) {
      const fts = montarConsultaFts(qp([h], [h]));
      if (fts === null) continue;
      // fora das aspas só sobram AND/OR/parênteses/asterisco
      expect(fts.replace(/"[^"]*"/g, '').replace(/\s+|AND|OR|[()*]/g, '')).toBe('');
    }
  });
});

describe('normalização da consulta = tokenizer unicode61 remove_diacritics 2', () => {
  it('cada palavra normalizada em JS casa no FTS5 do SQLite', async () => {
    const d = criarDriverNode();
    await d.executar("CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'unicode61 remove_diacritics 2')");
    const palavras = ['Ação', 'coração', 'PÃO', 'pinça', 'Über', 'nº 5', '1ª', 'ÇÉU', 'jacaré', '6203-2RS', 'Peça_01', 'ångström', 'Øre'];
    for (const p of palavras) {
      await d.rodar('DELETE FROM t');
      await d.rodar('INSERT INTO t (x) VALUES (?)', [p]);
      for (const termo of normalizarBusca(p))
        expect((await d.todas('SELECT x FROM t WHERE t MATCH ?', [`"${termo}"`])).length, `${p} → ${termo}`).toBe(1);
    }
    expect(normalizarBusca('Ação  rápida—ÓLEO')).toEqual(['acao', 'rapida', 'oleo']);
  });
});

describe.each(FABRICAS)('busca no aparelho [%s]', (_nome, fabrica) => {
  it.each(CASOS)('%s', async (_caso, consulta, esperado) => {
    const { buscar } = await carregado(fabrica);
    expect(await buscar(consulta)).toEqual(esperado);
  });

  it('entradas hostis nunca lançam e nunca casam fora do esperado', async () => {
    const { buscar } = await carregado(fabrica);
    for (const h of ['"', '*', 'NEAR', ':', '(', 'a', 'x'.repeat(500), 'nome:freio', '^freio', '-freio', 'AND', "'; DROP TABLE kv; --"]) {
      const r = await buscar(qp([h]));
      // só casa o que contém o texto literal (NEAR e aspas são do produto p7); nada de operador
      for (const k of r) expect(['p3', 'p4', 'p6', 'p7']).toContain(k);
    }
    expect(await buscar(q(['near']))).toEqual(['p7']);
    expect(await buscar(q(['nome:freio']))).toEqual([]);
    expect(await buscar(q(['^freio']))).toEqual(['p3', 'p4', 'p6']);
  });

  it('manutenção no pull: produto alterado, atributo trocado de produto e produto removido', async () => {
    const { motor, servidor, buscar } = await carregado(fabrica);
    const T1 = '2026-10-31T11:00:00.000Z';
    servidor.linhas.produto!.push({ ...prod(2, '6203-ZZ', 'Rolamento blindado premium', 'NSK', T1) });
    servidor.linhas.produto!.push({ ...prod(6, 'FR-77', 'Freio de mão completo', 'Cofap', T1), deleted_at: T1 });
    servidor.linhas.produto_atributo!.push(attr(1, 2, 'cerâmica', T1)); // a1 sai do p3 e vai para o p2
    expect(await motor.sincronizar()).toBe(true);
    expect(await buscar(q(['premium']))).toEqual(['p2']);
    expect(await buscar(q(['ceramica']))).toEqual(['p2']);
    expect(await buscar(q(['freio']))).toEqual(['p3', 'p4']);
  });
});

describe('FTS5 no adaptador SQLite', () => {
  const abrir = () => {
    const driver = criarDriverNode(':memory:');
    return {
      driver,
      fabrica: () =>
        criarArmazenamentoSqlite(driver, {
          migracoesModulos: { catalogo: MIGRACOES },
          indicesBusca: [INDICE],
          entidades: ENTIDADES,
        }),
    };
  };

  it('primeira carga só grava os documentos e faz um rebuild no fim do sync; depois é incremental', async () => {
    const { driver, fabrica } = abrir();
    const { motor, servidor, armazenamento, buscar } = await carregado(fabrica);
    expect(await armazenamento.ler('_busca:catalogo.teste:sujo')).toBeNull();
    expect(await driver.primeira('SELECT count(*) AS n FROM catalogo__teste_doc')).toEqual({ n: PRODUTOS.length });
    servidor.linhas.produto!.push(prod(8, 'XY-9', 'Correia dentada', 'Gates', '2026-10-31T12:00:00.000Z'));
    expect(await motor.sincronizar()).toBe(true);
    expect(await armazenamento.ler('_busca:catalogo.teste:sujo')).toBeNull();
    expect(await buscar(q(['correia']))).toEqual(['p8']);
    // índice íntegro (content externo sem divergência)
    await driver.rodar("INSERT INTO catalogo__teste (catalogo__teste, rank) VALUES ('integrity-check', 1)");
  });

  it('carga interrompida antes do rebuild: a próxima consulta reconstrói', async () => {
    const { fabrica } = abrir();
    const a = fabrica();
    await a.linhas!.aplicar('produto', PRODUTOS, 'k');
    expect(await a.ler('_busca:catalogo.teste:sujo')).toBe(true);
    expect((await a.busca!.buscar(INDICE.id, q(['rolamento']))).map((r) => r.chave).sort()).toEqual(['p1', 'p2']);
    expect(await a.ler('_busca:catalogo.teste:sujo')).toBeNull();
  });

  it('SKU idêntico vem em primeiro (peso da coluna sku no bm25)', async () => {
    const { fabrica } = abrir();
    const { motor } = await carregado(fabrica);
    const r = await motor.buscar(INDICE.id, q(['pf', '100']));
    expect(r?.[0]?.chave).toBe('p3');
  });

  it('tabela FTS com colunas diferentes das declaradas: índice desligado com erro registrado, consulta vazia', async () => {
    const erros: string[] = [];
    const a = criarArmazenamentoSqlite(criarDriverNode(), {
      migracoesModulos: { catalogo: [{ versao: 1, sql: MIGRACOES[0]!.sql.replace('marca, atributos,', 'atributos, marca,') }] },
      indicesBusca: [INDICE],
      entidades: ENTIDADES,
      registrarErro: (m) => erros.push(m),
    });
    await a.linhas.aplicar('produto', PRODUTOS, 'k');
    expect(await a.busca.buscar(INDICE.id, q(['rolamento']))).toEqual([]);
    expect(erros.join(' ')).toMatch(/colunas diferentes/);
    expect(erros.join(' ')).not.toMatch(/rolamento/); // nada do texto digitado no log
  });

  it('RN-CORE-02: módulo desativado apaga a FTS e o _esquema; reativado, recria e indexa de novo pelo pull', async () => {
    const { driver, fabrica } = abrir();
    const { motor, servidor, buscar } = await carregado(fabrica);
    servidor.modulosAtivos = ['core'];
    await motor.aplicarModulosAtivos(['core']);
    expect((await listarObjetos(driver)).filter((o) => o.name.startsWith('catalogo__'))).toEqual([]);
    expect(await driver.primeira("SELECT versao FROM _esquema WHERE dono = 'catalogo'")).toBeNull();
    servidor.modulosAtivos = ['core', 'catalogo'];
    await motor.aplicarModulosAtivos(['core', 'catalogo']);
    expect(await motor.sincronizar()).toBe(true);
    expect(await buscar(q(['ceramica']))).toEqual(['p3', 'p6']);
    // L-1: os produtos (fonte do Core, cursor intacto) não voltam pelo pull, mas o índice os tem de novo
    expect(await buscar(q(['rolamento']))).toEqual(['p1', 'p2']);
    expect(await buscar(q(['freio']))).toEqual(['p3', 'p4', 'p6']);
  });

  // lotes de 500 de verdade (3 lotes): mais lentos que o resto da suíte, sobretudo com o turbo rodando tudo em paralelo
  describe('L-1: índice (re)criado vazio com fonte já sincronizada é reindexado das linhas locais', { timeout: 60_000 }, () => {
    /** 1.100 produtos (3 lotes de reindexação) e 1 em cada 5 com "Gol" nos atributos. */
    const MUITOS = Array.from({ length: 1100 }, (_, k) => prod(100 + k, `SKU-${k}`, `Peça ${k}`, 'Marca'));
    const ATTR_GOL = MUITOS.filter((_, k) => k % 5 === 0).map((p, k) => ({ ...attr(1000 + k, 0, 'Gol G5'), produto_id: p.id }));
    const opcoes = { migracoesModulos: { catalogo: MIGRACOES }, indicesBusca: [INDICE], entidades: ENTIDADES };
    const contar = async (a: ArmazenamentoSync, termo: string) => ((await a.busca!.buscar(INDICE.id, { grupos: [[termo]], prefixoNoUltimo: false, limite: 500 })) ?? []).length;

    it('reativação (RN-CORE-02): só 1 atributo volta pelo pull e a busca acha todos os produtos e atributos locais', async () => {
      const driver = criarDriverNode(':memory:');
      const a = criarArmazenamentoSqlite(driver, opcoes);
      await a.linhas.aplicar('produto', MUITOS, 'k');
      await a.linhas.aplicar('produto_atributo', ATTR_GOL, 'k');
      await a.busca.finalizar!();
      expect(await contar(a, 'gol')).toBe(220);
      await a.removerModulo!('catalogo');
      // reativado: o pull do Catálogo devolve 1 atributo; os produtos (Core) não voltam
      await a.linhas.aplicar('produto_atributo', ATTR_GOL.slice(0, 1), 'k2');
      expect(await a.ler('_busca:catalogo.teste:reindexar')).toBe(true);
      await a.busca.finalizar!();
      expect(await a.ler('_busca:catalogo.teste:reindexar')).toBeNull();
      expect(await contar(a, 'gol')).toBe(1);
      expect(await contar(a, 'peca')).toBe(500); // limite da consulta; o índice tem os 1.100
      expect((await driver.primeira<{ n: number }>('SELECT count(*) AS n FROM catalogo__teste_doc'))!.n).toBe(1100);
      await driver.rodar("INSERT INTO catalogo__teste (catalogo__teste, rank) VALUES ('integrity-check', 1)");
    });

    it('downgrade: objetos recriados do zero na abertura e reindexados na primeira consulta', async () => {
      const driver = criarDriverNode(':memory:');
      const a = criarArmazenamentoSqlite(driver, opcoes);
      await a.linhas.aplicar('produto', MUITOS, 'k');
      await a.linhas.aplicar('produto_atributo', ATTR_GOL, 'k');
      await a.busca.finalizar!();
      await driver.rodar("UPDATE _esquema SET versao = 99 WHERE dono = 'catalogo'");
      const b = criarArmazenamentoSqlite(driver, opcoes);
      await b.pronto;
      expect(await b.ler('_busca:catalogo.teste:reindexar')).toBe(true);
      expect(await contar(b, 'gol')).toBe(220);
      expect(await b.ler('_busca:catalogo.teste:sujo')).toBeNull();
    });

    it('índice instalado depois de o Core já ter os produtos (Catálogo ligado depois / índice novo no app)', async () => {
      const driver = criarDriverNode(':memory:');
      const semCatalogo = criarArmazenamentoSqlite(driver, { entidades: ENTIDADES });
      await semCatalogo.linhas.aplicar('produto', MUITOS, 'k');
      const comCatalogo = criarArmazenamentoSqlite(driver, opcoes);
      await comCatalogo.pronto;
      expect(await contar(comCatalogo, 'peca')).toBe(500);
      expect((await driver.primeira<{ n: number }>('SELECT count(*) AS n FROM catalogo__teste_doc'))!.n).toBe(1100);
    });

    it('primeira carga normal (índice e fontes vazios na abertura) não marca reindexação', async () => {
      const driver = criarDriverNode(':memory:');
      const a = criarArmazenamentoSqlite(driver, opcoes);
      await a.pronto;
      expect(await a.ler('_busca:catalogo.teste:reindexar')).toBeNull();
      await a.linhas.aplicar('produto', PRODUTOS, 'k');
      expect(await a.ler('_busca:catalogo.teste:reindexar')).toBeNull();
    });

    it('nos adaptadores sem SQLite (busca em JS) os documentos são montados na hora: reativar não perde nada', async () => {
      for (const [, fabrica] of FABRICAS.slice(0, 2)) {
        const { motor, servidor, buscar } = await carregado(fabrica);
        servidor.modulosAtivos = ['core'];
        await motor.aplicarModulosAtivos(['core']);
        servidor.modulosAtivos = ['core', 'catalogo'];
        await motor.aplicarModulosAtivos(['core', 'catalogo']);
        expect(await motor.sincronizar()).toBe(true);
        expect(await buscar(q(['rolamento']))).toEqual(['p1', 'p2']);
      }
    });
  });
});

describe('índice de busca no shell (desenho T-0008 §2.1)', () => {
  const core = definirModuloShell({
    manifesto: manifestos[0]!,
    entidadesSync: [definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) })],
  });
  const atributo = definirEntidadeSync({ nome: 'produto_atributo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });

  it('aceita fonte do próprio módulo e de módulo em depende; expõe migrações e índices ao armazenamento', () => {
    const shell = criarShell('campo', [
      core,
      definirModuloShell({ manifesto: manifestos[1]!, entidadesSync: [atributo], migracoesAparelho: MIGRACOES, indicesBusca: [INDICE] }),
    ]);
    expect(shell.indicesBusca.map((i) => i.id)).toEqual(['catalogo.teste']);
    expect(shell.migracoesAparelho.catalogo).toBe(MIGRACOES);
  });

  it('recusa fonte de módulo fora de depende, índice de outro módulo e índice sem migrações', () => {
    const promotor = definirModuloShell({
      manifesto: defineModule({ id: 'promotor', versao: '1.0.0', depende: ['core'], perfis: ['promotor'], sync: ['gondola'] }),
      entidadesSync: [definirEntidadeSync({ nome: 'gondola', modulo: 'promotor', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) })],
    });
    const comGondola = { ...INDICE, fontes: ['produto', 'gondola'] };
    expect(() =>
      criarShell('campo', [
        core,
        promotor,
        definirModuloShell({ manifesto: manifestos[1]!, entidadesSync: [atributo], migracoesAparelho: MIGRACOES, indicesBusca: [comGondola] }),
      ]),
    ).toThrow(/gondola do índice catalogo.teste é de promotor, que não está em depende/);
    expect(() => criarShell('campo', [core, definirModuloShell({ manifesto: manifestos[1]!, entidadesSync: [atributo], indicesBusca: [INDICE] })])).toThrow(
      /sem migracoesAparelho/,
    );
    // o Core registrando o índice do Catálogo (ninguém declara índice em nome de outro módulo)
    const alheio: IndiceBusca = INDICE;
    expect(() => criarShell('campo', [definirModuloShell({ ...core, migracoesAparelho: MIGRACOES, indicesBusca: [alheio] }), definirModuloShell({ manifesto: manifestos[1]!, entidadesSync: [atributo] })])).toThrow(
      /core: índice catalogo.teste declarado como de catalogo/,
    );
  });

  it('definirIndiceBusca valida id, prefixo das tabelas, colunas e pesos', () => {
    expect(() => definirIndiceBusca({ ...INDICE, id: 'teste' })).toThrow(/<modulo>\.<nome>/);
    expect(() => definirIndiceBusca({ ...INDICE, tabelaFts: 'busca' })).toThrow(/catalogo__/);
    const base = INDICE as unknown as IndiceBusca;
    expect(() => definirIndiceBusca({ ...base, colunas: { nome: 0 } })).toThrow(/peso/);
    expect(() => definirIndiceBusca({ ...base, colunas: { 'nome; drop': 1 } })).toThrow(/coluna inválida/);
  });
});
