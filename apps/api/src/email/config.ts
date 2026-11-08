/**
 * Configuração do e-mail transacional (T-0094) lida do ambiente. Segredos só no `.env`/secrets (CLAUDE.md regra 8).
 *
 * | Variável | Padrão | Uso |
 * |---|---|---|
 * | `MACUXI_EMAIL_TRANSPORTE` | `smtp` com `MACUXI_SMTP_HOST`; `arquivo` com `MACUXI_EMAIL_ARQUIVO_DIR`; senão `desligado` | `smtp`, `arquivo` (demo/testes) ou `desligado` |
 * | `MACUXI_SMTP_HOST` | — | servidor SMTP (obrigatório com `smtp`) |
 * | `MACUXI_SMTP_PORTA` | 587 (465 com `tls`) | porta; 465 ⇒ TLS implícito se `MACUXI_SMTP_TLS` não vier |
 * | `MACUXI_SMTP_TLS` | `starttls` (465: `tls`) | `starttls` (exige o anúncio), `tls` (implícito) ou `nenhum` (só fora de produção com credencial) |
 * | `MACUXI_SMTP_USUARIO` / `MACUXI_SMTP_SENHA` | — | credencial AUTH (as duas ou nenhuma) |
 * | `MACUXI_SMTP_REMETENTE` | `Macuxi FDV <nao-responda@macuxifdv.com.br>` | `Nome <email>` ou só o e-mail |
 * | `MACUXI_SMTP_TIMEOUT_MS` | 15000 | prazo de cada etapa SMTP |
 * | `MACUXI_EMAIL_ARQUIVO_DIR` | — (`<tmp>/macuxi-email` com `arquivo` explícito) | pasta do adaptador `arquivo` (a "caixa" da demo e dos testes) |
 * | `MACUXI_EMAIL_ARQUIVO_MASCARAR` | desligado | `1`: o `.eml` sai com a senha mascarada |
 *
 * Chave da carga da outbox (`plataforma.email_saida.carga`, AES-256-GCM): HKDF-SHA256 do `MACUXI_JWT_SEGREDO` com
 * `info = macuxi.email_saida.v1` (ADR 0032; sem secret novo: trocar o segredo invalida só os e-mails pendentes, que vencem em 72 h).
 * `desligado` = `disponivel() = false` (a rota avisa ou recusa com 503 `EMAIL_INDISPONIVEL`; nada vai para a outbox).
 *
 * Falha fechada: em produção, sem `MACUXI_JWT_SEGREDO` (≥ 32) a configuração é recusada; credencial
 * SMTP com `MACUXI_SMTP_TLS=nenhum` também. Nenhuma mensagem de erro, aviso ou `descreverConfigEmail` traz senha, usuário
 * (costuma ser e-mail: só `autenticado: true`) ou chave.
 */
import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODIGOS_EMAIL, type EnderecoEmail } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { SEGREDO_JWT_MIN } from '../config';
import { ErroEmail } from './erros';

export const TRANSPORTES_EMAIL = ['smtp', 'arquivo', 'desligado'] as const;
export type TransporteEmailConfig = (typeof TRANSPORTES_EMAIL)[number];
export const MODOS_TLS_SMTP = ['starttls', 'tls', 'nenhum'] as const;
export type ModoTlsSmtp = (typeof MODOS_TLS_SMTP)[number];

export const REMETENTE_PADRAO = 'Macuxi FDV <nao-responda@macuxifdv.com.br>';
export const PORTA_SMTP_PADRAO = 587;
export const PORTA_SMTP_TLS_IMPLICITO = 465;
export const TIMEOUT_SMTP_PADRAO_MS = 15_000;
/** `info` do HKDF que deriva a chave da outbox de e-mail a partir do `MACUXI_JWT_SEGREDO` (desenho T-0094 §10; troca = chave nova). */
export const ROTULO_HKDF_EMAIL = 'macuxi.email_saida.v1';

export interface ConfigSmtp {
  host: string;
  porta: number;
  tls: ModoTlsSmtp;
  /** Ausente = sem AUTH. */
  credencial?: { usuario: string; senha: string };
  timeoutMs: number;
  /** Credencial em conexão sem TLS (só fora de produção; o cliente SMTP recusa se for `false`). */
  permitirCredencialSemTls: boolean;
}

export interface ConfigEmail {
  transporte: TransporteEmailConfig;
  producao: boolean;
  remetente: EnderecoEmail;
  smtp?: ConfigSmtp;
  /** Pasta do adaptador `arquivo` (`MACUXI_EMAIL_ARQUIVO_DIR`). */
  pasta: string;
  mascararSenhaNoArquivo: boolean;
  /** 32 bytes (AES-256-GCM). */
  chave: Uint8Array;
  origemChave: 'MACUXI_JWT_SEGREDO' | 'efemera';
  /** Avisos para a subida (sem valor de segredo). */
  avisos: string[];
  /** Se alguém registrar o objeto inteiro por engano, sai só a descrição segura. */
  toJSON(): Record<string, unknown>;
}

