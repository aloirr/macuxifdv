/**
 * Pacote pronto da primeira carga — rotas (ADR 0054; desenho `docs/desenho/T-catalogo-pacote.md` §1.2, §1.5 e §1.6):
 *   GET /v1/sync/pacotes              → `PacotesSyncResposta` (manifesto do usuário; links com validade curta)
 *   GET /v1/sync/pacotes/:id/arquivo  → bytes do `.sqlite.gz` com `Range` (só no driver `disco`: dev, CI, stack isolado)
 *
 * Escopo (o arquivo é igual para todos da partição; quem pode recebê-lo é decidido aqui, a cada pedido):
 * - sessão de usuário (`p.preparar`); **licença**: só módulos efetivos do usuário (RN-CORE-02/03);
 * - **perfil**: `pacote.permitido(ctx)` de cada provedor (RN-CAT-05: promotor sem preço não recebe a partição `filial`) e a
 *   regra do promotor para `pedido*` (RN-PRO-01, O-3), a mesma do pull; pacote com entidade que o usuário não pode ver não sai;
 * - **filial**: as partições `filial` são as de `particoesPacote.filiaisDoUsuario(ctx)` (RN-CORE-39); mais de
 *   `MAX_PARTICOES_PACOTE` (ou "todas") = sem pacote de filial (pull paginado). Tudo ou nada: se UMA filial do usuário não tem
 *   pacote pronto, nenhuma vai (o cursor da entidade sairia do horizonte de um pacote e pularia as linhas da filial sem pacote);
 * - **tenant**: `plataforma.sync_pacote` lida com RLS (`ctx.comTenant`, macuxi_app) e chave do armazenamento com o `tenant_id`;
 *   `:id` de outro tenant ou fora do escopo = 404.
 * - Só pacote da `geracao_base` atual (ADR 0021) e do `FORMATO_PACOTE_SYNC`. Partição sem pacote válido grava um pedido de
 *   geração (`plataforma.sync_pacote_pedido`, origem `manifesto`, idempotente por partição) e o aparelho segue no pull.
 * - Por entidade: `cursor` = `(horizonte, UUID nulo)` e a `versao_escopo` do usuário (mesma conta do pull, `sync.ts`).
 *
 * Desligado (`MACUXI_SYNC_PACOTES` ausente; `config.ts`), banco antes da 0074 ou sem pacote pronto: `{ pacotes: [] }`.
 * Log: só contagens, `tenant_id`, `modulo`, `particao` (uuid da filial, não é dado pessoal). Nunca a URL assinada.
 */
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  ACAO_VER_PEDIDO,
  codificarCursor,
  ehEntidadeDePedido,
  FORMATO_PACOTE_SYNC,
  MAX_PARTICOES_PACOTE,
  PacotesSyncRespostaSchema,
  particaoDeFilial,
  ROTA_SYNC_PACOTES,
  UUID_NIL,
  type ContextoBase,
  type ModuloApi,
  type ModuloId,
  type PacoteSync,
  type PacotesSyncResposta,
  type ParticaoPacote,
  type ProvedorSync,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { codigoDoErro, criarClienteS3, driverArquivosDoAmbiente, ErroArmazenamentoS3, type ClienteS3 } from './armazenamento-s3';
import { lerConfigSyncPacotes, syncPacotesLigados } from './config';
import { ErroHttp, semBanco } from './erros';
import { versaoEscopo } from './sync';
import type { Plataforma, RequisicaoPreparada } from './tipos';

// ---------- chave e armazenamento ----------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');
/** `sync-pacotes/<tenant_id>/<modulo>/<particao>/<id>.sqlite.gz` (mesmo CHECK da 0074): nada de `..` nem caminho absoluto. */
export const CHAVE_PACOTE_SYNC_RE = new RegExp(`^sync-pacotes/${UUID}/[a-z][a-z0-9-]*/(tenant|filial:${UUID})/${UUID}\\.sqlite\\.gz$`);

export function chaveDoPacoteSync(p: { tenant_id: string; modulo: string; particao: string; id: string }): string {
  const chave = `sync-pacotes/${p.tenant_id.toLowerCase()}/${p.modulo}/${p.particao.toLowerCase()}/${p.id.toLowerCase()}.sqlite.gz`;
  if (!CHAVE_PACOTE_SYNC_RE.test(chave)) throw new Error('chave de pacote de sync inválida');
  return chave;
}

