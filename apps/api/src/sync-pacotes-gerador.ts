/**
 * Gerador do pacote pronto da primeira carga, no worker (ADR 0054; desenho `docs/desenho/T-catalogo-pacote.md` §1.1 e §1.4).
 * Ligado só com `MACUXI_SYNC_PACOTES=1` (`config.ts`); laço próprio a cada `MACUXI_SYNC_PACOTES_INTERVALO_MS` (padrão 60 s).
 *
 * Unidade: (tenant, módulo, partição). Cada ciclo:
 * 1. **Gatilho do lote**: `integracao.lote.concluido@1` na outbox (`plataforma.evento`, papel `macuxi_worker`, pelo índice
 *    `(tenant_id, ocorrido_em)`) mais novo que o `horizonte` do pacote pronto (ou partição sem pacote) grava o pedido `lote`
 *    com `gerar_apos = último lote + 5 min` (empurrado a cada lote novo: não gera no meio de uma carga de vários lotes).
 * 2. **Agendado** (uma vez por hora): pacote com mais de 24 h e com mudança desde o horizonte (`pacote.puxar` com `limite: 1`,
 *    como as novidades) grava o pedido `agendado`. O pedido `manifesto` vem da rota (`sync-pacotes.ts`).
 * 3. **Pedidos vencidos**: trava consultiva de sessão por partição (`pg_try_advisory_lock`: dois workers não geram o mesmo);
 *    partição que saiu do tenant (licença, filial) = `descartado`; pacote já mais novo que o pedido = `atendido` sem gerar;
 *    senão gera: horizonte do banco (ADR 0006) e `geracao_base` atual (ADR 0021); cada provedor com `pacote` em páginas de
 *    5.000 (`pacote.puxar`, `comTenant` macuxi_app com RLS e o usuário de sistema, como o agendador), uma transação SQLite por
 *    página (`node:sqlite`); `_pacote`; `VACUUM`; gzip nível 6 em fluxo; md5 e bytes; grava no S3/disco; registra `pronto` e a
 *    anterior vira `substituido` (mesma transação). Falha: `tentativas + 1`, espera crescente; depois de `MAX_TENTATIVAS`,
 *    `descartado` (o próximo gatilho pede de novo).
 * 4. **Retenção**: arquivo de pacote `substituido` há mais de 1 h é apagado (quem estava baixando termina) e a linha vira
 *    `apagado`; linhas `apagado` e pedidos fechados com mais de 7 dias saem.
 *
 * Log: `tenant_id`, `modulo`, `particao` (uuid da filial, não é dado pessoal), linhas, bytes, duração. Nunca a URL assinada.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { EVENTO_LOTE_CONCLUIDO } from '@macuxi/integracao/contracts';
import {
  compararCursor,
  ENTIDADE_SYNC_RE,
  filialDaParticao,
  FORMATO_PACOTE_SYNC,
  fusoDoTenantOuPadrao,
  modulosEfetivos,
  particaoDeFilial,
  USUARIO_SISTEMA_ID,
  UUID_NIL,
  type AcessoBanco,
  type ContextoPacote,
  type CursorSync,
  type LinhaSync,
  type LogRota,
  type ModuloApi,
  type ModuloId,
  type ParticaoPacote,
  type ProvedorSync,
} from '@macuxi/platform-sdk';
import type pg from 'pg';
import { ErroArmazenamentoS3 } from './armazenamento-s3';
import type { BancoApp } from './banco';
import { iniciarLaco } from './laco';
import { licencasDoTenantNoBanco, type LicencasTenant } from './licencas';
import { mensagemSegura } from './log-seguro';
import { registroDeConsultas, transacaoTenant } from './outbox';
import { dentroDaJanela } from './sync';
import { chaveDoPacoteSync, provedoresDePacote, type ArmazenamentoPacotesSync } from './sync-pacotes';

/** Linhas por página do `pacote.puxar` (desenho §1.4). */
export const PAGINA_PACOTE = 5_000;
/** Espera depois do último lote do Hub antes de gerar (desenho §1.4). */
export const ESPERA_LOTE_MS = 5 * 60_000;
/** Pacote mais velho que isto, com mudança, é regerado (gatilho agendado). */
export const IDADE_REGERAR_MS = 24 * 3_600_000;
/** O gatilho agendado roda no máximo a cada... */
export const INTERVALO_AGENDADO_MS = 3_600_000;
/** Arquivo do pacote substituído fica este tempo (quem estava baixando termina). */
export const RETER_SUBSTITUIDO_MS = 3_600_000;
/** Linhas `apagado` e pedidos fechados saem depois de... */
export const EXPURGO_MS = 7 * 24 * 3_600_000;
/** Pedidos atendidos por ciclo (um por vez; o resto fica para o ciclo seguinte). */
export const PEDIDOS_POR_CICLO = 5;
/** Tentativas antes de descartar o pedido. */
export const MAX_TENTATIVAS = 8;
/** Janela do gatilho do lote na subida do worker (depois, desde o ciclo anterior com folga). */
const JANELA_LOTE_INICIAL_MS = 24 * 3_600_000;
/** Folga da janela do lote: o evento grava `ocorrido_em` no início da transação e pode confirmar depois. */
const FOLGA_LOTE_MS = 10 * 60_000;