const EmailRemetente = z.string().trim().toLowerCase().email().max(254);

/** `Nome <email>` ou `email`. Recusa CR/LF (injeção de cabeçalho). */
export function lerRemetente(valor: string): EnderecoEmail | null {
  const v = valor.trim();
  if (!v || /[\r\n]/.test(v)) return null;
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  const nome = m ? m[1]!.trim().replace(/^"(.*)"$/, '$1').trim() : undefined;
  const email = EmailRemetente.safeParse(m ? m[2] : v);
  if (!email.success) return null;
  return nome ? { email: email.data, nome } : { email: email.data };
}

/** Chave da outbox de e-mail derivada do segredo do JWT (HKDF-SHA256, sal vazio, `info = macuxi.email_saida.v1`, 32 bytes). */
export function derivarChaveEmail(segredoJwt: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', segredoJwt, '', ROTULO_HKDF_EMAIL, 32));
}

function erroConfig(problemas: string[]): ErroEmail {
  return new ErroEmail(CODIGOS_EMAIL.CONFIG_INVALIDA, `configuração de e-mail inválida: ${problemas.join('; ')}`, {
    retentavel: false,
    etapa: 'config',
  });
}

/**
 * Lê a configuração. Lança `ErroEmail` `EMAIL_CONFIG_INVALIDA` com a lista de problemas (só nomes de variável e valores
 * permitidos). `producao` padrão: `NODE_ENV === 'production'`.
 */
