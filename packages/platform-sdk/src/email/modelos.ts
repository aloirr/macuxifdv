/**
 * E-mail transacional (T-0094; premissas RN-CORE-32/33/34 em docs/desenho/T-0094-email.md): modelos, tipos Zod e
 * renderização. Puro TypeScript (sem `node:*`): a API usa para validar e montar a mensagem; o BKO pode usar para pré-visualizar.
 *
 * Modelos (texto curto, português):
 * - `acesso_inicial` — "Seu acesso ao Macuxi": código da empresa, login, senha inicial, troca obrigatória no 1º acesso,
 *   validade de 72 h (RN-CORE-32).
 * - `nova_senha` — "Sua nova senha": esqueci a senha ou redefinição pelo BKO; senha provisória com a mesma troca
 *   obrigatória e validade (RN-CORE-33).
 *
 * Nada aqui loga. `renderizarEmailParaLog` devolve a mesma mensagem com nome, e-mail e senha trocados por marcadores
 * (RN-CORE-34: nenhum e-mail, nome ou senha em log ou evento); `renderizarEmailSemSenha` troca só a senha (caixa da demo).
 */
import { z } from 'zod';

/** Validade da senha inicial/provisória (RN-CORE-32/33): depois disso o login recusa e o admin gera outra. */
export const VALIDADE_SENHA_PROVISORIA_HORAS = 72;

export const MODELOS_EMAIL = ['acesso_inicial', 'nova_senha'] as const;
export const ModeloEmailSchema = z.enum(MODELOS_EMAIL);
export type ModeloEmail = z.infer<typeof ModeloEmailSchema>;

/**
 * Sem caractere de controle (CR/LF/TAB/NUL…): os textos vão para cabeçalho MIME (`To`) e para o corpo; um `\r\n` num nome
 * seria injeção de cabeçalho.
 */
// eslint-disable-next-line no-control-regex -- é justamente a faixa de controle que se recusa
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]*$/;
const textoLivre = (max: number) => z.string().trim().min(1).max(max).regex(SEM_CONTROLE, 'caractere de controle');
const EmailSchema = z.string().trim().toLowerCase().email().max(254).regex(SEM_CONTROLE, 'caractere de controle');

/** Para quem vai. O nome só aparece na saudação e no cabeçalho `To`; nunca em log. */
export const DestinatarioEmailSchema = z
  .object({
    email: EmailSchema,
    nome: textoLivre(120),
  })
  .strict();
export type DestinatarioEmail = z.input<typeof DestinatarioEmailSchema>;

/** Senha provisória como sai no e-mail: sem espaço nas pontas, sem caractere de controle, 8 a 128 caracteres. */
const SenhaProvisoriaSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(SEM_CONTROLE, 'caractere de controle')
  .refine((s) => s === s.trim(), 'senha com espaço nas pontas');

/** Só http(s): o endereço sai como texto no corpo, mas nunca `javascript:`/`data:`. */
const UrlAcessoSchema = z
  .string()
  .url()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), 'url sem http(s)');

const BaseAcessoSchema = z.object({
  /** Nome da empresa (tenant) como o usuário conhece. */
  empresa: textoLivre(120),
  /** Código da empresa pedido na tela de login (RF-CORE-01). */
  codigoEmpresa: textoLivre(40),
  /** Login (e-mail do usuário no tenant). */
  login: EmailSchema,
  /** Endereço do BKO ou da página de download do app (opcional). */
  urlAcesso: UrlAcessoSchema.optional(),
  validadeHoras: z.number().int().positive().max(720).default(VALIDADE_SENHA_PROVISORIA_HORAS),
});

export const DadosAcessoInicialSchema = BaseAcessoSchema.extend({ senhaInicial: SenhaProvisoriaSchema }).strict();
export type DadosAcessoInicial = z.input<typeof DadosAcessoInicialSchema>;

