/**
 * E-mail transacional (T-0094; ADR 0032; desenho docs/desenho/T-0094.md §10; textos docs/design/ciclo-de-senha.md §8): modelos,
 * tipos Zod e renderização. Puro TypeScript (sem `node:*`): a API valida, cifra e monta a mensagem; o BKO pode pré-visualizar.
 *
 * Modelos (português, texto curto):
 * - `acesso_inicial` — "Seu acesso ao Macuxi": código da empresa, e-mail, senha temporária, onde entrar, troca no 1º acesso e
 *   validade (RN-CORE-34; `validade_horas = null` = não vence, P5).
 * - `nova_senha` — "Sua nova senha do Macuxi": "Esqueci a senha" (`esqueci`) ou redefinição pelo BKO/portal (`redefinida`;
 *   `redefinida_por = 'macuxi'` quando foi o suporte da Macuxi, pelo portal).
 *
 * Nada aqui loga. `renderizarEmailParaLog` devolve a mesma mensagem com nome, e-mail e senha trocados por marcadores
 * (RN-CORE-34: nenhum e-mail, nome ou senha em log ou evento); `renderizarEmailSemSenha` troca só a senha.
 */
import { z } from 'zod';
import { PILHA_MONO_EMAIL, PILHA_SISTEMA_EMAIL } from '@macuxi/comum/fonte';
import { APPS_COM_LOGIN } from '../perfis';

/** Validade da senha temporária (RN-CORE-34, P4): depois disso o login recusa e o admin gera outra. */
export const VALIDADE_SENHA_PROVISORIA_HORAS = 72;

export const MODELOS_EMAIL = ['acesso_inicial', 'nova_senha'] as const;
export const ModeloEmailSchema = z.enum(MODELOS_EMAIL);
export type ModeloEmail = z.infer<typeof ModeloEmailSchema>;

/** Motivo do "Sua nova senha": pedido em "Esqueci a senha" ou redefinida pelo BKO (ou pelo portal). */
export const MOTIVOS_NOVA_SENHA = ['esqueci', 'redefinida'] as const;
export type MotivoNovaSenha = (typeof MOTIVOS_NOVA_SENHA)[number];

/**
 * Quem redefiniu (só com `motivo = 'redefinida'`; aditivo, T-0094 🟢 do testes R-20261108-063325): `empresa` (padrão, o admin
 * pelo BKO) ou `macuxi` (o time da Macuxi pelo portal do super-admin, ADR 0029). Só muda a frase de abertura do e-mail.
 */
export const AUTORES_REDEFINICAO = ['empresa', 'macuxi'] as const;
export type AutorRedefinicao = (typeof AUTORES_REDEFINICAO)[number];

/**
 * Sem caractere de controle (CR/LF/TAB/NUL…): os textos vão para cabeçalho MIME (`To`) e para o corpo; um `\r\n` num nome
 * seria injeção de cabeçalho.
 */
// eslint-disable-next-line no-control-regex -- é justamente a faixa de controle que se recusa
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]*$/;
const texto = (min: number, max: number) => z.string().trim().min(min).max(max).regex(SEM_CONTROLE, 'caractere de controle');
export const EmailDestinoSchema = z.string().trim().toLowerCase().email().max(254).regex(SEM_CONTROLE, 'caractere de controle');

/** Dados do modelo (vão só dentro da carga cifrada da outbox). */
export const DadosMensagemEmailSchema = z
  .object({
    /** Vazio = "Olá." */
    nome: texto(0, 120),
    empresa_nome: texto(1, 120),
    codigo_empresa: texto(1, 40),
    login: EmailDestinoSchema,
    /** Segredo: só na carga cifrada e no corpo do e-mail. 8 a 128, sem espaço nas pontas nem caractere de controle. */
    senha: z
      .string()
      .min(8)
      .max(128)
      .regex(SEM_CONTROLE, 'caractere de controle')
      .refine((s) => s === s.trim(), 'senha com espaço nas pontas'),
    /** 72 (P4); `null` = não vence (senha master do admin inicial, P5). */
    validade_horas: z.number().int().positive().max(720).nullable(),
    /** Onde entrar (PERFIS_DO_APP do perfil): textos do modelo. */
    apps: z.array(z.enum(APPS_COM_LOGIN)).max(APPS_COM_LOGIN.length),
    /** Só no `nova_senha` (obrigatório nele). */
    motivo: z.enum(MOTIVOS_NOVA_SENHA).optional(),
    /** Só com `motivo = 'redefinida'`; ausente = `empresa`. */
    redefinida_por: z.enum(AUTORES_REDEFINICAO).optional(),
  })
  .strict();
