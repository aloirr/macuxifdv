/**
 * Ações sobre a empresa no portal (`config.`, só super-admin; ADR 0052; desenho docs/desenho/empresa-acoes.md; pedido do dono
 * do produto R-20261114-195600-alexandre): Inativar/Reativar (RN-PLA-07), Backup (RN-PLA-08) e Excluir (RN-PLA-09/10). Rotas: R-20261114-221000-alexandre.
 *   POST /v1/plataforma/empresas/:tenant_id/inativar              200 SituacaoEmpresaResposta (idempotente)
 *   POST /v1/plataforma/empresas/:tenant_id/reativar              200 SituacaoEmpresaResposta (idempotente)
 *   POST /v1/plataforma/empresas/:tenant_id/backups               202 BackupEmpresa (id do portal; 503 sem bucket ou chave)
 *   GET  /v1/plataforma/empresas/:tenant_id/backups[/:backup_id]  200 ListaBackupsEmpresa / BackupEmpresa
 *   POST /v1/plataforma/empresas/:tenant_id/exclusao              202 ExclusaoEmpresa (senha do super-admin conferida de novo)
 *   GET  /v1/plataforma/empresas/:tenant_id/exclusao              200 ExclusaoEmpresa (também depois de concluída)
 * E o bloco `acoes` de cada item do `GET /v1/plataforma/empresas` (`acoesDasEmpresas`, juntado pelo `plataforma.ts`).
 * Tudo pelo banco do portal (`macuxi_portal`), só pelas funções `SECURITY DEFINER` `sa_*` da 0072, que conferem a sessão,
 * revalidam a regra na transação (a `exclusao_bloqueada` é a `conferirExclusao` do SDK) e auditam; a API audita a requisição
 * no `onResponse` (`marcarPortal`). Ligado só com `empresaAcoesPortal` (`MACUXI_EMPRESA_ACOES=1` no `servidor.ts`).
 * Sem dado pessoal no log: só ids e códigos. A senha da confirmação nunca volta, nunca vai a log nem ao banco.
 */
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import { verificarSenha } from '@macuxi/db';
import {
  AcoesDaEmpresaSchema,
  BackupEmpresaSchema,
  CODIGOS_ACOES_EMPRESA,
  ExcluirEmpresaSchema,
  ExclusaoEmpresaSchema,
  InativarEmpresaSchema,
  ListaBackupsEmpresaSchema,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  MENSAGENS_ACOES_EMPRESA,
  PedirBackupEmpresaSchema,
  ReativarEmpresaSchema,
  ROTAS_ACOES_EMPRESA,
  SituacaoEmpresaRespostaSchema,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type AcoesDaEmpresa,
  type CodigoAcaoEmpresa,
  type ExcluirEmpresa,
  type InativarEmpresa,
  type PedirBackupEmpresa,
} from '@macuxi/platform-sdk';
import { chaveDeTentativaDoPortal } from '@macuxi/platform-sdk/tentativas-portal';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import { conferirRetorno as conferir, exigirSuperAdmin, traduzirErroSa, type AutenticarPortal } from './portal-comum';

const C = CODIGOS_ACOES_EMPRESA;
const M = MENSAGENS_ACOES_EMPRESA;

/** Linha da `sa_reautenticar` (0 linhas = conta inativa). O hash nunca sai daqui. */
export interface ContaParaReautenticar {
  super_admin_id: string;
  email: string;
  senha_hash: string;
}

/** Estado das tentativas de senha do portal (`sa_tentativa_*`, as mesmas do login do portal). */
export interface EstadoTentativaPortal {
  falhas: number;
  bloqueado_ate: Date | null;
}

