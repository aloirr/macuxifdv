/**
 * E-mail transacional do Core (T-0094; ADR 0032, desenho §10). A porta `ServicoEmail` vem da plataforma (`ctx.email`, fatia S +
 * frente N5): `enfileirar` só faz um insert na outbox de e-mail pela conexão da transação do tenant, com a carga cifrada, e o
 * despachante envia depois. Enquanto o SDK não expõe `ctx.email`, o Core lê o campo se existir e trata a ausência como
 * `indisponivel` (o BKO avisa e a Equipe por CSV recusa antes de gravar). A senha só passa por `dados.senha`: nunca vai a log,
 * auditoria nem evento.
 */
import { perfisDeFabrica, podeUsarApp } from '../domain';
import { APPS_COM_LOGIN, type AppComLogin, type ClienteBanco, type Perfil } from '@macuxi/platform-sdk';

export type ModeloEmail = 'acesso_inicial' | 'nova_senha';

export interface MensagemEmail {
  modelo: ModeloEmail;
  /** Destinatário no tenant da transação. */
  usuario_id: string;
  /** E-mail do destinatário (vai só dentro da carga cifrada). */
  para: string;
  dados: {
    nome: string;
    empresa_nome: string;
    codigo_empresa: string;
    login: string;
    /** Segredo: só na carga cifrada e no corpo do e-mail. */
    senha: string;
    /** 72; `null` = não vence. */
    validade_horas: number | null;
    /** Onde entrar (PERFIS_DO_APP do perfil). */
    apps: readonly AppComLogin[];
    motivo?: 'esqueci' | 'redefinida';
  };
  chave_idempotencia: string;
}

export interface ServicoEmail {
  disponivel(): boolean;
  enfileirar(db: ClienteBanco, m: MensagemEmail): Promise<'enfileirado' | 'indisponivel'>;
}

/** O serviço de e-mail do contexto, ou `null` se a plataforma não o oferece. */
export function emailDoContexto(ctx: unknown): ServicoEmail | null {
  const e = (ctx as { email?: ServicoEmail } | null)?.email;
  return e && typeof e.enfileirar === 'function' && typeof e.disponivel === 'function' ? e : null;
}

export const emailDisponivel = (ctx: unknown): boolean => emailDoContexto(ctx)?.disponivel() ?? false;

/** Apps em que o perfil entra (textos do e-mail). */
export const appsDoPerfil = (perfil: Perfil): AppComLogin[] => APPS_COM_LOGIN.filter((a) => podeUsarApp(perfisDeFabrica(perfil), a));

/** Enfileira e devolve o resultado; sem serviço = `indisponivel`. Nunca lança por falta de e-mail. */
export async function enviarEmail(ctx: unknown, db: ClienteBanco, m: MensagemEmail): Promise<'enfileirado' | 'indisponivel'> {
  const s = emailDoContexto(ctx);
  if (!s || !s.disponivel()) return 'indisponivel';
  return s.enfileirar(db, m);
}

/** Empresa do tenant da transação (nome e código para o e-mail). */
export async function empresaDoTenant(db: ClienteBanco): Promise<{ nome: string; codigo: string }> {
  const r = await db.query<{ nome: string; codigo: string }>('select nome, codigo from plataforma.tenant where id = plataforma.tenant_atual()');
  return r.rows[0] ?? { nome: '', codigo: '' };
}
