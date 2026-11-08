/**
 * Portas do e-mail transacional (T-0094, RN-CORE-34).
 *
 * - `EnvioEmail` — o que a rota chama. Valida, cifra e enfileira; devolve na hora (`situacao: 'enfileirado'`), sem esperar o
 *   servidor de e-mail. Nunca lança por dado inválido ou fila fora: devolve `{ ok: false, codigo, retentavel }`.
 * - `TransporteEmail` — o que o worker usa para entregar a mensagem já renderizada (SMTP, arquivo da demo…).
 *
 * Os códigos (`CODIGOS_EMAIL`) são os únicos detalhes de erro que vão para log, resposta ou job: nunca a resposta textual
 * do servidor SMTP (pode ecoar o destinatário), nem e-mail, nome ou senha.
 */
import { z } from 'zod';
import type { DadosPorModelo, DestinatarioEmail, EmailRenderizado, ModeloEmail } from './modelos';

export const CODIGOS_EMAIL = {
  /** Pedido recusado pela validação (Zod). Não adianta tentar de novo. */
  DADOS_INVALIDOS: 'EMAIL_DADOS_INVALIDOS',
  /** A fila não aceitou o pedido (banco fora, pg-boss parado). Pode tentar de novo. */
  FILA_INDISPONIVEL: 'EMAIL_FILA_INDISPONIVEL',
  /** Envio desligado na configuração (`MACUXI_EMAIL_TRANSPORTE=desligado`). */
  DESLIGADO: 'EMAIL_DESLIGADO',
  /** Configuração inválida (variável ausente ou incoerente). */
  CONFIG_INVALIDA: 'EMAIL_CONFIG_INVALIDA',
  /** Carga da fila não decifra (chave trocada, adulteração) ou não valida depois de decifrada. */
  CIFRA_INVALIDA: 'EMAIL_CIFRA_INVALIDA',
  /** Falha de rede (conexão recusada, caiu no meio). */
  CONEXAO: 'EMAIL_CONEXAO',
  /** O servidor não respondeu no prazo. */
  TEMPO_ESGOTADO: 'EMAIL_TEMPO_ESGOTADO',
  /** TLS exigido e o servidor não oferece (sem STARTTLS) ou o aperto de mão falhou. */
  TLS_INDISPONIVEL: 'EMAIL_TLS_INDISPONIVEL',
  /** Credencial recusada ou mecanismo AUTH não suportado. */
  AUTENTICACAO: 'EMAIL_AUTENTICACAO',
  /** Recusa temporária do servidor (4xx). */
  RECUSA_TEMPORARIA: 'EMAIL_RECUSA_TEMPORARIA',
  /** Recusa definitiva do servidor (5xx: destinatário inexistente, remetente não autorizado…). */
  RECUSA_DEFINITIVA: 'EMAIL_RECUSA_DEFINITIVA',
  /** Resposta fora do protocolo. */
  PROTOCOLO: 'EMAIL_PROTOCOLO',
  /** Falha inesperada do transporte (gravação do arquivo, erro desconhecido). */
  TRANSPORTE: 'EMAIL_TRANSPORTE',
} as const;
export type CodigoEmail = (typeof CODIGOS_EMAIL)[keyof typeof CODIGOS_EMAIL];
const LISTA_CODIGOS = Object.values(CODIGOS_EMAIL) as [CodigoEmail, ...CodigoEmail[]];
export const CodigoEmailSchema = z.enum(LISTA_CODIGOS);

export const SITUACOES_ENVIO_EMAIL = ['enfileirado', 'enviado'] as const;

export const ResultadoEnvioEmailSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), idEnvio: z.string().uuid(), situacao: z.enum(SITUACOES_ENVIO_EMAIL) }).strict(),
  z.object({ ok: z.literal(false), codigo: CodigoEmailSchema, retentavel: z.boolean() }).strict(),
]);
export type ResultadoEnvioEmail = z.infer<typeof ResultadoEnvioEmailSchema>;

export const OpcoesEnvioEmailSchema = z
  .object({
    /** UUID gerado por quem chama (idempotência: o mesmo id não gera 2º e-mail). Sem ele, o serviço gera. */
    idEnvio: z.string().uuid().optional(),
    /** Tenant do pedido (só vai para log e para o job, nunca dado pessoal). */
    tenantId: z.string().uuid().optional(),
  })
  .strict();
export type OpcoesEnvioEmail = z.input<typeof OpcoesEnvioEmailSchema>;

/** Porta que as rotas usam. */
export interface EnvioEmail {
  enviar<M extends ModeloEmail>(
    modelo: M,
    destinatario: DestinatarioEmail,
    dados: DadosPorModelo[M],
    opcoes?: OpcoesEnvioEmail,
  ): Promise<ResultadoEnvioEmail>;
}

/** Endereço com nome opcional (o remetente da configuração ou o destinatário). */
export interface EnderecoEmail {
  email: string;
  nome?: string;
}

/** Mensagem pronta para o transporte. */
export interface MensagemEmail {
  idEnvio: string;
  modelo: ModeloEmail;
  de: EnderecoEmail;
  para: { email: string; nome: string };
  assunto: string;
  texto: string;
  html: string;
  /** Mesma mensagem com nome, e-mail e senha em marcadores: a única versão do corpo que pode ir para log. */
  paraLog?: EmailRenderizado;
  /** Mesma mensagem com só a senha mascarada (transporte de arquivo com mascaramento ligado). */
  semSenha?: EmailRenderizado;
}

export interface ResultadoTransporteEmail {
  /** `Message-ID` gerado (sem dado pessoal: `<idEnvio@dominio-do-remetente>`). */
  idMensagem?: string;
}

/** Porta de saída: entrega uma mensagem. Falha lança `ErroEmail` (API) com `codigo` e `retentavel`. */
export interface TransporteEmail {
  nome: string;
  entregar(msg: MensagemEmail): Promise<ResultadoTransporteEmail>;
}
