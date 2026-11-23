/**
 * "Zerar dados" da empresa no portal (`config.`, só super-admin; ADR 0068; desenho docs/desenho/empresa-zerar.md §5; RN-PLA-12),
 * da empresa inteira (menu ⋯) ou só de algumas entidades do ERP (aba Integração da empresa):
 *   POST /v1/plataforma/empresas/:tenant_id/zerar/previa             202 PreviaZerar (id do portal; o worker conta)
 *   GET  /v1/plataforma/empresas/:tenant_id/zerar/previa/:previa_id  200 PreviaZerar · 404 ZERAR_PREVIA_NAO_ENCONTRADA
 *   POST /v1/plataforma/empresas/:tenant_id/zerar         202 ZerarEmpresa (senha do super-admin conferida de novo; id do portal)
 *   GET  /v1/plataforma/empresas/:tenant_id/zerar         200 ZerarEmpresa (o mais recente) · 404 ZERAR_NAO_ENCONTRADO
 * Tudo pelo banco do portal (`macuxi_portal`), só pelas `sa_*` da 0100, que conferem a sessão, aplicam a regra na transação
 * (`plataforma.zerar_bloqueado`, a única cópia da RN-PLA-12) e auditam (`tenant.zerar_pedido`). A prévia não roda aqui: o pool
 * do portal tem prazo de 10 s, e a limpeza rodada e desfeita (a MESMA `plataforma.limpar_cadastros` do worker) leva mais numa
 * empresa grande; quem conta é o worker (`empresa-zerar-worker.ts`). Ligado com as ações da empresa (`MACUXI_EMPRESA_ACOES=1`).
 * Sem dado pessoal no log; a senha e o código digitado nunca vão a log nem voltam.
 */
import {
  CODIGOS_ZERAR_EMPRESA,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  mensagemDoZerar,
  PedirPreviaZerarSchema,
  PedirZerarEmpresaSchema,
  PreviaZerarSchema,
  ROTAS_ZERAR_EMPRESA,
  ZerarEmpresaSchema,
  type AcessoBanco,
  type EntidadeZerar,
  type PedirPreviaZerar,
  type PedirZerarEmpresa,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { criarReautenticar, fonteAcoesEmpresaNoBanco, type DepsAcoesEmpresa, type FonteReautenticar } from './empresa-acoes-portal';
import { ErroHttp } from './erros';
import { conferirRetorno as conferir, exigirSuperAdmin, traduzirErroSa } from './portal-comum';

const Z = CODIGOS_ZERAR_EMPRESA;

/**
 * Acesso às `sa_*` do zerar (0100; testes injetam a sua). Devolvem o jsonb cru; a rota confere pelo contrato do SDK.
 * `entidades`: `null` = a empresa inteira.
 */
export interface FonteZerarEmpresa {
  /** Pede a prévia (o worker conta); o mesmo id devolve a mesma. */
  pedirPrevia(sid: string, tenantId: string, id: string, entidades: EntidadeZerar[] | null, banco: AcessoBanco): Promise<unknown>;
  /** A prévia pelo id; `null` = não existe nesta empresa. */
  lerPrevia(sid: string, tenantId: string, id: string, banco: AcessoBanco): Promise<unknown>;
  pedir(sid: string, tenantId: string, id: string, codigo: string, entidades: EntidadeZerar[] | null, banco: AcessoBanco): Promise<unknown>;
  /** O zerar mais recente; `null` = nenhum. */
  ler(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
}

const umValor = async (banco: AcessoBanco, sql: string, args: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, args)).rows[0]?.r ?? null);

export const fonteZerarEmpresaNoBanco: FonteZerarEmpresa = {
  pedirPrevia: (sid, t, id, ent, banco) =>
    umValor(banco, 'select plataforma.sa_pedir_previa_zerar($1, $2, $3, $4::text[]) as r', [sid, t, id, ent]),
  lerPrevia: (sid, t, id, banco) => umValor(banco, 'select plataforma.sa_ler_previa_zerar($1, $2, $3) as r', [sid, t, id]),
  pedir: (sid, t, id, codigo, ent, banco) =>
    umValor(banco, 'select plataforma.sa_pedir_zerar($1, $2, $3, $4, $5::text[]) as r', [sid, t, id, codigo, ent]),
  ler: (sid, t, banco) => umValor(banco, 'select plataforma.sa_ler_zerar($1, $2) as r', [sid, t]),
};

export interface DepsZerarEmpresa extends Pick<DepsAcoesEmpresa, 'autenticar' | 'acesso' | 'validar' | 'segredoPlataforma' | 'conferirSenha' | 'relogio'> {
  fonte?: FonteZerarEmpresa;
  /** Conferência da senha (padrão: as `sa_reautenticar`/`sa_tentativa_*` das ações da empresa). */
  reautenticacao?: FonteReautenticar;
}

