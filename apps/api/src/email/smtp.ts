/**
 * Cliente SMTP mínimo (T-0094) — o "equivalente ao nodemailer" sem dependência nova: conexão com prazo, saudação 220,
 * EHLO (HELO se o servidor não aceitar), STARTTLS ou TLS implícito, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO, DATA e QUIT.
 *
 * Segurança (RN-CORE-34):
 * - `tls: 'starttls'` exige o anúncio do STARTTLS: sem ele, recusa ANTES de qualquer AUTH (nunca manda credencial em claro).
 *   Dados que o servidor mandar junto com o 220 do STARTTLS (injeção pré-TLS) derrubam a conexão.
 * - Credencial sem TLS só com `permitirCredencialSemTls` (a config liga só fora de produção).
 * - O erro (`ErroEmail`) traz só etapa + código SMTP. A resposta textual do servidor nunca é guardada nem repassada: ela pode
 *   ecoar o destinatário (`550 <maria@…> unknown`).
 * - 4xx, rede e tempo esgotado = retentável; 5xx = não.
 */
import { hostname } from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import { CODIGOS_EMAIL, type MensagemEmail, type ResultadoTransporteEmail, type TransporteEmail } from '@macuxi/platform-sdk';
import type { ConfigSmtp } from './config';
import { ErroEmail } from './erros';
import { montarMime, prepararData } from './mime';

export interface OpcoesClienteSmtp extends ConfigSmtp {
  /** Nome no EHLO (padrão: hostname da máquina, se for um nome válido). */
  nomeHelo?: string;
  /** Opções extras do TLS (ex.: `ca` de um servidor interno). `servername` = host por padrão. */
  tlsOpcoes?: Pick<tls.ConnectionOptions, 'ca' | 'rejectUnauthorized' | 'minVersion' | 'servername'>;
}

interface Resposta {
  codigo: number;
  /** Texto de cada linha SEM o código. Usado só para ler extensões do EHLO; nunca sai daqui. */
  linhas: string[];
}

const CRLF = '\r\n';
const LIMITE_BUFFER = 64 * 1024;

function nomeHeloPadrao(): string {
  const h = hostname();
  return /^[A-Za-z0-9.-]{1,253}$/.test(h) ? h : '[127.0.0.1]';
}

/** Erro para uma resposta fora do esperado: só etapa e código. */
function erroResposta(etapa: string, codigo: number): ErroEmail {
  const mensagem = `SMTP ${etapa}: resposta ${codigo}`;
  const base = { codigoSmtp: codigo, etapa };
  if (etapa === 'auth') {
    return new ErroEmail(CODIGOS_EMAIL.AUTENTICACAO, mensagem, { ...base, retentavel: codigo >= 400 && codigo < 500 });
  }
  if (etapa === 'starttls') {
    return new ErroEmail(CODIGOS_EMAIL.TLS_INDISPONIVEL, mensagem, { ...base, retentavel: codigo >= 400 && codigo < 500 });
  }
  if (codigo >= 400 && codigo < 500) return new ErroEmail(CODIGOS_EMAIL.RECUSA_TEMPORARIA, mensagem, { ...base, retentavel: true });
  if (codigo >= 500 && codigo < 600) return new ErroEmail(CODIGOS_EMAIL.RECUSA_DEFINITIVA, mensagem, { ...base, retentavel: false });
  return new ErroEmail(CODIGOS_EMAIL.PROTOCOLO, mensagem, { ...base, retentavel: false });
}

/** Erro de rede/sistema: só o código do sistema (`ECONNREFUSED`, `ECONNRESET`…), nunca a mensagem. */
function erroRede(etapa: string, e: unknown): ErroEmail {
  const code = (e as { code?: unknown } | null)?.code;
  const sufixo = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  const tlsFalhou = typeof code === 'string' && /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH)/.test(code);
  return new ErroEmail(tlsFalhou ? CODIGOS_EMAIL.TLS_INDISPONIVEL : CODIGOS_EMAIL.CONEXAO, `SMTP ${etapa}: falha de ${tlsFalhou ? 'TLS' : 'rede'}${sufixo}`, {
    retentavel: true,
    etapa,
  });
}

function erroTempo(etapa: string): ErroEmail {
  return new ErroEmail(CODIGOS_EMAIL.TEMPO_ESGOTADO, `SMTP ${etapa}: tempo esgotado`, { retentavel: true, etapa });
}

class ConexaoSmtp {
  private socket: net.Socket;
  private buffer = '';
  private linhasAtuais: string[] = [];
  private prontas: Resposta[] = [];
  private espera: { resolve: (r: Resposta) => void; reject: (e: ErroEmail) => void } | null = null;
  private erro: ErroEmail | null = null;
  etapa = 'conexao';
  seguro: boolean;

  private readonly aoDados = (chunk: Buffer) => this.receber(chunk);
  private readonly aoErro = (e: unknown) => this.falhar(erroRede(this.etapa, e));
  private readonly aoFechar = () => this.falhar(new ErroEmail(CODIGOS_EMAIL.CONEXAO, `SMTP ${this.etapa}: conexão encerrada`, { retentavel: true, etapa: this.etapa }));