export type DadosMensagemEmail = z.input<typeof DadosMensagemEmailSchema>;

/** O que fica dentro da carga cifrada de `plataforma.email_saida`: destinatário + dados do modelo. */
export const CargaEmailSchema = z.object({ para: EmailDestinoSchema, dados: DadosMensagemEmailSchema }).strict();
export type CargaEmail = z.output<typeof CargaEmailSchema>;

/**
 * Confere a coerência modelo × dados: `motivo` obrigatório no `nova_senha` e proibido no `acesso_inicial`; `redefinida_por`
 * só com `motivo = 'redefinida'`.
 */
export function problemaModeloDados(modelo: ModeloEmail, dados: { motivo?: unknown; redefinida_por?: unknown }): string | null {
  if (modelo === 'nova_senha' && dados.motivo === undefined) return 'motivo obrigatório no modelo nova_senha';
  if (modelo === 'acesso_inicial' && dados.motivo !== undefined) return 'motivo só no modelo nova_senha';
  if (dados.redefinida_por !== undefined && dados.motivo !== 'redefinida') return 'redefinida_por só com motivo redefinida';
  return null;
}

/** Mensagem pronta para o transporte (SMTP/arquivo). */
export interface EmailRenderizado {
  assunto: string;
  texto: string;
  html: string;
}