const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
const ParamsPrevia = z.object({ tenant_id: z.string().uuid(), previa_id: z.string().uuid() }).strict();
const CODIGOS_409 = new Set<string>([Z.zerarEmAndamento, Z.exclusaoEmAndamento, Z.backupEmAndamento, Z.hubProcessando]);
const CODIGOS_422 = new Set<string>([Z.codigoNaoConfere, Z.volumeAlto]);
const erro = (status: number, codigo: string) => new ErroHttp(status, codigo, mensagemDoZerar(codigo) ?? 'Não foi possível concluir.');

/** SQLSTATE das `sa_*` do zerar → HTTP, com o código do contrato no `hint` (os comuns ficam no `traduzirErroSa`). */
async function chamar<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    return traduzirErroSa(e, (code, hint) => {
      if (code === 'P0002') throw erro(404, Z.naoEncontrada);
      if (code === '55000' && CODIGOS_409.has(hint)) throw erro(409, hint);
      if (code === '22023' && CODIGOS_422.has(hint)) throw erro(422, hint);
      // o mesmo id já usado no zerar (ou na prévia) de OUTRA empresa
      if (code === '23505') throw erro(409, Z.idEmUso);
    });
  }
}

export function registrarRotasZerarEmpresa(app: FastifyInstance, dep: DepsZerarEmpresa): void {
  const fonte = dep.fonte ?? fonteZerarEmpresaNoBanco;
  const reautenticar = criarReautenticar(dep, dep.reautenticacao ?? fonteAcoesEmpresaNoBanco);
  /** RN-PLA-12: só super-admin; o admin do cliente recebe 403 `PERFIL_SEM_ACESSO`. */
  const exigir = (req: FastifyRequest, tenantId: string) => exigirSuperAdmin(dep.autenticar, req, tenantId, MENSAGEM_SO_SUPER_ADMIN_ACOES);
  const empresa = (req: FastifyRequest) => (dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>).tenant_id;

  app.post(ROTAS_ZERAR_EMPRESA.previa, async (req, reply) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const { id, entidades } = dep.validar(PedirPreviaZerarSchema, req.body, 'corpo') as PedirPreviaZerar;
    const r = await chamar(() => fonte.pedirPrevia(quem.sessao_id, tenantId, id, entidades, dep.acesso));
    const previa = conferir(PreviaZerarSchema, r, 'sa_pedir_previa_zerar');
    req.log.info({ previa_id: previa.id, tenant_alvo_id: tenantId, situacao: previa.situacao, entidades: previa.entidades }, 'prévia do zerar pedida');
    return reply.code(202).send(previa);
  });

  app.get(ROTAS_ZERAR_EMPRESA.previaLer, async (req) => {
    const { tenant_id: tenantId, previa_id: id } = dep.validar(ParamsPrevia, req.params, 'params') as z.output<typeof ParamsPrevia>;
    const quem = await exigir(req, tenantId);
    const r = await chamar(() => fonte.lerPrevia(quem.sessao_id, tenantId, id, dep.acesso));
    if (r === null || r === undefined) throw erro(404, Z.previaNaoEncontrada);
    return conferir(PreviaZerarSchema, r, 'sa_ler_previa_zerar');
  });

  app.post(ROTAS_ZERAR_EMPRESA.zerar, async (req, reply) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const { senha, id, codigo_confirmacao, entidades } = dep.validar(PedirZerarEmpresaSchema, req.body, 'corpo') as PedirZerarEmpresa;
    await reautenticar(quem, senha);
    // RN-PLA-12: a sa_pedir_zerar aplica a regra (zerar_bloqueado) e confere o código na transação; o mesmo id devolve o mesmo zerar
    const r = await chamar(() => fonte.pedir(quem.sessao_id, tenantId, id, codigo_confirmacao, entidades, dep.acesso));
    const zerar = conferir(ZerarEmpresaSchema, r, 'sa_pedir_zerar');
    req.log.info({ zerar_id: zerar.id, tenant_alvo_id: tenantId, situacao: zerar.situacao, entidades: zerar.entidades }, 'zerar dados pedido');
    return reply.code(202).send(zerar);
  });

  app.get(ROTAS_ZERAR_EMPRESA.zerar, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const r = await chamar(() => fonte.ler(quem.sessao_id, tenantId, dep.acesso));
    if (r === null || r === undefined) throw erro(404, Z.zerarNaoEncontrado);
    return conferir(ZerarEmpresaSchema, r, 'sa_ler_zerar');
  });
}
