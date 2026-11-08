/**
 * Despachante da outbox de e-mail (T-0094; ADR 0032; desenho §10 item 3; RN-CORE-34). Roda no processo do worker
 * (`worker.ts`) com o papel `macuxi_worker` (política própria em `plataforma.email_saida`: lê todos os tenants, marca só linha
 * pendente; sem BYPASSRLS), como o despachante de eventos (`../despachante.ts`).
 *
 * Cada e-mail numa transação curta: `select … limit 1 for update skip locked` (vários processos não pegam a mesma linha) →
 * decifra (AAD = id|tenant|modelo) → renderiza o modelo → entrega pelo adaptador (SMTP ou arquivo) → grava e commit.
 * - Entregue → `enviado_em = agora`, `carga = null`, `ultimo_erro = null`.
 * - Falha retentável com tentativa sobrando → `tentativas + 1`, `ultimo_erro` = código, `proxima_tentativa_em = agora + espera`.
 * - Falha definitiva, tentativas esgotadas (`maxTentativas`, padrão 8), carga que não decifra ou `expira_em` vencido →
 *   `falhou_em = agora`, `ultimo_erro` = código, `carga = null` (a senha temporária some do banco).
 * Entrega ao menos uma vez: se o processo cair entre o aceite do SMTP e o commit, o e-mail sai de novo (o `Message-ID` é o
 * mesmo, `<id@dominio>`, e o provedor pode deduplicar).
 *
 * Log: só `email_id`, `tenant_id`, `modelo`, `tentativas`, `codigo` (e `codigo_smtp`/`etapa`) — nunca e-mail, nome ou senha;
 * `ultimo_erro` só leva o código (`EMAIL_*`), nunca o texto do servidor SMTP.
 */
import type { EnderecoEmail, LogRota, ModeloEmail, TransporteEmail } from '@macuxi/platform-sdk';
import { CODIGOS_EMAIL, renderizarEmail, renderizarEmailParaLog, renderizarEmailSemSenha } from '@macuxi/platform-sdk';
import type pg from 'pg';
import type { CifraEmail } from './cifra';
import { mensagemSegura } from '../log-seguro';
import { comoErroEmail, ErroEmail } from './erros';

export const LOTE_EMAIL_PADRAO = 10;
export const MAX_TENTATIVAS_EMAIL_PADRAO = 8;
const ESPERA_BASE_MS = 30_000;
const ESPERA_TETO_MS = 60 * 60_000;

/** 30 s, 1 min, 2 min… dobrando até 1 h (8 tentativas ≈ 1 h 4 min, bem dentro das 72 h da senha temporária). */
export function esperaEmailPadrao(tentativas: number): number {
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(0, tentativas - 1), ESPERA_TETO_MS);
}

export interface OpcoesDespachanteEmail {
  /** Pool com o papel `macuxi_worker`. */
  worker: Pick<pg.Pool, 'connect'>;
  transporte: TransporteEmail;
  cifra: CifraEmail;
  remetente: EnderecoEmail;
  log: LogRota;
  agora?: () => Date;
  /** E-mails por ciclo (padrão 10), cada um na sua transação. */
  lote?: number;
  maxTentativas?: number;
  espera?: (tentativas: number) => number;
}

export interface ResumoCicloEmail {
  lidos: number;
  enviados: number;
  /** Voltam depois da espera. */
  adiados: number;
  /** Falha final (carga zerada). */
  falhos: number;
}

interface LinhaEmail {
  id: string;
  tenant_id: string;
  modelo: ModeloEmail;
  carga: Buffer | null;
  tentativas: number;
  expira_em: Date;
}

const SQL_PROXIMO = `
  select id, tenant_id, modelo, carga, tentativas, expira_em
    from plataforma.email_saida
   where enviado_em is null and falhou_em is null and deleted_at is null
     and proxima_tentativa_em <= $1
   order by proxima_tentativa_em, id
   limit 1
   for update skip locked`;

