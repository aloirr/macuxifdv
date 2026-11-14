/**
 * Planos e licenças no portal (`config.`; ADR 0047; desenho docs/desenho/planos-e-licencas.md; R-20261114-132600-alexandre,
 * item 1). O catálogo é DADO (`plataforma.plano`, seed do banco-dados); a API só aplica as regras puras do SDK (`planos.ts`) e
 * revalida antes de gravar. Tudo pelo banco do portal (`macuxi_portal`), só pelas funções `SECURITY DEFINER` `sa_*`, que
 * conferem a sessão e auditam; a API audita a requisição no `onResponse` (`marcarPortal`), como as outras rotas do portal.
 *   GET  /v1/plataforma/planos                                catálogo (super-admin e admin do cliente)
 *   POST /v1/plataforma/empresas-com-plano                    passo Empresa com o plano (só super-admin; `simular` não grava)
 *   GET  /v1/plataforma/empresas/:tenant_id/assinatura        ficha (super-admin; admin do cliente só a da sessão)
 *   PUT  /v1/plataforma/empresas/:tenant_id/assinatura        troca de plano (só super-admin; RN-PLA-05)
 * Ligado só com `planosPortal` (`MACUXI_PLANOS=1` no `servidor.ts`): desligado, as rotas nem existem (404).
 * Sem dado pessoal no log: só ids e códigos.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import {
  conferirEscolhaDePlano,
  conferirTrocaDePlano,
  CriarEmpresaComPlanoRespostaSchema,
  CriarEmpresaComPlanoSchema,
  FichaAssinaturaSchema,
  fimDoTeste,
  ITENS_CONTADOS,
  ListaPlanosSchema,
  modulosDaAssinatura,
  ROTA_PORTAL_EMPRESA_COM_PLANO,
  ROTA_PORTAL_PLANOS,
  UsoDeLicencaSchema,
  usoPorItem,
  valorDaAssinatura,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type AdicionalContratado,
  type Ciclo,
  type CriarEmpresaComPlano,
  type FichaAssinatura,
  type Plano,
  type ProblemaDePlano,
  type TrocarPlano,
  TrocarPlanoSchema,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import type { ConsultaCnpj } from './consulta-cnpj';
import { criarEmpresaNoPortal, exigirCnpjAtivo, marcarPortal, type DepsCriarEmpresa } from './plataforma';

/** Assinatura gravada pela `sa_gravar_assinatura` (idempotente: uma por tenant). */
export interface EntradaAssinatura {
  plano: string;
  ciclo: Ciclo;
  adicionais: AdicionalContratado[];
  teste_ate: string | null;
  paga: boolean;
  pedido_id: string;
}

/** Troca pela `sa_trocar_plano` (idempotente por `pedido_id`; liga os `modulos` no `tenant_modulo`, nunca desliga com usuário). */
export interface EntradaTrocaDePlano {
  plano: string;
  ciclo: Ciclo;
  adicionais: AdicionalContratado[];
  pedido_id: string;
  modulos: string[];
}

/** Acesso às funções `sa_*` dos planos (testes injetam a sua). Devolvem o jsonb cru; a rota confere pelo contrato. */
export interface FontePlanosPortal {
  listar(sid: string, banco: AcessoBanco): Promise<unknown>;
  gravarAssinatura(sid: string, tenantId: string, e: EntradaAssinatura, banco: AcessoBanco): Promise<unknown>;
  /** Ficha crua (sem `valor`); sem assinatura = SQLSTATE P0002. */
  assinatura(sid: string, tenantId: string, banco: AcessoBanco): Promise<unknown>;
  trocar(sid: string, tenantId: string, e: EntradaTrocaDePlano, banco: AcessoBanco): Promise<unknown>;
}

const umValor = async (banco: AcessoBanco, sql: string, args: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, args)).rows[0]?.r);

export const fontePlanosNoBanco: FontePlanosPortal = {
  listar: (sid, banco) => umValor(banco, 'select plataforma.sa_listar_planos($1) as r', [sid]),
  gravarAssinatura: (sid, tenantId, e, banco) => umValor(banco, 'select plataforma.sa_gravar_assinatura($1, $2, $3::jsonb) as r', [sid, tenantId, JSON.stringify(e)]),
  assinatura: (sid, tenantId, banco) => umValor(banco, 'select plataforma.sa_assinatura_da_empresa($1, $2) as r', [sid, tenantId]),
  trocar: (sid, tenantId, e, banco) => umValor(banco, 'select plataforma.sa_trocar_plano($1, $2, $3::jsonb) as r', [sid, tenantId, JSON.stringify(e)]),
};

