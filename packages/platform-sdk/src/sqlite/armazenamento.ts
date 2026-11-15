/**
 * Adaptador SQLite do motor de sync (desenho T-0008 §1, §2 e §3; P3 + P5). TS puro sobre o `DriverSqlite`: o mesmo
 * código roda no aparelho (expo-sqlite, P4) e nos testes (node:sqlite). Implementa a interface base do
 * `ArmazenamentoSync` e as extensões `linhas`, `emTransacao`, `removerModulo` e `busca`.
 *
 * - Base chave→JSON na tabela `kv`; `sync:fila` (e o marcador da passagem do AsyncStorage, T-0088) gravados com
 *   `synchronous=FULL` (pedido na fila não some com queda de energia). Compatibilidade da chave `ent:<e>` (lenta por natureza; nunca é o caminho do pull).
 * - Pull por linha em `ent_<e>`, em lotes de 500 por transação, cursor na transação do último lote, cedendo o loop
 *   entre lotes (a tela desenha). Reaplicar a mesma página é inofensivo (upsert por `id`).
 * - Escritas SERIALIZADAS numa fila interna (no expo-sqlite a transação exclusiva é outra conexão: escrita de fora dela
 *   falharia com `database is locked`). Leituras não entram na fila.
 * - Migrações da plataforma e de cada módulo na abertura (`_esquema`); falha num módulo = módulo marcado
 *   "armazenamento local indisponível" (o resto e a fila seguem). Downgrade = objetos do módulo recriados do zero.
 * - RN-CORE-02 (`removerModulo`): linhas das entidades do módulo (via `_entidades`), `DROP` de todo objeto `<m>__*`
 *   (inclusive a FTS), `_esquema` sem o módulo e `PRAGMA incremental_vacuum` fora da transação.
 * - L-1: índice (re)criado vazio com fonte já sincronizada é reindexado das linhas locais (marca `_busca:<i>:reindexar`,
 *   lotes cedendo o loop) antes do `rebuild`, na consulta ou no fim do sync.
 * - Reindexação marcada (T-0084): `versaoDocumentos` do índice diferente da guardada (`_busca:<i>:versao`) = marca
 *   `_busca:<i>:reindexar` = `'versao'`; a busca dispara a reindexação EM SEGUNDO PLANO e responde com os documentos
 *   antigos; o `finalizar` espera. A marca do L-1 (`true`, índice vazio) bloqueia a busca até reindexar, salvo com
 *   `buscaSemEsperarIndexacao` (T-0088): a busca dispara a reindexação em segundo plano e responde `indexando`.
 * - ADR 0054 (`linhas.importarPacote`): `ATTACH` do arquivo do pacote, `quick_check`, `_pacote` conferido, um
 *   `INSERT ... SELECT` por entidade (só substitui com `updated_at` maior), contagem, cursor e `versao_escopo` numa transação
 *   exclusiva; índices de busca das entidades marcados para reindexar (o `finalizar` reconstrói uma vez); `DETACH` depois.
 * - Busca (FTS5, content externo): manutenção na mesma transação do lote — incremental (`'delete'` com os valores
 *   antigos + insert) ou, na carga em massa (índice vazio ou > 2.000 chaves numa página), só a tabela de documentos e
 *   `'rebuild'` no fim do sync (`busca.finalizar`) ou na primeira consulta.
 */
import {
  limiteDaConsulta,
  montarConsultaFts,
  type BuscaTextoSync,
  type ConsultaTexto,
  type ContextoIndice,
  type DesfechoBusca,
  type IndiceBusca,
  type LeitorLinhas,
  type ResultadoBusca,
} from '../busca';
import {
  validarCampoLinha,
  valoresDeCampo,
  type ArmazenamentoSync,
  type ConferenciaPacote,
  type LinhasSync,
  type ValorCampoLinha,
} from '../motor-sync';
import { ErroPacoteSync, MetaPacoteSchema, type EntidadePacoteSync } from '../pacotes-sync';
import { FUSO_PADRAO_TENANT, fusoDoTenantOuPadrao } from '../fuso';
import { MODULOS, type ModuloId } from '../nomes';
import type { LinhaSync } from '../sync';
import type { DriverSqlite, ValorSql } from './driver';
import {
  aplicarMigracoes,
  ddlDaEntidade,
  DONO_PLATAFORMA,
  listarObjetos,
  MIGRACOES_PLATAFORMA,
  PRAGMAS_ABERTURA,
  prefixoDoModulo,
  tabelaDaEntidade,
  type MigracaoAparelho,
} from './esquema';

/** Linhas por transação no pull (desenho T-0008 §1.3). */
export const TAMANHO_LOTE_GRAVACAO = 500;
/** Acima disso (chaves afetadas numa página), a manutenção da busca vira carga em massa + `rebuild`. */
export const LIMITE_INCREMENTAL_BUSCA = 2000;
/** Mudanças incrementais entre dois `optimize` do FTS. */
export const MUDANCAS_ATE_OTIMIZAR = 5000;

const CHAVE_FILA = 'sync:fila';
/**
 * Chaves gravadas com `synchronous=FULL` fora de transação: a fila e o marcador da passagem do AsyncStorage (T-0088 §2;
 * `concluida` perdido numa queda de energia com o espelho já gravado faria a passagem recomeçar à toa).
 */
const CHAVES_DURAVEIS: ReadonlySet<string> = new Set([CHAVE_FILA, '_migracao:asyncstorage']);
const PREFIXO_ENT = 'ent:';
const cursorDe = (e: string) => `sync:cursor:${e}`;
/** Mesma chave do motor (`CHAVE.escopo`): a importação do pacote grava a `versao_escopo` na transação das linhas. */
const escopoDe = (e: string) => `sync:escopo:${e}`;
/** Apelido do arquivo do pacote no `ATTACH` (ADR 0054): lista fixa, nunca texto livre. */
const APELIDO_PACOTE = 'pacote';
/** Índice marcado para `rebuild` (sobrevive a reinício: a carga pode cair no meio). */
const chaveSujo = (indice: string) => `_busca:${indice}:sujo`;
/**
 * L-1: índice (re)criado vazio com fonte já sincronizada (reativação RN-CORE-02, downgrade, índice novo numa versão do
 * app, Catálogo ligado depois de o Core puxar `produto`). O cursor da fonte de outro módulo não volta, então o pull não
 * repovoa: reindexação completa a partir das linhas locais. Persistida (a reindexação pode cair no meio).
 */