/** Porta dos arquivos dos pacotes (S3 no servidor; disco no dev/CI). A chave é sempre conferida contra o formato fechado. */
export interface ArmazenamentoPacotesSync {
  readonly driver: 'disco' | 's3';
  /** Envia o arquivo local (`.sqlite.gz` montado pelo gerador) para a chave. */
  gravar(chave: string, arquivoLocal: string): Promise<void>;
  /** Ausente = ok. */
  remover(chave: string): Promise<void>;
  /** S3: GET pré-assinado (aceita `Range`). Disco: `null` (quem serve é a rota `/arquivo`, com a sessão). */
  link(chave: string, validadeS: number): { url: string; expiraEm: Date } | null;
  /** Disco: caminho absoluto do arquivo (a rota `/arquivo` lê com `Range`). S3: `null`. */
  caminhoLocal(chave: string): string | null;
}

const conferirChave = (chave: string) => {
  if (!CHAVE_PACOTE_SYNC_RE.test(chave)) throw new Error('chave de pacote de sync inválida');
};

/**
 * Disco: `<dir>/sync-pacotes/<tenant>/<modulo>/<particao>/<id>.sqlite.gz`, com `filial:` gravado como `filial_` (o `:` não é
 * nome de arquivo válido em todo sistema). Grava em temporário e renomeia (quem lê nunca vê meio arquivo).
 */
export function criarArmazenamentoPacotesSyncEmDisco(diretorio: string): ArmazenamentoPacotesSync {
  const raiz = resolve(diretorio);
  const caminho = (chave: string) => {
    conferirChave(chave);
    return join(raiz, ...chave.replace('/filial:', '/filial_').split('/'));
  };
  return {
    driver: 'disco',
    async gravar(chave, arquivoLocal) {
      const destino = caminho(chave);
      await mkdir(dirname(destino), { recursive: true });
      const tmp = `${destino}.${process.pid}.${Date.now()}.tmp`;
      await copyFile(arquivoLocal, tmp);
      await rename(tmp, destino);
    },
    async remover(chave) {
      await rm(caminho(chave), { force: true });
    },
    link: () => null,
    caminhoLocal: caminho,
  };
}

/** S3 (bucket privado das fotos, na raiz `sync-pacotes/`, ao lado de `pacotes/` e `backups/`; ADR 0037 para o link). */
export function criarArmazenamentoPacotesSyncS3(cliente: ClienteS3): ArmazenamentoPacotesSync {
  return {
    driver: 's3',
    async gravar(chave, arquivoLocal) {
      conferirChave(chave);
      const r = await cliente.chamar('PUT', chave, new Uint8Array(await readFile(arquivoLocal)), 'application/gzip');
      if (!r.ok) throw new ErroArmazenamentoS3('pacote', r.status, await codigoDoErro(r));
      await r.body?.cancel();
    },
    async remover(chave) {
      conferirChave(chave);
      const r = await cliente.chamar('DELETE', chave);
      if (!r.ok && r.status !== 404) throw new ErroArmazenamentoS3('pacote', r.status, await codigoDoErro(r));
      await r.body?.cancel();
    },
    link(chave, validadeS) {
      conferirChave(chave);
      return cliente.urlPreAssinada(chave, validadeS);
    },
    caminhoLocal: () => null,
  };
}

/** Upload de até dezenas de MB: prazo maior que o das fotos. */
const TIMEOUT_S3_PACOTE_MS = 120_000;

/**
 * Armazenamento pelo ambiente (o mesmo `MACUXI_ARQUIVOS_DRIVER` das fotos): `disco` em `MACUXI_ARQUIVOS_DIR`; `s3` com as
 * `MACUXI_S3_*` (falta = erro com o NOME da variável). API e worker precisam ver o mesmo lugar (no disco, a mesma máquina).
 */
