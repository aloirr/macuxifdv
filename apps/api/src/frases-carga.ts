/**
 * T-0181: rotas das frases da tela de carga (portal só super-admin; app sem licença de módulo). Rotas, funções da 0081 e
 * respostas: docs/desenho/T-0181.md §2. Log sem o texto das frases.
 */
import { randomUUID } from 'node:crypto';
import {
  FraseCargaAlteracaoSchema,
  FraseCargaEntradaSchema,
  FraseCargaSchema,
  FrasesCargaAppRespostaSchema,
  FrasesCargaListaSchema,
  MENSAGENS_FRASE_CARGA,
  ROTA_PORTAL_FRASES_CARGA,
  ROTA_SYNC_FRASES_CARGA,
  validarTextoFrase,
  type AcessoBanco,
  type ClienteBanco,
  type FraseCarga,
  type FraseCargaAlteracao,
  type FraseCargaEntrada,
  type FrasesCargaAppResposta,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import { conferirRetorno, exigirSuperAdmin as exigirSuperAdminDoPortal, traduzirErroSa, type AutenticarPortal } from './portal-comum';
import type { Plataforma } from './tipos';

/** Acesso às funções da 0081 (testes injetam a sua). Devolvem o jsonb cru; a rota confere pelo contrato do SDK. */
export interface FonteFrasesCarga {
  /** `{ frases: [{ id, texto, ordem }] }` — no `macuxi_app`, dentro da transação da requisição. */
  ativas(db: ClienteBanco): Promise<unknown>;
  /** `{ itens: FraseCarga[] }`. */
  listar(sid: string, banco: AcessoBanco): Promise<unknown>;
  /** A frase incluída (ou a já existente com o mesmo `id` e o mesmo texto). */
  incluir(sid: string, id: string, texto: string, banco: AcessoBanco): Promise<unknown>;
  /** A frase depois da mudança. */
  editar(sid: string, id: string, texto: string | null, ativa: boolean | null, banco: AcessoBanco): Promise<unknown>;
}

const primeira = async (banco: AcessoBanco, sql: string, params: unknown[]): Promise<unknown> =>
  banco.semTenant(async (db) => (await db.query<{ r: unknown }>(sql, params)).rows[0]?.r);

export const fonteFrasesCargaNoBanco: FonteFrasesCarga = {
  ativas: async (db) => (await db.query<{ r: unknown }>('select plataforma.frases_carga_ativas() as r')).rows[0]?.r,
  listar: (sid, banco) => primeira(banco, 'select plataforma.sa_listar_frases_carga($1) as r', [sid]),
  incluir: (sid, id, texto, banco) => primeira(banco, 'select plataforma.sa_incluir_frase_carga($1, $2, $3) as r', [sid, id, texto]),
  editar: (sid, id, texto, ativa, banco) =>
    primeira(banco, 'select plataforma.sa_editar_frase_carga($1, $2, $3, $4) as r', [sid, id, texto, ativa]),
};

export interface DepsFrasesCarga {
  /** Conexão do portal (`macuxi_portal`). */
  acessoPortal: AcessoBanco;
  fonte?: FonteFrasesCarga;
  /** Quem entrou pelo portal; `null` = 401 (sem o banco do portal, lança 503 `PORTAL_INDISPONIVEL`). */
  autenticar: AutenticarPortal;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
}

const SO_A_MACUXI = 'Só o time da Macuxi cuida das frases da carga.';
const Params = z.object({ id: z.string().uuid() }).strict();

const indisponivel = () => new ErroHttp(503, 'FRASES_CARGA_INDISPONIVEIS', 'Frases da carga indisponíveis no momento. Tente de novo em instantes.');
const negocio = (codigo: keyof typeof MENSAGENS_FRASE_CARGA) => new ErroHttp(422, codigo, MENSAGENS_FRASE_CARGA[codigo]);

/** Função ou tabela da 0081 ausente no banco (antes da migração): 503. */
const ausente = (c: unknown): boolean => c === '42883' || c === '42P01';
const semCache = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'private, no-store');

