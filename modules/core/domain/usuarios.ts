/**
 * Usuários no BKO (RF-CORE-02, RF-CORE-01): regras puras da gestão de usuários pelo admin. A API revalida tudo.
 * - só o admin cria, edita, desativa e define senha (`usuario.gerir`); supervisor/gerente leem a lista recortada
 *   pelo escopo (RN-CORE-04), reutilizando o conjunto de `usuariosVisiveis`;
 * - usuário nunca é apagado: desativar (`ativo = false`) corta o acesso na próxima requisição;
 * - toda alteração é auditada (RN-AUD-01) sem dado pessoal em claro e sem senha/hash.
 */
import { PERFIS, type Perfil } from '@macuxi/platform-sdk';
import { montarHierarquia, type EquipeLinha } from './hierarquia';
import { podeExecutar, podeVer } from './matriz';

export const podeGerirUsuarios = (perfil: Perfil): boolean => podeExecutar(perfil, 'usuario.gerir');
export const podeVerUsuarios = (perfil: Perfil): boolean => podeVer(perfil, 'usuario.ver');

export const normalizarEmail = (email: string): string => email.trim().toLowerCase();

/** Mesmo formato da constraint `usuario_email_formato`. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const NOME_USUARIO_MAX = 200;
export const EXTERNAL_ID_MAX = 100;

export interface ErroDeCampo {
  campo: string;
  mensagem: string;
}

export interface DadosBasicosDeUsuario {
  nome: string;
  email: string;
  perfil: string;
  external_id: string | null;
}

export function validarDadosDeUsuario(d: DadosBasicosDeUsuario): ErroDeCampo[] {
  const erros: ErroDeCampo[] = [];
  const nome = d.nome.trim();
  if (nome.length === 0) erros.push({ campo: 'nome', mensagem: 'Informe o nome do usuário.' });
  else if (nome.length > NOME_USUARIO_MAX) erros.push({ campo: 'nome', mensagem: `O nome pode ter até ${NOME_USUARIO_MAX} caracteres.` });
  const email = normalizarEmail(d.email);
  if (!EMAIL_RE.test(email) || email.length > 254) erros.push({ campo: 'email', mensagem: 'Informe um e-mail válido, como nome@empresa.com.br.' });
  if (!(PERFIS as readonly string[]).includes(d.perfil)) erros.push({ campo: 'perfil', mensagem: 'Escolha um perfil da lista.' });
  if (d.external_id !== null && (d.external_id.trim().length === 0 || d.external_id.trim().length > EXTERNAL_ID_MAX)) {
    erros.push({ campo: 'external_id', mensagem: `O código do ERP deve ter de 1 a ${EXTERNAL_ID_MAX} caracteres; deixe vazio se não houver.` });
  }
  return erros;
}

/** Política da senha inicial definida pelo admin. Devolve a mensagem de erro ou `null` se a senha serve. */
export function validarSenhaInicial(senha: string, email: string): string | null {
  if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (senha.length > 200) return 'A senha pode ter até 200 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha precisa ter letras e números.';
  if (senha.toLowerCase() === normalizarEmail(email)) return 'A senha não pode ser igual ao e-mail.';
  return null;
}

export type CodigoAlteracaoRecusada = 'USUARIO_SEM_PERMISSAO' | 'USUARIO_AUTODESATIVACAO' | 'USUARIO_AUTORREBAIXA' | 'ULTIMO_ADMIN';

export interface EntradaAlteracaoUsuario {
  ator: { id: string; perfil: Perfil };
  alvo: { id: string; perfil: Perfil; ativo: boolean };
  depois: { perfil: Perfil; ativo: boolean };
  /** Admins ativos do tenant ANTES da alteração (inclui o alvo, se ele for admin ativo). */
  adminsAtivos: number;
}