export function armazenamentoPacotesSyncDoAmbiente(env: NodeJS.ProcessEnv): { armazenamento: ArmazenamentoPacotesSync; descricao: string } {
  const d = driverArquivosDoAmbiente(env);
  if (d.driver === 'disco') return { armazenamento: criarArmazenamentoPacotesSyncEmDisco(d.dir), descricao: 'disco' };
  const { cfg } = d;
  return {
    armazenamento: criarArmazenamentoPacotesSyncS3(criarClienteS3({ ...cfg, timeoutMs: TIMEOUT_S3_PACOTE_MS })),
    descricao: `s3 ${cfg.bucket}/sync-pacotes/`,
  };
}

// ---------- fonte (plataforma.sync_pacote, com RLS) ----------

export interface LinhaPacoteSync {
  id: string;
  tenant_id: string;
  modulo: string;
  particao: string;
  formato: number;
  situacao: 'pronto' | 'substituido' | 'apagado';
  horizonte: Date;
  geracao_base: string;
  chave_armazenamento: string;
  bytes: number;
  md5: string;
  /** `{ nome: linhas }`. */
  entidades: Record<string, number>;
}

/** Leitura dos pacotes e pedido de geração, sempre no tenant da sessão (macuxi_app, RLS). Testes injetam a sua. */
export interface FontePacotesSync {
  /** Pacotes `pronto` vivos dos módulos. */
  prontos(ctx: ContextoBase, modulos: readonly string[]): Promise<LinhaPacoteSync[]>;
  /** Um pacote pelo id (qualquer situação); outro tenant = `null` (RLS). */
  porId(ctx: ContextoBase, id: string): Promise<LinhaPacoteSync | null>;
  /** Pedido de geração (origem `manifesto`); idempotente por partição (um pendente vivo). */
  pedir(ctx: ContextoBase, particoes: readonly { modulo: string; particao: string }[]): Promise<void>;
}

const COLUNAS_PACOTE = `id, tenant_id, modulo, particao, formato, situacao, horizonte, geracao_base::text as geracao_base,
  chave_armazenamento, bytes, md5, entidades`;

type LinhaBruta = Omit<LinhaPacoteSync, 'bytes' | 'horizonte'> & { bytes: string | number; horizonte: Date | string };
const daLinha = (r: LinhaBruta): LinhaPacoteSync => ({ ...r, bytes: Number(r.bytes), horizonte: new Date(r.horizonte) });