/** Acesso às funções `sa_*` da 0072 (testes injetam a sua). Devolvem o jsonb cru; a rota confere pelo contrato do SDK. */
export interface FonteAcoesEmpresa {
  inativar(sid: string, tenantId: string, motivo: string | null, banco: AcessoBanco): Promise<unknown>;
  reativar(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  pedirBackup(sid: string, tenantId: string, backupId: string, banco: AcessoBanco): Promise<unknown>;
  /** `{ itens }`; `backupId` = só aquele (lista vazia = 404). */
  listarBackups(sid: string, tenantId: string, backupId: string | null, banco: AcessoBanco): Promise<unknown>;
  pedirExclusao(sid: string, tenantId: string, e: Omit<ExcluirEmpresa, 'senha'>, banco: AcessoBanco): Promise<unknown>;
  /** A exclusão mais recente; `null` = nenhuma. */
  lerExclusao(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  reautenticar(sid: string, banco: AcessoBanco): Promise<ContaParaReautenticar | null>;
  tentativaEstado(chave: string, banco: AcessoBanco): Promise<EstadoTentativaPortal>;
  tentativaFalha(chave: string, banco: AcessoBanco): Promise<EstadoTentativaPortal>;
  tentativaSucesso(chave: string, banco: AcessoBanco): Promise<void>;
  /** `{ itens: [{ tenant_id, ...AcoesDaEmpresa }] }` das empresas vivas. */
  acoesDasEmpresas(sid: string, banco: AcessoBanco): Promise<unknown>;
}

const umValor = async (banco: AcessoBanco, sql: string, args: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, args)).rows[0]?.r ?? null);
const tentativa = async (banco: AcessoBanco, funcao: string, chave: string): Promise<EstadoTentativaPortal> =>
  banco.semTenant(async (db) => {
    const r = (await db.query<{ falhas: unknown; bloqueado_ate: unknown }>(`select * from plataforma.${funcao}($1)`, [chave])).rows[0];
    return { falhas: Number(r?.falhas ?? 0), bloqueado_ate: r?.bloqueado_ate ? new Date(r.bloqueado_ate as string) : null };
  });

export const fonteAcoesEmpresaNoBanco: FonteAcoesEmpresa = {
  inativar: (sid, t, motivo, banco) => umValor(banco, 'select plataforma.sa_inativar_tenant($1, $2, $3) as r', [sid, t, motivo]),
  reativar: (sid, t, banco) => umValor(banco, 'select plataforma.sa_reativar_tenant($1, $2) as r', [sid, t]),
  pedirBackup: (sid, t, id, banco) => umValor(banco, 'select plataforma.sa_pedir_backup($1, $2, $3) as r', [sid, t, id]),
  listarBackups: (sid, t, id, banco) => umValor(banco, 'select plataforma.sa_listar_backups($1, $2, $3) as r', [sid, t, id]),
  pedirExclusao: (sid, t, e, banco) =>
    umValor(banco, 'select plataforma.sa_pedir_exclusao($1, $2, $3, $4, $5) as r', [sid, t, e.id, e.backup_id, e.codigo_confirmacao]),
  lerExclusao: (sid, t, banco) => umValor(banco, 'select plataforma.sa_ler_exclusao($1, $2) as r', [sid, t]),
  reautenticar: (sid, banco) =>
    banco.semTenant(async (db) => (await db.query<ContaParaReautenticar>('select * from plataforma.sa_reautenticar($1)', [sid])).rows[0] ?? null),
  tentativaEstado: (chave, banco) => tentativa(banco, 'sa_tentativa_estado', chave),
  tentativaFalha: (chave, banco) => tentativa(banco, 'sa_tentativa_falha', chave),
  tentativaSucesso: async (chave, banco) => {
    await umValor(banco, 'select plataforma.sa_tentativa_sucesso($1) as r', [chave]);
  },
  acoesDasEmpresas: (sid, banco) => umValor(banco, 'select plataforma.sa_acoes_das_empresas($1) as r', [sid]),
};

export interface DepsAcoesEmpresa {
  autenticar: AutenticarPortal;
  acesso: AcessoBanco;
  fonte?: FonteAcoesEmpresa;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  /** Bucket S3 e `MACUXI_BACKUP_EMPRESA_CHAVE` configurados (falso = 503 `BACKUP_INDISPONIVEL` no pedido de backup). */
  backupDisponivel: boolean;
  /** Segredo do portal (`MACUXI_JWT_SEGREDO_PLATAFORMA`), o da chave de tentativas; ausente = 503 na exclusão. */
  segredoPlataforma: () => string | undefined;
  /** Conferência argon2id (padrão: `verificarSenha` do `@macuxi/db`). */
  conferirSenha?: (senha: string, phc: string) => boolean | Promise<boolean>;
  relogio?: () => Date;
}

