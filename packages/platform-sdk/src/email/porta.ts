/**
 * Porta do e-mail transacional (T-0094; ADR 0032; desenho docs/desenho/T-0094.md §10; RN-CORE-34).
 *
 * - `ServicoEmail` — o que a rota recebe em `ctx.email` (rota de módulo e rota pública). `enfileirar(db, m)` só faz um `insert` em
 *   `plataforma.email_saida` PELA CONEXÃO RECEBIDA (a da transação do tenant): a senha muda ⇔ o e-mail entra na fila, juntos ou
 *   nenhum. A carga (`para` + `dados`) vai cifrada; fora dela ficam só `tenant_id`, `usuario_id`, `modelo` e
 *   `chave_idempotencia`. A mesma `chave_idempotencia` no tenant não gera 2º e-mail. Sem adaptador configurado:
 *   `disponivel() = false` e `enfileirar` devolve `'indisponivel'` sem gravar.
 * - `TransporteEmail` — o que o despachante (papel `macuxi_worker`) usa para entregar a mensagem já renderizada (SMTP, arquivo).
 *
 * Os códigos (`CODIGOS_EMAIL`) são os únicos detalhes de erro que vão para log, resposta ou para `email_saida.ultimo_erro`: nunca
 * a resposta textual do servidor SMTP (pode ecoar o destinatário), nem e-mail, nome ou senha.
 */
import { z } from 'zod';
import type { ClienteBanco } from '../api';
import {
  DadosMensagemEmailSchema,
  EmailDestinoSchema,
  ModeloEmailSchema,
  problemaModeloDados,
  type EmailRenderizado,
  type ModeloEmail,
} from './modelos';

export const CODIGOS_EMAIL = {
  /** Mensagem recusada pela validação (Zod). Não adianta tentar de novo. */
  DADOS_INVALIDOS: 'EMAIL_DADOS_INVALIDOS',
  /** Configuração inválida (variável ausente ou incoerente). */
  CONFIG_INVALIDA: 'EMAIL_CONFIG_INVALIDA',
  /** Carga da outbox não decifra (segredo trocado, adulteração) ou não valida depois de decifrada. */
  CIFRA_INVALIDA: 'EMAIL_CIFRA_INVALIDA',
  /** Passou de `email_saida.expira_em` sem sair (a senha temporária já venceu). */
  EXPIRADO: 'EMAIL_EXPIRADO',
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

/** Formato aceito pela coluna `email_saida.chave_idempotencia` (migração 0040): sem `@` nem espaço, nunca o e-mail. */
export const CHAVE_IDEMPOTENCIA_EMAIL_RE = /^[A-Za-z0-9_.:+-]{1,200}$/;

/** Pedido de e-mail que a rota entrega à porta (desenho §10). */
export const MensagemEmailSchema = z
  .object({
    modelo: ModeloEmailSchema,
    /** Destinatário no tenant da transação (FK composta para `core.usuario`). */
    usuario_id: z.string().uuid(),
    /** E-mail do destinatário (vai só dentro da carga cifrada). */
    para: EmailDestinoSchema,
    dados: DadosMensagemEmailSchema,
    /** Ex.: `${usuario_id}:acesso`, `${usuario_id}:redefinida:${sessao_versao}`, `${usuario_id}:esqueci:${criada_em}`. */
    chave_idempotencia: z.string().regex(CHAVE_IDEMPOTENCIA_EMAIL_RE, 'chave de idempotência fora do formato'),
  })
  .strict()
  .superRefine((m, ctx) => {
    const problema = problemaModeloDados(m.modelo, m.dados);
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['dados', 'motivo'] });
  });
export type MensagemEmail = z.input<typeof MensagemEmailSchema>;
/** Mensagem validada (e-mails em minúsculas). */
export type MensagemEmailValidada = z.output<typeof MensagemEmailSchema>;

export type ResultadoEnfileirarEmail = 'enfileirado' | 'indisponivel';

/** Porta que as rotas usam (`ctx.email`). */
export interface ServicoEmail {
  /** Há adaptador configurado (SMTP ou arquivo)? */
  disponivel(): boolean;
  /**
   * Grava o pedido na outbox pela conexão recebida (a da transação do tenant, `comTenant`). Duplicata pela
   * `chave_idempotencia` = `'enfileirado'` sem 2ª linha. Sem adaptador = `'indisponivel'` sem gravar. Mensagem inválida ou banco
   * fora = lança (a rota desfaz a transação: a senha não muda sem o e-mail).
   */
  enfileirar(db: ClienteBanco, m: MensagemEmail): Promise<ResultadoEnfileirarEmail>;
}

/** `ServicoEmail` em memória para testes de módulo: guarda as mensagens validadas (senha em claro só aqui, no teste). */
export function criarServicoEmailMemoria(op: { disponivel?: boolean } = {}): ServicoEmail & {
  readonly enviados: readonly MensagemEmailValidada[];
  ligar(disponivel: boolean): void;
} {
  const enviados: MensagemEmailValidada[] = [];
  const chaves = new Set<string>();
  let ligado = op.disponivel ?? true;
  return {
    enviados,
    ligar: (d) => {
      ligado = d;
    },
    disponivel: () => ligado,
    async enfileirar(_db, m) {
      if (!ligado) return 'indisponivel';
      const v = MensagemEmailSchema.parse(m);
      if (!chaves.has(v.chave_idempotencia)) {
        chaves.add(v.chave_idempotencia);
        enviados.push(v);
      }
      return 'enfileirado';
    },
  };
}

/** Endereço com nome opcional (o remetente da configuração ou o destinatário). */
export interface EnderecoEmail {
  email: string;
  nome?: string;
}

/** Mensagem pronta para o transporte (o despachante monta a partir da linha da outbox decifrada). */
export interface EmailParaEnvio {
  /** `plataforma.email_saida.id` (também vai no `Message-ID`). */
  idEnvio: string;
  modelo: ModeloEmail;
  de: EnderecoEmail;
  para: EnderecoEmail;
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
  entregar(msg: EmailParaEnvio): Promise<ResultadoTransporteEmail>;
}
