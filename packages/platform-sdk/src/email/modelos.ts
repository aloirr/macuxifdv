/**
 * E-mail transacional (T-0094; ADR 0032, com o adendo de 15/11/2026; desenho docs/desenho/T-0094.md §10; textos e layout
 * docs/design/emails/redefinir-senha.md, aprovado em R-20261114-202700): modelos, tipos Zod e renderização. Puro TypeScript
 * (sem `node:*`): a API valida, cifra e monta a mensagem; o BKO pode pré-visualizar.
 *
 * Um só layout para os modelos (spec §5): título "Crie a sua senha {destino}", uma linha de contexto, o bloco de dados
 * (código da empresa, e-mail, senha temporária e validade), o botão do backoffice (opcional) e a assinatura.
 * - `acesso_inicial` — "Seu acesso ao Macuxi" (RN-CORE-34; `validade_horas = null` = não vence, P5).
 * - `nova_senha` — "Sua senha temporária do Macuxi": "Esqueci a senha" (`esqueci`) ou redefinição pelo BKO/portal
 *   (`redefinida`; `redefinida_por = 'macuxi'` quando foi o suporte da Macuxi, pelo portal).
 *
 * Nada aqui loga. `renderizarEmailParaLog` devolve a mesma mensagem com nome, e-mail e senha trocados por marcadores
 * (RN-CORE-34: nenhum e-mail, nome ou senha em log ou evento); `renderizarEmailSemSenha` troca só a senha.
 */
import { z } from 'zod';
import { APPS_COM_LOGIN } from '../perfis';

/** Validade da senha temporária (RN-CORE-34, P4): depois disso o login recusa e o admin gera outra. */
export const VALIDADE_SENHA_PROVISORIA_HORAS = 72;

export const MODELOS_EMAIL = ['acesso_inicial', 'nova_senha'] as const;
export const ModeloEmailSchema = z.enum(MODELOS_EMAIL);
export type ModeloEmail = z.infer<typeof ModeloEmailSchema>;

/** Motivo do "Sua senha temporária": pedido em "Esqueci a senha" ou redefinida pelo BKO (ou pelo portal). */
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
    /** Só no `To:` (o corpo não leva o nome, spec §1); vazio = sem nome. */
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
  nova_senha: 'Sua senha temporária do Macuxi',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

type AppComLogin = (typeof APPS_COM_LOGIN)[number];

const ONDE_ENTRAR: Readonly<Record<AppComLogin, string>> = {
  campo: 'no app Macuxi Campo',
  gestao: 'no app Macuxi Gestão',
  web: 'no backoffice',
};
/** Sem destino (admin redefinido pelo portal sem acesso ao portal, `apps = []`). */
const SEM_DESTINO = 'no Macuxi';

/** "no app Macuxi Campo ou no backoffice" na ordem campo, gestão, web; sem destino, "no Macuxi" (spec §4). */
export function ondeEntrar(apps: readonly AppComLogin[]): string {
  const destinos = APPS_COM_LOGIN.filter((a) => apps.includes(a)).map((a) => ONDE_ENTRAR[a]);
  return destinos.length > 0 ? destinos.join(' ou ') : SEM_DESTINO;
}

/** Assinatura do manual da marca §7 (aprovada pelo dono do produto, R-20261114-202700). */
export const RODAPE_EMAIL = 'Equipe Macuxi FDV · Boa Vista, RR · macuxifdv.com.br';
/** Texto alternativo do logo (o `aria-label` do SVG); sem `urlLogo`, entra como texto no lugar do logo. */
export const TEXTO_ALTERNATIVO_LOGO = 'Macuxi Força de Vendas';
const ROTULO_BOTAO_BKO = 'Abrir o backoffice';

/**
 * Apresentação (não vem da carga cifrada; vem da configuração da API). Sem `urlLogo`, o texto alternativo entra como texto;
 * sem `urlLogoEscuro`, o modo escuro mantém o logo positivo (PNG com fundo branco opaco); sem `urlBackoffice`, não há botão.
 */
