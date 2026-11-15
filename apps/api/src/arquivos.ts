/**
 * Arquivos enviados pelo aparelho (ADR 0010; desenho T-0016 §1 E4) — rotas de plataforma, como `/v1/sync/*`:
 *   PUT /v1/arquivos/:id  corpo `image/jpeg` cru (sem multipart), até 2 MB → completa a linha `aguardando`
 *   GET /v1/arquivos/:id  devolve os bytes (licença do módulo, perfil e carteira do `cliente_id`; foto de produto vale para o tenant;
 *       com `perfis_leitura`, ADR 0041, também um perfil da lista, e a resposta sai com `no-store`)
 *       foto do perfil (`core/avatar`, T-0170, RN-CORE-42) vale para o tenant; foto de tarefa sem cliente (`core/tarefa`) só
 *       para quem enviou e para quem tem `tarefa.acompanhar` e enxerga quem enviou
 *   GET /v1/arquivos/:id/miniatura  versão reduzida (T-0097 b: maior lado 320 px, até 30 KB) com a MESMA regra de acesso;
 *       gerada na 1ª leitura e guardada ao lado do original (`<id>.m320.jpg`; `miniatura.ts`)
 *
 * Quem CRIA a linha em `plataforma.arquivo` é o módulo, na transação do comando que referencia a foto
 * (`tx.registrarArquivo`, `outbox.ts`). O upload só completa uma linha do mesmo tenant (RLS) e do mesmo usuário:
 *   - sem linha (o push ainda não chegou) → 409 ARQUIVO_SEM_REFERENCIA (retentável no aparelho);
 *   - já recebido com o mesmo sha256 → 200 (idempotente pelo UUID do aparelho); sha256 diferente → 409 ARQUIVO_DIVERGENTE;
 *   - corpo que não é JPEG (FF D8 FF) ou vazio → 400 ARQUIVO_INVALIDO; acima de 2 MB → 413 ARQUIVO_GRANDE_DEMAIS;
 *     outro Content-Type → 415 TIPO_NAO_ACEITO; teto menor da categoria (`TETO_POR_CATEGORIA`) → 422 com o código da RN.
 * A autenticação roda ANTES de ler o corpo (gancho `onRequest`): sem sessão, 401 sem receber os 2 MB.
 * Os bytes ficam atrás da porta `ArmazenamentoArquivos`: disco local em `MACUXI_ARQUIVOS_DIR` (dev, CI) ou objeto S3
 * (`armazenamento-s3.ts`, ADR 0020; `MACUXI_ARQUIVOS_DRIVER=s3`).
 * Log sem dado pessoal: só id, tamanho e tempo.
 *
 * ADR 0054 (T-0174, RN-CAT-14): arquivo grande (o ZIP do lote de fotos, `application/zip`) vai em PARTES de 8 MiB:
 *   PUT  /v1/arquivos/:id/partes/:n   corpo `application/octet-stream` (1 byte a 8 MiB) → objeto `<id>.pNNN.zip` (sobrescreve)
 *   GET  /v1/arquivos/:id/partes/:n/url-envio  PUT pré-assinado da mesma chave (só S3 + `MACUXI_ENVIO_URL_ASSINADA=1`)
 *   POST /v1/arquivos/:id/concluir    confere os tamanhos das partes e marca `recebido` (sem sha256: o trabalho calcula)
 * Mesmas regras do PUT da foto (sessão antes do corpo, dono, tenant, licença do módulo da linha, `aguardando`); a 1ª parte
 * fixa a `chave_armazenamento` (a da parte 1), e as outras saem dela. O ZIP nunca é servido pelo GET (404).
 * Os bytes da parte vão ao armazenamento FORA da transação (T-0121: rede fora do banco).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  CODIGOS_ARQUIVO,
  ConcluirEnvioSchema,
  conferirPartes,
  dimensoesJpeg,
  ehJpeg,
  EXTENSAO_POR_TIPO,
  LIMITE_ARQUIVO_BYTES,
  LIMITES_ZIP_TETO,
  megabytesParaMensagem,
  PARTE_ENVIO_BYTES,
  PARTES_ENVIO_MAX,
  partesDoEnvio,
  perfilLeArquivo,
  ROTA_ARQUIVOS,
  verificarAcao,
  verificarAcesso,
  verificarCarteira,
  type InfoArquivo,
  type TipoImagem,
  type UrlEnvio,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ehPrintDeDiagnostico } from './diagnosticos';
import { ErroHttp } from './erros';
import { miniaturaDeImagem } from './decodificadores';
import { chaveDaMiniatura, ErroMiniatura } from './miniatura';
import type { Plataforma, RequisicaoPreparada } from './tipos';

// ---------- porta e adaptador de disco ----------

/**
 * Porta dos bytes (ADR 0010 §3). A chave é `<tenant_id>/<modulo>/<aaaa-mm>/<id>.<ext>`: `.jpg|.png|.webp` (original),
 * `.m320.jpg` (miniatura) ou `.pNNN.zip` (parte do ZIP, ADR 0054).
 */
