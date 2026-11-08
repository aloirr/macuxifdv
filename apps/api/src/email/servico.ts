/**
 * Serviço do e-mail transacional (T-0094; RN-CORE-32/33/34).
 *
 * Fluxo: rota → `envio.enviar(modelo, destinatario, dados)` → valida (Zod) → cifra (AES-256-GCM, AAD = idEnvio) → enfileira
 * (`id` = idEnvio) → devolve `{ ok: true, situacao: 'enfileirado' }` na hora. O worker (`criarProcessadorEmail`) decifra,
 * renderiza e entrega pelo transporte; erro retentável ⇒ lança (a fila tenta de novo); não retentável ⇒ conclui e registra.
 *
 * Log: só `id_envio`, `modelo`, `tenant_id`, `tentativa`, `codigo`, `transporte` — nunca e-mail, nome ou senha. Nenhum
 * evento de outbox é publicado aqui (quem quiser auditar registra `email_enviado: true` sem dado pessoal).
 */
import { randomUUID } from 'node:crypto';
import {
  CODIGOS_EMAIL,
  MODELOS_EMAIL,
  OpcoesEnvioEmailSchema,
  PedidoEmailSchema,
  renderizarEmailParaLog,
  renderizarEmailSemSenha,
  renderizarPedidoEmail,
  type EnderecoEmail,
  type EnvioEmail,
  type LogRota,
  type MensagemEmail,
  type ModeloEmail,
  type ResultadoEnvioEmail,
  type TransporteEmail,
} from '@macuxi/platform-sdk';
import type { ZodIssue } from 'zod';
import { criarTransporteArquivo } from './arquivo';
import { criarCifraEmail, type CifraEmail } from './cifra';
import { descreverConfigEmail, type ConfigEmail } from './config';
import { comoErroEmail } from './erros';
import { criarFilaMemoria, criarFilaPgBoss, type FilaEmail, type JobEmail, type PgBossLike, type ProcessarJobEmail } from './fila';
import { criarTransporteSmtp } from './smtp';

/** Só caminho e código do Zod (a mensagem pode trazer o valor recebido). */
function problemasSeguros(issues: readonly ZodIssue[]): { caminho: string; codigo: string }[] {
  return issues.slice(0, 10).map((i) => ({ caminho: i.path.join('.'), codigo: i.code }));
}

function modeloParaLog(m: unknown): ModeloEmail | 'desconhecido' {
  return (MODELOS_EMAIL as readonly unknown[]).includes(m) ? (m as ModeloEmail) : 'desconhecido';
}

export interface OpcoesEnvioServico {
  fila: FilaEmail;
  cifra: CifraEmail;
  log: LogRota;
  novoId?: () => string;
}

/** Implementa a porta `EnvioEmail` (o que a rota recebe). Nunca lança. */
export function criarEnvioEmail(op: OpcoesEnvioServico): EnvioEmail {
  const novoId = op.novoId ?? randomUUID;
  return {
    async enviar(modelo, destinatario, dados, opcoes = {}): Promise<ResultadoEnvioEmail> {
      const opc = OpcoesEnvioEmailSchema.safeParse(opcoes);
      const pedido = PedidoEmailSchema.safeParse({ modelo, destinatario, dados });
      if (!opc.success || !pedido.success) {
        op.log.warn(
          {
            tipo: 'email',
            evento: 'recusado',
            modelo: modeloParaLog(modelo),
            codigo: CODIGOS_EMAIL.DADOS_INVALIDOS,
            problemas: problemasSeguros([...(opc.success ? [] : opc.error.issues), ...(pedido.success ? [] : pedido.error.issues)]),
          },
          'pedido de e-mail inválido',
        );
        return { ok: false, codigo: CODIGOS_EMAIL.DADOS_INVALIDOS, retentavel: false };
      }
      const idEnvio = opc.data.idEnvio ?? novoId();
      const tenantId = opc.data.tenantId;
      const base = { tipo: 'email', id_envio: idEnvio, modelo: pedido.data.modelo, ...(tenantId ? { tenant_id: tenantId } : {}) };
      try {
        const job: JobEmail = {
          v: 1,
          idEnvio,
          modelo: pedido.data.modelo,
          ...(tenantId ? { tenantId } : {}),
          carga: op.cifra.cifrar(pedido.data, idEnvio),
        };
        await op.fila.enfileirar(job);
      } catch (e) {
        const err = comoErroEmail(e);
        op.log.warn({ ...base, evento: 'fila_indisponivel', codigo: CODIGOS_EMAIL.FILA_INDISPONIVEL, causa: err.codigo }, 'e-mail não enfileirado');
        return { ok: false, codigo: CODIGOS_EMAIL.FILA_INDISPONIVEL, retentavel: true };
      }
      op.log.info({ ...base, evento: 'enfileirado' }, 'e-mail enfileirado');
      return { ok: true, idEnvio, situacao: 'enfileirado' };
    },
  };
}