export interface OpcoesApresentacaoEmail {
  urlLogo?: string;
  urlLogoEscuro?: string;
  urlBackoffice?: string;
}

/** Modelo estruturado do layout-base (spec §2): um só layout para os três e-mails. */
interface CorpoEmail {
  titulo: string;
  contexto: string;
  /** Rótulo + valor, cada valor numa linha só dele; `destaque` = a senha (a maior coisa do bloco). */
  dados: readonly { rotulo: string; valor: string; destaque?: boolean }[];
  validade?: string;
  botao?: { rotulo: string; url: string };
}

const F_TITULO = 'font-family:Archivo,Arial,Helvetica,sans-serif;';
const F_TEXTO = "font-family:'IBM Plex Sans',Arial,Helvetica,sans-serif;";
const F_MONO = "font-family:'IBM Plex Mono',Consolas,'Courier New',monospace;";
const SELECIONAVEL = '-webkit-user-select:all;user-select:all;word-break:break-all';

function cabecalhoHtml(op: OpcoesApresentacaoEmail): string {
  const alt = escaparHtml(TEXTO_ALTERNATIVO_LOGO);
  const estiloAlt = `${F_TITULO}font-size:16px;font-weight:700;`;
  if (!op.urlLogo) {
    return `<tr><td class="mx-marca" style="padding:0 0 28px;${estiloAlt}line-height:30px;color:#1E3350">${alt}</td></tr>\n`;
  }
  const img = (classe: string, url: string, extra: string) =>
    `<img class="${classe}" src="${escaparHtml(url)}" width="139" height="30" alt="${alt}" style="${extra}border:0;height:30px;width:139px;${estiloAlt}`;
  return (
    '<tr><td style="padding:0 0 28px">\n' +
    img('mx-claro', op.urlLogo, 'display:block;') +
    'color:#1E3350">\n' +
    (op.urlLogoEscuro ? `<!--[if !mso]><!-->${img('mx-escuro', op.urlLogoEscuro, 'display:none;')}color:#FFFFFF"><!--<![endif]-->\n` : '') +
    '</td></tr>\n'
  );
}

function dadosHtml(c: CorpoEmail): string {
  const linhas = c.dados.map((d) => {
    const rotulo = `<tr><td class="mx-rotulo" style="padding:${d.destaque ? '12px' : '0'} 20px 2px;${F_TEXTO}font-size:13px;line-height:18px;color:#5B6673">${escaparHtml(d.rotulo)}</td></tr>`;
    const fonte = d.destaque ? `padding:0 20px ${c.validade ? 4 : 16}px;${F_MONO}font-size:22px;line-height:30px;font-weight:700;` : `padding:0 20px 12px;${F_MONO}font-size:17px;line-height:24px;font-weight:500;`;
    return `${rotulo}\n<tr><td class="mx-valor" style="${fonte}color:#16202A;${SELECIONAVEL}">${escaparHtml(d.valor)}</td></tr>`;
  });
  const validade = c.validade
    ? `\n<tr><td class="mx-texto" style="padding:0 20px 16px;${F_TEXTO}font-size:14px;line-height:20px;color:#4A5562">${escaparHtml(c.validade)}</td></tr>`
    : '';
  return (
    '<tr><td>\n<table role="presentation" class="mx-dados" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8F6F1" style="background:#F8F6F1;border:1px solid #DFE2E6;border-radius:8px">\n' +
    '<tr><td style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>\n' +
    linhas.join('\n') +
    validade +
    '\n</table>\n</td></tr>\n'
  );
}

function botaoHtml(b: CorpoEmail['botao']): string {
  if (!b) return '';
  return (
    '<tr><td style="padding:24px 0 0">\n' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="mx-botao" bgcolor="#1E3350" style="border-radius:8px;background:#1E3350">\n' +
    `<a class="mx-botao-txt" href="${escaparHtml(b.url)}" style="display:inline-block;padding:14px 24px;${F_TEXTO}font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${escaparHtml(b.rotulo)}</a>\n` +
    '</td></tr></table>\n</td></tr>\n'
  );
}