export interface DepsPlanosPortal extends DepsCriarEmpresa {
  fontePlanos?: FontePlanosPortal;
  /** Quem entrou pelo portal; `null` = 401. */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  /** Relógio (o "hoje" do teste grátis no fuso da empresa). */
  relogio?: () => Date;
  /** ADR 0048, item 8: a Receita confere o CNPJ (só ATIVA cria) e dá a UF do código da licença, como no passo Empresa. */
  consultaCnpj: ConsultaCnpj;
}

const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
/** Ficha como a `sa_assinatura_da_empresa` devolve: sem o `valor` (a API calcula) e as licenças em qualquer ordem. */
const FichaCruaSchema = FichaAssinaturaSchema.omit({ valor: true, licencas: true }).extend({ licencas: z.array(UsoDeLicencaSchema) });
const GravouSchema = z.object({ resultado: z.enum(['criada', 'existente']), teste_ate: z.string().nullable() });

const SEM_ASSINATURA = () => new ErroHttp(404, 'SEM_ASSINATURA', 'Esta empresa ainda não tem plano.');

/**
 * SQLSTATE das `sa_*` → HTTP: sessão vencida no meio = 401; sem permissão = 403; não achou = 404; 22023 = 422 na escrita (com
 * o código RN no `hint`, ex.: `PLANO_ABAIXO_DO_USO` quando o banco recusa na transação por corrida) e 400 na leitura.
 */