  constructor(
    socket: net.Socket,
    seguro: boolean,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.seguro = seguro;
    this.anexar();
  }

  private anexar(): void {
    this.socket.on('data', this.aoDados);
    this.socket.on('error', this.aoErro);
    this.socket.on('close', this.aoFechar);
  }

  private desanexar(): void {
    this.socket.off('data', this.aoDados);
    this.socket.off('error', this.aoErro);
    this.socket.off('close', this.aoFechar);
  }

  private falhar(e: ErroEmail): void {
    if (!this.erro) this.erro = e;
    const w = this.espera;
    this.espera = null;
    w?.reject(this.erro);
  }

  private receber(chunk: Buffer): void {
    this.buffer += chunk.toString('latin1');
    if (this.buffer.length > LIMITE_BUFFER) {
      this.falhar(new ErroEmail(CODIGOS_EMAIL.PROTOCOLO, `SMTP ${this.etapa}: resposta longa demais`, { retentavel: false, etapa: this.etapa }));
      this.socket.destroy();
      return;
    }
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const linha = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      const m = /^(\d{3})(?:([ -])(.*))?$/.exec(linha);
      if (!m) {
        this.falhar(new ErroEmail(CODIGOS_EMAIL.PROTOCOLO, `SMTP ${this.etapa}: resposta fora do protocolo`, { retentavel: false, etapa: this.etapa }));
        this.socket.destroy();
        return;
      }
      this.linhasAtuais.push(m[3] ?? '');
      if (m[2] !== '-') {
        const r: Resposta = { codigo: Number(m[1]), linhas: this.linhasAtuais };
        this.linhasAtuais = [];
        const w = this.espera;
        this.espera = null;
        if (w) w.resolve(r);
        else this.prontas.push(r);
      }
    }
  }

  ler(etapa: string): Promise<Resposta> {
    this.etapa = etapa;
    const pronta = this.prontas.shift();
    if (pronta) return Promise.resolve(pronta);
    if (this.erro) return Promise.reject(this.erro);
    return new Promise<Resposta>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.falhar(erroTempo(etapa));
        this.socket.destroy();
      }, this.timeoutMs);
      this.espera = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }

  escrever(dados: string, etapa: string): void {
    this.etapa = etapa;
    if (this.erro) throw this.erro;
    this.socket.write(dados);
  }

  async comando(linha: string, etapa: string, aceitos: readonly number[]): Promise<Resposta> {
    this.escrever(linha + CRLF, etapa);
    const r = await this.ler(etapa);
    if (!aceitos.includes(r.codigo)) throw erroResposta(etapa, r.codigo);
    return r;
  }

  /** STARTTLS já aceito (220): troca o socket por um TLS sobre o mesmo TCP. */
  async promoverTls(host: string, tlsOpcoes: OpcoesClienteSmtp['tlsOpcoes']): Promise<void> {
    this.etapa = 'tls';
    if (this.buffer.length > 0 || this.prontas.length > 0 || this.linhasAtuais.length > 0) {
      // RFC 3207 §6: nada pode vir em claro depois do 220 — seria injeção de comando antes do TLS
      throw new ErroEmail(CODIGOS_EMAIL.PROTOCOLO, 'SMTP starttls: dados inesperados antes do TLS', { retentavel: false, etapa: 'starttls' });
    }
    this.desanexar();
    const plano = this.socket;
    const seguro = tls.connect({ socket: plano, servername: host, ...tlsOpcoes });
    await aguardarConexao(seguro, 'secureConnect', 'tls', this.timeoutMs);
    this.socket = seguro;
    this.seguro = true;
    this.anexar();
  }

  encerrar(): void {
    this.desanexar();
    this.socket.on('error', () => undefined);
    this.socket.destroy();
  }
}

function aguardarConexao(socket: net.Socket, evento: 'connect' | 'secureConnect', etapa: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const limpar = () => {
      clearTimeout(timer);
      socket.off(evento, ok);
      socket.off('error', erro);
    };
    const ok = () => {
      limpar();
      resolve();
    };
    const erro = (e: unknown) => {
      limpar();
      socket.destroy();
      reject(erroRede(etapa, e));
    };
    const timer = setTimeout(() => {
      limpar();
      socket.on('error', () => undefined);
      socket.destroy();
      reject(erroTempo(etapa));
    }, timeoutMs);
    socket.once(evento, ok);
    socket.once('error', erro);
  });
}

async function abrir(op: OpcoesClienteSmtp): Promise<ConexaoSmtp> {
  if (op.tls === 'tls') {
    const s = tls.connect({ host: op.host, port: op.porta, servername: op.host, ...op.tlsOpcoes });
    await aguardarConexao(s, 'secureConnect', 'conexao', op.timeoutMs);
    return new ConexaoSmtp(s, true, op.timeoutMs);
  }
  const s = net.connect({ host: op.host, port: op.porta });
  await aguardarConexao(s, 'connect', 'conexao', op.timeoutMs);
  return new ConexaoSmtp(s, false, op.timeoutMs);
}