export type OrigemPedidoPacote = 'lote' | 'manifesto' | 'agendado';

export interface PedidoPacote {
  id: string;
  tenant_id: string;
  modulo: string;
  particao: string;
  origem: OrigemPedidoPacote;
  tentativas: number;
  /** Última mudança do pedido (criação ou lote novo): pacote com horizonte depois disto já o atende. */
  updated_at: Date;
}

export interface PacotePronto {
  id: string;
  tenant_id: string;
  modulo: string;
  particao: string;
  horizonte: Date;
  geracao_base: string;
  created_at: Date;
  entidades: Record<string, number>;
}

export interface NovoPacote {
  id: string;
  tenant_id: string;
  modulo: string;
  particao: string;
  horizonte: Date;
  geracao_base: string;
  chave: string;
  bytes: number;
  md5: string;
  entidades: Record<string, number>;
}

/** Acesso do gerador às tabelas da plataforma (papel `macuxi_worker`, todos os tenants). Testes injetam um em memória. */
export interface RepositorioPacotes {
  tenantsAtivos(): Promise<string[]>;
  /** Último `integracao.lote.concluido@1` de cada tenant depois de `desde`. */
  lotesConcluidos(tenants: readonly string[], desde: Date): Promise<{ tenant_id: string; ultimo: Date }[]>;
  /** Pacotes `pronto` vivos (de um tenant, ou de todos com `criadosAntes`). */
  prontos(filtro: { tenant_id: string } | { criadosAntes: Date }): Promise<PacotePronto[]>;
  /**
   * Pedido idempotente por partição. Já há pendente: `lote` empurra o `gerar_apos` para o maior; as outras origens não mudam.
   */
  pedir(p: { tenant_id: string; modulo: string; particao: string; origem: OrigemPedidoPacote; gerar_apos: Date }): Promise<void>;
  /** Pendentes com `gerar_apos <= agora`, mais antigos primeiro. */
  pendentes(agora: Date, limite: number): Promise<PedidoPacote[]>;
  /** O pedido ainda pendente (relido depois da trava; `null` = outro worker já atendeu). */
  pendente(id: string): Promise<PedidoPacote | null>;
  /** Trava de sessão da partição; `null` = outro processo está gerando. */
  travar(chave: string): Promise<{ liberar(): Promise<void> } | null>;
  /** Insere o novo `pronto` e marca o anterior da partição `substituido`, na mesma transação. */
  registrar(p: NovoPacote): Promise<void>;
  concluir(pedidoId: string, situacao: 'atendido' | 'descartado', erro?: string): Promise<void>;
  /** Falhou: `tentativas + 1`, `ultimo_erro` e nova espera. */
  adiar(pedidoId: string, erro: string, gerarApos: Date): Promise<void>;
  /** Substituídos antes de `antes`, com o arquivo ainda no armazenamento. */
  substituidos(antes: Date): Promise<{ id: string; chave: string }[]>;
  marcarApagado(id: string): Promise<void>;
  /** Apaga linhas `apagado` e pedidos fechados mais velhos que `antes`. */
  expurgar(antes: Date): Promise<{ pacotes: number; pedidos: number }>;
}

// ---------- repositório SQL (macuxi_worker) ----------

