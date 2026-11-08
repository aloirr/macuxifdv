/**
 * Erro do e-mail transacional (T-0094, RN-CORE-34). A mensagem é sempre montada aqui, só com etapa e código: nunca a
 * resposta textual do servidor SMTP (pode ecoar o destinatário), credenciais, e-mail, nome ou senha. É seguro ir para log
 * e para a coluna de saída do job do pg-boss.
 */
import { CODIGOS_EMAIL, type CodigoEmail } from '@macuxi/platform-sdk';

export class ErroEmail extends Error {
  override readonly name = 'ErroEmail' as const;
  readonly codigo: CodigoEmail;
  readonly retentavel: boolean;
  /** Código numérico SMTP da resposta, quando houver (ex.: 550). */
  readonly codigoSmtp: number | undefined;
  /** Etapa em que falhou (ex.: `rcpt_to`, `starttls`, `config`). */
  readonly etapa: string | undefined;

  constructor(codigo: CodigoEmail, mensagem: string, opcoes: { retentavel: boolean; codigoSmtp?: number; etapa?: string }) {
    super(mensagem);
    this.codigo = codigo;
    this.retentavel = opcoes.retentavel;
    this.codigoSmtp = opcoes.codigoSmtp;
    this.etapa = opcoes.etapa;
  }

  /** Para o pino (`code`) e para o `serializarErro`: só campos seguros. */
  get code(): string {
    return this.codigo;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, codigo: this.codigo, retentavel: this.retentavel, codigoSmtp: this.codigoSmtp, etapa: this.etapa, message: this.message };
  }
}

/**
 * Qualquer erro → `ErroEmail` seguro. Erro desconhecido vira `EMAIL_TRANSPORTE` retentável com mensagem genérica: a
 * mensagem original (de biblioteca, do sistema de arquivos…) não é copiada, pois pode trazer caminho ou dado.
 */
export function comoErroEmail(e: unknown): ErroEmail {
  if (e instanceof ErroEmail) return e;
  const codigoSistema = typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : undefined;
  const sufixo = codigoSistema && /^E[A-Z0-9_]+$/.test(codigoSistema) ? ` (${codigoSistema})` : '';
  return new ErroEmail(CODIGOS_EMAIL.TRANSPORTE, `falha inesperada no envio de e-mail${sufixo}`, { retentavel: true });
}
