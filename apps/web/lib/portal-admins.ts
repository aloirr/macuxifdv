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
import type { AdminDaEmpresa, RedefinirSenhaAdminResposta } from '@macuxi/platform-sdk';
import { formatDateTime, type BadgeTone } from '@macuxi/ui/web';

import { ehRotaAusente, ErroPortal, MENSAGEM_SEM_CONEXAO, mensagemDoErro } from './portal-api';

export const TEXTOS_ADMINS = Object.freeze({
  titulo: 'Administradores',
  ajuda: 'Quem administra esta empresa no backoffice. Se um deles perdeu a senha, mande uma senha temporária nova por e-mail.',
  carregando: 'Buscando os administradores…',
  vazio: 'Esta empresa ainda não tem administrador.',
  emBreve: 'A lista de administradores ainda não está disponível neste servidor.',
  botao: 'Redefinir senha',
  dialogoTexto: (email: string) =>
    `O Macuxi gera uma senha temporária e manda para ${email}. Ela vale por 72 horas, e a pessoa cria a dela no próximo acesso ao backoffice. Ela sai do Macuxi agora em todos os aparelhos.`,
  cancelar: 'Cancelar',
  confirmar: 'Redefinir senha',
  confirmando: 'Redefinindo…',
  semEmail: 'O envio de e-mail não está configurado, e a senha não foi trocada. Fale com o suporte da Macuxi.',
  alterado: 'Os dados deste administrador mudaram. Confira a lista atualizada e tente de novo.',
  naoEncontrado: 'Este administrador não está mais ativo nesta empresa. A lista foi atualizada.',
  empresaNaoEncontrada: 'Empresa não encontrada ou inativa. Volte à lista de empresas.',
  semAcesso: 'Só o time da Macuxi redefine a senha do administrador. O administrador usa "Esqueci a senha" no backoffice.',
  repetido: 'Não deu para concluir. Tente de novo.',
  rotaAusente: 'A redefinição de senha ainda não está disponível neste servidor.',
});

export const tituloDoDialogo = (nome: string) => `Redefinir a senha de ${nome}?`;

/** Resultado (a senha nunca aparece no portal; nem com `repetida`, que é a mesma redefinição já feita). */
export function textoDoResultado(email: string, r: Pick<RedefinirSenhaAdminResposta, 'senha_expira_em'>, fuso?: string): string {
  return `Senha nova enviada por e-mail para ${email}; vale 72 h (até ${formatDateTime(r.senha_expira_em, fuso)}).`;
}

/** Só admin ativo e não bloqueado (a API responde 404 aos outros). Também para senha pendente ou vencida: é como reenviar. */
export const podeRedefinir = (a: Pick<AdminDaEmpresa, 'ativo' | 'bloqueado'>): boolean => a.ativo && !a.bloqueado;

export interface Etiqueta {
  texto: string;
  tom: BadgeTone;
}

/** Etiquetas da linha (sempre com texto; tons da tabela de Usuários, spec ciclo-de-senha.md §5), no fuso da empresa. */
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