const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
const ParamsBackup = z.object({ tenant_id: z.string().uuid(), backup_id: z.string().uuid() }).strict();
const AcoesComTenantSchema = z.object({ itens: z.array(AcoesDaEmpresaSchema.extend({ tenant_id: z.string().uuid() })) });

const CODIGOS_409 = new Set<string>([C.exclusaoEmAndamento, C.backupEmAndamento]);
const CODIGOS_422 = new Set<string>([
  C.exclusaoEmpresaAtiva,
  C.exclusaoSemBackup,
  C.exclusaoBackupAntesDaInativacao,
  C.exclusaoBackupVencido,
  C.exclusaoCodigoNaoConfere,
]);
/** A frase de cada recusa vem do SDK (`MENSAGENS_ACOES_EMPRESA`, spec §15.2): a mesma da tela. */
const erroDaAcao = (status: number, codigo: CodigoAcaoEmpresa) => new ErroHttp(status, codigo, M[codigo]);

/** SQLSTATE próprios das `sa_*` da 0072 → HTTP, com o código do contrato no `hint` (os comuns, inclusive o 22023 sem hint, ficam no `traduzirErroSa`). */
function traduzir(e: unknown): never {
  return traduzirErroSa(e, (code, hint) => {
    if (code === 'P0002') throw erroDaAcao(404, C.naoEncontrada);
    if (code === '55000' && hint && CODIGOS_409.has(hint)) throw erroDaAcao(409, hint as CodigoAcaoEmpresa);
    if (code === '22023' && hint && CODIGOS_422.has(hint)) throw erroDaAcao(422, hint as CodigoAcaoEmpresa);
    // o mesmo id já usado em backup ou exclusão de OUTRA empresa
    if (code === '23505') throw new ErroHttp(409, 'ID_EM_USO', 'Identificador já usado. Tente de novo.');
  });
}

async function chamar<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * Bloco `acoes` por empresa, para o `GET /v1/plataforma/empresas` (só super-admin; o admin do cliente não vê as ações).
 * Devolve `Map<tenant_id, AcoesDaEmpresa>`.
 */
export async function acoesDasEmpresas(
  quem: AcessoPortalAutenticado,
  acesso: AcessoBanco,
  fonte: FonteAcoesEmpresa = fonteAcoesEmpresaNoBanco,
): Promise<Map<string, AcoesDaEmpresa>> {
  if (quem.tipo !== 'super_admin') return new Map();
  const lista = conferir(AcoesComTenantSchema, await chamar(() => fonte.acoesDasEmpresas(quem.sessao_id, acesso)), 'sa_acoes_das_empresas');
  return new Map(lista.itens.map(({ tenant_id, ...acoes }) => [tenant_id, acoes]));
}

