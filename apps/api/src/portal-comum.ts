/**
 * Encanamento comum das rotas do portal (RD-0405): quem entra (super-admin), a tradução do SQLSTATE das funções `sa_*` do
 * banco-dados e a conferência do retorno pelo contrato. Um lugar só para o texto do 401/403 e para os códigos comuns.
 */
import type { AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ErroHttp } from './erros';
import { marcarPortal } from './plataforma';

export interface AutenticacaoDoPortal {
  /** Quem entrou pelo portal; `null` = 401 (sem o banco do portal, lança 503 `PORTAL_INDISPONIVEL`). */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
}

/** 401 sem sessão; marca a requisição para a auditoria do portal; 403 `PERFIL_SEM_ACESSO` (com `mensagem403`) se não for super-admin. */
export async function exigirSuperAdmin(
  dep: AutenticacaoDoPortal,
  req: FastifyRequest,
  tenantId: string | null,
  mensagem403: string,
): Promise<AcessoPortalAutenticado & { tipo: 'super_admin' }> {
  const quem = await dep.autenticar(req);
  if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
  marcarPortal(req, { quem, tenantId });
  if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', mensagem403);
  return quem;
}

/**
 * SQLSTATE das `sa_*` → HTTP. Os casos próprios da rota entram por `extras` (chamado antes dos comuns, então também
 * troca a mensagem de um comum); `extras` que não lança cai nos comuns: 28000 = 401 (sessão vencida no meio), 42501 = 403,
 * 22023 = 400 `VALIDACAO`. Sem caso, relança o erro original.
 */
export function traduzirErroSa(e: unknown, extras?: (code: string | null, hint: string | null) => never | void): never {
  const x = e as { code?: unknown; hint?: unknown } | null;
  const code = typeof x?.code === 'string' ? x.code : null;
  const hint = typeof x?.hint === 'string' ? x.hint : null;
  extras?.(code, hint);
  if (code === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
  if (code === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu acesso não permite esta ação.');
  if (code === '22023') throw new ErroHttp(400, 'VALIDACAO', 'Dados inválidos.');
  throw e;
}

/** Confere o jsonb devolvido pela função do banco pelo contrato; formato errado = `Error` (500), nunca dado sem conferir. */
export function conferirRetorno<S extends z.ZodTypeAny>(schema: S, bruto: unknown, funcao: string): z.infer<S> {
  const r = schema.safeParse(bruto);
  if (!r.success) throw new Error(`${funcao} devolveu formato diferente do combinado`);
  return r.data;
}
