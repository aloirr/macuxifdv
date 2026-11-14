/**
 * "Redefinir senha do admin" no portal `config.` (T-0094 fatia S; R-20261108-005744; RN-CORE-32, RN-CORE-34; doc 03 §2): o time da
 * Macuxi escolhe um admin da empresa e manda uma senha temporária nova por e-mail. Puro, para teste.
 * - Lista: `GET /v1/plataforma/empresas/:tenant_id/admins` (`ListaAdminsDaEmpresaSchema`, função `sa_admins_da_empresa` da 0042).
 * - Redefinir: `POST .../admins/:usuario_id/redefinir-senha` com `{ email_id }` (UUID gerado no portal, chave de idempotência:
 *   repetir o mesmo id devolve a mesma resposta e não muda nada). A senha NUNCA volta na resposta: vai só por e-mail, vale 72 h,
 *   a pessoa cria a dela no 1º acesso ao backoffice e as sessões dela caem.
 * - Sem e-mail configurado a API responde 503 `EMAIL_INDISPONIVEL` ANTES de trocar a senha: não há senha para mostrar nem copiar
 *   (diferente da tela Usuários do BKO, em que quem digita a senha é o admin; spec docs/design/ciclo-de-senha.md §5).
 * Textos propostos ao designer-ux (revisão pedida na entrega), no tom da spec ciclo-de-senha.md.
 */
import type { AdminDaEmpresa } from '@macuxi/platform-sdk';
import { formatDateTime, type BadgeTone } from '@macuxi/ui/web';

import { ehRotaAusente, ErroPortal, MENSAGEM_SEM_CONEXAO, mensagemDoErro, TEXTO_INDISPONIVEL } from './portal-api';

export const TEXTOS_ADMINS = Object.freeze({
  titulo: 'Administradores',
  carregando: 'Buscando os administradores…',
  vazio: 'Esta empresa ainda não tem administrador.',
  emBreve: TEXTO_INDISPONIVEL,
  botao: 'Redefinir senha',
  /** Spec portal-config-enxuto §8 (RD-0291): o destino e o efeito, sem o funcionamento. */
  dialogoTexto: (a: Pick<AdminDaEmpresa, 'nome' | 'email'>) => `Uma senha temporária vai para ${a.email}. ${a.nome} sai do Macuxi em todos os aparelhos.`,
  cancelar: 'Cancelar',
  confirmar: 'Redefinir senha',
  confirmando: 'Redefinindo…',
  /** RD-0292: quem vê é o time da Macuxi (só ele redefine), que confere a configuração. */
  semEmail: 'O envio de e-mail não está configurado neste servidor: nada foi gravado. Confira a configuração de e-mail.',
  alterado: 'Os dados deste administrador mudaram. Confira a lista atualizada e tente de novo.',
  naoEncontrado: 'Este administrador não está mais ativo nesta empresa. A lista foi atualizada.',
  empresaNaoEncontrada: 'Empresa não encontrada ou inativa.',
  semAcesso: 'Só o time da Macuxi redefine a senha do administrador. O administrador usa "Esqueci a senha" no backoffice.',
  repetido: 'Não deu para concluir. Tente de novo.',
  rotaAusente: TEXTO_INDISPONIVEL,
  /** RN-CORE-33/35: admin com outro perfil de base vendedor, promotor ou supervisor (ex.: admin + vendedor). R-20261108-125732 🟡 3. */
  soPeloApp: 'Entra só pelo app',
  soPeloAppDica: 'Também tem perfil de vendedor, promotor ou supervisor; por isso não entra no backoffice.',
});

/**
 * `entra_no_portal` (migração 0047, `sa_admins_da_empresa`; R-20261108-111116 e R-20261108-111043): a lista traz também quem tem
 * admin como perfil extra; com outro perfil de base vendedor, promotor ou supervisor, a regra mais restritiva dos acessos
 * (RN-CORE-35) fecha o backoffice e o portal: `entra_no_portal = false`. A pessoa entra só pelo app, e a redefinição continua.
 */
export const soEntraPeloApp = (a: Pick<AdminDaEmpresa, 'entra_no_portal'>): boolean => !a.entra_no_portal;