const SQL_ENVIADO = `update plataforma.email_saida set enviado_em = $2, carga = null, ultimo_erro = null, tentativas = tentativas + 1 where id = $1`;
const SQL_ADIADO = `update plataforma.email_saida set tentativas = $2, ultimo_erro = $3, proxima_tentativa_em = $4 where id = $1`;
const SQL_FALHOU = `update plataforma.email_saida set falhou_em = $2, carga = null, ultimo_erro = $3, tentativas = $4 where id = $1`;

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function criarDespachanteEmail(op: OpcoesDespachanteEmail) {
  const relogio = op.agora ?? (() => new Date());
  const lote = op.lote ?? LOTE_EMAIL_PADRAO;
  const maxTentativas = op.maxTentativas ?? MAX_TENTATIVAS_EMAIL_PADRAO;
  const espera = op.espera ?? esperaEmailPadrao;
  const log = op.log ?? semLog;

  /** Um e-mail numa transação. `null` = não havia pendente. */
  async function umEmail(): Promise<'enviado' | 'adiado' | 'falhou' | null> {
    const c = await op.worker.connect();
    try {
      await c.query('begin');
      const agora = relogio();
      const l = (await c.query<LinhaEmail>(SQL_PROXIMO, [agora])).rows[0];
      if (!l) {
        await c.query('commit');
        return null;
      }
      const base = { tipo: 'email', email_id: l.id, tenant_id: l.tenant_id, modelo: l.modelo };
      const tentativas = l.tentativas + 1;
      const falhar = async (erro: ErroEmail, nivel: 'warn' | 'error') => {
        await c.query(SQL_FALHOU, [l.id, agora, erro.codigo, tentativas]);
        await c.query('commit');
        log[nivel]({ ...base, evento: 'falhou', tentativas, codigo: erro.codigo, ...(erro.etapa ? { etapa: erro.etapa } : {}) }, 'e-mail não enviado (falha final; carga apagada)');
        return 'falhou' as const;
      };
      if (l.expira_em.getTime() <= agora.getTime()) {
        return await falhar(new ErroEmail(CODIGOS_EMAIL.EXPIRADO, 'e-mail vencido antes de sair', { retentavel: false, etapa: 'fila' }), 'warn');
      }
      if (!l.carga) return await falhar(new ErroEmail(CODIGOS_EMAIL.CIFRA_INVALIDA, 'linha pendente sem carga', { retentavel: false, etapa: 'cifra' }), 'error');
      try {
        const carga = op.cifra.decifrar(l.carga, { id: l.id, tenant_id: l.tenant_id, modelo: l.modelo });
        const r = renderizarEmail(l.modelo, carga);
        const { idMensagem } = await op.transporte.entregar({
          idEnvio: l.id,
          modelo: l.modelo,
          de: op.remetente,
          para: carga.dados.nome ? { email: carga.para, nome: carga.dados.nome } : { email: carga.para },
          ...r,
          paraLog: renderizarEmailParaLog(l.modelo, carga),
          semSenha: renderizarEmailSemSenha(l.modelo, carga),
        });
        await c.query(SQL_ENVIADO, [l.id, agora]);
        await c.query('commit');
        log.info({ ...base, evento: 'enviado', tentativas, transporte: op.transporte.nome, ...(idMensagem ? { id_mensagem: idMensagem } : {}) }, 'e-mail enviado');
        return 'enviado';
      } catch (e) {
        const erro = comoErroEmail(e);
        const campos = { ...base, tentativas, codigo: erro.codigo, ...(erro.etapa ? { etapa: erro.etapa } : {}), ...(erro.codigoSmtp ? { codigo_smtp: erro.codigoSmtp } : {}) };
        if (!erro.retentavel || tentativas >= maxTentativas) return await falhar(erro, 'error');
        const proxima = new Date(agora.getTime() + espera(tentativas));
        await c.query(SQL_ADIADO, [l.id, tentativas, erro.codigo, proxima]);
        await c.query('commit');
        log.warn({ ...campos, evento: 'adiado', espera_ms: proxima.getTime() - agora.getTime() }, 'falha temporária no envio de e-mail; nova tentativa depois');
        return 'adiado';
      }
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async function ciclo(): Promise<ResumoCicloEmail> {
    const resumo: ResumoCicloEmail = { lidos: 0, enviados: 0, adiados: 0, falhos: 0 };
    for (let i = 0; i < lote; i++) {
      const r = await umEmail();
      if (!r) break;
      resumo.lidos += 1;
      if (r === 'enviado') resumo.enviados += 1;
      else if (r === 'adiado') resumo.adiados += 1;
      else resumo.falhos += 1;
    }
    return resumo;
  }

  return {
    ciclo,
    /** Laço do processo: ciclo; lote cheio → próximo já; senão espera `intervaloMs` (padrão 5 s). Erro do ciclo é logado. */
    iniciar(o: { intervaloMs?: number } = {}): { parar(): Promise<void> } {
      const intervalo = o.intervaloMs ?? 5_000;
      let ativo = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let atual: Promise<void> = Promise.resolve();
      const passo = async (): Promise<void> => {
        let cheio = false;
        try {
          cheio = (await ciclo()).lidos >= lote;
        } catch (e) {
          log.error({ tipo: 'email', erro: mensagemSegura(e) }, 'ciclo do despachante de e-mail falhou');
        }
        if (ativo) timer = setTimeout(() => (atual = passo()), cheio ? 0 : intervalo);
      };
      atual = passo();
      return {
        async parar() {
          ativo = false;
          if (timer) clearTimeout(timer);
          await atual;
        },
      };
    },
  };
}

export type DespachanteEmail = ReturnType<typeof criarDespachanteEmail>;
