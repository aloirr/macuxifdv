/**
 * Apoio dos testes do e-mail (T-0094): servidor SMTP falso em 127.0.0.1, captura de log e dados de exemplo.
 * Só usado pelos `*.test.ts` desta pasta.
 */
import net from 'node:net';
import { PedidoEmailSchema, valoresSensiveisEmail, type DadosAcessoInicial, type DadosNovaSenha, type LogRota, type PedidoEmail } from '@macuxi/platform-sdk';

export const ID_ENVIO = '7d0f1f8e-3c4b-4a8e-9f61-2b5c9a0d1e23';
export const ID_ENVIO_2 = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
export const TENANT = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
/** Instante fixo dos testes (relógio injetado). */
export const INSTANTE = new Date('2026-11-07T12:00:00Z');
export const relogio = () => INSTANTE;

export const destinatario = { email: 'joaquina.teste@exemplo.com.br', nome: 'Joaquina Teste' };
export const dadosAcesso: DadosAcessoInicial = {
  empresa: 'Distribuidora Rio Branco',
  codigoEmpresa: 'RIOBRANCO',
  login: 'joaquina.teste@exemplo.com.br',
  senhaInicial: 'Prov1sor1a-Xq7',
};
export const dadosNovaSenha: DadosNovaSenha = {
  empresa: 'Distribuidora Rio Branco',
  codigoEmpresa: 'RIOBRANCO',
  login: 'joaquina.teste@exemplo.com.br',
  senhaProvisoria: 'N0va-Senh4-Kz',
  motivo: 'redefinicao_bko',
};
export const pedidoAcesso: PedidoEmail = PedidoEmailSchema.parse({ modelo: 'acesso_inicial', destinatario, dados: dadosAcesso });
export const pedidoNovaSenha: PedidoEmail = PedidoEmailSchema.parse({ modelo: 'nova_senha', destinatario, dados: dadosNovaSenha });
/** Tudo que nunca pode aparecer em log, job ou erro. */
export const SENSIVEIS = [...new Set([...valoresSensiveisEmail(pedidoAcesso), ...valoresSensiveisEmail(pedidoNovaSenha)])];

export interface LinhaLog {
  nivel: 'info' | 'warn' | 'error';
  obj: Record<string, unknown>;
  msg?: string;
}

export function capturarLog(): { log: LogRota; linhas: LinhaLog[]; json(): string } {
  const linhas: LinhaLog[] = [];
  const reg = (nivel: LinhaLog['nivel']) => (obj: Record<string, unknown>, msg?: string) => {
    // serializa na hora, como o pino: o que for mutado depois não conta
    linhas.push({ nivel, obj: JSON.parse(JSON.stringify(obj)) as Record<string, unknown>, ...(msg !== undefined ? { msg } : {}) });
  };
  return { log: { info: reg('info'), warn: reg('warn'), error: reg('error') }, linhas, json: () => linhas.map((l) => JSON.stringify(l)).join('\n') };
}

/** Lista os valores sensíveis que aparecem no texto (vazio = ok). */
export function vazamentos(texto: string, valores: readonly string[] = SENSIVEIS): string[] {
  const baixo = texto.toLowerCase();
  return valores.filter((v) => baixo.includes(v.toLowerCase()));
}

export function decodificarPartes(eml: string): { texto: string; html: string } {
  const partes = eml.split(/\r\n--=_macuxi_[0-9a-f]+/);
  const corpo = (tipo: string) => {
    const p = partes.find((x) => x.includes(`Content-Type: ${tipo}`)) ?? '';
    const b64 = p.split('\r\n\r\n')[1] ?? '';
    return Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString('utf8');
  };
  return { texto: corpo('text/plain'), html: corpo('text/html') };
}

// ---------------------------------------------------------------------------------------------------------------------
// servidor SMTP falso

export interface RoteiroSmtp {
  /** Linhas do EHLO depois da primeira (padrão: AUTH PLAIN LOGIN, 8BITMIME). */
  extensoes?: string[];
  /** Não manda a saudação (testa o prazo). */
  mudo?: boolean;
  saudacao?: string;
  /** Respostas por comando (linha completa, sem CRLF; pode ter várias linhas com \r\n). */
  respostas?: Partial<Record<'EHLO' | 'MAIL' | 'RCPT' | 'DATA' | 'CORPO' | 'AUTH' | 'STARTTLS', string>>;
}

