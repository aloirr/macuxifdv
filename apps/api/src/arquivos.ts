/**
 * Arquivos enviados pelo aparelho (ADR 0010; desenho T-0016 §1 E4) — rotas de plataforma, como `/v1/sync/*`:
 *   PUT /v1/arquivos/:id  corpo `image/jpeg` cru (sem multipart), até 2 MB → completa a linha `aguardando`
 *   GET /v1/arquivos/:id  devolve os bytes (licença do módulo, perfil e carteira do `cliente_id`; foto de produto vale para o tenant)
 *
 * Quem CRIA a linha em `plataforma.arquivo` é o módulo, na transação do comando que referencia a foto
 * (`tx.registrarArquivo`, `outbox.ts`). O upload só completa uma linha do mesmo tenant (RLS) e do mesmo usuário:
 *   - sem linha (o push ainda não chegou) → 409 ARQUIVO_SEM_REFERENCIA (retentável no aparelho);
 *   - já recebido com o mesmo sha256 → 200 (idempotente pelo UUID do aparelho); sha256 diferente → 409 ARQUIVO_DIVERGENTE;
 *   - corpo que não é JPEG (FF D8 FF) ou vazio → 400 ARQUIVO_INVALIDO; acima de 2 MB → 413 ARQUIVO_GRANDE_DEMAIS;
 *     outro Content-Type → 415 TIPO_NAO_ACEITO.
 * A autenticação roda ANTES de ler o corpo (gancho `onRequest`): sem sessão, 401 sem receber os 2 MB.
 * Os bytes ficam atrás da porta `ArmazenamentoArquivos`: disco local em `MACUXI_ARQUIVOS_DIR` (dev, CI) ou objeto S3
 * (`armazenamento-s3.ts`, ADR 0020; `MACUXI_ARQUIVOS_DRIVER=s3`).
 * Log sem dado pessoal: só id, tamanho e tempo.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  CODIGOS_ARQUIVO,
  dimensoesJpeg,
  ehJpeg,
  LIMITE_ARQUIVO_BYTES,
  ROTA_ARQUIVOS,
  verificarAcesso,
  verificarCarteira,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ErroHttp } from './erros';
import type { Plataforma, RequisicaoPreparada } from './tipos';

// ---------- porta e adaptador de disco ----------

/** Porta dos bytes (ADR 0010 §3). A chave é `<tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`. */
export interface ArmazenamentoArquivos {
  gravar(chave: string, bytes: Uint8Array): Promise<void>;
  /** `null` = não existe. */
  ler(chave: string): Promise<Uint8Array | null>;
  remover(chave: string): Promise<void>;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');
/** Formato fechado da chave: nada de `..`, barra invertida ou caminho absoluto chega ao disco. */
export const CHAVE_ARQUIVO_RE = new RegExp(`^${UUID}/[a-z][a-z0-9-]*/\\d{4}-\\d{2}/${UUID}\\.jpg$`);
const CHAVE_RE = CHAVE_ARQUIVO_RE;

export function chaveDoArquivo(a: { tenant_id: string; modulo: string; id: string }, quando: Date): string {
  const mes = quando.toISOString().slice(0, 7);
  const chave = `${a.tenant_id.toLowerCase()}/${a.modulo}/${mes}/${a.id.toLowerCase()}.jpg`;
  if (!CHAVE_RE.test(chave)) throw new Error('chave de arquivo inválida');
  return chave;
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
    chaves: () => [...m.keys()],
  };
}

// ---------- rotas ----------

interface LinhaArquivo {
  modulo: string;
  finalidade: string;
  enviado_por: string;
  situacao: 'aguardando' | 'recebido';
  sha256: string | null;
  tamanho_bytes: number | null;
  cliente_id: string | null;
  chave_armazenamento: string | null;
}