/** Extensões anunciadas no EHLO (maiúsculas) e mecanismos AUTH. */
function lerExtensoes(r: Resposta): { extensoes: Set<string>; auth: Set<string> } {
  const extensoes = new Set<string>();
  const auth = new Set<string>();
  for (const l of r.linhas.slice(1)) {
    const partes = l.trim().toUpperCase().split(/[\s=]+/);
    const chave = partes[0];
    if (!chave) continue;
    extensoes.add(chave);
    if (chave === 'AUTH') for (const m of partes.slice(1)) auth.add(m);
  }
  return { extensoes, auth };
}

async function saudar(c: ConexaoSmtp, nome: string): Promise<ReturnType<typeof lerExtensoes>> {
  c.escrever(`EHLO ${nome}${CRLF}`, 'ehlo');
  const r = await c.ler('ehlo');
  if (r.codigo === 250) return lerExtensoes(r);
  if (r.codigo >= 500 && r.codigo < 600) {
    await c.comando(`HELO ${nome}`, 'helo', [250]);
    return { extensoes: new Set(), auth: new Set() };
  }
  throw erroResposta('ehlo', r.codigo);
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function autenticar(c: ConexaoSmtp, op: OpcoesClienteSmtp, mecanismos: Set<string>): Promise<void> {
  const cred = op.credencial;
  if (!cred) return;
  if (!c.seguro && !op.permitirCredencialSemTls) {
    throw new ErroEmail(CODIGOS_EMAIL.TLS_INDISPONIVEL, 'SMTP auth: credencial sem TLS recusada', { retentavel: false, etapa: 'auth' });
  }
  if (mecanismos.has('PLAIN')) {
    await c.comando(`AUTH PLAIN ${b64(`\u0000${cred.usuario}\u0000${cred.senha}`)}`, 'auth', [235]);
    return;
  }
  if (mecanismos.has('LOGIN')) {
    await c.comando('AUTH LOGIN', 'auth', [334]);
    await c.comando(b64(cred.usuario), 'auth', [334]);
    await c.comando(b64(cred.senha), 'auth', [235]);
    return;
  }
  throw new ErroEmail(CODIGOS_EMAIL.AUTENTICACAO, 'SMTP auth: servidor não anuncia AUTH PLAIN nem LOGIN', { retentavel: false, etapa: 'auth' });
}

/** Endereço do envelope: sem `<>`, espaço nem quebra (já validado pelo Zod; reforço). */
function enderecoEnvelope(email: string, etapa: string): string {
  if (!/^[^\s<>]+@[^\s<>]+$/.test(email)) {
    throw new ErroEmail(CODIGOS_EMAIL.DADOS_INVALIDOS, `SMTP ${etapa}: endereço inválido`, { retentavel: false, etapa });
  }
  return email;
}

/** Entrega uma mensagem MIME já montada. Lança `ErroEmail`. */
export async function enviarSmtp(op: OpcoesClienteSmtp, envelope: { de: string; para: string }, bruto: string): Promise<void> {
  const de = enderecoEnvelope(envelope.de, 'mail_from');
  const para = enderecoEnvelope(envelope.para, 'rcpt_to');
  const c = await abrir(op);
  try {
    const saudacao = await c.ler('saudacao');
    if (saudacao.codigo !== 220) throw erroResposta('saudacao', saudacao.codigo);
    const nome = op.nomeHelo ?? nomeHeloPadrao();
    let ext = await saudar(c, nome);
    if (op.tls === 'starttls') {
      if (!ext.extensoes.has('STARTTLS')) {
        throw new ErroEmail(CODIGOS_EMAIL.TLS_INDISPONIVEL, 'SMTP starttls: servidor não anuncia STARTTLS', { retentavel: false, etapa: 'starttls' });
      }
      await c.comando('STARTTLS', 'starttls', [220]);
      await c.promoverTls(op.host, op.tlsOpcoes);
      ext = await saudar(c, nome);
    }
    await autenticar(c, op, ext.auth);
    await c.comando(`MAIL FROM:<${de}>`, 'mail_from', [250]);
    await c.comando(`RCPT TO:<${para}>`, 'rcpt_to', [250, 251]);
    await c.comando('DATA', 'data', [354]);
    await c.comando(`${prepararData(bruto)}.`, 'corpo', [250]);
    try {
      await c.comando('QUIT', 'quit', [221]);
    } catch {
      // a mensagem já foi aceita: falha no QUIT não importa
    }
  } finally {
    c.encerrar();
  }
}

/** Transporte SMTP para o processador da fila. */
export function criarTransporteSmtp(op: OpcoesClienteSmtp, opcoes: { agora?: () => Date } = {}): TransporteEmail {
  const agora = opcoes.agora ?? (() => new Date());
  return {
    nome: 'smtp',
    async entregar(msg: MensagemEmail): Promise<ResultadoTransporteEmail> {
      const { bruto, messageId } = montarMime(msg, { agora: agora() });
      await enviarSmtp(op, { de: msg.de.email, para: msg.para.email }, bruto);
      return { idMensagem: messageId };
    },
  };
}