/** `esqueci`: pedido do próprio usuário na tela de login; `redefinicao_bko`: o admin redefiniu pelo BKO. */
export const MOTIVOS_NOVA_SENHA = ['esqueci', 'redefinicao_bko'] as const;
export const DadosNovaSenhaSchema = BaseAcessoSchema.extend({
  senhaProvisoria: SenhaProvisoriaSchema,
  motivo: z.enum(MOTIVOS_NOVA_SENHA),
}).strict();
export type DadosNovaSenha = z.input<typeof DadosNovaSenhaSchema>;

/** Dados de cada modelo (entrada, antes do `parse`). */
export interface DadosPorModelo {
  acesso_inicial: DadosAcessoInicial;
  nova_senha: DadosNovaSenha;
}

export const SCHEMAS_DADOS_EMAIL = {
  acesso_inicial: DadosAcessoInicialSchema,
  nova_senha: DadosNovaSenhaSchema,
} as const;

/** Pedido completo (o que vai, cifrado, para a fila). */
export const PedidoEmailSchema = z.discriminatedUnion('modelo', [
  z.object({ modelo: z.literal('acesso_inicial'), destinatario: DestinatarioEmailSchema, dados: DadosAcessoInicialSchema }).strict(),
  z.object({ modelo: z.literal('nova_senha'), destinatario: DestinatarioEmailSchema, dados: DadosNovaSenhaSchema }).strict(),
]);
/** Pedido validado (saída do `parse`: e-mails em minúsculas, `validadeHoras` preenchida). */
export type PedidoEmail = z.infer<typeof PedidoEmailSchema>;

/** Mensagem pronta para o transporte (SMTP/arquivo). */
export interface EmailRenderizado {
  assunto: string;
  texto: string;
  html: string;
}