/**
 * Arquivos SEM cliente que valem para o tenant inteiro (`<modulo>/<finalidade>`): quem tem a licença e o perfil do módulo
 * lê, não importa quem enviou. Foto de produto (T-0097): sobe pelo gerente/analista e aparece na miniatura do vendedor e do
 * promotor (RN-CAT-04: todos os perfis consultam o catálogo). As demais fotos sem cliente seguem os usuários visíveis.
 */
export const ARQUIVOS_DO_TENANT: ReadonlySet<string> = new Set(['catalogo/foto_produto']);

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

export function registrarArquivos(app: FastifyInstance, p: Plataforma, armazenamento: ArmazenamentoArquivos | null): void {
  const preparadas = new WeakMap<FastifyRequest, RequisicaoPreparada>();
  const porManifesto = new Map(p.manifestos.map((m) => [m.id as string, m] as const));

  void app.register(async (escopo) => {
    // só neste escopo: o corpo image/jpeg chega como Buffer (as rotas JSON não aceitam binário)
    escopo.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: LIMITE_ARQUIVO_BYTES }, (_req, corpo, feito) => feito(null, corpo));
    escopo.setErrorHandler((erro, _req, reply) => {
      const e = erro as { statusCode?: number; code?: string };
      if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE')
        return reply.code(413).send({ codigo: CODIGOS_ARQUIVO.grandeDemais, mensagem: `Arquivo maior que ${LIMITE_ARQUIVO_BYTES / 1024 / 1024} MB.` });
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
          if (!u.modulos.includes(linha.modulo as never)) throw moduloInativo(linha.modulo);
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

    escopo.get(`${ROTA_ARQUIVOS}/:id`, async (req, reply) => {
      const id = idDaRota(req);
      const { ctx } = await p.preparar(req, null);
      const u = ctx.usuario;
      const naoEncontrado = () => new ErroHttp(404, CODIGOS_ARQUIVO.naoEncontrado, 'Foto não encontrada.');
      const linha = await ctx.comTenant(async (db) =>
        (
          await db.query<LinhaArquivo>(
            `select modulo, finalidade, enviado_por, situacao, sha256, tamanho_bytes, cliente_id, chave_armazenamento
               from plataforma.arquivo where id = $1 and deleted_at is null`,
            [id],
          )
        ).rows[0],
      );
      if (!linha || linha.situacao !== 'recebido' || !linha.chave_armazenamento) throw naoEncontrado();
      // licença e perfil do módulo dono da foto (RN-CORE-01/02)
      const manifesto = porManifesto.get(linha.modulo);
      if (!manifesto) throw naoEncontrado();
      const acesso = verificarAcesso(u, { modulo: manifesto.id, perfis: manifesto.perfis });
      if (!acesso.ok) {
        if (acesso.codigo === 'MODULO_INATIVO') throw moduloInativo(linha.modulo);
        throw new ErroHttp(acesso.status, acesso.codigo, acesso.mensagem);
      }
      // escopo (RN-CORE-04): carteira do cliente da foto; sem cliente, os usuários visíveis — menos as fotos do tenant
      // (foto de produto: o catálogo é do tenant, RN-CAT-04), que a licença e o perfil acima já liberam
      if (linha.cliente_id) {
        const c = verificarCarteira(linha.cliente_id, await ctx.carteira());
        if (!c.ok) throw new ErroHttp(c.status, c.codigo, c.mensagem);
      } else if (!ARQUIVOS_DO_TENANT.has(`${linha.modulo}/${linha.finalidade}`)) {
        const visiveis = await ctx.usuariosVisiveis();
        if (visiveis !== 'tenant' && !visiveis.has(linha.enviado_por)) throw naoEncontrado();
      }
      if (!armazenamento) throw indisponivel();
      const bytes = await armazenamento.ler(linha.chave_armazenamento);
      if (!bytes) {
        ctx.log.warn({ arquivo_id: id }, 'bytes do arquivo ausentes no armazenamento');
        throw naoEncontrado();
      }
      return reply
        .code(200)
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, max-age=86400')
        .header('etag', `"${linha.sha256}"`)
        .send(Buffer.from(bytes));
    });
  });
}