export function registrarRotasAcoesEmpresa(app: FastifyInstance, dep: DepsAcoesEmpresa): void {
  const fonte = dep.fonte ?? fonteAcoesEmpresaNoBanco;
  const conferirSenha = dep.conferirSenha ?? verificarSenha;
  const relogio = dep.relogio ?? (() => new Date());

  /** Só super-admin (RN-PLA-07); o admin do cliente recebe 403 `PERFIL_SEM_ACESSO`. */
  const exigir = (req: FastifyRequest, tenantId: string) => exigirSuperAdmin(dep.autenticar, req, tenantId, MENSAGEM_SO_SUPER_ADMIN_ACOES);
  const empresa = (req: FastifyRequest) => (dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>).tenant_id;

  /**
   * Confirmação forte da exclusão (ADR 0052 §3.2): a senha do super-admin DA SESSÃO, no mesmo limite de falhas do login do
   * portal (5 seguidas = 423 por 15 min). Senha errada = 403 `REAUTENTICACAO_FALHOU`.
   */
  const reautenticar = async (quem: AcessoPortalAutenticado, senha: string): Promise<void> => {
    const segredo = dep.segredoPlataforma();
    if (!segredo || segredo.length < 32)
      throw new ErroHttp(503, CODIGOS_PORTAL.indisponivel, 'O acesso ao portal está indisponível no momento. Avise o suporte da Macuxi.');
    const conta = await chamar(() => fonte.reautenticar(quem.sessao_id, dep.acesso));
    if (!conta) throw erroDaAcao(403, C.reautenticacaoFalhou);
    const chave = chaveDeTentativaDoPortal(segredo, conta.email);
    const bloqueada = (e: EstadoTentativaPortal) => e.bloqueado_ate !== null && e.bloqueado_ate.getTime() > relogio().getTime();
    const bloqueio = () => new ErroHttp(423, CODIGOS_PORTAL.bloqueado, 'Acesso bloqueado por tentativas erradas. Tente de novo em 15 minutos.');
    if (bloqueada(await fonte.tentativaEstado(chave, dep.acesso))) throw bloqueio();
    if (!(await conferirSenha(senha, conta.senha_hash))) {
      if (bloqueada(await fonte.tentativaFalha(chave, dep.acesso))) throw bloqueio();
      throw erroDaAcao(403, C.reautenticacaoFalhou);
    }
    await fonte.tentativaSucesso(chave, dep.acesso);
  };

  app.post(ROTAS_ACOES_EMPRESA.inativar, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const corpo = dep.validar(InativarEmpresaSchema, req.body ?? {}, 'corpo') as InativarEmpresa;
    const r = await chamar(() => fonte.inativar(quem.sessao_id, tenantId, corpo.motivo ?? null, dep.acesso));
    return conferir(SituacaoEmpresaRespostaSchema, r, 'sa_inativar_tenant');
  });

  app.post(ROTAS_ACOES_EMPRESA.reativar, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    dep.validar(ReativarEmpresaSchema, req.body ?? {}, 'corpo');
    const r = await chamar(() => fonte.reativar(quem.sessao_id, tenantId, dep.acesso));
    return conferir(SituacaoEmpresaRespostaSchema, r, 'sa_reativar_tenant');
  });

  app.post(ROTAS_ACOES_EMPRESA.backups, async (req, reply) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const corpo = dep.validar(PedirBackupEmpresaSchema, req.body, 'corpo') as PedirBackupEmpresa;
    // falha fechada (ADR 0052 §2.3): sem bucket ou sem chave, nada é gravado
    if (!dep.backupDisponivel)
      throw erroDaAcao(503, C.backupIndisponivel);
    const r = await chamar(() => fonte.pedirBackup(quem.sessao_id, tenantId, corpo.id, dep.acesso));
    return reply.code(202).send(conferir(BackupEmpresaSchema, r, 'sa_pedir_backup'));
  });

  app.get(ROTAS_ACOES_EMPRESA.backups, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const r = await chamar(() => fonte.listarBackups(quem.sessao_id, tenantId, null, dep.acesso));
    return conferir(ListaBackupsEmpresaSchema, r, 'sa_listar_backups');
  });

  app.get(ROTAS_ACOES_EMPRESA.backup, async (req) => {
    const { tenant_id, backup_id } = dep.validar(ParamsBackup, req.params, 'params') as z.output<typeof ParamsBackup>;
    const quem = await exigir(req, tenant_id);
    const r = await chamar(() => fonte.listarBackups(quem.sessao_id, tenant_id, backup_id, dep.acesso));
    const [backup] = conferir(ListaBackupsEmpresaSchema, r, 'sa_listar_backups').itens;
    if (!backup) throw new ErroHttp(404, 'BACKUP_NAO_ENCONTRADO', 'Backup não encontrado.');
    return backup;
  });

  app.post(ROTAS_ACOES_EMPRESA.exclusao, async (req, reply) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const { senha, ...pedido } = dep.validar(ExcluirEmpresaSchema, req.body, 'corpo') as ExcluirEmpresa;
    await reautenticar(quem, senha);
    // RN-PLA-09: a sa_pedir_exclusao revalida a regra (exclusao_bloqueada = conferirExclusao) e o código na transação
    const r = await chamar(() => fonte.pedirExclusao(quem.sessao_id, tenantId, pedido, dep.acesso));
    return reply.code(202).send(conferir(ExclusaoEmpresaSchema, r, 'sa_pedir_exclusao'));
  });

  app.get(ROTAS_ACOES_EMPRESA.exclusao, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const r = await chamar(() => fonte.lerExclusao(quem.sessao_id, tenantId, dep.acesso));
    if (r === null || r === undefined) throw new ErroHttp(404, 'EXCLUSAO_NAO_ENCONTRADA', 'Nenhuma exclusão pedida para esta empresa.');
    return conferir(ExclusaoEmpresaSchema, r, 'sa_ler_exclusao');
  });
}