export function lerConfigEmail(env: NodeJS.ProcessEnv, opcoes: { producao?: boolean } = {}): ConfigEmail {
  const producao = opcoes.producao ?? env.NODE_ENV === 'production';
  const problemas: string[] = [];
  const avisos: string[] = [];
  const valor = (k: string) => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };

  const host = valor('MACUXI_SMTP_HOST');
  const transporteBruto = valor('MACUXI_EMAIL_TRANSPORTE')?.toLowerCase();
  const dirArquivo = valor('MACUXI_EMAIL_ARQUIVO_DIR');
  let transporte: TransporteEmailConfig = host ? 'smtp' : dirArquivo ? 'arquivo' : 'desligado';
  if (transporteBruto !== undefined) {
    if ((TRANSPORTES_EMAIL as readonly string[]).includes(transporteBruto)) transporte = transporteBruto as TransporteEmailConfig;
    else problemas.push(`MACUXI_EMAIL_TRANSPORTE deve ser ${TRANSPORTES_EMAIL.join(', ')}`);
  }

  const remetenteBruto = valor('MACUXI_SMTP_REMETENTE');
  const remetente = lerRemetente(remetenteBruto ?? REMETENTE_PADRAO);
  if (!remetente) problemas.push('MACUXI_SMTP_REMETENTE inválido (use "Nome <email>" ou só o e-mail)');
  if (transporte === 'smtp' && !remetenteBruto) avisos.push(`MACUXI_SMTP_REMETENTE ausente: usando ${REMETENTE_PADRAO}`);

  let smtp: ConfigSmtp | undefined;
  if (transporte === 'smtp') {
    if (!host) problemas.push('MACUXI_SMTP_HOST obrigatório com MACUXI_EMAIL_TRANSPORTE=smtp');
    else if (/[\s/@]/.test(host)) problemas.push('MACUXI_SMTP_HOST deve ser só o nome ou IP do servidor');

    const tlsBruto = valor('MACUXI_SMTP_TLS')?.toLowerCase();
    if (tlsBruto !== undefined && !(MODOS_TLS_SMTP as readonly string[]).includes(tlsBruto)) {
      problemas.push(`MACUXI_SMTP_TLS deve ser ${MODOS_TLS_SMTP.join(', ')}`);
    }
    const portaBruta = valor('MACUXI_SMTP_PORTA');
    let porta = PORTA_SMTP_PADRAO;
    if (portaBruta !== undefined) {
      porta = Number(portaBruta);
      if (!/^\d+$/.test(portaBruta) || porta < 1 || porta > 65_535) problemas.push('MACUXI_SMTP_PORTA deve ser um número de 1 a 65535');
    } else if (tlsBruto === 'tls') {
      porta = PORTA_SMTP_TLS_IMPLICITO;
    }
    const tls: ModoTlsSmtp =
      tlsBruto && (MODOS_TLS_SMTP as readonly string[]).includes(tlsBruto)
        ? (tlsBruto as ModoTlsSmtp)
        : porta === PORTA_SMTP_TLS_IMPLICITO
          ? 'tls'
          : 'starttls';

    const usuario = env.MACUXI_SMTP_USUARIO?.trim() || undefined;
    const senha = env.MACUXI_SMTP_SENHA || undefined;
    if (Boolean(usuario) !== Boolean(senha)) problemas.push('MACUXI_SMTP_USUARIO e MACUXI_SMTP_SENHA vão juntos (as duas ou nenhuma)');
    if (usuario && senha && tls === 'nenhum' && producao) {
      problemas.push('credencial SMTP com MACUXI_SMTP_TLS=nenhum é recusada em produção (a senha iria em claro)');
    }
    if (tls === 'nenhum' && !producao) avisos.push('MACUXI_SMTP_TLS=nenhum: conexão sem cifra (só para teste local)');

    const timeoutBruto = valor('MACUXI_SMTP_TIMEOUT_MS');
    const timeoutMs = timeoutBruto === undefined ? TIMEOUT_SMTP_PADRAO_MS : Number(timeoutBruto);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      problemas.push('MACUXI_SMTP_TIMEOUT_MS deve ser inteiro de 1000 a 120000');
    }

    smtp = {
      host: host ?? '',
      porta,
      tls,
      ...(usuario && senha ? { credencial: { usuario, senha } } : {}),
      timeoutMs,
      permitirCredencialSemTls: !producao,
    };
  }

  const pasta = dirArquivo ?? join(tmpdir(), 'macuxi-email');
  if (transporte === 'arquivo') {
    avisos.push('e-mail no adaptador "arquivo": nada sai para a internet; os .eml ficam em MACUXI_EMAIL_ARQUIVO_DIR');
    if (producao) avisos.push('transporte "arquivo" em produção: use só na demo');
  }
  if (transporte === 'desligado') avisos.push('envio de e-mail desligado: sem MACUXI_SMTP_HOST nem MACUXI_EMAIL_ARQUIVO_DIR (ou MACUXI_EMAIL_TRANSPORTE=desligado)');
  const mascararBruto = (valor('MACUXI_EMAIL_ARQUIVO_MASCARAR') ?? '').toLowerCase();
  const mascararSenhaNoArquivo = mascararBruto === '1' || mascararBruto === 'true' || mascararBruto === 'sim';

  let chave: Uint8Array | null = null;
  let origemChave: ConfigEmail['origemChave'] = 'efemera';
  const segredoJwt = env.MACUXI_JWT_SEGREDO;
  if (segredoJwt && segredoJwt.length >= SEGREDO_JWT_MIN) {
    chave = derivarChaveEmail(segredoJwt);
    origemChave = 'MACUXI_JWT_SEGREDO';
  } else if (transporte !== 'desligado') {
    if (producao) {
      problemas.push(`sem MACUXI_JWT_SEGREDO (mín. ${SEGREDO_JWT_MIN}) em produção: a outbox de e-mail não sobe (falha fechada)`);
    } else {
      avisos.push('sem MACUXI_JWT_SEGREDO: chave da outbox de e-mail efêmera (API e despachante em processos diferentes não se entendem)');
    }
  }

  if (problemas.length > 0 || !remetente) throw erroConfig(problemas);

  const cfg: ConfigEmail = {
    transporte,
    producao,
    remetente,
    ...(smtp ? { smtp } : {}),
    pasta,
    mascararSenhaNoArquivo,
    chave: chave ?? new Uint8Array(randomBytes(32)),
    origemChave,
    avisos,
    toJSON: () => descreverConfigEmail(cfg),
  };
  return cfg;
}

/**
 * Descrição para log da subida: nunca usuário, senha ou chave (só `autenticado` e uma impressão curta da chave para
 * conferir que API e despachante usam a mesma — 8 hex do SHA-256, não reversível).
 */
export function descreverConfigEmail(cfg: ConfigEmail): Record<string, unknown> {
  return {
    transporte: cfg.transporte,
    producao: cfg.producao,
    remetente: cfg.remetente.email,
    ...(cfg.smtp
      ? { host: cfg.smtp.host, porta: cfg.smtp.porta, tls: cfg.smtp.tls, autenticado: Boolean(cfg.smtp.credencial), timeout_ms: cfg.smtp.timeoutMs }
      : {}),
    ...(cfg.transporte === 'arquivo' ? { pasta: cfg.pasta, mascarar_senha: cfg.mascararSenhaNoArquivo } : {}),
    origem_chave: cfg.origemChave,
    impressao_chave: createHash('sha256').update('macuxi.email.impressao:').update(cfg.chave).digest('hex').slice(0, 8),
  };
}