export const ASSUNTOS_EMAIL: Readonly<Record<ModeloEmail, string>> = {
  acesso_inicial: 'Seu acesso ao Macuxi',
  nova_senha: 'Sua nova senha do Macuxi',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const ONDE_ENTRAR: Readonly<Record<(typeof APPS_COM_LOGIN)[number], string>> = {
  campo: 'no app Macuxi Campo',
  gestao: 'no app Macuxi Gestão',
  web: 'no backoffice do Macuxi, pelo navegador',
};

/** "no app Macuxi Campo ou no backoffice…" na ordem campo, gestão, web (design §8). */
export function ondeEntrar(apps: readonly (typeof APPS_COM_LOGIN)[number][]): string {
  return APPS_COM_LOGIN.filter((a) => apps.includes(a))
    .map((a) => ONDE_ENTRAR[a])
    .join(' ou ');
}

/** Linha do texto: parágrafo, rótulo + valor, ou a senha (monoespaçada no HTML). */
type Linha = string | { rotulo: string; valor: string; senha?: boolean };

const RODAPE = 'Macuxi FDV · e-mail automático, não responda.';


function montar(assunto: string, linhas: readonly Linha[]): EmailRenderizado {
  const textoPuro = linhas.map((l) => (typeof l === 'string' ? l : `${l.rotulo}: ${l.valor}`)).join('\n') + '\n';
  const corpo = linhas
    .map((l) => {
      if (typeof l === 'string') return l === '' ? '' : `<p style="margin:0 0 12px">${escaparHtml(l)}</p>`;
      if (l.senha) {
        return (
          `<p style="margin:0 0 4px">${escaparHtml(l.rotulo)}:</p>` +
          `<p style="margin:0 0 12px"><span style="display:inline-block;background:#F8F6F1;color:#16202A;padding:8px 12px;font-family:${PILHA_MONO_EMAIL};font-variant-numeric:tabular-nums;font-size:18px">${escaparHtml(l.valor)}</span></p>`
        );
      }
      return `<p style="margin:0 0 4px">${escaparHtml(l.rotulo)}: <span style="font-weight:600">${escaparHtml(l.valor)}</span></p>`;
    })
    .filter(Boolean)
    .join('\n');
  const html =
    '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>' +
    escaparHtml(assunto) +
    '</title></head>\n<body style="margin:0;background:#FFFFFF">\n' +
    `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:${PILHA_SISTEMA_EMAIL};font-size:15px;line-height:1.5;color:#16202A">\n` +
    `<h1 style="font-family:${PILHA_SISTEMA_EMAIL};font-size:20px;margin:0 0 16px">${escaparHtml(assunto)}</h1>\n` +
    corpo +
    '\n</div>\n</body></html>\n';
  return { assunto, texto: textoPuro, html };
}

function renderizarValidado(modelo: ModeloEmail, c: CargaEmail): EmailRenderizado {
  const d = c.dados;
  const ola = d.nome ? `Olá, ${d.nome}.` : 'Olá.';
  const onde = ondeEntrar(d.apps);
  const comApp = d.apps.includes('campo') || d.apps.includes('gestao');
  const credenciais: Linha[] = [
    { rotulo: 'Código da empresa', valor: d.codigo_empresa },
    { rotulo: 'E-mail', valor: d.login },
    { rotulo: 'Senha temporária', valor: d.senha, senha: true },
  ];
  if (modelo === 'acesso_inicial') {
    const validade =
      d.validade_horas === null
        ? ['No primeiro acesso, você cria a sua senha.']
        : [`No primeiro acesso, você cria a sua senha. A senha temporária vale por ${d.validade_horas} horas.`, 'Se ela vencer, use "Esqueci a senha" na tela de entrada.'];
    return montar(ASSUNTOS_EMAIL.acesso_inicial, [
      ola,
      '',
      `Seu acesso ao Macuxi na ${d.empresa_nome} está pronto.`,
      '',
      ...credenciais,
      '',
      ...(onde ? [`Entre ${onde}.`] : []),
      ...(comApp ? ['Ainda não tem o app? Peça ao administrador da sua empresa.'] : []),
      '',
      ...validade,
      '',
      RODAPE,
    ]);
  }
  const esqueci = d.motivo === 'esqueci';
  const abertura = esqueci
    ? `Recebemos um pedido de senha nova para o seu acesso na ${d.empresa_nome}.`
    : d.redefinida_por === 'macuxi'
      ? `O suporte da Macuxi definiu uma senha nova para o seu acesso na ${d.empresa_nome}.`
      : `O administrador da ${d.empresa_nome} definiu uma senha nova para você.`;
  const fecho = esqueci ? 'Se não foi você, ignore este e-mail: a sua senha atual continua valendo.' : 'A senha anterior não vale mais.';
  const validade = d.validade_horas === null ? '' : ` A senha temporária vale por ${d.validade_horas} horas.`;
  return montar(ASSUNTOS_EMAIL.nova_senha, [
    ola,
    '',
    abertura,
    '',
    ...credenciais,
    '',
    `Entre ${onde || 'no Macuxi'} e crie a sua senha.${validade}`,
    '',
    fecho,
    '',
    RODAPE,
  ]);
}

/** Valida a carga (Zod) e a coerência com o modelo. Lança `ZodError`/`Error` (sem valores: a mensagem é fixa). */
export function validarCargaEmail(modelo: ModeloEmail, carga: unknown): CargaEmail {
  const m = ModeloEmailSchema.parse(modelo);
  const c = CargaEmailSchema.parse(carga);
  const problema = problemaModeloDados(m, c.dados);
  if (problema) throw new Error(`carga de e-mail incoerente: ${problema}`);
  return c;
}

/** Renderiza o e-mail (valida antes). */
export function renderizarEmail(modelo: ModeloEmail, carga: unknown): EmailRenderizado {
  return renderizarValidado(modelo, validarCargaEmail(modelo, carga));
}

/** Marcadores que substituem os dados pessoais na versão de log. */
export const MARCADORES_EMAIL = { nome: '[nome]', email: '[e-mail]', senha: '********' } as const;

/**
 * A mesma mensagem com nome, e-mail/login e senha trocados por marcadores (RN-CORE-34): é o que pode ir para console/log.
 * Recebe a carga já validada.
 */
export function renderizarEmailParaLog(modelo: ModeloEmail, c: CargaEmail): EmailRenderizado {
  return renderizarValidado(modelo, {
    para: MARCADORES_EMAIL.email,
    dados: { ...c.dados, nome: c.dados.nome ? MARCADORES_EMAIL.nome : '', login: MARCADORES_EMAIL.email, senha: MARCADORES_EMAIL.senha },
  });
}

/** A mensagem com só a senha mascarada (nome e login reais): opção do adaptador de arquivo. */
export function renderizarEmailSemSenha(modelo: ModeloEmail, c: CargaEmail): EmailRenderizado {
  return renderizarValidado(modelo, { ...c, dados: { ...c.dados, senha: MARCADORES_EMAIL.senha } });
}

/** Os valores sensíveis da carga (para conferir em teste que nada vazou num log): e-mail, nome, login e senha. */
export function valoresSensiveisEmail(c: CargaEmail): string[] {
  return [...new Set([c.para, c.dados.nome, c.dados.login, c.dados.senha].filter((v) => v.length > 0))];
}
