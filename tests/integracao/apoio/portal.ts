/**
 * Apoio dos testes do portal `config.` só com e-mail e senha (T-0093; ADR 0031; desenho docs/desenho/T-0093.md §2 a §7).
 * Usado pelos testes de API com o `subirApi` (banco efêmero do arquivo, dois-tenants, pool do `macuxi_portal`).
 *  - `criarSuperAdmin`: como o deploy faz (P3): `plataforma.criar_super_admin` pela conexão de ADMINISTRAÇÃO, hash argon2id
 *    PHC do `@macuxi/db` (o mesmo do `tenant:criar` e da CLI `super-admin`); nunca pelo pool do portal nem do app;
 *  - `criarAdminCliente`: um `admin` (ou outro perfil) direto no `core.usuario` de um tenant, pela administração, para montar o
 *    mesmo e-mail em várias empresas (a fixture dois-tenants só repete o e-mail do vendedor);
 *  - `entrarNoPortal`: `POST /v1/plataforma/auth/login` de um IP próprio (o limite é 10/5 min por IP);
 *  - `tokenForjado`: JWT HS256 no formato do token do portal, para provar que assinatura, `typ`, `aud` e sessão são conferidos.
 * Senhas de teste aqui seguem a RN-CORE-32 (8+ com letra, número e caractere especial).
 */
import crypto from 'node:crypto';
import { hashSenha } from '@macuxi/db';
import { SessaoPortalSchema, type SessaoPortal } from '@macuxi/core/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { novoIp, type ApiDeTeste } from './api';
import { garantirFilialDosUsuarios } from './filial-usuario';

/** Nomes das `plataforma.sa_*` citadas num trecho de SQL registrado (`espiarSql`). */
const SA_FN = /plataforma\.(sa_[a-z_]+)\s*\(/g;
export const funcoesSa = (sql: readonly string[]): string[] => [...new Set(sql.flatMap((t) => [...t.matchAll(SA_FN)].map((m) => m[1]!)))].sort();

/** Super-admin pelo caminho do deploy (`criar_super_admin`, conexão de administração). Devolve o id. */
export async function criarSuperAdmin(admin: pg.Pool, sa: { email: string; nome: string; senha: string }): Promise<string> {
  const r = await admin.query<{ r: { resultado: string; super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
    JSON.stringify({ acao: 'criar', email: sa.email, nome: sa.nome, senha_hash: hashSenha(sa.senha) }),
  ]);
  const saida = r.rows[0]!.r;
  if (saida.resultado !== 'criado') throw new Error(`criar_super_admin: ${saida.resultado}`);
  return saida.super_admin_id;
}

/** Usuário de um tenant gravado pela administração (sem RLS no caminho), com a senha em argon2id e (T-0176) a filial padrão; `semFilial` o deixa travado. Devolve o id. */
export async function criarUsuarioNoTenant(
  admin: pg.Pool,
  u: { tenantId: string; email: string; nome: string; senha: string; perfil?: string; semFilial?: boolean },
): Promise<string> {
  const id = crypto.randomUUID();
  await admin.query('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [
    id,
    u.tenantId,
    u.nome,
    u.email,
    u.perfil ?? 'admin',
    hashSenha(u.senha),
  ]);
  // T-0176 (RN-CORE-39): com a 0077, a filial padrão do tenant como cadastro e venda (sem ela, 403 USUARIO_SEM_FILIAL no Core)
  if (!u.semFilial) await garantirFilialDosUsuarios(admin, [id]);
  return id;
}

/** `POST /v1/plataforma/auth/<caminho>` público, de um IP próprio (ou do informado). */
export function postPortal(api: ApiDeTeste, caminho: string, opcoes: { payload?: unknown; token?: string; ip?: string; requestId?: string } = {}): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `/v1/plataforma/auth/${caminho}`,
    remoteAddress: opcoes.ip ?? novoIp(),
    ...(opcoes.payload !== undefined ? { payload: opcoes.payload as object } : {}),
    headers: { ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}), ...(opcoes.requestId ? { 'x-request-id': opcoes.requestId } : {}) },
  });
}

export const entrarNoPortal = (api: ApiDeTeste, email: string, senha: string, ip?: string): Promise<LightMyRequestResponse> =>
  postPortal(api, 'login', { payload: { email, senha }, ...(ip ? { ip } : {}) });

/** Login que precisa dar certo: a sessão validada pelo contrato do SDK. */
export async function sessaoDoPortal(api: ApiDeTeste, email: string, senha: string): Promise<SessaoPortal> {
  const r = await entrarNoPortal(api, email, senha);
  if (r.statusCode !== 200) throw new Error(`login no portal falhou: ${r.statusCode} ${r.body}`);
  return SessaoPortalSchema.parse(r.json());
}

/** Escolhe (ou troca) a empresa: devolve a resposta crua (o teste confere status e corpo). */
export const escolherEmpresa = (api: ApiDeTeste, token: string, tenantId: string): Promise<LightMyRequestResponse> =>
  postPortal(api, 'empresa', { token, payload: { tenant_id: tenantId } });

/** JWT HS256 no formato do token do portal (para provar que assinatura, `aud`, `typ` e a sessão no banco são conferidos). */
export function tokenForjado(claims: Record<string, unknown>, segredo: string): string {
  const b = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const cab = b({ alg: 'HS256', typ: 'JWT' });
  const corpo = b(claims);
  return `${cab}.${corpo}.${crypto.createHmac('sha256', segredo).update(`${cab}.${corpo}`).digest('base64url')}`;
}

/** Claims decodificados de um token (sem conferir assinatura: só para montar o forjado a partir do verdadeiro). */
export function claimsDe(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}

export interface LinhaAuditoriaPortal {
  acao: string;
  ator_tipo: string | null;
  super_admin_id: string | null;
  usuario_id: string | null;
  sessao_id: string | null;
  tenant_alvo_id: string | null;
  metodo: string | null;
  rota: string | null;
  status: number | null;
  request_id: string | null;
  ip_prefixo: string | null;
  detalhes: Record<string, unknown>;
  bruto: string;
}

/** Toda a `plataforma.auditoria_plataforma` (pela administração), na ordem, com a linha inteira em texto para varredura. */
export async function auditoriaDoPortal(admin: pg.Pool): Promise<LinhaAuditoriaPortal[]> {
  const r = await admin.query<LinhaAuditoriaPortal>(
    `select acao, ator_tipo, super_admin_id, usuario_id, sessao_id, tenant_alvo_id, metodo, rota, status, request_id, ip_prefixo, detalhes,
            row_to_json(a)::text as bruto
       from plataforma.auditoria_plataforma a order by ocorrido_em, id`,
  );
  return r.rows;
}

/** O `onResponse` grava a auditoria depois de a resposta sair: espera os `request_id` chegarem (teto 5 s). */
export async function esperarAuditoria(admin: pg.Pool, requestIds: readonly string[]): Promise<LinhaAuditoriaPortal[]> {
  const limite = Date.now() + 5_000;
  for (;;) {
    const linhas = await auditoriaDoPortal(admin);
    const tem = new Set(linhas.map((l) => l.request_id));
    if (requestIds.every((x) => tem.has(x)) || Date.now() > limite) return linhas;
    await new Promise((r) => setTimeout(r, 100));
  }
}
