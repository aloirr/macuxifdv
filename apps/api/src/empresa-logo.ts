/**
 * Logo do cliente e nome fantasia (T-0182; desenho `docs/desenho/T-0182-logo-cliente.md` §2 e §3.2). Contratos, limites e
 * frases no SDK (`empresa-logo.ts`). Gravar é SÓ do super-admin (RN-CORE-33); o admin do cliente lê a da própria empresa.
 *   GET    /v1/plataforma/empresas/:tenant_id/marca   MarcaEmpresa (super-admin; admin do cliente só a da sessão)
 *   PUT    /v1/plataforma/empresas/:tenant_id/marca   nome fantasia (JSON; vazio apaga), só super-admin
 *   GET    /v1/plataforma/empresas/:tenant_id/logo    bytes da logo atual (mesmo acesso do GET da marca), `no-store`
 *   PUT    /v1/plataforma/empresas/:tenant_id/logo    bytes crus `image/png`|`image/jpeg` até 1 MiB, só super-admin
 *   DELETE /v1/plataforma/empresas/:tenant_id/logo    tira a logo, só super-admin
 *   GET    /v1/me/empresa/logo/:sha256                bytes para o app e o BKO (sessão do app, tenant do token; módulo Core)
 * As rotas do portal vão pelas funções `sa_*` (0081, `macuxi_portal`), que conferem a sessão e o acesso de novo e auditam.
 * O PUT da logo autentica no `onRequest` (sem sessão não recebe o corpo), confere pelo cabeçalho (`conferirLogo`: tipo,
 * tamanho, assinatura, altura mínima e lado máximo), é idempotente pelo sha256, grava o objeto novo antes do banco (falha no
 * banco apaga o novo) e apaga o anterior por melhor esforço. Log: tenant, tamanho, tipo, dimensões e tempo; nunca bytes nem
 * nome de arquivo.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  CODIGOS_LOGO,
  conferirLogo,
  EmpresaLogoSchema,
  GravarNomeFantasiaSchema,
  LIMITES_LOGO,
  MarcaEmpresaSchema,
  MENSAGENS_LOGO,
  ROTA_ME_EMPRESA_LOGO,
  Sha256LogoSchema,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type ClienteBanco,
  type GravarNomeFantasia,
  type MarcaEmpresa,
  type TipoLogo,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { chaveDoArquivo, erroArmazenamentoIndisponivel, type ArmazenamentoArquivos } from './arquivos';
import { ErroHttp } from './erros';
import { conferirRetorno, exigirPortal, exigirSuperAdmin, traduzirErroSa, type AutenticarPortal } from './portal-comum';
import type { Plataforma } from './tipos';

/** O que a `sa_gravar_logo` recebe (desenho §1.2, item 3): exatamente estas chaves. */
export interface LogoParaGravar {
  id: string;
  tipo: TipoLogo;
  sha256: string;
  tamanho_bytes: number;
  largura_px: number;
  altura_px: number;
  chave: string;
}

/** Logo atual do tenant da transação (RLS do `macuxi_app`), para a rota do aparelho. */
export interface LogoDoTenant {
  sha256: string;
  tipo: TipoLogo;
  chave: string;
}

/** Acesso às funções do banco (testes injetam a sua). As `sa_*` devolvem o jsonb cru; a rota confere pelo contrato. */
export interface FonteMarcaEmpresa {
  marca(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  gravarNome(sid: string, tenantId: string, nome: string | null, banco: AcessoBanco): Promise<unknown>;
  gravarLogo(sid: string, tenantId: string, logo: LogoParaGravar, banco: AcessoBanco): Promise<unknown>;
  removerLogo(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  logoDoTenant(db: ClienteBanco): Promise<LogoDoTenant | null>;
}

const primeira = async (banco: AcessoBanco, sql: string, params: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, params)).rows[0]?.r);