export const fontePacotesSyncNoBanco: FontePacotesSync = {
  prontos: (ctx, modulos) =>
    ctx.comTenant(async (db) =>
      (
        await db.query<LinhaBruta>(
          `select ${COLUNAS_PACOTE} from plataforma.sync_pacote
            where tenant_id = $1 and situacao = 'pronto' and deleted_at is null and modulo = any($2::text[])`,
          [ctx.usuario.tenant_id, [...modulos]],
        )
      ).rows.map(daLinha),
    ),
  porId: (ctx, id) =>
    ctx.comTenant(async (db) => {
      const r = await db.query<LinhaBruta>(
        `select ${COLUNAS_PACOTE} from plataforma.sync_pacote where tenant_id = $1 and id = $2 and deleted_at is null`,
        [ctx.usuario.tenant_id, id],
      );
      return r.rows[0] ? daLinha(r.rows[0]) : null;
    }),
  pedir: (ctx, particoes) =>
    ctx.comTenant(async (db) => {
      await db.query(
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, filial_id, origem)
         select $1::uuid, x.modulo, x.particao, x.filial_id, 'manifesto'
           from unnest($2::text[], $3::text[], $4::uuid[]) as x (modulo, particao, filial_id)
         on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do nothing`,
        [
          ctx.usuario.tenant_id,
          particoes.map((x) => x.modulo),
          particoes.map((x) => x.particao),
          particoes.map((x) => (x.particao.startsWith('filial:') ? x.particao.slice('filial:'.length) : null)),
        ],
      );
    }),
};

// ---------- escopo do usuário ----------

/** O que o usuário pode receber de um módulo: entidades por tipo de partição e as filiais (já conferidas). */
export interface PlanoModuloPacote {
  modulo: ModuloId;
  ctx: ContextoBase;
  /** Entidades da partição `tenant` que o usuário pode ver (vazio = nenhuma). */
  tenant: ReadonlyMap<string, ProvedorSync>;
  /** Entidades das partições `filial`; `null` = sem pacote de filial (sem permissão, sem filial ou "todas"). */
  filial: { provedores: ReadonlyMap<string, ProvedorSync>; filiais: readonly ParticaoPacote[] } | null;
}

/** Provedores com pacote, por módulo (só escopo `tenant`, como exige `definirModuloApi`). */
export function provedoresDePacote(modulos: readonly ModuloApi[]): Map<ModuloApi, ProvedorSync[]> {
  const r = new Map<ModuloApi, ProvedorSync[]>();
  for (const m of modulos) {
    const ps = (m.sync ?? []).filter((p) => p.pacote && p.puxar && p.escopo === 'tenant');
    if (ps.length > 0) r.set(m, ps);
  }
  return r;
}

/**
 * Plano do usuário da sessão: só módulos efetivos (licença), `permitido` de cada provedor, regra do promotor para `pedido*`
 * e filiais da carteira (`filiaisDoUsuario`, até `MAX_PARTICOES_PACOTE`).
 */
export async function planoDoUsuario(
  p: Pick<Plataforma, 'permissoes'>,
  porModulo: ReadonlyMap<ModuloApi, readonly ProvedorSync[]>,
  prep: RequisicaoPreparada,
): Promise<PlanoModuloPacote[]> {
  const u = prep.ctx.usuario;
  const verPedido = p.permissoes.pode(ACAO_VER_PEDIDO, { perfil: u.perfil, modulosAtivos: u.modulos });
  const planos: PlanoModuloPacote[] = [];
  for (const [m, provs] of porModulo) {
    const modulo = m.manifesto.id;
    if (!u.modulos.includes(modulo)) continue;
    const ctx = prep.doModulo(modulo);
    const tenant = new Map<string, ProvedorSync>();
    const filial = new Map<string, ProvedorSync>();
    for (const prov of provs) {
      if (u.perfil === 'promotor' && ehEntidadeDePedido(prov.entidade.nome) && !verPedido) continue;
      if (prov.pacote!.permitido && !(await prov.pacote!.permitido(ctx))) continue;
      (prov.pacote!.particao === 'tenant' ? tenant : filial).set(prov.entidade.nome, prov);
    }
    let filiais: ParticaoPacote[] | null = null;
    if (filial.size > 0 && m.particoesPacote) {
      const lista = await m.particoesPacote.filiaisDoUsuario(ctx);
      if (lista && lista.length > 0 && lista.length <= MAX_PARTICOES_PACOTE && lista.every((f) => UUID_RE.test(f)))
        filiais = [...new Set(lista.map((f) => particaoDeFilial(f.toLowerCase())))];
    }
    if (tenant.size === 0 && !filiais) continue;
    planos.push({ modulo, ctx, tenant, filial: filiais ? { provedores: filial, filiais } : null });
  }
  return planos;
}

/** Entidades que o usuário pode receber na partição (`null` = partição fora do plano dele). */
export function entidadesDaParticao(plano: PlanoModuloPacote, particao: string): ReadonlyMap<string, ProvedorSync> | null {
  if (particao === 'tenant') return plano.tenant.size > 0 ? plano.tenant : null;
  return plano.filial?.filiais.includes(particao as ParticaoPacote) ? plano.filial.provedores : null;
}

type Avaliacao = { ok: true; linha: LinhaPacoteSync } | { ok: false; pedir: boolean };

/** O pacote pronto da partição serve ao usuário? Faltando ou velho = pedir outro; com entidade que ele não vê = não serve. */
function avaliar(linha: LinhaPacoteSync | undefined, permitidas: ReadonlyMap<string, ProvedorSync>, geracao: string): Avaliacao {
  if (!linha || linha.formato !== FORMATO_PACOTE_SYNC || linha.geracao_base !== geracao) return { ok: false, pedir: true };
  const nomes = Object.keys(linha.entidades);
  if (nomes.length === 0 || !nomes.every((n) => permitidas.has(n))) return { ok: false, pedir: false };
  return { ok: true, linha };
}

/** Código SQLSTATE de tabela ausente (banco antes da 0074). */
const TABELA_INEXISTENTE = '42P01';

// ---------- Range ----------

/** Faixa de bytes pedida (`Range: bytes=a-b`, `a-` ou `-n`); `null` = sem Range; `'invalida'` = 416. Só uma faixa. */
export function lerFaixa(cabecalho: string | undefined, tamanho: number): { inicio: number; fim: number } | null | 'invalida' {
  if (!cabecalho) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalida';
  let inicio: number;
  let fim: number;
  if (m[1] === '') {
    const sufixo = Number(m[2]);
    if (sufixo === 0) return 'invalida';
    inicio = Math.max(0, tamanho - sufixo);
    fim = tamanho - 1;
  } else {
    inicio = Number(m[1]);
    fim = m[2] === '' ? tamanho - 1 : Math.min(Number(m[2]), tamanho - 1);
  }
  if (!Number.isSafeInteger(inicio) || inicio >= tamanho || fim < inicio) return 'invalida';
  return { inicio, fim };
}

// ---------- rotas ----------

export interface OpcoesSyncPacotes {
  armazenamento: ArmazenamentoPacotesSync;
  /** Validade do link (s), `MACUXI_SYNC_PACOTES_VALIDADE_S`. */
  validadeS: number;
  /** Padrão: `fontePacotesSyncNoBanco`. */
  fonte?: FontePacotesSync;
}

/** Opções pelo ambiente: `null` sem `MACUXI_SYNC_PACOTES=1` (padrão). Variável inválida = erro na subida. */
export function syncPacotesDoAmbiente(env: NodeJS.ProcessEnv): (OpcoesSyncPacotes & { descricao: string }) | null {
  if (!syncPacotesLigados(env)) return null;
  const { validadeS } = lerConfigSyncPacotes(env);
  const { armazenamento, descricao } = armazenamentoPacotesSyncDoAmbiente(env);
  return { armazenamento, validadeS, descricao: `${descricao} (link ${validadeS} s)` };
}

export function registrarSyncPacotes(app: FastifyInstance, p: Plataforma, op: OpcoesSyncPacotes | null): void {
  const porModulo = provedoresDePacote(p.modulos);
  const fonte = op?.fonte ?? fontePacotesSyncNoBanco;

  app.get(ROTA_SYNC_PACOTES, async (req, reply): Promise<PacotesSyncResposta> => {
    const prep = await p.preparar(req, null);
    void reply.header('cache-control', 'no-store'); // os links são segredos de curta duração
    if (!op || porModulo.size === 0) return { pacotes: [] };
    if (!p.banco) semBanco();
    const { ctx } = prep;
    const planos = await planoDoUsuario(p, porModulo, prep);
    if (planos.length === 0) return { pacotes: [] };
    const geracao = await p.banco.geracaoBase?.(ctx.usuario.tenant_id);
    if (!geracao) return { pacotes: [] }; // sem geração conhecida o aparelho não confere o pacote (ADR 0021)
    let linhas: LinhaPacoteSync[];
    try {
      linhas = await fonte.prontos(ctx, planos.map((x) => x.modulo));
    } catch (e) {
      if ((e as { code?: unknown }).code !== TABELA_INEXISTENTE) throw e;
      ctx.log.warn({ operacao: 'sync_pacotes' }, 'pacotes da primeira carga sem a migração 0074: manifesto vazio');
      return { pacotes: [] };
    }
    const pronto = (modulo: string, particao: string) => linhas.find((l) => l.modulo === modulo && l.particao === particao);
    const oferecidos: { plano: PlanoModuloPacote; linha: LinhaPacoteSync; provedores: ReadonlyMap<string, ProvedorSync> }[] = [];
    const pedir: { modulo: string; particao: string }[] = [];
    for (const plano of planos) {
      if (plano.tenant.size > 0) {
        const a = avaliar(pronto(plano.modulo, 'tenant'), plano.tenant, geracao);
        if (a.ok) oferecidos.push({ plano, linha: a.linha, provedores: plano.tenant });
        else if (a.pedir) pedir.push({ modulo: plano.modulo, particao: 'tenant' });
      }
      if (plano.filial) {
        const grupo = plano.filial.filiais.map((particao) => ({ particao, a: avaliar(pronto(plano.modulo, particao), plano.filial!.provedores, geracao) }));
        for (const g of grupo) if (!g.a.ok && g.a.pedir) pedir.push({ modulo: plano.modulo, particao: g.particao });
        // tudo ou nada: a entidade recebe o cursor do pacote; uma filial sem pacote ficaria para trás do cursor
        if (grupo.every((g) => g.a.ok))
          for (const g of grupo) if (g.a.ok) oferecidos.push({ plano, linha: g.a.linha, provedores: plano.filial.provedores });
      }
    }
    if (pedir.length > 0)
      await fonte.pedir(ctx, pedir).catch((e: unknown) =>
        ctx.log.warn({ operacao: 'sync_pacotes', particoes: pedir.length, codigo: (e as { code?: unknown }).code ?? null }, 'pedido de pacote não gravado'),
      );
    const agora = p.relogio();
    const pacotes: PacoteSync[] = [];
    for (const { plano, linha, provedores } of oferecidos) {
      const link = op.armazenamento.link(linha.chave_armazenamento, op.validadeS) ?? {
        url: `${ROTA_SYNC_PACOTES}/${linha.id}/arquivo`,
        expiraEm: new Date(agora.getTime() + op.validadeS * 1000),
      };
      const horizonte = linha.horizonte.toISOString();
      const cursor = codificarCursor({ updated_at: horizonte, id: UUID_NIL });
      const entidades = [];
      for (const [nome, n] of Object.entries(linha.entidades)) {
        // a mesma conta do pull (escopo `tenant`, o único com pacote: só a `variacaoEscopo` entra)
        const versao = await versaoEscopo(provedores.get(nome)!, plano.ctx);
        entidades.push({ nome, linhas: n, cursor, ...(versao !== undefined ? { versao_escopo: versao } : {}) });
      }
      pacotes.push({
        id: linha.id,
        modulo: plano.modulo,
        particao: linha.particao as ParticaoPacote,
        horizonte,
        bytes: linha.bytes,
        md5: linha.md5,
        url: link.url,
        expira_em: link.expiraEm.toISOString(),
        entidades,
      });
    }
    if (pacotes.length > 0 || pedir.length > 0)
      ctx.log.info({ operacao: 'sync_pacotes', oferecidos: pacotes.length, pedidos: pedir.length }, 'manifesto de pacotes');
    return PacotesSyncRespostaSchema.parse({ geracao_base: geracao, pacotes });
  });

  // driver `disco`: o arquivo sai pela API com a sessão (no S3 o link pré-assinado vai direto ao bucket)
  if (!op || op.armazenamento.driver !== 'disco') return;
  const armazenamento = op.armazenamento;
  app.get(`${ROTA_SYNC_PACOTES}/:id/arquivo`, async (req, reply) => {
    const prep = await p.preparar(req, null);
    const naoEncontrado = () => new ErroHttp(404, 'PACOTE_NAO_ENCONTRADO', 'Pacote não encontrado.');
    const id = (req.params as { id?: string }).id ?? '';
    if (!UUID_RE.test(id)) throw naoEncontrado();
    if (!p.banco) semBanco();
    const linha = await fonte.porId(prep.ctx, id.toLowerCase());
    if (!linha || linha.situacao === 'apagado') throw naoEncontrado();
    // mesma checagem do manifesto: módulo efetivo, permissão e filial da carteira, e nenhuma entidade que ele não veja
    const plano = (await planoDoUsuario(p, porModulo, prep)).find((x) => x.modulo === linha.modulo);
    const permitidas = plano ? entidadesDaParticao(plano, linha.particao) : null;
    if (!permitidas || !Object.keys(linha.entidades).every((n) => permitidas.has(n))) throw naoEncontrado();
    const caminho = armazenamento.caminhoLocal(linha.chave_armazenamento);
    const tamanho = caminho ? await stat(caminho).then((s) => s.size, () => null) : null;
    if (!caminho || tamanho === null) throw naoEncontrado();
    const faixa = lerFaixa(req.headers.range, tamanho);
    void reply.header('cache-control', 'no-store').header('accept-ranges', 'bytes').type('application/gzip');
    if (faixa === 'invalida') {
      void reply.code(416).header('content-range', `bytes */${tamanho}`);
      return reply.send();
    }
    if (!faixa) {
      void reply.header('content-length', String(tamanho));
      return reply.send(createReadStream(caminho));
    }
    void reply
      .code(206)
      .header('content-range', `bytes ${faixa.inicio}-${faixa.fim}/${tamanho}`)
      .header('content-length', String(faixa.fim - faixa.inicio + 1));
    return reply.send(createReadStream(caminho, { start: faixa.inicio, end: faixa.fim }));
  });
}