/** `<head>`: o `<style>` só melhora onde o cliente aceita (celular e modo escuro); tudo o que importa está inline. */
function cabecaHtml(assunto: string, op: OpcoesApresentacaoEmail): string {
  const trocaLogo = op.urlLogo && op.urlLogoEscuro ? '    .mx-claro { display:none !important; }\n    .mx-escuro { display:block !important; }\n' : '';
  return (
    '<!doctype html>\n<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="x-apple-disable-message-reformatting">\n' +
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">\n' +
    '<meta name="color-scheme" content="light dark">\n<meta name="supported-color-schemes" content="light dark">\n' +
    `<title>${escaparHtml(assunto)}</title>\n<style>\n` +
    '  :root { color-scheme: light dark; supported-color-schemes: light dark; }\n' +
    '  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }\n' +
    '  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }\n' +
    '  .mx-escuro { display:none; mso-hide:all; }\n' +
    '  @media (max-width:620px) {\n' +
    '    .mx-folha { padding:24px 20px 20px !important; }\n' +
    '    .mx-titulo { font-size:22px !important; line-height:28px !important; }\n' +
    '    .mx-fora { padding:0 !important; }\n' +
    '  }\n' +
    '  @media (prefers-color-scheme: dark) {\n' +
    '    .mx-fundo, .mx-folha, body { background:#1E3350 !important; }\n' +
    '    .mx-titulo, .mx-valor, .mx-marca { color:#FFFFFF !important; }\n' +
    '    .mx-texto, .mx-rotulo, .mx-assinatura { color:#C9CED5 !important; }\n' +
    '    .mx-dados { background:#3A4D68 !important; border-color:#3A4D68 !important; }\n' +
    '    .mx-filete { border-top-color:#C9CED5 !important; }\n' +
    '    .mx-botao { background:#FFFFFF !important; }\n' +
    '    .mx-botao-txt { color:#1E3350 !important; }\n' +
    trocaLogo +
    '  }\n</style>\n</head>\n'
  );
}

/**
 * Monta o HTML (tabelas, estilos inline, 600 px, modo escuro; spec §2 e §5, base `redefinir-senha/depois-*.html`) e a versão
 * só texto (spec §3: mesmo conteúdo e ordem, cada valor numa linha só dele).
 */
function montar(assunto: string, c: CorpoEmail, op: OpcoesApresentacaoEmail): EmailRenderizado {
  const texto =
    [
      c.titulo,
      '',
      c.contexto,
      '',
      ...c.dados.flatMap((d, i) => [...(i > 0 ? [''] : []), d.rotulo, d.valor]),
      ...(c.validade ? [c.validade] : []),
      ...(c.botao ? ['', `${c.botao.rotulo}: ${c.botao.url}`] : []),
      '',
      '--',
      RODAPE_EMAIL,
    ].join('\n') + '\n';
  const html =
    cabecaHtml(assunto, op) +
    '<body class="mx-fundo" style="margin:0;padding:0;background:#F8F6F1">\n' +
    '<table role="presentation" class="mx-fundo" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8F6F1" style="background:#F8F6F1">\n' +
    '<tr><td class="mx-fora" align="center" style="padding:24px 12px">\n' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">\n' +
    '<tr><td class="mx-folha" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 40px 28px;border-radius:12px">\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">\n' +
    cabecalhoHtml(op) +
    `<tr><td class="mx-titulo" style="padding:0 0 8px;${F_TITULO}font-size:24px;line-height:30px;font-weight:700;color:#16202A">${escaparHtml(c.titulo)}</td></tr>\n` +
    `<tr><td class="mx-texto" style="padding:0 0 20px;${F_TEXTO}font-size:15px;line-height:22px;color:#4A5562">${escaparHtml(c.contexto)}</td></tr>\n` +
    dadosHtml(c) +
    botaoHtml(c.botao) +
    '<tr><td style="padding:32px 0 0">\n' +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mx-filete mx-assinatura" style="border-top:2px solid #1E3350;padding:12px 0 0;${F_TEXTO}font-size:13px;line-height:18px;color:#5B6673">${escaparHtml(RODAPE_EMAIL)}</td></tr></table>\n` +
    '</td></tr>\n</table>\n</td></tr>\n</table>\n</td></tr>\n</table>\n</body>\n</html>\n';
  return { assunto, texto, html };
}