export const fonteMarcaNoBanco: FonteMarcaEmpresa = {
  marca: (sid, t, banco) => primeira(banco, 'select plataforma.sa_marca_da_empresa($1, $2) as r', [sid, t]),
  gravarNome: (sid, t, nome, banco) => primeira(banco, 'select plataforma.sa_gravar_nome_fantasia($1, $2, $3) as r', [sid, t, nome]),
  gravarLogo: (sid, t, logo, banco) => primeira(banco, 'select plataforma.sa_gravar_logo($1, $2, $3::jsonb) as r', [sid, t, JSON.stringify(logo)]),
  removerLogo: (sid, t, banco) => primeira(banco, 'select plataforma.sa_remover_logo($1, $2) as r', [sid, t]),
  logoDoTenant: async (db) => {
    const l = (
      await db.query<{ sha256: string | null; tipo: TipoLogo | null; chave: string | null }>(
        'select logo_sha256 as sha256, logo_tipo as tipo, logo_chave as chave from plataforma.tenant where id = plataforma.tenant_atual()',
      )
    ).rows[0];
    return l?.sha256 && l.tipo && l.chave ? { sha256: l.sha256, tipo: l.tipo, chave: l.chave } : null;
  },
};

/** Retorno das `sa_*`: a `MarcaEmpresa` com a chave do objeto (só a API usa) e, na escrita, a chave que saiu. */
const MarcaBrutaSchema = MarcaEmpresaSchema.extend({
  logo: EmpresaLogoSchema.extend({ chave: z.string() }).nullable(),
  chave_anterior: z.string().nullable().optional(),
});
type MarcaBruta = z.output<typeof MarcaBrutaSchema>;

/** Resposta pública da rota: sem `chave` nem `chave_anterior`. */
function resposta(m: MarcaBruta): MarcaEmpresa {
  const { chave_anterior: _a, logo, ...resto } = m;
  if (!logo) return { ...resto, logo: null };
  const { chave: _c, ...semChave } = logo;
  return { ...resto, logo: semChave };
}

const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
const ParamsLogoAparelho = z.object({ sha256: Sha256LogoSchema }).strict();

const SO_A_MACUXI = 'Só o time da Macuxi altera a logo e o nome fantasia.';

/** A chave do objeto é do próprio tenant (`<tenant>/plataforma/...`; o banco tem o CHECK, aqui ela vira caminho). */
const chaveDoTenant = (chave: string, tenantId: string): boolean => chave.startsWith(`${tenantId.toLowerCase()}/plataforma/`);
const semLogo = () => new ErroHttp(404, CODIGOS_LOGO.naoEncontrada, MENSAGENS_LOGO[CODIGOS_LOGO.naoEncontrada]);

/** SQLSTATE das `sa_*` → HTTP: os comuns (`traduzirErroSa`) + os desta rota. */
const traduzir = (e: unknown): never =>
  traduzirErroSa(e, (c) => {
    if (c === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', SO_A_MACUXI);
    if (c === 'P0002') throw new ErroHttp(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada.');
    if (c === '22023' || c === '23514') throw new ErroHttp(400, 'VALIDACAO', 'Dados da logo ou do nome fantasia inválidos.');
    if (c === '42883') throw new ErroHttp(503, 'MARCA_INDISPONIVEL', 'Logo e nome fantasia indisponíveis neste servidor.');
  });

const msg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 200) : String(e));

export interface DepsMarcaEmpresa {
  /** Conexão do portal (`macuxi_portal`). */
  acessoPortal: AcessoBanco;
  fonte?: FonteMarcaEmpresa;
  autenticar: AutenticarPortal;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  armazenamento: ArmazenamentoArquivos | null;
  relogio: () => Date;
  /** Sessão do app (rota do aparelho). */
  plataforma: Plataforma;
}