export interface ArmazenamentoArquivos {
  gravar(chave: string, bytes: Uint8Array): Promise<void>;
  /** `null` = não existe. */
  ler(chave: string): Promise<Uint8Array | null>;
  remover(chave: string): Promise<void>;
  /** Bytes do objeto sem lê-lo (disco: `stat`; S3: `HEAD`). `null` = não existe. */
  tamanho(chave: string): Promise<number | null>;
  /** Só S3: URL de PUT pré-assinado da chave por `validadeS` segundos (ADR 0054 §1). Ausente = o driver não oferece. */
  urlEnvio?(chave: string, validadeS: number): { url: string; expiraEm: Date };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');
/** Formato fechado da chave: nada de `..`, barra invertida ou caminho absoluto chega ao disco. */
export const CHAVE_ARQUIVO_RE = new RegExp(`^${UUID}/[a-z][a-z0-9-]*/\\d{4}-\\d{2}/${UUID}(\\.m320\\.jpg|\\.jpg|\\.png|\\.webp|\\.p\\d{3}\\.zip)$`);
const CHAVE_RE = CHAVE_ARQUIVO_RE;

/** Chave do original (`.jpg` por padrão; PNG e WEBP da foto do lote guardam a extensão do tipo). */
export function chaveDoArquivo(a: { tenant_id: string; modulo: string; id: string }, quando: Date, tipo: TipoImagem = 'image/jpeg'): string {
  const mes = quando.toISOString().slice(0, 7);
  const chave = `${a.tenant_id.toLowerCase()}/${a.modulo}/${mes}/${a.id.toLowerCase()}.${EXTENSAO_POR_TIPO[tipo]}`;
  if (!CHAVE_RE.test(chave)) throw new Error('chave de arquivo inválida');
  return chave;
}

/** Chave da parte 1 do arquivo enviado em partes (`<...>/<id>.p001.zip`); as outras saem dela (`chaveDaParte`). */
export function chaveDaParte1(a: { tenant_id: string; modulo: string; id: string }, quando: Date): string {
  const mes = quando.toISOString().slice(0, 7);
  const chave = `${a.tenant_id.toLowerCase()}/${a.modulo}/${mes}/${a.id.toLowerCase()}.p001.zip`;
  if (!CHAVE_RE.test(chave)) throw new Error('chave de arquivo inválida');
  return chave;
}

/** Chave da parte `n` (1..`PARTES_ENVIO_MAX`) a partir da chave da parte 1. */
export function chaveDaParte(chaveParte1: string, n: number): string {
  const m = /^(.*)\.p001\.zip$/.exec(chaveParte1);
  if (!m || !CHAVE_RE.test(chaveParte1) || !Number.isInteger(n) || n < 1 || n > PARTES_ENVIO_MAX) throw new Error('parte de arquivo inválida');
  return `${m[1]}.p${String(n).padStart(3, '0')}.zip`;
}

/** `content-type` do original pela chave (o GET responde com o tipo guardado). */
export function tipoDaChave(chave: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  return chave.endsWith('.png') ? 'image/png' : chave.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

/** Diretório padrão (fora do git: `.dados/` no .gitignore). */
export const DIR_ARQUIVOS_PADRAO = './.dados/arquivos';

/**
 * Adaptador de disco local (dev, CI e a primeira implantação). Grava em arquivo temporário e renomeia (quem lê nunca
 * vê meio arquivo). A chave é conferida contra o formato fechado antes de virar caminho.
 */
export function criarArmazenamentoEmDisco(diretorio: string): ArmazenamentoArquivos {
  const raiz = resolve(diretorio);
  const caminho = (chave: string) => {
    if (!CHAVE_RE.test(chave)) throw new Error('chave de arquivo inválida');
    return join(raiz, ...chave.split('/'));
  };
  return {
    async gravar(chave, bytes) {
      const destino = caminho(chave);
      await mkdir(dirname(destino), { recursive: true });
      const tmp = `${destino}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, destino);
    },
    async ler(chave) {
      try {
        return new Uint8Array(await readFile(caminho(chave)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async remover(chave) {
      await rm(caminho(chave), { force: true });
    },
    async tamanho(chave) {
      try {
        return (await stat(caminho(chave))).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

/** Armazenamento em memória (testes). */
export function criarArmazenamentoEmMemoria(): ArmazenamentoArquivos & { chaves(): string[] } {
  const m = new Map<string, Uint8Array>();
  return {
    async gravar(chave, bytes) {
      if (!CHAVE_RE.test(chave)) throw new Error('chave de arquivo inválida');
      m.set(chave, new Uint8Array(bytes));
    },
    ler: async (chave) => m.get(chave) ?? null,
    remover: async (chave) => void m.delete(chave),
    tamanho: async (chave) => m.get(chave)?.length ?? null,
    chaves: () => [...m.keys()],
  };
}

// ---------- rotas ----------

interface LinhaArquivo {
  modulo: string;
  /** ADR 0054: o ZIP (`application/zip`) nunca é servido; o resto responde com o tipo do original. */
  tipo?: string;
  finalidade: string;
  enviado_por: string;
  situacao: 'aguardando' | 'recebido';
  sha256: string | null;
  tamanho_bytes: number | null;
  cliente_id: string | null;
  chave_armazenamento: string | null;
  /** ADR 0041: `null` = regra de sempre; lista = também um destes perfis (só no GET). */
  perfis_leitura?: string[] | null;
}

/**
 * Arquivos SEM cliente que valem para o tenant inteiro (`<modulo>/<finalidade>`): quem tem a licença e o perfil do módulo
 * lê, não importa quem enviou. Foto de produto (T-0097): sobe pelo gerente/analista e aparece na miniatura do vendedor e do
 * promotor (RN-CAT-04: todos os perfis consultam o catálogo). As demais fotos sem cliente seguem os usuários visíveis.
 */
export const ARQUIVOS_DO_TENANT: ReadonlySet<string> = new Set([
  'catalogo/foto_produto',
  // T-0170 (RN-CORE-42, decisão D4): a foto do perfil é lida por todo usuário do tenant com o Core, como um crachá; sem isto,
  // a foto enviada pelo BKO ficaria invisível para o próprio vendedor
  'core/avatar',
]);

/**
 * Foto de tarefa (T-0170; desenho `tarefas-consultor.md` §6.3). Com cliente vale a carteira, como toda foto de cliente; sem
 * cliente, só quem enviou (o destinatário) ou quem tem a ação abaixo e enxerga quem enviou (o autor e o acompanhamento do BKO).
 */
export const CATEGORIA_FOTO_TAREFA = 'core/tarefa';
export const ACAO_ACOMPANHAR_TAREFA = 'tarefa.acompanhar';

/**
 * Teto menor que o da rota (2 MB, ADR 0010) por `<modulo>/<finalidade>`, conferido no PUT depois de achar a linha: acima dele,
 * 422 com o código da RN (a foto não vira um arquivo de câmera cheio).
 * `core/avatar` = `AVATAR_FOTO_MAX_BYTES` de `modules/core/contracts/avatar.ts` (RN-CORE-42: JPEG 480×640, qualidade 80).
 */
export const TETO_POR_CATEGORIA: ReadonlyMap<string, { bytes: number; codigo: string; mensagem: string }> = new Map([
  ['core/avatar', { bytes: 300 * 1024, codigo: 'RN-CORE-42', mensagem: 'A foto do perfil passa de 300 KB. Tire ou escolha a foto de novo.' }],
]);

/** Teto do arquivo enviado em partes quando a categoria não tem o seu: o do ZIP (`LIMITES_ZIP_TETO.bytesZipMax`, 500 MiB). */
export const TETO_ENVIO_EM_PARTES_PADRAO = LIMITES_ZIP_TETO.bytesZipMax;
const MB_ENVIO_EM_PARTES = megabytesParaMensagem(TETO_ENVIO_EM_PARTES_PADRAO);

/**
 * ADR 0054: teto do arquivo enviado em partes por `<modulo>/<finalidade>`, conferido no `concluir` (413 com o código da RN).
 * `catalogo/foto_lote` = `LIMITES_ZIP_TETO.bytesZipMax` do SDK (RN-CAT-14).
 */
export const TETO_ENVIO_EM_PARTES: ReadonlyMap<string, { bytes: number; codigo: string; mensagem: string }> = new Map([
  [
    'catalogo/foto_lote',
    { bytes: TETO_ENVIO_EM_PARTES_PADRAO, codigo: 'RN-CAT-14', mensagem: `O ZIP passa de ${MB_ENVIO_EM_PARTES} MB. Divida as fotos em mais de um ZIP.` },
  ],
]);

/** Validade da URL assinada de envio (15 min). */
export const VALIDADE_URL_ENVIO_S = 900;

const indisponivel = () =>
  new ErroHttp(503, 'ARMAZENAMENTO_INDISPONIVEL', 'Armazenamento de arquivos indisponível. Tente de novo em instantes.');

function idDaRota(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new ErroHttp(400, 'VALIDACAO', 'Informe o id do arquivo (UUID gerado no aparelho).');
  return id.toLowerCase();
}

function moduloInativo(modulo: string): ErroHttp {
  return new ErroHttp(403, 'MODULO_INATIVO', `O módulo ${modulo} não está ativo para você. Fale com o administrador da sua empresa.`, { modulo });
}

const tipoDoPedido = (req: FastifyRequest) => req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();

function parteDaRota(req: FastifyRequest): number {
  const n = (req.params as { n?: unknown }).n;
  const v = typeof n === 'string' && /^\d{1,2}$/.test(n) ? Number(n) : NaN;
  if (!(v >= 1 && v <= PARTES_ENVIO_MAX))
    throw new ErroHttp(400, CODIGOS_ARQUIVO.parteInvalida, `Informe o número da parte, de 1 a ${PARTES_ENVIO_MAX}.`);
  return v;
}

interface LinhaEnvio {
  modulo: string;
  finalidade: string;
  enviado_por: string;
  situacao: 'aguardando' | 'recebido';
  tipo: string;
  tamanho_bytes: number | null;
  chave_armazenamento: string | null;
  entidade?: string;
  entidade_id?: string;
}

export function registrarArquivos(
  app: FastifyInstance,
  p: Plataforma,
  armazenamento: ArmazenamentoArquivos | null,
  op: { envioUrlAssinada?: boolean } = {},
): void {
  const preparadas = new WeakMap<FastifyRequest, RequisicaoPreparada>();
  const porManifesto = new Map(p.manifestos.map((m) => [m.id as string, m] as const));

  void app.register(async (escopo) => {
    // só neste escopo: o corpo image/jpeg chega como Buffer (as rotas JSON não aceitam binário)
    escopo.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: LIMITE_ARQUIVO_BYTES }, (_req, corpo, feito) => feito(null, corpo));
    // ADR 0054: parte do arquivo enviado em partes (só a rota de partes aceita; o limite da rota é o que vale)
    escopo.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: PARTE_ENVIO_BYTES }, (_req, corpo, feito) => feito(null, corpo));
    escopo.setErrorHandler((erro, _req, reply) => {
      const e = erro as { statusCode?: number; code?: string };
      if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        const mensagem = _req.url.includes('/partes/')
          ? `Parte maior que ${PARTE_ENVIO_BYTES / 1024 / 1024} MB.`
          : `Arquivo maior que ${LIMITE_ARQUIVO_BYTES / 1024 / 1024} MB.`;
        return reply.code(413).send({ codigo: CODIGOS_ARQUIVO.grandeDemais, mensagem });
      }
      if (e.statusCode === 415 || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
        return reply.code(415).send({ codigo: 'TIPO_NAO_ACEITO', mensagem: 'Envie a foto como image/jpeg.' });
      throw erro; // o resto (ErroHttp, 401, 503…) segue para o tratador da raiz
    });

    escopo.put(
      `${ROTA_ARQUIVOS}/:id`,
      {
        bodyLimit: LIMITE_ARQUIVO_BYTES,
        // sessão antes do corpo: sem login não recebe os bytes
        onRequest: async (req) => {
          preparadas.set(req, await p.preparar(req, null));
        },
      },
      async (req, reply) => {
        const inicio = Date.now();
        const id = idDaRota(req);
        const { ctx } = preparadas.get(req) ?? (await p.preparar(req, null));
        const corpo = req.body;
        // o octet-stream é só das partes (ADR 0054): a foto continua exigindo image/jpeg
        if (tipoDoPedido(req) === 'application/octet-stream') throw new ErroHttp(415, 'TIPO_NAO_ACEITO', 'Envie a foto como image/jpeg.');
        if (corpo !== undefined && corpo !== null && !Buffer.isBuffer(corpo))
          throw new ErroHttp(415, 'TIPO_NAO_ACEITO', 'Envie a foto como image/jpeg.');
        const bytes = corpo ? new Uint8Array(corpo) : new Uint8Array();
        if (bytes.length === 0 || !ehJpeg(bytes)) throw new ErroHttp(400, CODIGOS_ARQUIVO.invalido, 'O arquivo enviado não é uma foto JPEG.');
        if (!armazenamento) throw indisponivel();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const u = ctx.usuario;
        const r = await ctx.comTenant(async (db) => {
          const linha = (
            await db.query<LinhaArquivo>(
              `select modulo, finalidade, enviado_por, situacao, sha256, tamanho_bytes, cliente_id, chave_armazenamento
                 from plataforma.arquivo where id = $1 and deleted_at is null for update`,
              [id],
            )
          ).rows[0];
          // de outro usuário = como se não existisse (não revela o id de outra pessoa)
          if (!linha || linha.enviado_por !== u.id)
            throw new ErroHttp(409, CODIGOS_ARQUIVO.semReferencia, 'O registro desta foto ainda não chegou ao servidor. Ela fica na fila e vai depois.');
          // T-0158: o print do diagnóstico é da plataforma (não é módulo): sem checagem de licença; o resto da ADR 0010 vale
          if (!ehPrintDeDiagnostico(linha) && !u.modulos.includes(linha.modulo as never)) throw moduloInativo(linha.modulo);
          const teto = TETO_POR_CATEGORIA.get(`${linha.modulo}/${linha.finalidade}`);
          if (teto && bytes.length > teto.bytes) throw new ErroHttp(422, teto.codigo, teto.mensagem, { limite_bytes: teto.bytes });
          if (linha.situacao === 'recebido') {
            if (linha.sha256 !== sha256) throw new ErroHttp(409, CODIGOS_ARQUIVO.divergente, 'Esta foto já foi recebida com outro conteúdo.');
            return { repetido: true, tamanho: linha.tamanho_bytes ?? bytes.length };
          }
          const quando = ctx.agora();
          const chave = chaveDoArquivo({ tenant_id: u.tenant_id, modulo: linha.modulo, id }, quando);
          const dim = dimensoesJpeg(bytes);
          // bytes antes da linha: se gravar falhar, a transação desfaz; se o update falhar, o retry sobrescreve a mesma chave
          await armazenamento.gravar(chave, bytes);
          await db.query(
            `update plataforma.arquivo
                set situacao = 'recebido', sha256 = $2, tamanho_bytes = $3, largura_px = $4, altura_px = $5,
                    recebido_em = $6, chave_armazenamento = $7
              where id = $1`,
            [id, sha256, bytes.length, dim?.largura ?? null, dim?.altura ?? null, quando.toISOString(), chave],
          );
          return { repetido: false, tamanho: bytes.length };
        });
        ctx.log.info({ arquivo_id: id, tamanho_bytes: r.tamanho, repetido: r.repetido, ms: Date.now() - inicio }, 'arquivo recebido');
        return reply.code(r.repetido ? 200 : 201).send({ id, situacao: 'recebido', sha256, tamanho_bytes: r.tamanho, repetido: r.repetido });
      },
    );

    // ---------- ADR 0054: envio em partes ----------

    /**
     * Linha `aguardando` do arquivo em partes, do usuário da sessão, com a licença do módulo dela; fixa a chave da parte 1
     * na primeira chamada (as partes de um arquivo ficam no mesmo mês, mesmo que o envio atravesse a virada).
     */
    async function linhaDoEnvio(req: FastifyRequest, id: string): Promise<{ chave1: string; ctx: RequisicaoPreparada['ctx'] }> {
      const { ctx } = preparadas.get(req) ?? (await p.preparar(req, null));
      const u = ctx.usuario;
      const chave1 = await ctx.comTenant(async (db) => {
        const linha = (
          await db.query<LinhaEnvio>(
            `select modulo, finalidade, enviado_por, situacao, tipo, tamanho_bytes, chave_armazenamento
               from plataforma.arquivo where id = $1 and deleted_at is null for update`,
            [id],
          )
        ).rows[0];
        if (!linha || linha.enviado_por !== u.id || linha.tipo !== 'application/zip')
          throw new ErroHttp(409, CODIGOS_ARQUIVO.semReferencia, 'O registro deste envio ainda não chegou ao servidor.');
        if (!u.modulos.includes(linha.modulo as never)) throw moduloInativo(linha.modulo);
        if (linha.situacao === 'recebido') throw new ErroHttp(409, CODIGOS_ARQUIVO.divergente, 'Este arquivo já foi recebido por inteiro.');
        if (linha.chave_armazenamento) return linha.chave_armazenamento;
        const nova = chaveDaParte1({ tenant_id: u.tenant_id, modulo: linha.modulo, id }, ctx.agora());
        const r = await db.query<{ chave_armazenamento: string }>(
          `update plataforma.arquivo set chave_armazenamento = coalesce(chave_armazenamento, $2) where id = $1 returning chave_armazenamento`,
          [id, nova],
        );
        return r.rows[0]?.chave_armazenamento ?? nova;
      });
      return { chave1, ctx };
    }

    escopo.put(
      `${ROTA_ARQUIVOS}/:id/partes/:n`,
      {
        bodyLimit: PARTE_ENVIO_BYTES,
        onRequest: async (req) => {
          preparadas.set(req, await p.preparar(req, null));
        },
      },
      async (req, reply) => {
        const inicio = Date.now();
        const id = idDaRota(req);
        const n = parteDaRota(req);
        if (tipoDoPedido(req) !== 'application/octet-stream') throw new ErroHttp(415, 'TIPO_NAO_ACEITO', 'Envie a parte como application/octet-stream.');
        const corpo = req.body;
        if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw new ErroHttp(400, CODIGOS_ARQUIVO.parteInvalida, 'A parte veio vazia.');
        if (!armazenamento) throw indisponivel();
        const { chave1, ctx } = await linhaDoEnvio(req, id);
        // fora da transação (T-0121): reenviar a mesma parte sobrescreve a mesma chave
        await armazenamento.gravar(chaveDaParte(chave1, n), new Uint8Array(corpo));
        ctx.log.info({ arquivo_id: id, parte: n, tamanho_bytes: corpo.length, ms: Date.now() - inicio }, 'parte recebida');
        return reply.code(200).send({ n, tamanho_bytes: corpo.length });
      },
    );

    escopo.get(`${ROTA_ARQUIVOS}/:id/partes/:n/url-envio`, async (req, reply) => {
      const id = idDaRota(req);
      const n = parteDaRota(req);
      const desligada = () => new ErroHttp(404, CODIGOS_ARQUIVO.urlAssinadaDesligada, 'Envio direto ao armazenamento desligado. Envie a parte pela API.');
      if (!op.envioUrlAssinada || !armazenamento?.urlEnvio) throw desligada();
      const { chave1 } = await linhaDoEnvio(req, id);
      const u = armazenamento.urlEnvio(chaveDaParte(chave1, n), VALIDADE_URL_ENVIO_S);
      const corpo: UrlEnvio = { url: u.url, metodo: 'PUT', expira_em: u.expiraEm.toISOString() };
      return reply.code(200).header('cache-control', 'no-store').send(corpo);
    });

    escopo.post(`${ROTA_ARQUIVOS}/:id/concluir`, async (req, reply) => {
      const id = idDaRota(req);
      const { ctx } = await p.preparar(req, null);
      const u = ctx.usuario;
      const c = ConcluirEnvioSchema.safeParse(req.body);
      if (!c.success || partesDoEnvio(c.data.tamanho_bytes) !== c.data.partes)
        throw new ErroHttp(400, 'VALIDACAO', 'Informe partes (1 a 63) e tamanho_bytes coerentes com partes de 8 MB.');
      const { partes, tamanho_bytes: total } = c.data;
      if (!armazenamento) throw indisponivel();
      const linha = await ctx.comTenant(async (db) =>
        (
          await db.query<LinhaEnvio>(
            `select modulo, finalidade, enviado_por, situacao, tipo, tamanho_bytes, chave_armazenamento, entidade, entidade_id
               from plataforma.arquivo where id = $1 and deleted_at is null`,
            [id],
          )
        ).rows[0],
      );
      if (!linha || linha.enviado_por !== u.id || linha.tipo !== 'application/zip')
        throw new ErroHttp(409, CODIGOS_ARQUIVO.semReferencia, 'O registro deste envio ainda não chegou ao servidor.');
      if (!u.modulos.includes(linha.modulo as never)) throw moduloInativo(linha.modulo);
      const info = (situacao: 'recebido'): InfoArquivo => ({
        id,
        tipo: 'application/zip',
        situacao,
        tamanho_bytes: total,
        entidade: linha.entidade ?? '',
        entidade_id: linha.entidade_id ?? '',
        enviado_por: linha.enviado_por,
      });
      if (linha.situacao === 'recebido') {
        if (Number(linha.tamanho_bytes) !== total) throw new ErroHttp(409, CODIGOS_ARQUIVO.divergente, 'Este arquivo já foi recebido com outro tamanho.');
        return reply.code(200).send(info('recebido'));
      }
      const teto = TETO_ENVIO_EM_PARTES.get(`${linha.modulo}/${linha.finalidade}`) ?? {
        bytes: TETO_ENVIO_EM_PARTES_PADRAO,
        codigo: CODIGOS_ARQUIVO.grandeDemais,
        mensagem: `Arquivo maior que ${MB_ENVIO_EM_PARTES} MB.`,
      };
      if (total > teto.bytes) throw new ErroHttp(413, teto.codigo, teto.mensagem, { limite_bytes: teto.bytes });
      // tamanhos das partes fora da transação (HEAD no S3)
      const chave1 = linha.chave_armazenamento;
      const tamanhos = chave1
        ? await Promise.all(Array.from({ length: partes }, (_, i) => armazenamento.tamanho(chaveDaParte(chave1, i + 1))))
        : Array.from({ length: partes }, () => null);
      const conferencia = conferirPartes(tamanhos, total);
      if (!conferencia.ok)
        throw new ErroHttp(409, CODIGOS_ARQUIVO.envioIncompleto, 'Faltam partes do arquivo. Envie de novo as partes indicadas.', {
          partes_faltando: conferencia.partes_faltando,
        });
      await ctx.comTenant((db) =>
        db.query(
          `update plataforma.arquivo set situacao = 'recebido', tamanho_bytes = $2, recebido_em = $3
            where id = $1 and situacao = 'aguardando'`,
          [id, total, ctx.agora().toISOString()],
        ),
      );
      ctx.log.info({ arquivo_id: id, partes, tamanho_bytes: total }, 'envio em partes concluído');
      return reply.code(200).send(info('recebido'));
    });

    /**
     * Linha do arquivo que o usuário da sessão pode ler: licença e perfil do módulo dono, carteira do cliente da foto ou
     * usuários visíveis (foto do tenant liberada pela licença). Fora disso, 404 sem revelar o motivo. Original e miniatura.
     */
    async function lerAutorizado(req: FastifyRequest) {
      const id = idDaRota(req);
      const { ctx } = await p.preparar(req, null);
      const u = ctx.usuario;
      const naoEncontrado = () => new ErroHttp(404, CODIGOS_ARQUIVO.naoEncontrado, 'Foto não encontrada.');
      const linha = await ctx.comTenant(async (db) =>
        (
          await db.query<LinhaArquivo>(
            `select modulo, finalidade, enviado_por, situacao, tipo, sha256, tamanho_bytes, cliente_id, chave_armazenamento, perfis_leitura
               from plataforma.arquivo where id = $1 and deleted_at is null`,
            [id],
          )
        ).rows[0],
      );
      // ADR 0054: o ZIP do lote nunca é servido (nem a quem enviou)
      if (!linha || linha.situacao !== 'recebido' || !linha.chave_armazenamento || linha.tipo === 'application/zip') throw naoEncontrado();
      // licença e perfil do módulo dono da foto (RN-CORE-01/02)
      const manifesto = porManifesto.get(linha.modulo);
      if (!manifesto) throw naoEncontrado();
      const acesso = verificarAcesso(u, { modulo: manifesto.id, perfis: manifesto.perfis });
      if (!acesso.ok) {
        if (acesso.codigo === 'MODULO_INATIVO') throw moduloInativo(linha.modulo);
        throw new ErroHttp(acesso.status, acesso.codigo, acesso.mensagem);
      }
      // ADR 0041 / RN-CORE-38: arquivo restrito (CNH, contrato social) só para os perfis da lista; fora dela, 404 sem motivo
      // (nem o próprio vendedor que enviou reabre). A carteira abaixo continua valendo.
      const restrito = linha.perfis_leitura != null;
      if (!perfilLeArquivo(linha.perfis_leitura, u)) throw naoEncontrado();
      // escopo (RN-CORE-04): carteira do cliente da foto; sem cliente, os usuários visíveis — menos as fotos do tenant
      // (foto de produto: o catálogo é do tenant, RN-CAT-04), que a licença e o perfil acima já liberam
      if (linha.cliente_id) {
        const c = verificarCarteira(linha.cliente_id, await ctx.carteira());
        if (!c.ok) throw new ErroHttp(c.status, c.codigo, c.mensagem);
      } else if (!ARQUIVOS_DO_TENANT.has(`${linha.modulo}/${linha.finalidade}`)) {
        // foto de tarefa sem cliente: além de enxergar quem enviou, quem não enviou precisa acompanhar tarefas (fora = 404)
        if (`${linha.modulo}/${linha.finalidade}` === CATEGORIA_FOTO_TAREFA && linha.enviado_por !== u.id && !verificarAcao(u, p.permissoes, ACAO_ACOMPANHAR_TAREFA).ok)
          throw naoEncontrado();
        const visiveis = await ctx.usuariosVisiveis();
        if (visiveis !== 'tenant' && !visiveis.has(linha.enviado_por)) throw naoEncontrado();
      }
      if (!armazenamento) throw indisponivel();
      // restrito: o navegador e proxies não guardam cópia (a imagem fica só na memória de quem abriu)
      const cache = restrito ? 'private, no-store' : 'private, max-age=86400';
      return { id, ctx, linha, chave: linha.chave_armazenamento, naoEncontrado, armazenamento, cache };
    }

    escopo.get(`${ROTA_ARQUIVOS}/:id`, async (req, reply) => {
      const { id, ctx, linha, chave, naoEncontrado, armazenamento, cache } = await lerAutorizado(req);
      const bytes = await armazenamento.ler(chave);
      if (!bytes) {
        ctx.log.warn({ arquivo_id: id }, 'bytes do arquivo ausentes no armazenamento');
        throw naoEncontrado();
      }
      return reply
        .code(200)
        .header('content-type', tipoDaChave(chave))
        .header('cache-control', cache)
        .header('etag', `"${linha.sha256}"`)
        .send(Buffer.from(bytes));
    });

    // T-0097 b: versão reduzida (320 px, até 30 KB), mesma regra de acesso; gerada na 1ª leitura e guardada
    escopo.get(`${ROTA_ARQUIVOS}/:id/miniatura`, async (req, reply) => {
      const { id, ctx, linha, chave, naoEncontrado, armazenamento, cache } = await lerAutorizado(req);
      const chaveMini = chaveDaMiniatura(chave);
      let bytes = await armazenamento.ler(chaveMini);
      if (!bytes) {
        const original = await armazenamento.ler(chave);
        if (!original) {
          ctx.log.warn({ arquivo_id: id }, 'bytes do arquivo ausentes no armazenamento');
          throw naoEncontrado();
        }
        const inicio = Date.now();
        try {
          const m = miniaturaDeImagem(original, tipoDaChave(chave));
          bytes = m.bytes;
          ctx.log.info({ arquivo_id: id, tamanho_bytes: bytes.length, largura_px: m.largura, altura_px: m.altura, ms: Date.now() - inicio }, 'miniatura gerada');
        } catch (e) {
          if (!(e instanceof ErroMiniatura)) throw e;
          ctx.log.warn({ arquivo_id: id, erro: e.message }, 'miniatura não gerada');
          throw new ErroHttp(422, 'MINIATURA_INDISPONIVEL', 'Não foi possível reduzir esta foto.');
        }
        // guardar é melhor esforço: se falhar, a próxima leitura gera de novo
        const gerada = bytes;
        await armazenamento
          .gravar(chaveMini, gerada)
          .catch((e: unknown) => ctx.log.warn({ arquivo_id: id, erro: e instanceof Error ? e.message : String(e) }, 'miniatura não guardada'));
      }
      return reply
        .code(200)
        .header('content-type', 'image/jpeg')
        .header('cache-control', cache)
        .header('etag', `"${linha.sha256}-m320"`)
        .send(Buffer.from(bytes));
    });
  });
}