/** SQLSTATE das `sa_*` da 0081 → HTTP: 23505 = repetida (422), P0002 = 404, 23514 = 400, `ausente`; + os comuns. */
const traduzir = (e: unknown): never =>
  traduzirErroSa(e, (c) => {
    if (c === '42501') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', SO_A_MACUXI);
    if (c === '23505') throw negocio('FRASE_DUPLICADA');
    if (c === 'P0002') throw new ErroHttp(404, 'FRASE_NAO_ENCONTRADA', 'Frase não encontrada.');
    if (c === '23514') throw new ErroHttp(400, 'VALIDACAO', 'Frase inválida.');
    if (ausente(c)) throw indisponivel();
  });

/** Texto pela regra do SDK (`validarTextoFrase`); a duplicidade fica com o índice único do banco. */
function textoValido(texto: string): string {
  const r = validarTextoFrase(texto);
  if (!r.ok) throw negocio(r.codigo);
  return r.texto;
}

const conferirFrase = (bruto: unknown, funcao: string): FraseCarga => conferirRetorno(FraseCargaSchema, bruto, funcao);

export function registrarRotasFrasesCarga(app: FastifyInstance, p: Plataforma, dep: DepsFrasesCarga): void {
  const fonte = dep.fonte ?? fonteFrasesCargaNoBanco;
  const exigirSuperAdmin = (req: FastifyRequest) => exigirSuperAdminDoPortal(dep.autenticar, req, null, SO_A_MACUXI);
  const chamar = async (f: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await f();
    } catch (e) {
      return traduzir(e);
    }
  };

  // ---------- app (sessão do app, sem licença de módulo) ----------
  app.get(ROTA_SYNC_FRASES_CARGA, async (req, reply): Promise<FrasesCargaAppResposta> => {
    const { ctx } = await p.preparar(req, null);
    let bruto: unknown;
    try {
      bruto = await ctx.comTenant((db) => fonte.ativas(db));
    } catch (e) {
      const c = (e as { code?: unknown } | null)?.code;
      if (ausente(c)) {
        req.log.warn({ codigo: 'FRASES_CARGA_INDISPONIVEIS', sqlstate: c }, 'frases da carga: função ausente no banco');
        throw indisponivel();
      }
      throw e;
    }
    const r = conferirRetorno(FrasesCargaAppRespostaSchema, bruto, 'frases_carga_ativas');
    semCache(reply);
    return { frases: r.frases };
  });

  // ---------- portal (só super-admin) ----------
  app.get(ROTA_PORTAL_FRASES_CARGA, async (req, reply) => {
    const quem = await exigirSuperAdmin(req);
    const lista = conferirRetorno(FrasesCargaListaSchema, await chamar(() => fonte.listar(quem.sessao_id, dep.acessoPortal)), 'sa_listar_frases_carga');
    return semCache(reply).send({ itens: lista.itens });
  });

  app.post(ROTA_PORTAL_FRASES_CARGA, async (req, reply) => {
    const quem = await exigirSuperAdmin(req);
    const corpo = dep.validar(FraseCargaEntradaSchema, req.body, 'corpo') as FraseCargaEntrada;
    const texto = textoValido(corpo.texto);
    const id = (corpo.id ?? randomUUID()).toLowerCase();
    const frase = conferirFrase(await chamar(() => fonte.incluir(quem.sessao_id, id, texto, dep.acessoPortal)), 'sa_incluir_frase_carga');
    return semCache(reply.code(201)).send(frase);
  });

  app.patch(`${ROTA_PORTAL_FRASES_CARGA}/:id`, async (req, reply) => {
    const { id } = dep.validar(Params, req.params, 'params') as z.output<typeof Params>;
    const quem = await exigirSuperAdmin(req);
    const alt = dep.validar(FraseCargaAlteracaoSchema, req.body, 'corpo') as FraseCargaAlteracao;
    const texto = alt.texto === undefined ? null : textoValido(alt.texto);
    const frase = conferirFrase(
      await chamar(() => fonte.editar(quem.sessao_id, id.toLowerCase(), texto, alt.ativa ?? null, dep.acessoPortal)),
      'sa_editar_frase_carga',
    );
    return semCache(reply).send(frase);
  });
}