const MENSAGENS: Record<CodigoAlteracaoRecusada, string> = {
  USUARIO_SEM_PERMISSAO: 'Só o administrador altera usuários.',
  USUARIO_AUTODESATIVACAO: 'Você não pode desativar o seu próprio usuário. Peça a outro administrador.',
  USUARIO_AUTORREBAIXA: 'Você não pode tirar o seu próprio perfil de administrador. Peça a outro administrador.',
  ULTIMO_ADMIN: 'Esta empresa ficaria sem administrador ativo. Cadastre outro administrador antes.',
};
export const mensagemDaRecusa = (c: CodigoAlteracaoRecusada): string => MENSAGENS[c];

/** Guarda contra perda de acesso administrativo ao desativar ou mudar o perfil de um usuário. */
export function avaliarAlteracaoDeUsuario(e: EntradaAlteracaoUsuario): { ok: true } | { ok: false; codigo: CodigoAlteracaoRecusada; mensagem: string } {
  const recusa = (codigo: CodigoAlteracaoRecusada) => ({ ok: false as const, codigo, mensagem: MENSAGENS[codigo] });
  if (!podeGerirUsuarios(e.ator.perfil)) return recusa('USUARIO_SEM_PERMISSAO');
  const proprio = e.ator.id === e.alvo.id;
  if (proprio && e.alvo.ativo && !e.depois.ativo) return recusa('USUARIO_AUTODESATIVACAO');
  if (proprio && e.alvo.perfil === 'admin' && e.depois.perfil !== 'admin') return recusa('USUARIO_AUTORREBAIXA');
  const eraAdminAtivo = e.alvo.perfil === 'admin' && e.alvo.ativo;
  const continuaAdminAtivo = e.depois.perfil === 'admin' && e.depois.ativo;
  if (eraAdminAtivo && !continuaAdminAtivo && e.adminsAtivos <= 1) return recusa('ULTIMO_ADMIN');
  return { ok: true };
}

/** RN-CORE-04: recorta a lista pelo conjunto de usuários visíveis (`usuariosVisiveis`); `'tenant'` = sem recorte. */
export function recortarUsuarios<T extends { id: string }>(itens: readonly T[], visiveis: ReadonlySet<string> | 'tenant'): T[] {
  if (visiveis === 'tenant') return [...itens];
  return itens.filter((i) => visiveis.has(i.id));
}

export interface UsuarioAuditavel {
  nome: string;
  nome_curto: string | null;
  email: string;
  perfil: string;
  equipe_id: string | null;
  ativo: boolean;
  external_id: string | null;
}

/** Campos pessoais: a auditoria diz que mudaram, mas não guarda o valor (nome, nome curto, e-mail). */
const PESSOAIS = ['nome', 'nome_curto', 'email'] as const;
const NAO_PESSOAIS = ['perfil', 'equipe_id', 'ativo', 'external_id'] as const;

/** RN-AUD-01: antes/depois só do que mudou. Valores só dos campos não pessoais; senha e hash nunca entram. */
export function diffAuditavelDeUsuario(antes: UsuarioAuditavel, depois: UsuarioAuditavel): { campos_alterados: string[]; antes: Record<string, unknown>; depois: Record<string, unknown> } {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  const campos: string[] = [];
  for (const c of PESSOAIS) if (antes[c] !== depois[c]) campos.push(c);
  for (const c of NAO_PESSOAIS) {
    if (antes[c] === depois[c]) continue;
    campos.push(c);
    a[c] = antes[c];
    d[c] = depois[c];
  }
  return { campos_alterados: campos, antes: a, depois: d };
}

/** Superior imediato de um usuário que está (ou entra) na equipe: reaproveita `montarHierarquia` (mesma regra da API de hierarquia). */
export function superiorImediatoNaEquipe(equipes: readonly EquipeLinha[], equipeId: string | null): string | null {
  if (!equipeId) return null;
  const candidato = { id: '00000000-0000-0000-0000-000000000000', nome: 'x', perfil: 'vendedor' as const, equipe_id: equipeId, ativo: true };
  return montarHierarquia(equipes, [candidato])[0]?.superior_id ?? null;
}