function traduzir(e: unknown, escrita: boolean, naoAchou: () => ErroHttp = SEM_ASSINATURA): never {
  const x = e as { code?: unknown; hint?: unknown; message?: unknown } | null;
  if (x?.code === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
  if (x?.code === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu acesso não permite esta ação.');
  if (x?.code === 'P0002') throw naoAchou();
  if (x?.code === '22023') {
    if (!escrita) throw new ErroHttp(400, 'VALIDACAO', 'Pedido inválido.');
    const codigo = typeof x.hint === 'string' && /^[A-Z][A-Z0-9_-]{2,40}$/.test(x.hint) ? x.hint : 'VALIDACAO';
    throw new ErroHttp(422, codigo, 'O plano não cobre a empresa agora. Confira as licenças em uso.');
  }
  throw e;
}

const recusar = (problemas: readonly ProblemaDePlano[]): never => {
  const [primeiro] = problemas;
  throw new ErroHttp(422, primeiro?.codigo ?? 'VALIDACAO', primeiro?.mensagem ?? 'Plano inválido.', { problemas: problemas.map((p) => ({ ...p })) });
};

export function registrarRotasPlanosPortal(app: FastifyInstance, dep: DepsPlanosPortal): void {
  const fonte = dep.fontePlanos ?? fontePlanosNoBanco;
  const relogio = dep.relogio ?? (() => new Date());

  const exigir = async (req: FastifyRequest, tenantId: string | null): Promise<AcessoPortalAutenticado> => {
    const quem = await dep.autenticar(req);
    if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarPortal(req, { quem, tenantId: tenantId ?? (quem.tipo === 'admin_cliente' ? (quem.empresa?.tenant_id ?? null) : null) });
    return quem;
  };
  const soSuperAdmin = (quem: AcessoPortalAutenticado, acao: string): void => {
    if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', `Só o time da Macuxi ${acao}.`);
  };

  const planos = async (quem: AcessoPortalAutenticado): Promise<Plano[]> => {
    let bruto: unknown;
    try {
      bruto = await fonte.listar(quem.sessao_id, dep.acesso);
    } catch (e) {
      traduzir(e, false);
    }
    const r = ListaPlanosSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_listar_planos devolveu formato diferente do combinado (ADR 0047; ListaPlanosSchema)');
    return [...r.data.itens].sort((a, b) => a.ordem - b.ordem);
  };
  const planoPeloCodigo = async (quem: AcessoPortalAutenticado, codigo: string): Promise<Plano> => {
    const p = (await planos(quem)).find((x) => x.codigo === codigo);
    if (!p) throw new ErroHttp(422, 'PLANO_DESCONHECIDO', 'Plano não encontrado no catálogo.', { campo: 'plano' });
    return p;
  };
  const ficha = async (quem: AcessoPortalAutenticado, tenantId: string): Promise<FichaAssinatura> => {
    let bruto: unknown;
    try {
      bruto = await fonte.assinatura(quem.sessao_id, tenantId, dep.acesso);
    } catch (e) {
      traduzir(e, false);
    }
    if (bruto === null || bruto === undefined) throw SEM_ASSINATURA();
    const r = FichaCruaSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_assinatura_da_empresa devolveu formato diferente do combinado (ADR 0047; FichaAssinaturaSchema)');
    const f = r.data;
    const ordem = (i: string) => (ITENS_CONTADOS as readonly string[]).indexOf(i);
    const montada = FichaAssinaturaSchema.safeParse({
      ...f,
      licencas: [...f.licencas].sort((a, b) => ordem(a.item) - ordem(b.item)),
      valor: valorDaAssinatura(f.plano, f.adicionais, f.ciclo),
    });
    if (!montada.success) throw new Error('sa_assinatura_da_empresa devolveu licenças diferentes dos 6 itens contados (ADR 0047)');
    return montada.data;
  };

  app.get(ROTA_PORTAL_PLANOS, async (req) => {
    const quem = await exigir(req, null);
    return ListaPlanosSchema.parse({ itens: await planos(quem) });
  });

  app.post(ROTA_PORTAL_EMPRESA_COM_PLANO, async (req, reply) => {
    const quem = await exigir(req, null);
    soSuperAdmin(quem, 'cadastra empresas');
    const e = dep.validar(CriarEmpresaComPlanoSchema, req.body, 'corpo') as CriarEmpresaComPlano;
    const { assinatura: escolha, ...empresa } = e;
    const plano = await planoPeloCodigo(quem, escolha.plano);
    const problemas = conferirEscolhaDePlano(plano, escolha.adicionais);
    if (problemas.length > 0) recusar(problemas);
    // os módulos saem do plano (RN-PLA-01): o mesmo fluxo do passo Empresa, sem teto de licença por módulo (a trava é a RN-PLA-04)
    const modulos = modulosDaAssinatura(plano, escolha.adicionais).map((modulo) => ({ modulo, licencas: null }));
    const { status, resposta } = await criarEmpresaNoPortal(dep, quem, { ...empresa, modulos }, () => exigirCnpjAtivo(req, dep.consultaCnpj, empresa.cnpj, reply));
    if (resposta.tenant_id) marcarPortal(req, { quem, tenantId: resposta.tenant_id });
    const testeAte = escolha.com_teste ? fimDoTeste(localIsoDate(relogio(), empresa.fuso), plano.dias_teste) : null;
    let assinatura: 'criada' | 'existente' | 'simulada' = 'simulada';
    let testeGravado = testeAte;
    if (!e.simular) {
      if (!resposta.tenant_id) throw new Error('sa_provisionar_tenant não devolveu o tenant_id da empresa gravada');
      let bruto: unknown;
      try {
        bruto = await fonte.gravarAssinatura(
          quem.sessao_id,
          resposta.tenant_id,
          { plano: plano.codigo, ciclo: escolha.ciclo, adicionais: escolha.adicionais, teste_ate: testeAte, paga: testeAte === null, pedido_id: escolha.pedido_id },
          dep.acesso,
        );
      } catch (erro) {
        traduzir(erro, true);
      }
      const g = GravouSchema.safeParse(bruto);
      if (!g.success) throw new Error('sa_gravar_assinatura devolveu formato diferente do combinado (ADR 0047)');
      assinatura = g.data.resultado;
      testeGravado = g.data.teste_ate;
    }
    return reply.code(status).send(
      CriarEmpresaComPlanoRespostaSchema.parse({
        tenant_id: resposta.tenant_id,
        codigo: resposta.codigo,
        resultado: resposta.resultado,
        assinatura,
        teste_ate: testeGravado,
        valor: valorDaAssinatura(plano, escolha.adicionais, escolha.ciclo),
        avisos: resposta.avisos,
        admin: resposta.admin,
        simulado: resposta.simulado,
      }),
    );
  });

  app.get('/v1/plataforma/empresas/:tenant_id/assinatura', async (req) => {
    const { tenant_id } = dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>;
    const quem = await exigir(req, tenant_id);
    // o admin do cliente vê só a empresa da sessão (a sa_* confere de novo)
    if (quem.tipo === 'admin_cliente' && quem.empresa?.tenant_id !== tenant_id)
      throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Você só vê o plano da sua empresa.');
    return ficha(quem, tenant_id);
  });

  app.put('/v1/plataforma/empresas/:tenant_id/assinatura', async (req) => {
    const { tenant_id } = dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>;
    const quem = await exigir(req, tenant_id);
    soSuperAdmin(quem, 'troca o plano');
    const t = dep.validar(TrocarPlanoSchema, req.body, 'corpo') as TrocarPlano;
    const atual = await ficha(quem, tenant_id);
    const novo = await planoPeloCodigo(quem, t.plano);
    // RN-PLA-05: a API revalida aqui; a sa_trocar_plano confere de novo na transação (corrida com o cadastro de usuários)
    const problemas = conferirTrocaDePlano(novo, t.adicionais, usoPorItem(atual.licencas).emUso);
    if (problemas.length > 0) recusar(problemas);
    try {
      await fonte.trocar(
        quem.sessao_id,
        tenant_id,
        { plano: novo.codigo, ciclo: t.ciclo, adicionais: t.adicionais, pedido_id: t.pedido_id, modulos: modulosDaAssinatura(novo, t.adicionais) },
        dep.acesso,
      );
    } catch (e) {
      traduzir(e, true);
    }
    return ficha(quem, tenant_id);
  });
}
