/**
 * Encanamento comum das rotas do portal (RD-0405, unificado no RD-0428): quem entrou (401 + `marcarPortal` para a auditoria
 * do `onResponse`), só super-admin (403), a tradução dos SQLSTATE das funções `sa_*` e a conferência do retorno pelo contrato.
 * Um texto só para o 401, o 403 da sessão e a tradução: muda aqui, muda em todas as rotas do portal.
 */
import type { AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ErroHttp } from './erros';
import { marcarPortal } from './plataforma';

/** Quem entrou pelo portal; `null` = sem token válido (sem o banco do portal, lança 503 `PORTAL_INDISPONIVEL`). */
export type AutenticarPortal = (req: FastifyRequest) => Promise<AcessoPortalAutenticado | null>;

/** Super-admin ou admin do cliente; sem token = 401 `NAO_AUTENTICADO`. Marca a requisição para a auditoria do portal. */
export async function exigirPortal(
  autenticar: AutenticarPortal,
  req: FastifyRequest,
  tenantId: string | null,
): Promise<AcessoPortalAutenticado> {
  const quem = await autenticar(req);
  if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
  marcarPortal(req, { quem, tenantId });
  return quem;
}

/** Só super-admin; o admin do cliente recebe 403 `PERFIL_SEM_ACESSO` com a frase da rota (marcado mesmo assim). */
export async function exigirSuperAdmin(
  autenticar: AutenticarPortal,
  req: FastifyRequest,
  tenantId: string | null,
  mensagem403: string,
): Promise<AcessoPortalAutenticado & { tipo: 'super_admin' }> {
  const quem = await exigirPortal(autenticar, req, tenantId);
  if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', mensagem403);
  return quem;
}

/**
 * SQLSTATE das `sa_*` → HTTP. Os casos próprios da rota entram por `extras(code, hint)` ANTES dos comuns (lançam o seu
 * erro; se voltarem, seguem os comuns): 28000 = 401 (sessão revogada ou vencida), 42501 = 403, 22023 = 400 `VALIDACAO`.
 * `code`/`hint` ausentes chegam como `''`. O resto relança o erro original.
 */
export function traduzirErroSa(e: unknown, extras?: (code: string, hint: string) => void): never {
  const x = e as { code?: unknown; hint?: unknown } | null;
  const code = typeof x?.code === 'string' ? x.code : '';
  const hint = typeof x?.hint === 'string' ? x.hint : '';
  extras?.(code, hint);
  if (code === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
  if (code === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu acesso não permite esta ação.');
  if (code === '22023') throw new ErroHttp(400, 'VALIDACAO', 'Dados inválidos.');
  throw e;
}

/** Retorno da `sa_*` conferido pelo contrato; formato diferente = erro interno (500), nunca dado fora do contrato. */
export function conferirRetorno<S extends z.ZodTypeAny>(schema: S, bruto: unknown, funcao: string): z.output<S> {
  const r = schema.safeParse(bruto);
  if (!r.success) throw new Error(`${funcao} devolveu formato diferente do combinado`);
  return r.data;
}