const chaveReindexar = (indice: string) => `_busca:${indice}:reindexar`;
/**
 * Marca de reindexação: `true` = L-1 (índice vazio; a busca espera); `'versao'` = `versaoDocumentos` mudou (T-0084;
 * os documentos antigos ainda servem, a busca não espera).
 */
type MarcaReindexar = true | 'versao';
/** Última `versaoDocumentos` com que o índice foi (ou está sendo) indexado (T-0084). */
const chaveVersao = (indice: string) => `_busca:${indice}:versao`;
const CAMPO_RE = /^[a-z][a-z0-9_]*$/;
/** Maior caractere do BMP: limite superior da faixa de `chaves(prefixo)` (sem LIKE, sem escapar `%`/`_`). */
const FIM_FAIXA = '￿';

export interface OpcoesArmazenamentoSqlite {
  /** Migrações locais por módulo (`definirModuloShell({ migracoesAparelho })`), aplicadas na abertura. */
  migracoesModulos?: Partial<Record<ModuloId, readonly MigracaoAparelho[]>>;
  /**
   * Entidades do registro de sync e seus donos (`shell.registroSync.entidadesAtivas(MODULOS)`): o dono vai para
   * `_entidades` (limpar entidade que saiu do registro) e as tabelas `ent_<e>` do módulo existem antes das migrações
   * dele (índices de expressão).
   */
  entidades?: ReadonlyArray<{ nome: string; modulo: ModuloId }>;
  /** Índices de busca registrados pelos módulos (`definirModuloShell({ indicesBusca })`). */
  indicesBusca?: readonly IndiceBusca[];
  agora?: () => Date;
  /** Erros que não derrubam o fluxo (módulo indisponível, consulta FTS recusada). Sem texto digitado nem dado pessoal. */
  registrarErro?: (mensagem: string) => void;
  /**
   * T-0088 §5: com o índice vazio e as linhas já no aparelho (L-1), a busca NÃO espera a reindexação inteira (segundos
   * com 20 mil produtos): dispara em segundo plano e responde `{ buscou: false, motivo: 'indexando' }`. Ligada no app;
   * sem ela (padrão), a busca espera, como antes.
   */
  buscaSemEsperarIndexacao?: boolean;
}

/** A busca do SQLite sempre separa "não achou" de "não buscou" (`buscarComDesfecho` obrigatório; T-0052). */
export type BuscaSqlite = BuscaTextoSync & Required<Pick<BuscaTextoSync, 'buscarComDesfecho'>>;

export interface ArmazenamentoSqlite extends ArmazenamentoSync {
  linhas: LinhasSync;
  busca: BuscaSqlite;
  /** Sempre presente no SQLite (a passagem do AsyncStorage, T-0088, conta com ela). */
  emTransacao: NonNullable<ArmazenamentoSync['emTransacao']>;
  /** Abertura concluída (PRAGMAs e migrações). Toda operação já espera por ela. */
  pronto: Promise<void>;
  /** Módulos cujas migrações locais falharam nesta abertura. */
  modulosIndisponiveis(): readonly ModuloId[];
  fechar(): Promise<void>;
}

const ceder = () =>
  new Promise<void>((r) => (globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown }).setTimeout(r, 0));

interface LinhaEnt {
  id: string;
  dados: string;
}

