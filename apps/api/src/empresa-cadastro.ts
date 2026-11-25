/** Rotas do cadastro da empresa (ADR 0075; contrato em plataforma.ts). Log: só o tenant. */
import {
  CODIGOS_CADASTRO_EMPRESA,
  DadosCadastraisEmpresaSchema,
  GravarDadosCadastraisEmpresaSchema,
  ROTA_PORTAL_CADASTRO_EMPRESA,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type DadosCadastraisEmpresa,
  type GravarDadosCadastraisEmpresa,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import { conferirRetorno, exigirPortal, traduzirErroSa, type AutenticarPortal } from './portal-comum';

/** Acesso às funções do banco (testes injetam a sua). As `sa_*` devolvem o jsonb cru; a rota confere pelo contrato. */
export interface FonteCadastroEmpresa {
  ler(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  gravar(sid: string, tenantId: string, dados: GravarDadosCadastraisEmpresa, banco: AcessoBanco): Promise<unknown>;
}

const primeira = async (banco: AcessoBanco, sql: string, params: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, params)).rows[0]?.r);

export const fonteCadastroNoBanco: FonteCadastroEmpresa = {
  ler: (sid, t, banco) => primeira(banco, 'select plataforma.sa_dados_da_empresa($1, $2) as r', [sid, t]),
  gravar: (sid, t, dados, banco) =>
    primeira(banco, 'select plataforma.sa_gravar_dados_da_empresa($1, $2, $3::jsonb) as r', [sid, t, JSON.stringify(dados)]),
};

const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
const SEM_ACESSO = 'Seu acesso não permite ver nem alterar o cadastro desta empresa.';
const invalido = (detalhes?: Record<string, unknown>) =>
  new ErroHttp(422, CODIGOS_CADASTRO_EMPRESA.invalido, 'Confira os dados cadastrais.', detalhes);

/** SQLSTATE das `sa_*` → HTTP: os comuns (`traduzirErroSa`) + os desta rota. */
const traduzir = (e: unknown): never =>
  traduzirErroSa(e, (c) => {
    if (c === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', SEM_ACESSO);
    if (c === 'P0002') throw new ErroHttp(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada.');
    if (c === '22023' || c === '23514') throw invalido();
    if (c === '42883') throw new ErroHttp(503, CODIGOS_CADASTRO_EMPRESA.indisponivel, 'Cadastro da empresa indisponível neste servidor.');
  });

export interface DepsCadastroEmpresa {
  /** Conexão do portal (`macuxi_portal`). */
  acessoPortal: AcessoBanco;
  fonte?: FonteCadastroEmpresa;
  autenticar: AutenticarPortal;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
}

export function registrarRotasCadastroEmpresa(app: FastifyInstance, dep: DepsCadastroEmpresa): void {
  const fonte = dep.fonte ?? fonteCadastroNoBanco;

  /** Super-admin em qualquer empresa; admin do cliente só na da sessão (a `sa_*` confere de novo). */
  const exigirAcesso = async (req: FastifyRequest): Promise<{ quem: AcessoPortalAutenticado; tenantId: string }> => {
    const tenantId = (dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>).tenant_id.toLowerCase();
    const quem = await exigirPortal(dep.autenticar, req, tenantId);
    if (quem.tipo === 'admin_cliente' && quem.empresa?.tenant_id.toLowerCase() !== tenantId) throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', SEM_ACESSO);
    return { quem, tenantId };
  };

  const chamar = async (f: () => Promise<unknown>, funcao: string, tenantId: string): Promise<DadosCadastraisEmpresa> => {
    let bruto: unknown;
    try {
      bruto = await f();
    } catch (e) {
      traduzir(e);
    }
    const d = conferirRetorno(DadosCadastraisEmpresaSchema, bruto, funcao);
    if (d.tenant_id.toLowerCase() !== tenantId) throw new Error(`${funcao} devolveu outro tenant`);
    return d;
  };

  app.get(ROTA_PORTAL_CADASTRO_EMPRESA, async (req, reply) => {
    const { quem, tenantId } = await exigirAcesso(req);
    const d = await chamar(() => fonte.ler(quem.sessao_id, tenantId, dep.acessoPortal), 'sa_dados_da_empresa', tenantId);
    return reply.header('cache-control', 'private, no-store').send(d);
  });

  app.put(ROTA_PORTAL_CADASTRO_EMPRESA, async (req, reply) => {
    const { quem, tenantId } = await exigirAcesso(req);
    const r = GravarDadosCadastraisEmpresaSchema.safeParse(req.body);
    if (!r.success) throw invalido({ problemas: r.error.issues.slice(0, 20).map((i) => ({ caminho: ['corpo', ...i.path].join('.'), mensagem: i.message })) });
    const d = await chamar(() => fonte.gravar(quem.sessao_id, tenantId, r.data, dep.acessoPortal), 'sa_gravar_dados_da_empresa', tenantId);
    req.log.info({ tenant_id: tenantId }, 'cadastro da empresa gravado');
    return reply.header('cache-control', 'private, no-store').send(d);
  });
}