/** Contexto do spec §3: uma linha que diz por que o e-mail chegou. */
function contextoDe(modelo: ModeloEmail, d: CargaEmail['dados']): string {
  if (modelo === 'acesso_inicial') {
    const comApp = d.apps.includes('campo') || d.apps.includes('gestao');
    return `A ${d.empresa_nome} criou o seu acesso.${comApp ? ' Ainda não tem o app? Peça ao administrador da sua empresa.' : ''}`;
  }
  if (d.motivo === 'esqueci') return `Foi pedida uma senha nova para o seu acesso na ${d.empresa_nome}. Se não foi você, ignore este e-mail.`;
  if (d.redefinida_por === 'macuxi') return `O suporte da Macuxi redefiniu a sua senha na ${d.empresa_nome}.`;
  return `O administrador da ${d.empresa_nome} redefiniu a sua senha.`;
}

function renderizarValidado(modelo: ModeloEmail, c: CargaEmail, op: OpcoesApresentacaoEmail): EmailRenderizado {
  const d = c.dados;
  return montar(
    ASSUNTOS_EMAIL[modelo],
    {
      titulo: `Crie a sua senha ${ondeEntrar(d.apps)}`,
      contexto: contextoDe(modelo, d),
      dados: [
        { rotulo: 'Código da empresa', valor: d.codigo_empresa },
        { rotulo: 'E-mail', valor: d.login },
        { rotulo: 'Senha temporária', valor: d.senha, destaque: true },
      ],
      ...(d.validade_horas === null ? {} : { validade: `Vale por ${d.validade_horas} horas.` }),
      ...(d.apps.includes('web') && op.urlBackoffice ? { botao: { rotulo: ROTULO_BOTAO_BKO, url: op.urlBackoffice } } : {}),
    },
    op,
  );
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
export function renderizarEmail(modelo: ModeloEmail, carga: unknown, opcoes: OpcoesApresentacaoEmail = {}): EmailRenderizado {
  return renderizarValidado(modelo, validarCargaEmail(modelo, carga), opcoes);
}

/** Marcadores que substituem os dados pessoais na versão de log. */
export const MARCADORES_EMAIL = { nome: '[nome]', email: '[e-mail]', senha: '********' } as const;

/**
 * A mesma mensagem com nome, e-mail/login e senha trocados por marcadores (RN-CORE-34): é o que pode ir para console/log.
 * Recebe a carga já validada.
 */
export function renderizarEmailParaLog(modelo: ModeloEmail, c: CargaEmail, opcoes: OpcoesApresentacaoEmail = {}): EmailRenderizado {
  return renderizarValidado(modelo, {
    para: MARCADORES_EMAIL.email,
    dados: { ...c.dados, nome: c.dados.nome ? MARCADORES_EMAIL.nome : '', login: MARCADORES_EMAIL.email, senha: MARCADORES_EMAIL.senha },
  }, opcoes);
}

/** A mensagem com só a senha mascarada (nome e login reais): opção do adaptador de arquivo. */
export function renderizarEmailSemSenha(modelo: ModeloEmail, c: CargaEmail, opcoes: OpcoesApresentacaoEmail = {}): EmailRenderizado {
  return renderizarValidado(modelo, { ...c, dados: { ...c.dados, senha: MARCADORES_EMAIL.senha } }, opcoes);
}

/** Os valores sensíveis da carga (para conferir em teste que nada vazou num log): e-mail, nome, login e senha. */
export function valoresSensiveisEmail(c: CargaEmail): string[] {
  return [...new Set([c.para, c.dados.nome, c.dados.login, c.dados.senha].filter((v) => v.length > 0))];
}
