/**
 * "Zerar dados" da empresa no portal (`config.`, só super-admin; ADR 0068; desenho docs/desenho/empresa-zerar.md §5; RN-PLA-12),
 * da empresa inteira (menu ⋯) ou só de algumas entidades do ERP (aba Integração da empresa):
 *   GET  /v1/plataforma/empresas/:tenant_id/zerar/previa[?entidades=a,b]  200 PreviaZerarEmpresa (o que muda + bloqueio)
 *   POST /v1/plataforma/empresas/:tenant_id/zerar         202 ZerarEmpresa (senha do super-admin conferida de novo; id do portal)
 *   GET  /v1/plataforma/empresas/:tenant_id/zerar         200 ZerarEmpresa (o mais recente) · 404 ZERAR_NAO_ENCONTRADO
 * Tudo pelo banco do portal (`macuxi_portal`), só pelas `sa_*` da 0100, que conferem a sessão, revalidam a regra na transação
 * (`conferirZerar` do SDK) e auditam (`tenant.zerar_pedido`). A prévia e o worker (`empresa-zerar-worker.ts`) rodam a MESMA
 * `plataforma.limpar_cadastros`. Ligado com as ações da empresa (`MACUXI_EMPRESA_ACOES=1`). Sem dado pessoal no log; a senha e
 * o código digitado nunca vão a log nem voltam.
 */
import {
  CODIGOS_ZERAR_EMPRESA,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  mensagemDoZerar,
  PedirZerarEmpresaSchema,
  PreviaZerarEmpresaSchema,
  PreviaZerarQuerySchema,
  ROTAS_ZERAR_EMPRESA,
  ZerarEmpresaSchema,
  type AcessoBanco,
  type EntidadeZerar,
  type PedirZerarEmpresa,
  type PreviaZerarQuery,
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
  previa(sid: string, tenantId: string, entidades: EntidadeZerar[] | null, banco: AcessoBanco): Promise<unknown>;
  pedir(sid: string, tenantId: string, id: string, codigo: string, entidades: EntidadeZerar[] | null, banco: AcessoBanco): Promise<unknown>;
  /** O zerar mais recente; `null` = nenhum. */
  ler(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
}

const umValor = async (banco: AcessoBanco, sql: string, args: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, args)).rows[0]?.r ?? null);

export const fonteZerarEmpresaNoBanco: FonteZerarEmpresa = {
  previa: (sid, t, ent, banco) => umValor(banco, 'select plataforma.sa_previa_zerar($1, $2, $3::text[]) as r', [sid, t, ent]),
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
      // o mesmo id já usado no zerar de OUTRA empresa
      if (code === '23505') throw new ErroHttp(409, 'ID_EM_USO', 'Identificador já usado. Tente de novo.');
    });
  }
}

export function registrarRotasZerarEmpresa(app: FastifyInstance, dep: DepsZerarEmpresa): void {
  const fonte = dep.fonte ?? fonteZerarEmpresaNoBanco;
  const reautenticar = criarReautenticar(dep, dep.reautenticacao ?? fonteAcoesEmpresaNoBanco);
  /** RN-PLA-12: só super-admin; o admin do cliente recebe 403 `PERFIL_SEM_ACESSO`. */
  const exigir = (req: FastifyRequest, tenantId: string) => exigirSuperAdmin(dep.autenticar, req, tenantId, MENSAGEM_SO_SUPER_ADMIN_ACOES);
  const empresa = (req: FastifyRequest) => (dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>).tenant_id;

  app.get(ROTAS_ZERAR_EMPRESA.previa, async (req) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const { entidades } = dep.validar(PreviaZerarQuerySchema, req.query ?? {}, 'query') as PreviaZerarQuery;
    return conferir(PreviaZerarEmpresaSchema, await chamar(() => fonte.previa(quem.sessao_id, tenantId, entidades, dep.acesso)), 'sa_previa_zerar');
  });

  app.post(ROTAS_ZERAR_EMPRESA.zerar, async (req, reply) => {
    const tenantId = empresa(req);
    const quem = await exigir(req, tenantId);
    const { senha, id, codigo_confirmacao, entidades } = dep.validar(PedirZerarEmpresaSchema, req.body, 'corpo') as PedirZerarEmpresa;
    await reautenticar(quem, senha);
    // RN-PLA-12: a sa_pedir_zerar revalida a regra (conferirZerar) e o código na transação; o mesmo id devolve o mesmo zerar
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