const SQL_TRAVA = 'select pg_try_advisory_lock(hashtextextended($1, 0)) as ok';
const SQL_DESTRAVA = 'select pg_advisory_unlock(hashtextextended($1, 0))';
const COLUNAS_PEDIDO = 'id, tenant_id, modulo, particao, origem, tentativas, updated_at';
const COLUNAS_PRONTO = 'id, tenant_id, modulo, particao, horizonte, geracao_base::text as geracao_base, created_at, entidades';

/**
 * Repositório sobre um pool do `macuxi_worker` (grants e políticas da 0074). A trava segura uma conexão do pool durante a
 * geração: use um pool próprio (o worker abre um de 2 conexões só para o gerador).
 */
export function criarRepositorioPacotesSql(pool: pg.Pool): RepositorioPacotes {
  const q = async <R extends object>(sql: string, valores: unknown[] = []): Promise<R[]> => (await pool.query(sql, valores)).rows as R[];
  return {
    tenantsAtivos: async () => (await q<{ id: string }>('select id from plataforma.tenants_ativos()')).map((r) => r.id),
    lotesConcluidos: (tenants, desde) =>
      q(
        `select t.id as tenant_id, x.ultimo
           from unnest($1::uuid[]) as t (id)
           cross join lateral (select max(e.ocorrido_em) as ultimo from plataforma.evento e
                                where e.tenant_id = t.id and e.ocorrido_em > $2 and e.nome = $3) x
          where x.ultimo is not null`,
        [[...tenants], desde, EVENTO_LOTE_CONCLUIDO.nome],
      ),
    prontos: (f) =>
      'tenant_id' in f
        ? q(`select ${COLUNAS_PRONTO} from plataforma.sync_pacote where tenant_id = $1 and situacao = 'pronto' and deleted_at is null`, [f.tenant_id])
        : q(`select ${COLUNAS_PRONTO} from plataforma.sync_pacote where situacao = 'pronto' and deleted_at is null and created_at < $1`, [f.criadosAntes]),
    async pedir(p) {
      const filial = filialDaParticao(p.particao);
      await pool.query(
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, filial_id, origem, gerar_apos)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null
         do update set gerar_apos = greatest(plataforma.sync_pacote_pedido.gerar_apos, excluded.gerar_apos)
          where excluded.origem = 'lote' and excluded.gerar_apos > plataforma.sync_pacote_pedido.gerar_apos`,
        [p.tenant_id, p.modulo, p.particao, filial, p.origem, p.gerar_apos],
      );
    },
    pendentes: (agora, limite) =>
      q(
        `select ${COLUNAS_PEDIDO} from plataforma.sync_pacote_pedido
          where situacao = 'pendente' and deleted_at is null and gerar_apos <= $1 order by gerar_apos, id limit $2`,
        [agora, limite],
      ),
    pendente: async (id) =>
      (await q<PedidoPacote>(`select ${COLUNAS_PEDIDO} from plataforma.sync_pacote_pedido where id = $1 and situacao = 'pendente' and deleted_at is null`, [id]))[0] ??
      null,
    async travar(chave) {
      const c = await pool.connect();
      try {
        const r = await c.query<{ ok: boolean }>(SQL_TRAVA, [chave]);
        if (!r.rows[0]?.ok) {
          c.release();
          return null;
        }
      } catch (e) {
        c.release(true);
        throw e;
      }
      return {
        async liberar() {
          try {
            await c.query(SQL_DESTRAVA, [chave]);
            c.release();
          } catch {
            c.release(true); // conexão descartada: a trava de sessão some com ela
          }
        },
      };
    },
    async registrar(p) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(
          `update plataforma.sync_pacote set situacao = 'substituido', substituido_em = now()
            where tenant_id = $1 and modulo = $2 and particao = $3 and situacao = 'pronto' and deleted_at is null`,
          [p.tenant_id, p.modulo, p.particao],
        );
        await c.query(
          `insert into plataforma.sync_pacote (id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base,
             chave_armazenamento, bytes, md5, entidades)
           values ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11, $12::jsonb)`,
          [p.id, p.tenant_id, p.modulo, p.particao, filialDaParticao(p.particao), FORMATO_PACOTE_SYNC, p.horizonte, p.geracao_base, p.chave, p.bytes, p.md5, JSON.stringify(p.entidades)],
        );
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    async concluir(id, situacao, erro) {
      await pool.query(
        `update plataforma.sync_pacote_pedido set situacao = $2, atendido_em = now(), ultimo_erro = coalesce($3, ultimo_erro)
          where id = $1 and situacao = 'pendente'`,
        [id, situacao, erro ?? null],
      );
    },
    async adiar(id, erro, gerarApos) {
      await pool.query(
        `update plataforma.sync_pacote_pedido set tentativas = least(tentativas + 1, 100), ultimo_erro = $2, gerar_apos = $3
          where id = $1 and situacao = 'pendente'`,
        [id, erro, gerarApos],
      );
    },
    substituidos: async (antes) =>
      (
        await q<{ id: string; chave_armazenamento: string }>(
          `select id, chave_armazenamento from plataforma.sync_pacote where situacao = 'substituido' and substituido_em < $1 order by substituido_em limit 100`,
          [antes],
        )
      ).map((r) => ({ id: r.id, chave: r.chave_armazenamento })),
    async marcarApagado(id) {
      await pool.query(`update plataforma.sync_pacote set situacao = 'apagado', arquivo_apagado_em = now() where id = $1 and situacao = 'substituido'`, [id]);
    },
    async expurgar(antes) {
      const a = await pool.query(`delete from plataforma.sync_pacote where situacao = 'apagado' and arquivo_apagado_em < $1`, [antes]);
      const b = await pool.query(`delete from plataforma.sync_pacote_pedido where situacao <> 'pendente' and atendido_em < $1`, [antes]);
      return { pacotes: a.rowCount ?? 0, pedidos: b.rowCount ?? 0 };
    },
  };
}

// ---------- gerador ----------

export interface OpcoesGeradorPacotes {
  /** Banco do `macuxi_app` (`criarBancoApp`): licenças, `pacote.puxar` (RLS), horizonte e geração. */
  app: AcessoBanco & Pick<BancoApp, 'horizonteSync' | 'geracaoBase'>;
  repositorio: RepositorioPacotes;
  modulos: readonly ModuloApi[];
  armazenamento: ArmazenamentoPacotesSync;
  /** Pasta onde o `.sqlite` e o `.gz` são montados (apagados no fim). Padrão: a temporária do sistema. */
  dirTemp?: string;
  licencasNoTenant?: (tenantId: string) => Promise<LicencasTenant>;
  agora?: () => Date;
  log?: LogRota;
  /** Linhas por página (testes usam menos). */
  tamanhoPagina?: number;
}

export interface ResumoGerador {
  pedidos_lote: number;
  pedidos_agendados: number;
  gerados: number;
  atendidos_sem_gerar: number;
  descartados: number;
  ocupados: number;
  falhas: number;
  arquivos_apagados: number;
}

interface ParticaoDoTenant {
  modulo: ModuloApi;
  particao: ParticaoPacote;
}

interface TenantPreparado {
  licencas: LicencasTenant;
  efetivos: ModuloId[];
  particoes: ParticaoDoTenant[];
}

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Código curto do erro para `ultimo_erro` (sem dado pessoal). */
export function codigoDoErroGerador(e: unknown): string {
  if (e instanceof ErroGeradorPacote) return e.codigo;
  if (e instanceof ErroArmazenamentoS3) return `armazenamento_${e.status}`;
  const pgCodigo = (e as { code?: unknown }).code;
  if (typeof pgCodigo === 'string' && /^[0-9A-Z]{5}$/.test(pgCodigo)) return `banco_${pgCodigo}`;
  return 'erro';
}

export class ErroGeradorPacote extends Error {
  constructor(readonly codigo: 'sem_geracao' | 'sem_provedor') {
    super(`gerador de pacote: ${codigo}`);
    this.name = 'ErroGeradorPacote';
  }
}

/** Espera depois da n-ésima falha: 1, 2, 4... minutos, até 1 h. */
export const esperaDaFalha = (tentativas: number): number => Math.min(60, 2 ** Math.max(0, tentativas - 1)) * 60_000;

export function criarGeradorPacotes(op: OpcoesGeradorPacotes) {
  const relogio = op.agora ?? (() => new Date());
  const log = op.log ?? semLog;
  const pagina = op.tamanhoPagina ?? PAGINA_PACOTE;
  const manifestos = op.modulos.map((m) => m.manifesto);
  const instalados = manifestos.map((m) => m.id);
  const consultas = registroDeConsultas(op.modulos);
  const porModulo = provedoresDePacote(op.modulos);
  const fonteLicencas = op.licencasNoTenant ?? ((tenantId: string) => licencasDoTenantNoBanco(tenantId, op.app));
  const repo = op.repositorio;
  /** Último lote já tratado por tenant (ms): o mesmo lote não recalcula as partições a cada ciclo. */
  const lotesVistos = new Map<string, number>();
  let desdeLote: Date | null = null;
  let proximoAgendado = 0;

  const contexto = (tenantId: string, modulo: ModuloId, particao: ParticaoPacote, t: TenantPreparado, requestId = randomUUID()): ContextoPacote => {
    const campos = { tenant_id: tenantId, modulo, particao, request_id: requestId };
    const logPacote: LogRota = {
      info: (o, msg) => log.info({ ...campos, ...o }, msg),
      warn: (o, msg) => log.warn({ ...campos, ...o }, msg),
      error: (o, msg) => log.error({ ...campos, ...o }, msg),
    };
    const fuso = fusoDoTenantOuPadrao(t.licencas.fuso);
    const parametros = (m: ModuloId) => t.licencas.parametros[m] ?? {};
    return {
      tenantId,
      modulo,
      particao,
      requestId,
      agora: relogio,
      fuso: () => fuso,
      parametros: () => parametros(modulo),
      log: logPacote,
      comTenant: (fn) =>
        op.app.comTenant(tenantId, (db) =>
          fn(
            db,
            transacaoTenant(db, {
              manifestos,
              modulo,
              tenantId,
              usuarioId: null,
              requestId,
              agora: relogio,
              // ADR 0012: não há pessoa; a consulta recebe o usuário de sistema com os efetivos do tenant (como o agendador)
              usuario: { id: USUARIO_SISTEMA_ID, tenant_id: tenantId, perfil: 'admin', modulos: t.efetivos },
              modulosDoTenant: t.efetivos,
              consultas,
              parametros,
              fuso: () => fuso,
              log: logPacote,
            }),
          ),
        ),
    };
  };

  /** Licenças e partições do tenant (módulos efetivos com pacote; filiais de `filiaisDoTenant`). */
  async function prepararTenant(tenantId: string): Promise<TenantPreparado> {
    const licencas = await fonteLicencas(tenantId);
    const efetivos = modulosEfetivos({ manifestos, ativosNoTenant: licencas.ativosNoTenant, doPerfil: instalados });
    const t: TenantPreparado = { licencas, efetivos, particoes: [] };
    for (const [m, provs] of porModulo) {
      if (!efetivos.includes(m.manifesto.id)) continue;
      if (provs.some((p) => p.pacote!.particao === 'tenant')) t.particoes.push({ modulo: m, particao: 'tenant' });
      if (provs.some((p) => p.pacote!.particao === 'filial') && m.particoesPacote) {
        const filiais = await m.particoesPacote.filiaisDoTenant(contexto(tenantId, m.manifesto.id, 'tenant', t));
        for (const f of new Set(filiais.map((x) => x.toLowerCase()))) {
          try {
            t.particoes.push({ modulo: m, particao: particaoDeFilial(f) });
          } catch {
            log.warn({ tenant_id: tenantId, modulo: m.manifesto.id }, 'filial inválida ignorada no pacote');
          }
        }
      }
    }
    return t;
  }

  const provedoresDaParticao = (m: ModuloApi, particao: string): ProvedorSync[] =>
    (porModulo.get(m) ?? []).filter((p) => p.pacote!.particao === (particao === 'tenant' ? 'tenant' : 'filial'));

  /** Gera o arquivo da partição e registra o `pronto`. Devolve linhas e bytes para o log. */
  async function gerar(tenantId: string, alvo: ParticaoDoTenant, t: TenantPreparado): Promise<{ linhas: number; bytes: number }> {
    const modulo = alvo.modulo.manifesto.id;
    const provs = provedoresDaParticao(alvo.modulo, alvo.particao);
    if (provs.length === 0) throw new ErroGeradorPacote('sem_provedor');
    const geracao = await op.app.geracaoBase?.(tenantId);
    if (!geracao) throw new ErroGeradorPacote('sem_geracao');
    const horizonte = await op.app.horizonteSync();
    const ate = horizonte.toISOString();
    const limite = horizonte.getTime();
    const filial = filialDaParticao(alvo.particao);
    const ctx = contexto(tenantId, modulo, alvo.particao, t);
    const base = op.dirTemp ?? tmpdir();
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(join(base, 'macuxi-pacote-'));
    try {
      const arquivo = join(dir, 'pacote.sqlite');
      const contagens: Record<string, number> = {};
      const db = new DatabaseSync(arquivo);
      try {
        db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
        db.exec('CREATE TABLE _pacote (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
        for (const prov of provs) {
          const nome = prov.entidade.nome;
          if (!ENTIDADE_SYNC_RE.test(nome)) throw new Error(`entidade inválida no pacote: ${nome}`);
          const tabela = `ent_${nome}`;
          db.exec(`CREATE TABLE ${tabela} (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, dados TEXT NOT NULL) WITHOUT ROWID`);
          const inserir = db.prepare(`INSERT OR REPLACE INTO ${tabela} (id, updated_at, dados) VALUES (?, ?, ?)`);
          let desde: CursorSync | null = null;
          for (;;) {
            const brutas: LinhaSync[] = (await prov.pacote!.puxar(ctx, { desde, ate, limite: pagina, filial })).slice().sort(compararCursor);
            // defesa do pull: só vivas e dentro da janela, mesmo que o módulo erre o SQL
            const validas = brutas.filter((l) => !l.deleted_at && dentroDaJanela(l, desde, limite));
            db.exec('BEGIN');
            try {
              for (const l of validas) inserir.run(l.id, l.updated_at, JSON.stringify(l));
              db.exec('COMMIT');
            } catch (e) {
              db.exec('ROLLBACK');
              throw e;
            }
            const ultima = brutas[brutas.length - 1];
            if (brutas.length < pagina || !ultima || (desde && compararCursor(ultima, desde) <= 0)) break;
            desde = { updated_at: ultima.updated_at, id: ultima.id };
          }
          contagens[nome] = (db.prepare(`SELECT count(*) AS n FROM ${tabela}`).get() as { n: number }).n;
        }
        const meta: Record<string, string> = {
          formato: String(FORMATO_PACOTE_SYNC),
          tenant_id: tenantId,
          modulo,
          particao: alvo.particao,
          horizonte: ate,
          geracao_base: geracao,
          entidades: JSON.stringify(contagens),
        };
        const ins = db.prepare('INSERT INTO _pacote (chave, valor) VALUES (?, ?)');
        for (const [k, v] of Object.entries(meta)) ins.run(k, v);
        db.exec('VACUUM');
      } finally {
        db.close();
      }
      const gz = `${arquivo}.gz`;
      await pipeline(createReadStream(arquivo), createGzip({ level: 6 }), createWriteStream(gz));
      const md5 = createHash('md5');
      for await (const parte of createReadStream(gz)) md5.update(parte as Buffer);
      const bytes = (await stat(gz)).size;
      const id = randomUUID();
      const chave = chaveDoPacoteSync({ tenant_id: tenantId, modulo, particao: alvo.particao, id });
      await op.armazenamento.gravar(chave, gz);
      try {
        await repo.registrar({ id, tenant_id: tenantId, modulo, particao: alvo.particao, horizonte, geracao_base: geracao, chave, bytes, md5: md5.digest('hex'), entidades: contagens });
      } catch (e) {
        await op.armazenamento.remover(chave).catch(() => undefined);
        throw e;
      }
      return { linhas: Object.values(contagens).reduce((a, b) => a + b, 0), bytes };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Gatilho do lote do Hub: pedidos `lote` das partições com pacote mais velho que o último lote (ou sem pacote). */
  async function gatilhoLote(tenants: readonly string[], cache: Map<string, Promise<TenantPreparado>>, resumo: ResumoGerador) {
    const agora = relogio();
    const desde = desdeLote ?? new Date(agora.getTime() - JANELA_LOTE_INICIAL_MS);
    const lotes = await repo.lotesConcluidos(tenants, desde);
    desdeLote = new Date(agora.getTime() - FOLGA_LOTE_MS);
    for (const { tenant_id, ultimo } of lotes) {
      const ultimoMs = new Date(ultimo).getTime();
      if (lotesVistos.get(tenant_id) === ultimoMs) continue;
      try {
        const t = await obter(cache, tenant_id);
        const prontos = await repo.prontos({ tenant_id });
        for (const alvo of t.particoes) {
          const modulo = alvo.modulo.manifesto.id;
          const p = prontos.find((x) => x.modulo === modulo && x.particao === alvo.particao);
          if (p && new Date(p.horizonte).getTime() > ultimoMs) continue;
          await repo.pedir({ tenant_id, modulo, particao: alvo.particao, origem: 'lote', gerar_apos: new Date(ultimoMs + ESPERA_LOTE_MS) });
          resumo.pedidos_lote += 1;
        }
        lotesVistos.set(tenant_id, ultimoMs);
      } catch (e) {
        resumo.falhas += 1;
        log.warn({ tenant_id, erro: mensagemSegura(e) }, 'pacotes: gatilho do lote falhou');
      }
    }
  }

  /** Gatilho agendado: pacote com mais de 24 h e com mudança desde o horizonte. */
  async function gatilhoAgendado(ativos: ReadonlySet<string>, cache: Map<string, Promise<TenantPreparado>>, resumo: ResumoGerador) {
    const agora = relogio();
    if (agora.getTime() < proximoAgendado) return;
    proximoAgendado = agora.getTime() + INTERVALO_AGENDADO_MS;
    const velhos = await repo.prontos({ criadosAntes: new Date(agora.getTime() - IDADE_REGERAR_MS) });
    if (velhos.length === 0) return;
    const ate = (await op.app.horizonteSync()).toISOString();
    for (const p of velhos) {
      if (!ativos.has(p.tenant_id)) continue;
      try {
        const t = await obter(cache, p.tenant_id);
        const alvo = t.particoes.find((x) => x.modulo.manifesto.id === p.modulo && x.particao === p.particao);
        if (!alvo) continue;
        const ctx = contexto(p.tenant_id, alvo.modulo.manifesto.id, alvo.particao, t);
        const desde = { updated_at: new Date(p.horizonte).toISOString(), id: UUID_NIL };
        let mudou = false;
        for (const prov of provedoresDaParticao(alvo.modulo, alvo.particao)) {
          const linhas = await prov.pacote!.puxar(ctx, { desde, ate, limite: 1, filial: filialDaParticao(alvo.particao) });
          if (linhas.some((l) => dentroDaJanela(l, desde, Date.parse(ate)))) {
            mudou = true;
            break;
          }
        }
        if (!mudou) continue;
        await repo.pedir({ tenant_id: p.tenant_id, modulo: p.modulo, particao: p.particao, origem: 'agendado', gerar_apos: agora });
        resumo.pedidos_agendados += 1;
      } catch (e) {
        resumo.falhas += 1;
        log.warn({ tenant_id: p.tenant_id, modulo: p.modulo, particao: p.particao, erro: mensagemSegura(e) }, 'pacotes: gatilho agendado falhou');
      }
    }
  }

  const obter = (cache: Map<string, Promise<TenantPreparado>>, tenantId: string): Promise<TenantPreparado> => {
    let t = cache.get(tenantId);
    if (!t) {
      t = prepararTenant(tenantId);
      cache.set(tenantId, t);
    }
    return t;
  };

  /** Um pedido: trava, confere, gera (ou fecha sem gerar) e destrava. */
  async function atender(pedido: PedidoPacote, ativos: ReadonlySet<string>, cache: Map<string, Promise<TenantPreparado>>, resumo: ResumoGerador) {
    const campos = { tenant_id: pedido.tenant_id, modulo: pedido.modulo, particao: pedido.particao };
    const trava = await repo.travar(`sync-pacote:${pedido.tenant_id}:${pedido.modulo}:${pedido.particao}`);
    if (!trava) {
      resumo.ocupados += 1;
      return;
    }
    try {
      const atual = await repo.pendente(pedido.id);
      if (!atual) return; // outro worker atendeu entre a leitura e a trava
      try {
        const t = ativos.has(pedido.tenant_id) ? await obter(cache, pedido.tenant_id) : null;
        const alvo = t?.particoes.find((x) => x.modulo.manifesto.id === pedido.modulo && x.particao === pedido.particao);
        if (!t || !alvo) {
          await repo.concluir(pedido.id, 'descartado', 'fora_do_tenant');
          resumo.descartados += 1;
          return;
        }
        const geracao = await op.app.geracaoBase?.(pedido.tenant_id);
        const ja = (await repo.prontos({ tenant_id: pedido.tenant_id })).find((x) => x.modulo === pedido.modulo && x.particao === pedido.particao);
        if (ja && ja.geracao_base === geracao && new Date(ja.horizonte).getTime() > new Date(atual.updated_at).getTime()) {
          await repo.concluir(pedido.id, 'atendido');
          resumo.atendidos_sem_gerar += 1;
          return;
        }
        const inicio = Date.now();
        const r = await gerar(pedido.tenant_id, alvo, t);
        await repo.concluir(pedido.id, 'atendido');
        resumo.gerados += 1;
        log.info({ ...campos, origem: pedido.origem, linhas: r.linhas, bytes: r.bytes, duracao_ms: Date.now() - inicio }, 'pacote da primeira carga gerado');
      } catch (e) {
        resumo.falhas += 1;
        const codigo = codigoDoErroGerador(e);
        const tentativas = atual.tentativas + 1;
        log.warn({ ...campos, codigo, tentativas, erro: mensagemSegura(e) }, 'pacote da primeira carga não gerado');
        if (tentativas >= MAX_TENTATIVAS) {
          await repo.concluir(pedido.id, 'descartado', codigo);
          resumo.descartados += 1;
        } else await repo.adiar(pedido.id, codigo, new Date(relogio().getTime() + esperaDaFalha(tentativas)));
      }
    } finally {
      await trava.liberar();
    }
  }

  /** Retenção: apaga o arquivo do substituído há mais de 1 h e expurga linhas velhas. */
  async function retencao(resumo: ResumoGerador) {
    const agora = relogio().getTime();
    for (const s of await repo.substituidos(new Date(agora - RETER_SUBSTITUIDO_MS))) {
      try {
        await op.armazenamento.remover(s.chave);
        await repo.marcarApagado(s.id);
        resumo.arquivos_apagados += 1;
      } catch (e) {
        resumo.falhas += 1;
        log.warn({ pacote_id: s.id, erro: mensagemSegura(e) }, 'pacotes: arquivo substituído não apagado');
      }
    }
    await repo.expurgar(new Date(agora - EXPURGO_MS));
  }

  async function ciclo(): Promise<ResumoGerador> {
    const resumo: ResumoGerador = {
      pedidos_lote: 0,
      pedidos_agendados: 0,
      gerados: 0,
      atendidos_sem_gerar: 0,
      descartados: 0,
      ocupados: 0,
      falhas: 0,
      arquivos_apagados: 0,
    };
    if (porModulo.size === 0) return resumo;
    const tenants = await repo.tenantsAtivos();
    const ativos = new Set(tenants);
    // licenças e partições lidas uma vez por ciclo e por tenant
    const cache = new Map<string, Promise<TenantPreparado>>();
    const etapa = async (nome: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        resumo.falhas += 1;
        log.warn({ etapa: nome, erro: mensagemSegura(e) }, 'pacotes: etapa do ciclo falhou');
      }
    };
    await etapa('lote', () => gatilhoLote(tenants, cache, resumo));
    await etapa('agendado', () => gatilhoAgendado(ativos, cache, resumo));
    await etapa('pedidos', async () => {
      for (const p of await repo.pendentes(relogio(), PEDIDOS_POR_CICLO)) await atender(p, ativos, cache, resumo);
    });
    await etapa('retencao', () => retencao(resumo));
    return resumo;
  }

  return {
    /** Módulos com entidade no pacote. */
    modulos: (): readonly ModuloId[] => [...porModulo.keys()].map((m) => m.manifesto.id),
    ciclo,
    /** Laço: ciclo na subida e depois a cada `intervaloMs`. Erro do ciclo é logado e o laço segue. */
    iniciar({ intervaloMs }: { intervaloMs: number }): { parar(): Promise<void> } {
      return iniciarLaco({
        ciclo: async () => {
          await ciclo();
        },
        intervaloMs,
        aoFalhar: (e) => log.error({ erro: mensagemSegura(e) }, 'ciclo do gerador de pacotes falhou'),
      });
    },
  };
}