export interface SmtpFalso {
  porta: number;
  /** Comandos recebidos (AUTH com o segredo trocado por ***). */
  comandos: string[];
  /** Credenciais decodificadas do AUTH. */
  auths: { usuario: string; senha: string }[];
  /** Mensagens recebidas no DATA (sem o ponto final, com dot-stuffing desfeito). */
  mensagens: string[];
  fechar(): Promise<void>;
}

export async function criarSmtpFalso(roteiro: RoteiroSmtp = {}): Promise<SmtpFalso> {
  const comandos: string[] = [];
  const auths: { usuario: string; senha: string }[] = [];
  const mensagens: string[] = [];
  const sockets = new Set<net.Socket>();
  const extensoes = roteiro.extensoes ?? ['AUTH PLAIN LOGIN', '8BITMIME'];

  const servidor = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => undefined);
    const enviar = (linha: string) => s.write(linha + '\r\n');
    if (!roteiro.mudo) enviar(roteiro.saudacao ?? '220 falso.local ESMTP');
    let buffer = '';
    let modo: 'comando' | 'dados' | 'login-usuario' | 'login-senha' = 'comando';
    let usuarioLogin = '';
    s.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (modo === 'dados') {
          const fim = buffer.indexOf('\r\n.\r\n');
          if (fim < 0) return;
          mensagens.push(buffer.slice(0, fim + 2).replace(/(^|\r\n)\.\./g, '$1.'));
          buffer = buffer.slice(fim + 5);
          modo = 'comando';
          comandos.push('<dados>');
          enviar(roteiro.respostas?.CORPO ?? '250 2.0.0 Ok: queued as FALSO1');
          continue;
        }
        const i = buffer.indexOf('\r\n');
        if (i < 0) return;
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (modo === 'login-usuario') {
          usuarioLogin = Buffer.from(linha, 'base64').toString('utf8');
          comandos.push('***');
          modo = 'login-senha';
          enviar('334 UGFzc3dvcmQ6');
          continue;
        }
        if (modo === 'login-senha') {
          auths.push({ usuario: usuarioLogin, senha: Buffer.from(linha, 'base64').toString('utf8') });
          comandos.push('***');
          modo = 'comando';
          enviar(roteiro.respostas?.AUTH ?? '235 2.7.0 ok');
          continue;
        }
        const verbo = linha.split(' ')[0]!.toUpperCase();
        if (verbo === 'AUTH') {
          const [, mec, inicial] = linha.split(' ');
          comandos.push(`AUTH ${mec}${inicial ? ' ***' : ''}`);
          if (mec === 'PLAIN' && inicial) {
            const [, usuario = '', senha = ''] = Buffer.from(inicial, 'base64').toString('utf8').split('\u0000');
            auths.push({ usuario, senha });
            enviar(roteiro.respostas?.AUTH ?? '235 2.7.0 ok');
          } else if (mec === 'LOGIN') {
            modo = 'login-usuario';
            enviar('334 VXNlcm5hbWU6');
          } else enviar('504 mecanismo');
          continue;
        }
        comandos.push(linha);
        switch (verbo) {
          case 'EHLO':
            if (roteiro.respostas?.EHLO) enviar(roteiro.respostas.EHLO);
            else {
              const todas = ['falso.local', ...extensoes];
              todas.forEach((l, k) => enviar(`250${k === todas.length - 1 ? ' ' : '-'}${l}`));
            }
            break;
          case 'HELO':
            enviar('250 falso.local');
            break;
          case 'STARTTLS':
            enviar(roteiro.respostas?.STARTTLS ?? '454 TLS indisponível');
            break;
          case 'MAIL':
            enviar(roteiro.respostas?.MAIL ?? '250 2.1.0 ok');
            break;
          case 'RCPT':
            enviar(roteiro.respostas?.RCPT ?? '250 2.1.5 ok');
            break;
          case 'DATA':
            enviar(roteiro.respostas?.DATA ?? '354 fim com <CRLF>.<CRLF>');
            if (!roteiro.respostas?.DATA || roteiro.respostas.DATA.startsWith('354')) modo = 'dados';
            break;
          case 'QUIT':
            enviar('221 2.0.0 tchau');
            s.end();
            break;
          default:
            enviar('502 5.5.2 comando desconhecido');
        }
      }
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const porta = (servidor.address() as net.AddressInfo).port;
  return {
    porta,
    comandos,
    auths,
    mensagens,
    fechar: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        servidor.close(() => resolve());
      }),
  };
}

/** Uma porta livre que ninguém escuta (conexão recusada). */
export async function portaFechada(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const porta = (s.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return porta;
}
