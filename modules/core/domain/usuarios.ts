/**
 * Usuários no BKO (RF-CORE-02, RF-CORE-01): regras puras da gestão de usuários pelo admin. A API revalida tudo.
 * - quem cria, edita, desativa e redefine senha é decidido pelo motor de permissões (ADR 0033: `usuario.criar|editar|desativar`,
 *   `senha.redefinir`; fábrica = só o admin), nunca por nome de perfil; supervisor/gerente leem a lista recortada
 *   pelo escopo (RN-CORE-04), reutilizando o conjunto de `usuariosVisiveis`;
 * - usuário nunca é apagado: desativar (`ativo = false`) corta o acesso na próxima requisição;
 * - toda alteração é auditada (RN-AUD-01) sem dado pessoal em claro e sem senha/hash.
 */
import {
  PERFIS,
  perfilDeFabrica,
  pode,
  validarAcessoDoTenant,
  type DefinicaoChave,
  type EstadoAcessoTenant,
  type MatrizFabrica,
  type Perfil,
  type PerfilDaRequisicao,
  type ViolacaoLimite,
} from '@macuxi/platform-sdk';
import { montarHierarquia, type EquipeLinha } from './hierarquia';
import { podeVer } from './matriz';
import { faltasNaSenha, mensagemDaSenha } from './senha';

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

/**
 * Política da senha definida pelo admin (RN-CORE-32 + não ser o e-mail). Devolve a mensagem de erro ou `null` se a senha serve.
 */
export function validarSenhaInicial(senha: string, email: string): string | null {
  const faltas = faltasNaSenha(senha);
  if (faltas.length > 0) return mensagemDaSenha(faltas, senha);
  if (senha.toLowerCase() === normalizarEmail(email)) return 'A senha não pode ser igual ao e-mail.';
  return null;
}

export type CodigoAlteracaoRecusada = 'USUARIO_SEM_PERMISSAO' | 'USUARIO_AUTODESATIVACAO' | 'USUARIO_AUTORREBAIXA' | 'ULTIMO_ADMIN' | ViolacaoLimite['codigo'];

export interface UsuarioDoEstado {
  id: string;
  perfil: Perfil;
  ativo: boolean;
}

export interface EntradaAlteracaoUsuario {
  /** Quem altera: o id e os perfis resolvidos da requisição (`ctx.usuario.perfis`). */
  ator: { id: string; perfis: readonly PerfilDaRequisicao[] };
  /** `perfis` = os perfis reais do alvo (multiperfil, T-0111); sem eles vale só o principal, no padrão de fábrica. */
  alvo: UsuarioDoEstado & { perfis?: readonly { codigo: string; base: Perfil }[] };
  /** `perfis` = códigos dos perfis depois da alteração (omitido = os de hoje; ou só o principal novo, se ele mudou). */
  depois: { perfil: Perfil; ativo: boolean; perfis?: readonly string[] };
  /**
   * Usuários do tenant ANTES da alteração (RN-CORE-35: o último admin e a autogestão olham o conjunto). Precisam incluir todos os
   * admins ativos, o ator e o alvo; os demais não mudam o resultado.
   */
  usuarios: readonly UsuarioDoEstado[];
  /**
   * Estado real do tenant ANTES da alteração (perfis personalizados, sobreposições e perfis de cada usuário; `carregar` da API).
   * Presente: os limites (último admin, autogestão) são avaliados nele; ausente: padrão de fábrica a partir de `usuarios`.
   */
  estado?: EstadoAcessoTenant;
  matriz: MatrizFabrica;
  catalogo?: readonly DefinicaoChave[];
}