export const ASSUNTOS_EMAIL: Readonly<Record<ModeloEmail, string>> = {
  acesso_inicial: 'Seu acesso ao Macuxi',
  nova_senha: 'Sua nova senha',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Linha do texto: rótulo + valor (o valor sai em negrito no HTML). */
type Linha = string | { rotulo: string; valor: string };

function montar(assunto: string, linhas: readonly Linha[]): EmailRenderizado {
  const texto = linhas.map((l) => (typeof l === 'string' ? l : `${l.rotulo}: ${l.valor}`)).join('\n') + '\n';
  const corpo = linhas
    .map((l) =>
      typeof l === 'string'
        ? l === ''
          ? ''
          : `<p>${escaparHtml(l)}</p>`
        : `<p>${escaparHtml(l.rotulo)}: <strong>${escaparHtml(l.valor)}</strong></p>`,
    )
    .filter(Boolean)
    .join('\n');
  const html =
    '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>' +
    escaparHtml(assunto) +
    '</title></head>\n<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">\n' +
    corpo +
    '\n</body></html>\n';
  return { assunto, texto, html };
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

function rodape(urlAcesso: string | undefined): Linha[] {
  return [
    ...(urlAcesso ? [{ rotulo: 'Acesse', valor: urlAcesso }] : []),
    '',
    'Não pediu este acesso? Ignore este e-mail e avise o administrador da sua empresa.',
    'Macuxi — mensagem automática, não responda.',
  ];
}

function renderizarValidado(p: PedidoEmail): EmailRenderizado {
  const ola = `Olá, ${primeiroNome(p.destinatario.nome)}.`;
  const validade = `A senha vale por ${p.dados.validadeHoras} h e precisa ser trocada no 1º acesso.`;
  if (p.modelo === 'acesso_inicial') {
    const d = p.dados;
    return montar(ASSUNTOS_EMAIL.acesso_inicial, [
      ola,
      `Seu acesso ao Macuxi (${d.empresa}) está pronto.`,
      '',
      { rotulo: 'Código da empresa', valor: d.codigoEmpresa },
      { rotulo: 'Login', valor: d.login },
      { rotulo: 'Senha inicial', valor: d.senhaInicial },
      '',
      validade,
      ...rodape(d.urlAcesso),
    ]);
  }
  const d = p.dados;
  const motivo =
    d.motivo === 'esqueci'
      ? 'Recebemos o pedido de nova senha do seu acesso ao Macuxi.'
      : `O administrador de ${d.empresa} redefiniu a senha do seu acesso ao Macuxi.`;
  return montar(ASSUNTOS_EMAIL.nova_senha, [
    ola,
    motivo,
    '',
    { rotulo: 'Código da empresa', valor: d.codigoEmpresa },
    { rotulo: 'Login', valor: d.login },
    { rotulo: 'Senha provisória', valor: d.senhaProvisoria },
    '',
    validade,
    'A senha anterior deixou de valer.',
    ...rodape(d.urlAcesso),
  ]);
}

/** Valida o pedido (Zod). Lança `ZodError` (o `serializarErro` da API só loga caminho e código, nunca o valor). */
export function validarPedidoEmail<M extends ModeloEmail>(modelo: M, destinatario: DestinatarioEmail, dados: DadosPorModelo[M]): PedidoEmail {
  return PedidoEmailSchema.parse({ modelo, destinatario, dados });
}

/** Renderiza o e-mail (valida antes). */
export function renderizarEmail<M extends ModeloEmail>(modelo: M, destinatario: DestinatarioEmail, dados: DadosPorModelo[M]): EmailRenderizado {
  return renderizarValidado(validarPedidoEmail(modelo, destinatario, dados));
}

/** Renderiza um pedido (o que sai da fila depois de decifrado); valida de novo. */
export function renderizarPedidoEmail(pedido: PedidoEmail): EmailRenderizado {
  return renderizarValidado(PedidoEmailSchema.parse(pedido));
}

/** Marcadores que substituem os dados pessoais na versão de log. */
export const MARCADORES_EMAIL = { nome: '[nome]', email: '[e-mail]', senha: '********' } as const;

function mascarar(pedido: PedidoEmail, pessoais: boolean): EmailRenderizado {
  const destinatario = pessoais ? { nome: MARCADORES_EMAIL.nome, email: MARCADORES_EMAIL.email } : pedido.destinatario;
  const login = pessoais ? MARCADORES_EMAIL.email : pedido.dados.login;
  if (pedido.modelo === 'acesso_inicial') {
    return renderizarValidado({ ...pedido, destinatario, dados: { ...pedido.dados, login, senhaInicial: MARCADORES_EMAIL.senha } });
  }
  return renderizarValidado({ ...pedido, destinatario, dados: { ...pedido.dados, login, senhaProvisoria: MARCADORES_EMAIL.senha } });
}

/**
 * A mesma mensagem com nome, e-mail/login e senha trocados por marcadores (RN-CORE-34): é o que pode ir para console/log.
 * Não revalida (recebe um pedido já validado e só troca os campos sensíveis).
 */
export function renderizarEmailParaLog(pedido: PedidoEmail): EmailRenderizado {
  return mascarar(pedido, true);
}

/** A mensagem com só a senha mascarada (nome e login reais): opção do transporte de arquivo na demo. */
export function renderizarEmailSemSenha(pedido: PedidoEmail): EmailRenderizado {
  return mascarar(pedido, false);
}

/**
 * Os valores sensíveis do pedido (para conferir que nada vazou num log; uso em teste e em auditoria de log): e-mail,
 * nome completo, primeiro nome (o que vai na saudação), login e senha.
 */
export function valoresSensiveisEmail(pedido: PedidoEmail): string[] {
  const senha = pedido.modelo === 'acesso_inicial' ? pedido.dados.senhaInicial : pedido.dados.senhaProvisoria;
  const valores = [pedido.destinatario.email, pedido.destinatario.nome, primeiroNome(pedido.destinatario.nome), pedido.dados.login, senha];
  return [...new Set(valores)];
}