export function criarArmazenamentoSqlite(driver: DriverSqlite, opcoes: OpcoesArmazenamentoSqlite = {}): ArmazenamentoSqlite {
  const agora = opcoes.agora ?? (() => new Date());
  const registrarErro = opcoes.registrarErro ?? (() => {});
  const migracoes = opcoes.migracoesModulos ?? {};
  const indices = opcoes.indicesBusca ?? [];
  const indicePorId = new Map(indices.map((i) => [i.id, i] as const));
  const indisponiveis = new Set<ModuloId>();
  const donoDa = new Map((opcoes.entidades ?? []).map((e) => [e.nome, e.modulo] as const));
  /** Índice → colunas validadas contra a tabela FTS (`null` = inválido, fica desligado). */
  const indicesValidos = new Map<string, boolean>();
  /** Módulos com objetos apagados nesta sessão (RN-CORE-02): recriados pelas migrações quando o índice volta a ser usado. */
  const removidos = new Set<ModuloId>();
  let mudancasIncrementais = 0;
  let vacuumPendente = false;
  /** Fuso do tenant para a indexação (`busca.conferirVersoes`, chamado pelo motor); até lá, o padrão. */
  let fusoIndice = FUSO_PADRAO_TENANT;
  let fusoInformado: string | undefined;
  const contextoIndice = (): ContextoIndice => ({ agora: agora(), fuso: fusoIndice });
  /** Índice → última versão conferida contra o disco nesta sessão (conferir de novo só quando mudar). */
  const versaoConferida = new Map<string, string>();

  // ---------- fila de escrita ----------
  let cauda: Promise<unknown> = Promise.resolve();
  const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = cauda.then(fn, fn);
    cauda = r.catch(() => undefined);
    return r;
  };

  // ---------- abertura ----------
  const garantirModulo = async (d: DriverSqlite, m: ModuloId): Promise<boolean> => {
    const lista = migracoes[m];
    if (!lista || lista.length === 0) return true;
    try {
      for (const [e, dono] of donoDa) if (dono === m) await garantirEntidade(d, e);
      if ((await aplicarMigracoes(d, m, lista, agora)) === 'downgrade') {
        // versão do aparelho maior que a do app: os objetos do módulo são reconstruíveis pelo pull
        await d.transacaoExclusiva((tx) => soltarObjetosDoModulo(tx, m));
        await aplicarMigracoes(d, m, lista, agora);
      }
      indisponiveis.delete(m);
      await marcarReindexacaoSeVazio(d, m);
      return true;
    } catch (e) {
      indisponiveis.add(m);
      registrarErro(`armazenamento local do módulo ${m} indisponível: ${(e as Error).message}`);
      return false;
    }
  };

  const abrir = async () => {
    await driver.executar(PRAGMAS_ABERTURA);
    await aplicarMigracoes(driver, DONO_PLATAFORMA, MIGRACOES_PLATAFORMA, agora);
    for (const m of MODULOS) await garantirModulo(driver, m);
  };
  const pronto = serializar(abrir);
  const aberto = async () => {
    await pronto;
  };

  // ---------- auxiliares SQL ----------
  /** Tabelas que já existem (só cresce; esvaziado em DROP e em transação desfeita, que pode ter criado e voltado atrás). */
  const tabelasConhecidas = new Set<string>();
  const existeTabela = async (d: DriverSqlite, nome: string) => {
    if (tabelasConhecidas.has(nome)) return true;
    const ok = (await d.primeira<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [nome]))!.n > 0;
    if (ok) tabelasConhecidas.add(nome);
    return ok;
  };
  /** Transação exclusiva; se falhar, esquece o que sabia das tabelas (o CREATE pode ter sido desfeito). */
  const transacao = async <T>(fn: (tx: DriverSqlite) => Promise<T>): Promise<T> => {
    try {
      return await driver.transacaoExclusiva(fn);
    } catch (e) {
      tabelasConhecidas.clear();
      throw e;
    }
  };

  const garantirEntidade = async (d: DriverSqlite, e: string) => {
    if (tabelasConhecidas.has(tabelaDaEntidade(e))) return;
    await d.executar(ddlDaEntidade(e));
    await d.rodar('INSERT OR IGNORE INTO _entidades (nome, modulo, criada_em) VALUES (?, ?, ?)', [
      e,
      donoDa.get(e) ?? '',
      agora().toISOString(),
    ]);
  };

  const lerKv = async <T>(d: DriverSqlite, chave: string): Promise<T | null> => {
    const r = await d.primeira<{ valor: string }>('SELECT valor FROM kv WHERE chave = ?', [chave]);
    return r ? (JSON.parse(r.valor) as T) : null;
  };
  const gravarKv = (d: DriverSqlite, chave: string, valor: unknown) =>
    d.rodar('INSERT INTO kv (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', [
      chave,
      JSON.stringify(valor),
    ]);
  const removerKv = (d: DriverSqlite, chave: string) => d.rodar('DELETE FROM kv WHERE chave = ?', [chave]);

  const listarLinhas = async <L extends LinhaSync>(d: DriverSqlite, e: string): Promise<L[]> => {
    const t = tabelaDaEntidade(e);
    if (!(await existeTabela(d, t))) return [];
    // ordem estável por id (o chave→JSON devolve por chegada): quem precisa de ordem ordena no domínio
    const rs = await d.todas<LinhaEnt>(`SELECT id, dados FROM ${t} ORDER BY id`);
    return rs.map((r) => JSON.parse(r.dados) as L);
  };

  const linhasPorIds = async <L extends LinhaSync>(d: DriverSqlite, e: string, ids: readonly string[]): Promise<L[]> => {
    const t = tabelaDaEntidade(e);
    if (ids.length === 0 || !(await existeTabela(d, t))) return [];
    const achadas = new Map<string, L>();
    for (let i = 0; i < ids.length; i += TAMANHO_LOTE_GRAVACAO) {
      const parte = ids.slice(i, i + TAMANHO_LOTE_GRAVACAO);
      const rs = await d.todas<LinhaEnt>(`SELECT id, dados FROM ${t} WHERE id IN (${parte.map(() => '?').join(',')})`, parte);
      for (const r of rs) achadas.set(r.id, JSON.parse(r.dados) as L);
    }
    return ids.flatMap((id) => {
      const l = achadas.get(id);
      return l ? [l] : [];
    });
  };

  /**
   * T-0052-B4: uma consulta só, com os valores num parâmetro JSON (`json_each`): sem limite de parâmetros e sem lotes.
   * Com o índice de expressão `json_extract(dados, '$.<campo>')` do dono, o plano é `SEARCH ... USING INDEX` por valor.
   * Tipos do JSON preservados (texto só casa texto; número só casa número), igual ao `===` do caminho em JS.
   */
  const linhasPorCampo = async <L extends LinhaSync>(
    d: DriverSqlite,
    e: string,
    campo: string,
    valores: readonly ValorCampoLinha[],
  ): Promise<L[]> => {
    validarCampoLinha(campo);
    const unicos = valoresDeCampo(valores);
    const t = tabelaDaEntidade(e);
    if (unicos.length === 0 || !(await existeTabela(d, t))) return [];
    const rs = await d.todas<LinhaEnt>(
      `SELECT id, dados FROM ${t} WHERE json_extract(dados, '$.${campo}') IN (SELECT value FROM json_each(?)) ORDER BY id`,
      [JSON.stringify(unicos)],
    );
    return rs.map((r) => JSON.parse(r.dados) as L);
  };

  const leitor = (d: DriverSqlite): LeitorLinhas => ({
    porIds: (e, ids) => linhasPorIds(d, e, ids),
    async porCampo<L extends LinhaSync>(e: string, campo: string, valor: string) {
      if (!CAMPO_RE.test(campo)) throw new Error(`Campo inválido: ${campo}`);
      const t = tabelaDaEntidade(e);
      if (!(await existeTabela(d, t))) return [];
      const rs = await d.todas<LinhaEnt>(`SELECT id, dados FROM ${t} WHERE json_extract(dados, '$.${campo}') = ? ORDER BY id`, [valor]);
      return rs.map((r) => JSON.parse(r.dados) as L);
    },
  });

  // ---------- busca: validação e manutenção ----------
  const colunasDe = (i: IndiceBusca) => Object.keys(i.colunas);

  /** Confere (uma vez) que as tabelas do índice existem com as colunas declaradas, na ordem. */
  const indiceValido = async (d: DriverSqlite, i: IndiceBusca): Promise<boolean> => {
    if (removidos.has(i.modulo)) {
      // módulo reativado depois da limpeza: migrações de novo (o pull recomeça do cursor apagado)
      removidos.delete(i.modulo);
      await garantirModulo(d, i.modulo);
    }
    const conhecido = indicesValidos.get(i.id);
    if (conhecido !== undefined) return conhecido;
    if (indisponiveis.has(i.modulo)) return false;
    const fts = (await d.todas<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [i.tabelaFts])).map((c) => c.name);
    const doc = new Set((await d.todas<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [i.tabelaDoc])).map((c) => c.name));
    const esperado = colunasDe(i);
    const ok =
      fts.length === esperado.length &&
      fts.every((c, k) => c === esperado[k]) &&
      ['rid', i.colunaChave, ...esperado].every((c) => doc.has(c));
    if (!ok) registrarErro(`índice de busca ${i.id}: tabelas ausentes ou colunas diferentes das declaradas`);
    indicesValidos.set(i.id, ok);
    return ok;
  };

  interface DocAntigo {
    rid: number;
    [coluna: string]: ValorSql;
  }

  const manterIndice = async (d: DriverSqlite, i: IndiceBusca, chaves: ReadonlySet<string>) => {
    if (chaves.size === 0 || !(await indiceValido(d, i))) return;
    const cols = colunasDe(i);
    const listaCols = cols.join(', ');
    const sujo = (await lerKv<boolean>(d, chaveSujo(i.id))) === true;
    const vazio = (await d.primeira<{ n: number }>(`SELECT count(*) AS n FROM ${i.tabelaDoc}`))!.n === 0;
    const massa = sujo || vazio || chaves.size > LIMITE_INCREMENTAL_BUSCA;
    const ler = leitor(d);
    const ctx = contextoIndice();
    for (const chave of chaves) {
      const doc = await i.documento(chave, ler, ctx);
      const antigo = await d.primeira<DocAntigo>(`SELECT rid, ${listaCols} FROM ${i.tabelaDoc} WHERE ${i.colunaChave} = ?`, [chave]);
      const valores = doc ? cols.map((c) => doc[c] ?? null) : [];
      if (!massa && antigo)
        await d.rodar(
          `INSERT INTO ${i.tabelaFts} (${i.tabelaFts}, rowid, ${listaCols}) VALUES ('delete', ?, ${cols.map(() => '?').join(', ')})`,
          [antigo.rid, ...cols.map((c) => antigo[c] ?? null)],
        );
      if (!doc) {
        if (antigo) await d.rodar(`DELETE FROM ${i.tabelaDoc} WHERE rid = ?`, [antigo.rid]);
        continue;
      }
      let rid: number;
      if (antigo) {
        await d.rodar(`UPDATE ${i.tabelaDoc} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE rid = ?`, [...valores, antigo.rid]);
        rid = antigo.rid;
      } else {
        const r = await d.primeira<{ rid: number }>(
          `INSERT INTO ${i.tabelaDoc} (${i.colunaChave}, ${listaCols}) VALUES (?, ${cols.map(() => '?').join(', ')}) RETURNING rid`,
          [chave, ...valores],
        );
        rid = r!.rid;
      }
      if (!massa)
        await d.rodar(`INSERT INTO ${i.tabelaFts} (rowid, ${listaCols}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [rid, ...valores]);
    }
    if (massa) await gravarKv(d, chaveSujo(i.id), true);
    else mudancasIncrementais += chaves.size;
  };

  const reconstruir = async (d: DriverSqlite, i: IndiceBusca) => {
    await d.rodar(`INSERT INTO ${i.tabelaFts} (${i.tabelaFts}) VALUES ('rebuild')`);
    await removerKv(d, chaveSujo(i.id));
  };

  /** L-1: depois das migrações do módulo, índice sem documento e com alguma fonte com linhas = marcar para reindexar. */
  async function marcarReindexacaoSeVazio(d: DriverSqlite, m: ModuloId) {
    for (const i of indices) {
      if (i.modulo !== m || !(await existeTabela(d, i.tabelaDoc))) continue;
      if ((await d.primeira<{ n: number }>(`SELECT EXISTS (SELECT 1 FROM ${i.tabelaDoc}) AS n`))!.n > 0) continue;
      for (const f of i.fontes) {
        const t = tabelaDaEntidade(f);
        if (!(await existeTabela(d, t))) continue;
        if ((await d.primeira<{ n: number }>(`SELECT EXISTS (SELECT 1 FROM ${t}) AS n`))!.n > 0) {
          await gravarKv(d, chaveReindexar(i.id), true);
          break;
        }
      }
    }
  }

  /** Reindexações em curso (consulta e fim do sync ao mesmo tempo esperam a mesma). */
  const reindexando = new Map<string, Promise<void>>();

  /**
   * L-1: reindexação completa a partir das linhas locais das fontes. Chaves lidas por faixa de `id` (lotes de
   * `TAMANHO_LOTE_GRAVACAO`), documentos gravados em lotes por transação cedendo o loop entre eles (modo massa: só a
   * tabela de documentos + `sujo`; o `rebuild` vem depois, no `finalizar` ou na consulta). A marca sai no último lote.
   */
  const reindexarSeMarcado = (i: IndiceBusca): Promise<void> => {
    const emCurso = reindexando.get(i.id);
    if (emCurso) return emCurso;
    const p = (async () => {
      if ((await lerKv<MarcaReindexar>(driver, chaveReindexar(i.id))) === null) return;
      if (!(await serializar(() => indiceValido(driver, i)))) return;
      const chaves = new Set<string>();
      for (const f of i.fontes) {
        const t = tabelaDaEntidade(f);
        if (!(await existeTabela(driver, t))) continue;
        let desde = '';
        for (;;) {
          const rs = await driver.todas<LinhaEnt>(`SELECT id, dados FROM ${t} WHERE id > ? ORDER BY id LIMIT ?`, [
            desde,
            TAMANHO_LOTE_GRAVACAO,
          ]);
          for (const r of rs) {
            const k = i.chaveDe(f, JSON.parse(r.dados) as LinhaSync);
            if (k) chaves.add(k);
          }
          if (rs.length < TAMANHO_LOTE_GRAVACAO) break;
          desde = rs[rs.length - 1]!.id;
          await ceder();
        }
      }
      const lista = [...chaves];
      if (lista.length === 0) {
        await serializar(() => removerKv(driver, chaveReindexar(i.id)));
        return;
      }
      for (let k = 0; k < lista.length; k += TAMANHO_LOTE_GRAVACAO) {
        const ultimo = k + TAMANHO_LOTE_GRAVACAO >= lista.length;
        await serializar(() =>
          transacao(async (tx) => {
            await manterIndice(tx, i, new Set(lista.slice(k, k + TAMANHO_LOTE_GRAVACAO)));
            if (ultimo) await removerKv(tx, chaveReindexar(i.id));
          }),
        );
        if (!ultimo) await ceder();
      }
    })().finally(() => reindexando.delete(i.id));
    reindexando.set(i.id, p);
    return p;
  };

  // ---------- pacote da primeira carga (ADR 0054) ----------
  /** Recusa do arquivo: o motor cai no pull paginado. */
  const recusar = (codigo: ConstructorParameters<typeof ErroPacoteSync>[0]): never => {
    throw new ErroPacoteSync(codigo);
  };

  /** Dentro da transação, com o arquivo anexado: confere o arquivo e copia as entidades. */
  const copiarDoPacote = async (tx: DriverSqlite, entidades: readonly EntidadePacoteSync[], conferir: ConferenciaPacote) => {
    let saude: Array<{ quick_check: string }>;
    let meta: Array<{ chave: string; valor: string }>;
    try {
      saude = await tx.todas<{ quick_check: string }>(`PRAGMA ${APELIDO_PACOTE}.quick_check`);
    } catch {
      return recusar('quick_check');
    }
    if (saude.length !== 1 || saude[0]!.quick_check !== 'ok') recusar('quick_check');
    try {
      meta = await tx.todas<{ chave: string; valor: string }>(`SELECT chave, valor FROM ${APELIDO_PACOTE}._pacote`);
    } catch {
      return recusar('formato');
    }
    const m = MetaPacoteSchema.safeParse(Object.fromEntries(meta.map((r) => [r.chave, String(r.valor)])));
    if (!m.success) return recusar('formato');
    if ((conferir.modulo && m.data.modulo !== conferir.modulo) || (conferir.particao && m.data.particao !== conferir.particao))
      recusar('formato');
    if (conferir.geracao_base && m.data.geracao_base !== conferir.geracao_base) recusar('geracao');
    for (const e of entidades) {
      const t = tabelaDaEntidade(e.nome);
      if (m.data.entidades[e.nome] !== e.linhas) recusar('contagem');
      let n: number;
      try {
        n = (await tx.primeira<{ n: number }>(`SELECT count(*) AS n FROM ${APELIDO_PACOTE}.${t}`))!.n;
      } catch {
        return recusar('contagem');
      }
      if (n !== e.linhas) recusar('contagem');
      await garantirEntidade(tx, e.nome);
      // `WHERE true`: desfaz a ambiguidade do `ON CONFLICT` depois de `SELECT` (gramática do SQLite)
      await tx.rodar(
        `INSERT INTO ${t} (id, updated_at, deleted_at, dados) SELECT id, updated_at, NULL, dados FROM ${APELIDO_PACOTE}.${t} WHERE true ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = NULL, dados = excluded.dados WHERE excluded.updated_at > ${t}.updated_at`,
      );
      await gravarKv(tx, cursorDe(e.nome), e.cursor);
      if (e.versao_escopo !== undefined) await gravarKv(tx, escopoDe(e.nome), e.versao_escopo);
    }
    // carga em massa da busca: documentos refeitos das linhas locais e `rebuild` uma vez (no `finalizar` ou na consulta)
    const nomes = new Set(entidades.map((e) => e.nome));
    for (const i of indices)
      if (!indisponiveis.has(i.modulo) && i.fontes.some((f) => nomes.has(f))) {
        await gravarKv(tx, chaveReindexar(i.id), true satisfies MarcaReindexar);
        await gravarKv(tx, chaveSujo(i.id), true);
      }
  };

  const importarPacote = async (
    caminho: string,
    entidades: readonly EntidadePacoteSync[],
    conferir: ConferenciaPacote = {},
  ): Promise<void> => {
    for (const e of entidades) tabelaDaEntidade(e.nome);
    await aberto();
    await serializar(async () => {
      /** Conexão em que o arquivo foi anexado (no expo-sqlite, a da transação): o `DETACH` vai nela, depois do COMMIT. */
      let anexadoEm: DriverSqlite | null = null;
      try {
        await transacao(async (tx) => {
          if (!tx.anexar) return recusar('indisponivel');
          try {
            await tx.anexar(caminho, APELIDO_PACOTE);
          } catch {
            return recusar('quick_check');
          }
          anexadoEm = tx;
          await copiarDoPacote(tx, entidades, conferir);
        });
      } finally {
        const d = anexadoEm as DriverSqlite | null;
        if (d?.desanexar)
          await d.desanexar(APELIDO_PACOTE).catch((e: unknown) => registrarErro(`pacote: DETACH falhou: ${(e as Error).message}`));
      }
    });
  };

  // ---------- operações sobre um driver (o de fora, com fila; ou o da transação, direto) ----------
  const operacoes = (d: DriverSqlite, naTransacao: boolean): ArmazenamentoSync & { linhas: LinhasSync } => {
    /** Escrita: fora da transação, entra na fila e roda numa transação exclusiva; dentro, roda direto. */
    const escrever = <T>(fn: (tx: DriverSqlite) => Promise<T>): Promise<T> =>
      naTransacao ? fn(d) : aberto().then(() => serializar(() => transacao(fn)));
    const ler = <T>(fn: () => Promise<T>): Promise<T> => (naTransacao ? fn() : aberto().then(fn));

    /** Uma parte de uma página do pull (ou da compatibilidade `ent:`), já dentro de uma transação. */
    const aplicarLote = async (tx: DriverSqlite, e: string, lote: readonly LinhaSync[], cursor: string | null) => {
      await garantirEntidade(tx, e);
      const t = tabelaDaEntidade(e);
      const afetados = indices.filter((i) => i.fontes.includes(e) && !indisponiveis.has(i.modulo));
      const chaves = new Map<string, Set<string>>(afetados.map((i) => [i.id, new Set()]));
      if (afetados.length > 0) {
        // a linha antiga também aponta documento (ex.: atributo que mudou de produto)
        const antigas = await linhasPorIds(tx, e, lote.map((l) => l.id));
        for (const i of afetados)
          for (const l of [...antigas, ...lote]) {
            const k = i.chaveDe(e, l);
            if (k) chaves.get(i.id)!.add(k);
          }
      }
      const upsert = await tx.preparar(
        `INSERT INTO ${t} (id, updated_at, deleted_at, dados) VALUES (?, ?, NULL, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = NULL, dados = excluded.dados`,
      );
      const apagar = await tx.preparar(`DELETE FROM ${t} WHERE id = ?`);
      try {
        for (const l of lote) {
          if (l.deleted_at) await apagar.rodar([l.id]);
          else await upsert.rodar([l.id, l.updated_at ?? '', JSON.stringify(l)]);
        }
      } finally {
        await upsert.finalizar();
        await apagar.finalizar();
      }
      if (cursor) await gravarKv(tx, cursorDe(e), cursor);
      for (const i of afetados) await manterIndice(tx, i, chaves.get(i.id)!);
    };

    const aplicar = async (e: string, novas: readonly LinhaSync[], cursor: string | null) => {
      tabelaDaEntidade(e);
      if (naTransacao) return aplicarLote(d, e, novas, cursor);
      await aberto();
      if (novas.length === 0) {
        await escrever((tx) => aplicarLote(tx, e, [], cursor));
        return;
      }
      for (let i = 0; i < novas.length; i += TAMANHO_LOTE_GRAVACAO) {
        const ultimo = i + TAMANHO_LOTE_GRAVACAO >= novas.length;
        // cursor só no último lote: se o app cair entre lotes, a página vem de novo (upsert por id = idempotente)
        await escrever((tx) => aplicarLote(tx, e, novas.slice(i, i + TAMANHO_LOTE_GRAVACAO), ultimo ? cursor : null));
        if (!ultimo) await ceder();
      }
    };

    const limparEntidade = async (tx: DriverSqlite, e: string) => {
      const t = tabelaDaEntidade(e);
      if (await existeTabela(tx, t)) {
        const afetados = indices.filter((i) => i.fontes.includes(e) && !indisponiveis.has(i.modulo));
        if (afetados.length > 0) {
          const antigas = await listarLinhas(tx, e);
          await tx.rodar(`DELETE FROM ${t}`);
          for (const i of afetados) {
            const ks = new Set(antigas.map((l) => i.chaveDe(e, l)).filter((k): k is string => !!k));
            await manterIndice(tx, i, ks);
          }
        } else await tx.rodar(`DELETE FROM ${t}`);
      }
      await removerKv(tx, cursorDe(e));
    };

    const linhas: LinhasSync = {
      // ADR 0054: só com `anexar`/`desanexar` no driver (sem eles, o motor nem baixa o pacote)
      ...(!naTransacao && driver.anexar && driver.desanexar ? { importarPacote } : {}),
      aplicar,
      listar: (e) => ler(() => listarLinhas(d, e)),
      porIds: (e, ids) => ler(() => linhasPorIds(d, e, ids)),
      porCampo: (e, campo, valores) => ler(() => linhasPorCampo(d, e, campo, valores)),
      ids: (e) => ler(async () => (await listarLinhas(d, e)).map((l) => l.id)),
      contar: (e) =>
        ler(async () => {
          const t = tabelaDaEntidade(e);
          return (await existeTabela(d, t)) ? (await d.primeira<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))!.n : 0;
        }),
      limpar: (e) => escrever((tx) => limparEntidade(tx, e)),
    };

    /** `ent:<e>` → mapa id → linha (compatibilidade). Vazio = `null`, como no chave→JSON depois de remover. */
    const lerEnt = async <T>(e: string): Promise<T | null> => {
      const ls = await listarLinhas(d, e);
      return ls.length === 0 ? null : (Object.fromEntries(ls.map((l) => [l.id, l])) as T);
    };

    const gravarEnt = (e: string, mapa: Record<string, LinhaSync>) =>
      escrever(async (tx) => {
        const novas = Object.values(mapa);
        const manter = new Set(novas.map((l) => l.id));
        const quando = agora().toISOString();
        const sair = (await listarLinhas(tx, e))
          .filter((l) => !manter.has(l.id))
          .map((l) => ({ ...l, updated_at: quando, deleted_at: quando }));
        await aplicarLote(tx, e, [...sair, ...novas], null);
      });

    const entidadeDaChave = (chave: string) => {
      const e = chave.slice(PREFIXO_ENT.length);
      tabelaDaEntidade(e);
      return e;
    };

    const base: ArmazenamentoSync & { linhas: LinhasSync } = {
      ler: <T>(chave: string) =>
        ler(() => (chave.startsWith(PREFIXO_ENT) ? lerEnt<T>(entidadeDaChave(chave)) : lerKv<T>(d, chave))),
      async gravar(chave, valor) {
        if (valor === null || valor === undefined) return base.remover(chave);
        if (chave.startsWith(PREFIXO_ENT)) return gravarEnt(entidadeDaChave(chave), valor as Record<string, LinhaSync>);
        if (CHAVES_DURAVEIS.has(chave) && !naTransacao) {
          // a fila sobrevive a queda de energia: troca de PRAGMA fora de transação, na fila de escrita
          await aberto();
          await serializar(async () => {
            await d.executar('PRAGMA synchronous = FULL');
            try {
              await gravarKv(d, chave, valor);
            } finally {
              await d.executar('PRAGMA synchronous = NORMAL');
            }
          });
          return;
        }
        await escrever((tx) => gravarKv(tx, chave, valor).then(() => undefined));
      },
      async remover(chave) {
        if (chave.startsWith(PREFIXO_ENT)) {
          const e = entidadeDaChave(chave);
          await escrever(async (tx) => {
            const t = tabelaDaEntidade(e);
            if (!(await existeTabela(tx, t))) return;
            const quando = agora().toISOString();
            const todas = (await listarLinhas(tx, e)).map((l) => ({ ...l, updated_at: quando, deleted_at: quando }));
            await aplicarLote(tx, e, todas, null);
          });
          return;
        }
        await escrever((tx) => removerKv(tx, chave).then(() => undefined));
      },
      chaves: (prefixo) =>
        ler(async () => {
          const kv = (
            await d.todas<{ chave: string }>('SELECT chave FROM kv WHERE chave >= ? AND chave < ? ORDER BY chave', [
              prefixo,
              prefixo + FIM_FAIXA,
            ])
          ).map((r) => r.chave);
          const ents: string[] = [];
          for (const { nome } of await d.todas<{ nome: string }>('SELECT nome FROM _entidades ORDER BY nome')) {
            const k = PREFIXO_ENT + nome;
            if (!k.startsWith(prefixo)) continue;
            if ((await d.primeira<{ n: number }>(`SELECT count(*) AS n FROM ${tabelaDaEntidade(nome)}`))!.n > 0) ents.push(k);
          }
          return [...kv, ...ents].sort();
        }),
      linhas,
    };
    return base;
  };

  // ---------- RN-CORE-02 ----------
  async function soltarObjetosDoModulo(tx: DriverSqlite, m: ModuloId) {
    const prefixo = prefixoDoModulo(m);
    const objetos = (await listarObjetos(tx)).filter((o) => o.name.startsWith(prefixo));
    // tabelas virtuais primeiro (levam as tabelas-sombra junto); depois visões, gatilhos e tabelas
    const ordem = (o: { type: string; sql: string | null }) =>
      /^CREATE VIRTUAL/i.test(o.sql ?? '') ? 0 : o.type === 'view' ? 1 : o.type === 'trigger' ? 2 : o.type === 'table' ? 3 : 4;
    for (const o of [...objetos].sort((a, b) => ordem(a) - ordem(b))) {
      const tipo = o.type === 'view' ? 'VIEW' : o.type === 'trigger' ? 'TRIGGER' : o.type === 'index' ? 'INDEX' : 'TABLE';
      await tx.executar(`DROP ${tipo} IF EXISTS "${o.name.replace(/"/g, '""')}"`);
    }
    await tx.rodar('DELETE FROM _esquema WHERE dono = ?', [m]);
    for (const i of indices) if (i.modulo === m) indicesValidos.delete(i.id);
    tabelasConhecidas.clear();
  }

  /** Só depois de `removerModuloEm`: recriar exige as migrações, que voltam no primeiro uso do índice. */
  const marcarRemovido = (m: ModuloId) => {
    if ((migracoes[m]?.length ?? 0) > 0) removidos.add(m);
  };

  const externo = operacoes(driver, false);

  const removerModuloEm = async (tx: DriverSqlite, m: ModuloId) => {
    const ops = operacoes(tx, true);
    // entidades do módulo pelo registro do aparelho (cobre entidade que nem está mais no registro)
    for (const { nome } of await tx.todas<{ nome: string }>('SELECT nome FROM _entidades WHERE modulo = ? ORDER BY nome', [m]))
      await ops.linhas.limpar(nome);
    for (const { chave } of await tx.todas<{ chave: string }>('SELECT chave FROM kv WHERE chave >= ? AND chave < ?', [
      `mod:${m}:`,
      `mod:${m}:${FIM_FAIXA}`,
    ]))
      await removerKv(tx, chave);
    for (const i of indices)
      if (i.modulo === m) {
        await removerKv(tx, chaveSujo(i.id));
        await removerKv(tx, chaveReindexar(i.id));
        await removerKv(tx, chaveVersao(i.id));
        versaoConferida.delete(i.id);
      }
    await soltarObjetosDoModulo(tx, m);
    marcarRemovido(m);
    vacuumPendente = true;
  };

  /** Fora de qualquer transação: devolve o espaço do que foi apagado ("nada ocupa espaço sem licença"). */
  const vacuumSePendente = async () => {
    if (!vacuumPendente) return;
    vacuumPendente = false;
    await serializar(() => driver.executar('PRAGMA incremental_vacuum'));
  };

  const operacoesDaTransacao = (tx: DriverSqlite): ArmazenamentoSync => ({
    ...operacoes(tx, true),
    removerModulo: (m) => removerModuloEm(tx, m),
  });

  const busca: BuscaSqlite = {
    async buscar(id: string, consulta: ConsultaTexto): Promise<ResultadoBusca[]> {
      const d = await busca.buscarComDesfecho(id, consulta);
      return d.buscou ? d.resultados : [];
    },
    async buscarComDesfecho(id: string, consulta: ConsultaTexto): Promise<DesfechoBusca> {
      await aberto();
      const i = indicePorId.get(id);
      if (!i) throw new Error(`Índice de busca ${id} não registrado`);
      const fts = montarConsultaFts(consulta);
      if (!fts) return { buscou: false, motivo: 'consulta_vazia' };
      if (indisponiveis.has(i.modulo) && !(await serializar(() => garantirModulo(driver, i.modulo))))
        return { buscou: false, motivo: 'modulo_indisponivel' };
      // já validado nesta sessão: sem entrar na fila de escrita (a reindexação por versão pode estar com um lote aberto)
      const valido = (indicesValidos.get(i.id) === true && !removidos.has(i.modulo)) || (await serializar(() => indiceValido(driver, i)));
      if (!valido) return { buscou: false, motivo: 'indice_invalido' };
      const marca = await lerKv<MarcaReindexar>(driver, chaveReindexar(i.id));
      const emSegundoPlano = () =>
        void reindexarSeMarcado(i).catch((e: unknown) => registrarErro(`reindexação do índice ${i.id} falhou: ${(e as Error).message}`));
      if (marca === true) {
        if (opcoes.buscaSemEsperarIndexacao) {
          // T-0088 §5: a tela não espera o L-1; quem chama varre até a marca sair
          emSegundoPlano();
          return { buscou: false, motivo: 'indexando' };
        }
        await reindexarSeMarcado(i);
      } else if (marca === 'versao')
        // T-0084: os documentos antigos ainda respondem; a reindexação segue sem prender a tela
        emSegundoPlano();
      if ((await lerKv<boolean>(driver, chaveSujo(i.id))) === true)
        await serializar(() => transacao((tx) => reconstruir(tx, i)));
      const pesos = Object.values(i.colunas).join(', ');
      try {
        // T-0084: os `limite` melhores saem do FTS ANTES de ler a tabela de documentos (com aplicação longa, ler a linha
        // de cada acerto custava ~1/3 da consulta em 20 mil produtos). Empate exato no corte: o menor `rid` fica.
        const rs = await driver.todas<{ chave: string; pontuacao: number }>(
          `SELECT d.${i.colunaChave} AS chave, m.pontuacao
             FROM (SELECT rowid AS rid, bm25(${i.tabelaFts}, ${pesos}) AS pontuacao
                     FROM ${i.tabelaFts}
                    WHERE ${i.tabelaFts} MATCH ?
                    ORDER BY pontuacao, rowid LIMIT ?) m
             JOIN ${i.tabelaDoc} d ON d.rid = m.rid
            ORDER BY m.pontuacao, chave`,
          [fts, limiteDaConsulta(consulta)],
        );
        return { buscou: true, resultados: rs.map((r) => ({ chave: r.chave, pontuacao: r.pontuacao })) };
      } catch (e) {
        // erro do FTS = não buscou (em `buscar`, lista vazia); o log leva só o tamanho e o índice (nunca o texto digitado)
        registrarErro(`busca ${i.id} recusada pelo FTS (consulta de ${fts.length} caracteres): ${(e as Error).message}`);
        return { buscou: false, motivo: 'erro_busca' };
      }
    },
    async conferirVersoes(c) {
      await aberto();
      // `fusoDoTenantOuPadrao` cria um `Intl.DateTimeFormat`: só quando o fuso informado muda (roda a cada busca)
      if (c.fuso !== fusoInformado) {
        fusoInformado = c.fuso;
        fusoIndice = fusoDoTenantOuPadrao(c.fuso);
      }
      const ctx = contextoIndice();
      for (const i of indices) {
        if (!i.versaoDocumentos || indisponiveis.has(i.modulo) || removidos.has(i.modulo)) continue;
        let versao: string;
        try {
          versao = String(i.versaoDocumentos(ctx));
        } catch (e) {
          registrarErro(`índice de busca ${i.id}: versaoDocumentos falhou: ${(e as Error).message}`);
          continue;
        }
        if (versaoConferida.get(i.id) === versao) continue;
        try {
          await serializar(() =>
            transacao(async (tx) => {
              if (!(await existeTabela(tx, i.tabelaDoc))) return;
              if ((await lerKv<string>(tx, chaveVersao(i.id))) === versao) return;
              const temDocumento = (await tx.primeira<{ n: number }>(`SELECT EXISTS (SELECT 1 FROM ${i.tabelaDoc}) AS n`))!.n > 0;
              // a marca do L-1 (`true`) é mais forte: não rebaixa para `'versao'`
              if (temDocumento && (await lerKv<MarcaReindexar>(tx, chaveReindexar(i.id))) !== true)
                await gravarKv(tx, chaveReindexar(i.id), 'versao' satisfies MarcaReindexar);
              await gravarKv(tx, chaveVersao(i.id), versao);
            }),
          );
          versaoConferida.set(i.id, versao);
        } catch (e) {
          // a próxima conferência tenta de novo (a busca segue com os documentos que tem)
          registrarErro(`índice de busca ${i.id}: conferência da versão falhou: ${(e as Error).message}`);
        }
      }
    },
    async finalizar() {
      await aberto();
      for (const i of indices) {
        if (!indisponiveis.has(i.modulo)) await reindexarSeMarcado(i);
        if (indisponiveis.has(i.modulo) || (await lerKv<boolean>(driver, chaveSujo(i.id))) !== true) continue;
        if (!(await serializar(() => indiceValido(driver, i)))) continue;
        await serializar(() => transacao((tx) => reconstruir(tx, i)));
      }
      if (mudancasIncrementais >= MUDANCAS_ATE_OTIMIZAR) {
        mudancasIncrementais = 0;
        for (const i of indices)
          if (!indisponiveis.has(i.modulo) && (await serializar(() => indiceValido(driver, i))))
            await serializar(() => driver.rodar(`INSERT INTO ${i.tabelaFts} (${i.tabelaFts}) VALUES ('optimize')`));
      }
    },
  };

  return {
    ...externo,
    busca,
    pronto,
    async emTransacao<T>(fn: (tx: ArmazenamentoSync) => Promise<T>): Promise<T> {
      await aberto();
      const r = await serializar(() => transacao((tx) => fn(operacoesDaTransacao(tx))));
      await vacuumSePendente();
      return r;
    },
    async removerModulo(m) {
      await aberto();
      await serializar(() => transacao((tx) => removerModuloEm(tx, m)));
      await vacuumSePendente();
    },
    modulosIndisponiveis: () => [...indisponiveis],
    async fechar() {
      await aberto().catch(() => undefined);
      await serializar(() => driver.fechar());
    },
  };
}