export const tituloDoDialogo = (nome: string) => `Redefinir a senha de ${nome}?`;

/** Resultado (a senha nunca aparece no portal). A validade fica só no selo da linha (RD-0291: uma informação, um lugar). */
export function textoDoResultado(email: string): string {
  return `Senha temporária enviada para ${email}.`;
}

/** Só admin ativo e não bloqueado (a API responde 404 aos outros). Também para senha pendente ou vencida: é como reenviar. */
export const podeRedefinir = (a: Pick<AdminDaEmpresa, 'ativo' | 'bloqueado'>): boolean => a.ativo && !a.bloqueado;

export interface Etiqueta {
  texto: string;
  tom: BadgeTone;
  /** Explicação ao passar o mouse (atributo `title`). */
  dica?: string;
}

/**
 * Etiquetas da linha (sempre com texto; tons da tabela de Usuários, spec ciclo-de-senha.md §5), no fuso da empresa. Por último,
 * "Entra só pelo app" (RN-CORE-35), que não muda o "Redefinir senha".
 */
export function etiquetasDoAdmin(a: AdminDaEmpresa, agora: number, fuso?: string): Etiqueta[] {
  const e: Etiqueta[] = [];
  if (!a.ativo) e.push({ texto: 'Inativo', tom: 'neutral' });
  if (a.bloqueado) e.push({ texto: 'Bloqueado', tom: 'danger' });
  if (!a.tem_senha) e.push({ texto: 'Sem senha', tom: 'neutral' });
  else if (a.trocar_senha) {
    if (!a.senha_expira_em) e.push({ texto: 'Troca de senha pendente', tom: 'warning' });
    else if (Date.parse(a.senha_expira_em) > agora) e.push({ texto: `Troca de senha pendente · vence em ${formatDateTime(a.senha_expira_em, fuso)}`, tom: 'warning' });
    else e.push({ texto: 'Senha temporária vencida', tom: 'danger' });
  }
  if (soEntraPeloApp(a)) e.push({ texto: TEXTOS_ADMINS.soPeloApp, tom: 'neutral', dica: TEXTOS_ADMINS.soPeloAppDica });
  return e;
}

/** O que a tela faz com o erro do redefinir: texto, recarregar a lista, trocar o `email_id`, fechar o diálogo. */
export interface AcaoDoErro {
  mensagem: string;
  recarregar: boolean;
  novoId: boolean;
  fechar: boolean;
}

export function acaoDoErro(e: unknown): AcaoDoErro {
  const base: AcaoDoErro = { mensagem: mensagemDoErro(e), recarregar: false, novoId: false, fechar: false };
  if (ehRotaAusente(e)) return { ...base, mensagem: TEXTOS_ADMINS.rotaAusente };
  if (!(e instanceof ErroPortal)) return base;
  switch (e.codigo) {
    // nada mudou; o mesmo `email_id` serve para tentar de novo quando o e-mail voltar
    case 'EMAIL_INDISPONIVEL':
      return { ...base, mensagem: TEXTOS_ADMINS.semEmail };
    case 'ADMIN_ALTERADO':
      return { ...base, mensagem: TEXTOS_ADMINS.alterado, recarregar: true, novoId: true, fechar: true };
    case 'USUARIO_NAO_ENCONTRADO':
      return { ...base, mensagem: TEXTOS_ADMINS.naoEncontrado, recarregar: true, novoId: true, fechar: true };
    case 'TENANT_NAO_ENCONTRADO':
      return { ...base, mensagem: TEXTOS_ADMINS.empresaNaoEncontrada, fechar: true };
    case 'PERFIL_SEM_ACESSO':
      return { ...base, mensagem: TEXTOS_ADMINS.semAcesso, fechar: true };
    // o id já foi usado para outro admin: gera outro e deixa tentar
    case 'PEDIDO_REPETIDO_DIFERENTE':
      return { ...base, mensagem: TEXTOS_ADMINS.repetido, novoId: true };
    // sem rede: tentar de novo com o MESMO id (se a 1ª chegou ao servidor, a API devolve a mesma resposta)
    case 'sem_conexao':
      return { ...base, mensagem: MENSAGEM_SEM_CONEXAO };
    default:
      return base;
  }
}