export function registrarRotasMarcaEmpresa(app: FastifyInstance, dep: DepsMarcaEmpresa): void {
  const fonte = dep.fonte ?? fonteMarcaNoBanco;
  const tenantDa = (req: FastifyRequest) => (dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>).tenant_id.toLowerCase();

  /** Super-admin em qualquer empresa; admin do cliente só na da sessão (403 antes do banco; a `sa_*` confere de novo). */
  const exigirLeitura = async (req: FastifyRequest, tenantId: string): Promise<AcessoPortalAutenticado> => {
    const quem = await exigirPortal(dep.autenticar, req, tenantId);
    if (quem.tipo === 'admin_cliente' && quem.empresa?.tenant_id.toLowerCase() !== tenantId)
      throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Você só vê a logo da sua empresa.');
    return quem;
  };
  const exigirEscrita = (req: FastifyRequest, tenantId: string) => exigirSuperAdmin(dep.autenticar, req, tenantId, SO_A_MACUXI);

  const chamar = async (f: () => Promise<unknown>, funcao: string): Promise<MarcaBruta> => {
    let bruto: unknown;
    try {
      bruto = await f();
    } catch (e) {
      traduzir(e);
    }
    const m = conferirRetorno(MarcaBrutaSchema, bruto, funcao);
    for (const c of [m.logo?.chave, m.chave_anterior])
      if (c && !chaveDoTenant(c, m.tenant_id)) throw new Error(`${funcao} devolveu chave de outro tenant`);
    return m;
  };

  /** Apaga o objeto que saiu (melhor esforço: a falha só vai a log, o banco já está certo). */
  const apagar = async (req: FastifyRequest, chave: string | null | undefined, tenantId: string) => {
    if (!chave || !dep.armazenamento) return;
    await dep.armazenamento.remover(chave).catch((e: unknown) => req.log.warn({ tenant_id: tenantId, erro: msg(e) }, 'logo: objeto anterior não apagado'));
  };

  app.get('/v1/plataforma/empresas/:tenant_id/marca', async (req, reply) => {
    const tenantId = tenantDa(req);
    const quem = await exigirLeitura(req, tenantId);
    const m = await chamar(() => fonte.marca(quem.sessao_id, tenantId, dep.acessoPortal), 'sa_marca_da_empresa');
    return reply.header('cache-control', 'private, no-store').send(resposta(m));
  });

  app.put('/v1/plataforma/empresas/:tenant_id/marca', async (req, reply) => {
    const tenantId = tenantDa(req);
    const quem = await exigirEscrita(req, tenantId);
    const corpo = dep.validar(GravarNomeFantasiaSchema, req.body, 'corpo') as GravarNomeFantasia;
    const m = await chamar(() => fonte.gravarNome(quem.sessao_id, tenantId, corpo.nome_fantasia, dep.acessoPortal), 'sa_gravar_nome_fantasia');
    return reply.header('cache-control', 'private, no-store').send(resposta(m));
  });

  app.get('/v1/plataforma/empresas/:tenant_id/logo', async (req, reply) => {
    const tenantId = tenantDa(req);
    const quem = await exigirLeitura(req, tenantId);
    const m = await chamar(() => fonte.marca(quem.sessao_id, tenantId, dep.acessoPortal), 'sa_marca_da_empresa');
    if (!m.logo) throw semLogo();
    if (!dep.armazenamento) throw erroArmazenamentoIndisponivel();
    const bytes = await dep.armazenamento.ler(m.logo.chave);
    if (!bytes) {
      req.log.warn({ tenant_id: tenantId }, 'logo: bytes ausentes no armazenamento');
      throw semLogo();
    }
    return reply
      .header('content-type', m.logo.tipo)
      .header('etag', `"${m.logo.sha256}"`)
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(bytes));
  });

  app.delete('/v1/plataforma/empresas/:tenant_id/logo', async (req, reply) => {
    const tenantId = tenantDa(req);
    const quem = await exigirEscrita(req, tenantId);
    const m = await chamar(() => fonte.removerLogo(quem.sessao_id, tenantId, dep.acessoPortal), 'sa_remover_logo');
    await apagar(req, m.chave_anterior, tenantId);
    req.log.info({ tenant_id: tenantId, removida: Boolean(m.chave_anterior) }, 'logo removida');
    return reply.header('cache-control', 'private, no-store').send(resposta(m));
  });

  // PUT da logo: escopo próprio (os bytes chegam como Buffer; 413 e 415 com os códigos da logo)
  const autorizados = new WeakMap<FastifyRequest, { quem: AcessoPortalAutenticado; tenantId: string }>();
  void app.register(async (escopo) => {
    for (const tipo of LIMITES_LOGO.tipos)
      escopo.addContentTypeParser(tipo, { parseAs: 'buffer', bodyLimit: LIMITES_LOGO.bytes }, (_req, corpo, feito) => feito(null, corpo));
    escopo.setErrorHandler((erro, _req, reply) => {
      const e = erro as { statusCode?: number; code?: string };
      if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE')
        return reply.code(413).send({ codigo: CODIGOS_LOGO.grande, mensagem: MENSAGENS_LOGO[CODIGOS_LOGO.grande] });
      if (e.statusCode === 415 || e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
        return reply.code(415).send({ codigo: CODIGOS_LOGO.formato, mensagem: MENSAGENS_LOGO[CODIGOS_LOGO.formato] });
      throw erro; // o resto (ErroHttp, 401, 403, 503…) segue para o tratador da raiz
    });

    escopo.put(
      '/v1/plataforma/empresas/:tenant_id/logo',
      {
        bodyLimit: LIMITES_LOGO.bytes,
        // sessão e perfil antes do corpo: sem super-admin não recebe o 1 MiB
        onRequest: async (req) => {
          const tenantId = tenantDa(req);
          autorizados.set(req, { quem: await exigirEscrita(req, tenantId), tenantId });
        },
      },
      async (req, reply) => {
        const inicio = Date.now();
        const autorizado = autorizados.get(req);
        if (!autorizado) throw new Error('logo: PUT sem o onRequest de autorização');
        const { quem, tenantId } = autorizado;
        const corpo = req.body;
        if (corpo !== undefined && corpo !== null && !Buffer.isBuffer(corpo))
          throw new ErroHttp(415, CODIGOS_LOGO.formato, MENSAGENS_LOGO[CODIGOS_LOGO.formato]);
        const bytes = corpo ? new Uint8Array(corpo) : new Uint8Array();
        const c = conferirLogo(bytes, req.headers['content-type']);
        if (!c.ok) throw new ErroHttp(c.status, c.codigo, MENSAGENS_LOGO[c.codigo]);
        if (!dep.armazenamento) throw erroArmazenamentoIndisponivel();
        const armazenamento = dep.armazenamento;
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        // idempotente: a mesma imagem da atual = 200 sem gravar nada
        const atual = await chamar(() => fonte.marca(quem.sessao_id, tenantId, dep.acessoPortal), 'sa_marca_da_empresa');
        const base = { tenant_id: tenantId, tamanho_bytes: bytes.length, tipo: c.tipo, largura_px: c.largura_px, altura_px: c.altura_px };
        if (atual.logo?.sha256 === sha256) {
          req.log.info({ ...base, repetida: true, ms: Date.now() - inicio }, 'logo recebida');
          return reply.header('cache-control', 'private, no-store').send(resposta(atual));
        }

        const id = randomUUID();
        const chave = chaveDoArquivo({ tenant_id: tenantId, modulo: 'plataforma', id }, dep.relogio(), c.tipo);
        await armazenamento.gravar(chave, bytes);
        let m: MarcaBruta;
        try {
          m = await chamar(
            () =>
              fonte.gravarLogo(
                quem.sessao_id,
                tenantId,
                { id, tipo: c.tipo, sha256, tamanho_bytes: bytes.length, largura_px: c.largura_px, altura_px: c.altura_px, chave },
                dep.acessoPortal,
              ),
            'sa_gravar_logo',
          );
        } catch (e) {
          await apagar(req, chave, tenantId);
          throw e;
        }
        // corrida: outra gravação com o mesmo sha256 venceu (a função não mudou nada) → o objeto novo sobra
        if (m.logo?.chave !== chave) await apagar(req, chave, tenantId);
        else await apagar(req, m.chave_anterior, tenantId);
        req.log.info({ ...base, repetida: false, ms: Date.now() - inicio }, 'logo recebida');
        return reply.header('cache-control', 'private, no-store').send(resposta(m));
      },
    );
  });

  // bytes para o aparelho e o BKO: só a logo ATUAL do tenant do token (sha256 velho = 404; o aparelho nunca guarda logo velha)
  app.get(`${ROTA_ME_EMPRESA_LOGO}/:sha256`, async (req, reply) => {
    const { ctx } = await dep.plataforma.preparar(req, 'core');
    const { sha256 } = dep.validar(ParamsLogoAparelho, req.params, 'params') as z.output<typeof ParamsLogoAparelho>;
    const logo = await ctx.comTenant((db) => fonte.logoDoTenant(db));
    if (!logo || logo.sha256 !== sha256) throw semLogo();
    if (!chaveDoTenant(logo.chave, ctx.usuario.tenant_id)) throw semLogo();
    if (!dep.armazenamento) throw erroArmazenamentoIndisponivel();
    const bytes = await dep.armazenamento.ler(logo.chave);
    if (!bytes) {
      ctx.log.warn({ logo_sha256: sha256 }, 'logo: bytes ausentes no armazenamento');
      throw semLogo();
    }
    return reply
      .header('content-type', logo.tipo)
      .header('etag', `"${logo.sha256}"`)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(bytes));
  });
}