const MENSAGENS: Record<'USUARIO_SEM_PERMISSAO' | 'USUARIO_AUTODESATIVACAO', string> = {
  USUARIO_SEM_PERMISSAO: 'Seu perfil não pode alterar usuários. Peça a quem administra a sua empresa.',
  USUARIO_AUTODESATIVACAO: 'Você não pode desativar o seu próprio usuário. Peça a outro administrador.',
};
const CODIGO_DA_VIOLACAO: Partial<Record<ViolacaoLimite['codigo'], CodigoAlteracaoRecusada>> = { AUTOGESTAO: 'USUARIO_AUTORREBAIXA' };
export const mensagemDaRecusa = (c: 'USUARIO_SEM_PERMISSAO' | 'USUARIO_AUTODESATIVACAO'): string => MENSAGENS[c];

const refDoUsuario = (perfil: Perfil) => ({ codigo: perfil, base: perfil });

/**
 * Guarda da alteração de um usuário: a chave do motor (`usuario.desativar` ao desativar, `usuario.editar` no resto; nunca o próprio
 * ao desativar), e os limites do tenant por `validarAcessoDoTenant` (RN-CORE-01/33/35: último admin com a gestão do acesso, autogestão,
 * usuário sem perfil). Recusa 422 com `codigo` estável para a tela e `regra` da RN que explica.
 */
export function avaliarAlteracaoDeUsuario(
  e: EntradaAlteracaoUsuario,
): { ok: true } | { ok: false; codigo: CodigoAlteracaoRecusada; regra: string; mensagem: string } {
  const sem = (codigo: 'USUARIO_SEM_PERMISSAO' | 'USUARIO_AUTODESATIVACAO') => ({ ok: false as const, codigo, regra: 'RN-CORE-35', mensagem: MENSAGENS[codigo] });
  const proprio = e.ator.id === e.alvo.id;
  const desativando = e.alvo.ativo && !e.depois.ativo;
  const chave = desativando ? 'usuario.desativar' : 'usuario.editar';
  if (!pode(e.ator.perfis, chave)) return sem('USUARIO_SEM_PERMISSAO');
  if (proprio && desativando) return sem('USUARIO_AUTODESATIVACAO');
  const refsDoAlvo = e.alvo.perfis && e.alvo.perfis.length > 0 ? e.alvo.perfis : [refDoUsuario(e.alvo.perfil)];
  if (!pode(e.ator.perfis, chave, { proprio, perfis: refsDoAlvo })) return sem('USUARIO_SEM_PERMISSAO');
  if (e.estado) {
    const atuais = e.estado.usuarios.find((u) => u.id === e.alvo.id)?.perfis ?? [];
    const codigosDepois = e.depois.perfis ?? (e.depois.perfil !== e.alvo.perfil || atuais.length === 0 ? [e.depois.perfil] : atuais);
    const depoisReal = { perfis: e.estado.perfis, usuarios: e.estado.usuarios.map((u) => (u.id === e.alvo.id ? { ...u, ativo: e.depois.ativo, perfis: codigosDepois } : u)) };
    const vr = validarAcessoDoTenant({ antes: e.estado, depois: depoisReal, atorId: e.ator.id, matriz: e.matriz, catalogo: e.catalogo })[0];
    if (vr) return { ok: false, codigo: CODIGO_DA_VIOLACAO[vr.codigo] ?? vr.codigo, regra: vr.regra, mensagem: vr.mensagem };
    return { ok: true };
  }
  const paraEstado = (us: readonly UsuarioDoEstado[]) => ({
    perfis: PERFIS.map(perfilDeFabrica),
    usuarios: us.map((u) => ({ id: u.id, ativo: u.ativo, perfis: [u.perfil] })),
  });
  const antes = paraEstado(e.usuarios);
  const depois = paraEstado(e.usuarios.map((u) => (u.id === e.alvo.id ? { ...u, perfil: e.depois.perfil, ativo: e.depois.ativo } : u)));
  const v = validarAcessoDoTenant({ antes, depois, atorId: e.ator.id, matriz: e.matriz, catalogo: e.catalogo })[0];
  if (v) return { ok: false, codigo: CODIGO_DA_VIOLACAO[v.codigo] ?? v.codigo, regra: v.regra, mensagem: v.mensagem };
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
