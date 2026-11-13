/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §2 e §3): Portal › Diagnósticos. Só o SUPER-ADMIN (o time da Macuxi,
 * cada pessoa com a própria conta, ADR 0029); o admin do cliente recebe 403. Tudo pelo banco do portal (`macuxi_portal`,
 * T-0091), só pelas funções `SECURITY DEFINER` da 0058 (`sa_listar_diagnosticos`, `sa_diagnostico`), que conferem a sessão
 * e auditam; a API audita a requisição no `onResponse` (`marcarPortal`), como as outras rotas do portal.
 *   GET /v1/plataforma/diagnosticos            lista (filtros versao, modelo, tenant_id, motivo, origem, de, ate, cursor)
 *   GET /v1/plataforma/diagnosticos/:id        detalhe técnico (sem a chave do armazenamento)
 *   GET /v1/plataforma/diagnosticos/:id/print  bytes do print pela porta `ArmazenamentoArquivos`, `private, no-store`
 *                                              (sem URL pré-assinada, ADR 0041 §4)
 * Ligado só com `diagnosticosPortal` (`MACUXI_DIAGNOSTICOS=1` no `servidor.ts`): desligado, as rotas nem existem (404).
 * Log sem texto do aparelho: só ids e o status.
 */
import {
  DiagnosticoDetalheSchema,
  DiagnosticoFiltroSchema,
  DiagnosticoListaSchema,
  ROTA_PORTAL_DIAGNOSTICOS,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type DiagnosticoFiltro,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ArmazenamentoArquivos } from './arquivos';
import { ErroHttp } from './erros';
import { marcarPortal } from './plataforma';

/** Acesso às funções da 0058 (testes injetam a sua). Devolvem o jsonb cru; a rota confere pelo contrato do SDK. */
export interface FonteDiagnosticosPortal {
  listar(sid: string, filtro: DiagnosticoFiltro, banco: AcessoBanco): Promise<unknown>;
  /** Detalhe com `chave_armazenamento` do print recebido (nula sem print). */
  detalhe(sid: string, id: string, banco: AcessoBanco): Promise<unknown>;
}

export const fonteDiagnosticosNoBanco: FonteDiagnosticosPortal = {
  listar: (sid, filtro, banco) =>
    banco.semTenant(async (db) => (await db.query<{ r: unknown }>('select plataforma.sa_listar_diagnosticos($1, $2::jsonb) as r', [sid, JSON.stringify(filtro)])).rows[0]?.r),
  detalhe: (sid, id, banco) =>
    banco.semTenant(async (db) => (await db.query<{ r: unknown }>('select plataforma.sa_diagnostico($1, $2) as r', [sid, id])).rows[0]?.r),
};

export interface DepsDiagnosticosPortal {
  /** Banco do portal (`macuxi_portal`). */
  acesso: AcessoBanco;
  fonte?: FonteDiagnosticosPortal;
  /** Quem entrou pelo portal; `null` = 401. */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  /** Bytes do print; `null` = o print responde 503. */
  armazenamento: ArmazenamentoArquivos | null;
}

const Params = z.object({ id: z.string().uuid() }).strict();
const ChavePrint = z.object({ chave_armazenamento: z.string().nullable().optional() });

/** SQLSTATE das `sa_*` da 0058 → HTTP (sessão vencida no meio = 401; cliente = 403; não achou = 404; filtro = 400). */
function traduzir(e: unknown): never {
  const c = (e as { code?: unknown } | null)?.code;
  if (c === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
  if (c === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi vê os diagnósticos.');
  if (c === 'P0002') throw new ErroHttp(404, 'DIAGNOSTICO_NAO_ENCONTRADO', 'Diagnóstico não encontrado.');
  if (c === '22023') throw new ErroHttp(400, 'VALIDACAO', 'Filtro inválido.');
  throw e;
}

export function registrarRotasDiagnosticosPortal(app: FastifyInstance, dep: DepsDiagnosticosPortal): void {
  const fonte = dep.fonte ?? fonteDiagnosticosNoBanco;
  const exigirSuperAdmin = async (req: FastifyRequest): Promise<AcessoPortalAutenticado & { tipo: 'super_admin' }> => {
    const quem = await dep.autenticar(req);
    if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarPortal(req, { quem, tenantId: null });
    if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi vê os diagnósticos.');
    return quem;
  };
  const detalheCru = async (quem: { sessao_id: string }, id: string): Promise<unknown> => {
    try {
      return await fonte.detalhe(quem.sessao_id, id, dep.acesso);
    } catch (e) {
      return traduzir(e);
    }
  };

  app.get(ROTA_PORTAL_DIAGNOSTICOS, async (req) => {
    const quem = await exigirSuperAdmin(req);
    const filtro = dep.validar(DiagnosticoFiltroSchema, req.query ?? {}, 'query') as DiagnosticoFiltro;
    let bruto: unknown;
    try {
      bruto = await fonte.listar(quem.sessao_id, filtro, dep.acesso);
    } catch (e) {
      traduzir(e);
    }
    const r = DiagnosticoListaSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_listar_diagnosticos devolveu formato diferente do combinado (0058; DiagnosticoListaSchema)');
    return r.data;
  });

  app.get(`${ROTA_PORTAL_DIAGNOSTICOS}/:id`, async (req) => {
    const { id } = dep.validar(Params, req.params, 'params') as z.output<typeof Params>;
    const quem = await exigirSuperAdmin(req);
    // o contrato descarta o que não é dele (chave_armazenamento e print_id não saem da API)
    const r = DiagnosticoDetalheSchema.safeParse(await detalheCru(quem, id));
    if (!r.success) throw new Error('sa_diagnostico devolveu formato diferente do combinado (0058; DiagnosticoDetalheSchema)');
    return r.data;
  });

  app.get(`${ROTA_PORTAL_DIAGNOSTICOS}/:id/print`, async (req, reply) => {
    const { id } = dep.validar(Params, req.params, 'params') as z.output<typeof Params>;
    const quem = await exigirSuperAdmin(req);
    const d = ChavePrint.safeParse(await detalheCru(quem, id));
    const chave = d.success ? d.data.chave_armazenamento : null;
    const semPrint = () => new ErroHttp(404, 'PRINT_NAO_ENCONTRADO', 'Este diagnóstico não tem print.');
    if (!chave) throw semPrint();
    if (!dep.armazenamento) throw new ErroHttp(503, 'ARQUIVOS_INDISPONIVEIS', 'Armazenamento de arquivos indisponível. Tente de novo em instantes.');
    const bytes = await dep.armazenamento.ler(chave);
    if (!bytes) {
      req.log.warn({ diagnostico_id: id }, 'bytes do print ausentes no armazenamento');
      throw semPrint();
    }
    return reply.code(200).header('content-type', 'image/jpeg').header('cache-control', 'private, no-store').send(Buffer.from(bytes));
  });
}