/** Porta para envio desligado: recusa com `EMAIL_DESLIGADO` (a rota segue; o admin informa a senha por outro meio). */
export function criarEnvioEmailDesligado(log: LogRota): EnvioEmail {
  return {
    async enviar(modelo) {
      log.warn({ tipo: 'email', evento: 'desligado', modelo: modeloParaLog(modelo), codigo: CODIGOS_EMAIL.DESLIGADO }, 'envio de e-mail desligado');
      return { ok: false, codigo: CODIGOS_EMAIL.DESLIGADO, retentavel: false };
    },
  };
}

export interface OpcoesProcessador {
  transporte: TransporteEmail;
  cifra: CifraEmail;
  remetente: EnderecoEmail;
  log: LogRota;
}

/** Handler do worker: decifra, renderiza e entrega. Retentável ⇒ lança `ErroEmail`; não retentável ⇒ conclui. */
export function criarProcessadorEmail(op: OpcoesProcessador): ProcessarJobEmail {
  return async (job, ctx) => {
    const base = {
      tipo: 'email',
      id_envio: job.idEnvio,
      modelo: job.modelo,
      ...(job.tenantId ? { tenant_id: job.tenantId } : {}),
      tentativa: ctx.tentativa,
      transporte: op.transporte.nome,
    };
    try {
      const pedido = op.cifra.decifrar(job.carga, job.idEnvio);
      const r = renderizarPedidoEmail(pedido);
      const msg: MensagemEmail = {
        idEnvio: job.idEnvio,
        modelo: pedido.modelo,
        de: op.remetente,
        para: { email: pedido.destinatario.email, nome: pedido.destinatario.nome },
        ...r,
        paraLog: renderizarEmailParaLog(pedido),
        semSenha: renderizarEmailSemSenha(pedido),
      };
      const { idMensagem } = await op.transporte.entregar(msg);
      op.log.info({ ...base, evento: 'enviado', ...(idMensagem ? { id_mensagem: idMensagem } : {}) }, 'e-mail entregue ao transporte');
    } catch (e) {
      const err = comoErroEmail(e);
      const campos = { ...base, codigo: err.codigo, ...(err.etapa ? { etapa: err.etapa } : {}), ...(err.codigoSmtp ? { codigo_smtp: err.codigoSmtp } : {}) };
      if (err.retentavel && !ctx.ultima) {
        op.log.warn({ ...campos, evento: 'falha_temporaria', retentavel: true }, 'falha temporária no envio de e-mail; nova tentativa');
        throw err;
      }
      if (err.retentavel) {
        op.log.error({ ...campos, evento: 'esgotado', retentavel: true }, 'e-mail não entregue: tentativas esgotadas');
        throw err;
      }
      op.log.warn({ ...campos, evento: 'descartado', retentavel: false }, 'e-mail não entregue: falha definitiva');
    }
  };
}

export interface EmailLigado {
  /** Porta para as rotas. */
  envio: EnvioEmail;
  /** Transporte em uso (`null` com envio desligado). */
  transporte: TransporteEmail | null;
  fila: FilaEmail | null;
  /** Liga o consumo da fila (no worker). */
  iniciar(): Promise<void>;
  parar(): Promise<void>;
}

/** Transporte a partir da configuração (`null` se desligado). */
export function criarTransporteDaConfig(cfg: ConfigEmail, op: { log: LogRota; agora?: () => Date }): TransporteEmail | null {
  if (cfg.transporte === 'desligado') return null;
  const agora = op.agora ? { agora: op.agora } : {};
  if (cfg.transporte === 'arquivo') return criarTransporteArquivo({ pasta: cfg.pasta, log: op.log, mascararSenha: cfg.mascararSenhaNoArquivo, ...agora });
  if (!cfg.smtp) throw new Error('configuração smtp ausente'); // lerConfigEmail garante; erro de programação
  return criarTransporteSmtp(cfg.smtp, agora);
}

/**
 * Fábrica para o worker/API (ainda NÃO ligada em `worker.ts`/`app.ts`: pendência do desenho). Com `boss` usa o pg-boss;
 * sem ele, a fila em memória (demo/testes: API e worker no mesmo processo).
 */
export function ligarEmail(op: { config: ConfigEmail; log: LogRota; boss?: PgBossLike; fila?: FilaEmail; agora?: () => Date }): EmailLigado {
  const { config, log } = op;
  log.info({ tipo: 'email', evento: 'configuracao', ...descreverConfigEmail(config), avisos: config.avisos }, 'e-mail transacional');
  const transporte = criarTransporteDaConfig(config, { log, ...(op.agora ? { agora: op.agora } : {}) });
  if (!transporte) {
    return { envio: criarEnvioEmailDesligado(log), transporte: null, fila: null, iniciar: async () => undefined, parar: async () => undefined };
  }
  const cifra = criarCifraEmail(config.chave);
  const fila = op.fila ?? (op.boss ? criarFilaPgBoss(op.boss, { log }) : criarFilaMemoria());
  const processador = criarProcessadorEmail({ transporte, cifra, remetente: config.remetente, log });
  return {
    envio: criarEnvioEmail({ fila, cifra, log }),
    transporte,
    fila,
    iniciar: () => fila.processar(processador),
    parar: () => fila.parar(),
  };
}
