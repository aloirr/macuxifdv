/**
 * Perfis de acesso (T-0111; ADR 0033; RN-CORE-01/04/33/35, RN-PRO-01): regras puras da página "Perfis de acesso" do BKO.
 * - o código do perfil nasce do nome (nunca aparece na tela);
 * - só vira sobreposição o que difere da fábrica da base (tabela vazia = padrão de fábrica);
 * - os limites travados do tenant inteiro vêm de `validarAcessoDoTenant` do SDK (RN-CORE-33/35, RN-PRO-01, RN-CORE-04), que a API
 *   aplica de novo na escrita; aqui só se adapta o resultado para a recusa 422 e os textos da tela;
 * - a auditoria (RN-AUD-01) guarda antes/depois das sobreposições, nunca dado pessoal.
 */
import {
  CODIGO_PERFIL_RE,
  validarAcessoDoTenant,
  type DefinicaoChave,
  type EstadoAcessoTenant,
  type MatrizFabrica,
  type Perfil,
  type PermissoesDoPerfil,
  type SobreposicaoPermissao,
  type ViolacaoLimite,
} from '@macuxi/platform-sdk';

export const NOME_PERFIL_MAX = 40;
export const DESCRICAO_PERFIL_MAX = 200;

/** Código a partir do nome: minúsculas, sem acento, `_`; começa por letra e cabe em 40 caracteres. */
export function codigoDoPerfil(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const comLetra = /^[a-z]/.test(base) ? base : `p_${base}`;
  const cortado = comLetra.slice(0, 40).replace(/_+$/, '');
  return CODIGO_PERFIL_RE.test(cortado) ? cortado : 'perfil';
}

export interface ErroDoPerfil {
  campo: 'nome' | 'descricao';
  mensagem: string;
}

export function validarNomeDoPerfil(nome: string, descricao: string | null | undefined): ErroDoPerfil[] {
  const erros: ErroDoPerfil[] = [];
  const n = nome.trim();
  if (n === '') erros.push({ campo: 'nome', mensagem: 'Dê um nome ao perfil.' });
  else if (n.length > NOME_PERFIL_MAX) erros.push({ campo: 'nome', mensagem: `O nome vai até ${NOME_PERFIL_MAX} caracteres.` });
  if ((descricao ?? '').length > DESCRICAO_PERFIL_MAX) erros.push({ campo: 'descricao', mensagem: `A descrição vai até ${DESCRICAO_PERFIL_MAX} caracteres.` });
  return erros;
}

const mesmosAlvos = (a?: readonly string[], b?: readonly string[]): boolean => {
  const x = [...(a ?? [])].sort().join(',');
  const y = [...(b ?? [])].sort().join(',');
  return x === y;
};

/** Diferença entre o que a página quer (chave → valor, só as concedidas) e a fábrica da base: as sobreposições a gravar. */
export function sobreposicoesDoDesejado(base: Perfil, desejado: PermissoesDoPerfil, matriz: MatrizFabrica): SobreposicaoPermissao[] {
  const fabrica = matriz[base];
  const chaves = [...new Set([...Object.keys(fabrica), ...Object.keys(desejado)])].sort();
  const saida: SobreposicaoPermissao[] = [];
  for (const chave of chaves) {
    const f = fabrica[chave];
    const d = desejado[chave];
    if (!f && !d) continue;
    if (f && !d) {
      saida.push({ chave, concedida: false });
      continue;
    }
    if (d && f && d.nivel === f.nivel && mesmosAlvos(d.alvos, f.alvos)) continue;
    saida.push({ chave, concedida: true, ...(d?.nivel ? { nivel: d.nivel } : {}), ...(d?.alvos ? { alvos: [...d.alvos] } : {}) });
  }
  return saida;
}

/** Textos da recusa (página, §7.2); os de trava e escopo vêm do SDK. */
const MENSAGEM_DA_TELA: Readonly<Record<string, string>> = {
  ULTIMO_ADMIN: 'A empresa ficaria sem admin. Mantenha pelo menos um admin ativo que entre no BKO e gerencie usuários e perfis.',
  AUTOGESTAO: 'Você não pode tirar de si mesmo a gestão de usuários e perfis. Peça a outro admin.',
  SENHA_ALVO_INVALIDO: 'Um dos perfis da redefinição de senha não existe mais ou é de admin. Revise a lista.',
  USUARIO_SEM_PERFIL: 'Este perfil é o único de alguns usuários. Dê outro perfil a eles antes de desativar.',
  PERFIL_INDISPONIVEL: 'Este perfil é o único de alguns usuários. Dê outro perfil a eles antes de desativar.',
  CODIGO_REPETIDO: 'Já existe um perfil com este nome.',
};

export type ViolacaoDePerfil = ViolacaoLimite;

export type ResultadoDosLimites = { ok: true } | { ok: false; violacoes: ViolacaoDePerfil[] };

/** Limites do tenant inteiro depois de uma escrita em perfis (RN-CORE-33/35, RN-PRO-01, RN-CORE-04, RN-CORE-01). */
export function avaliarEstadoDePerfis(e: {
  atorId?: string;
  antes?: EstadoAcessoTenant;
  depois: EstadoAcessoTenant;
  matriz: MatrizFabrica;
  catalogo?: readonly DefinicaoChave[];
}): ResultadoDosLimites {
  const v = validarAcessoDoTenant(e);
  if (v.length === 0) return { ok: true };
  return { ok: false, violacoes: v.map((x) => ({ ...x, mensagem: MENSAGEM_DA_TELA[x.codigo] ?? x.mensagem })) };
}

export interface PerfilAuditavel {
  nome: string;
  descricao: string | null;
  ativo: boolean;
  sobreposicoes: readonly SobreposicaoPermissao[];
}

const comoTexto = (s: readonly SobreposicaoPermissao[]) => JSON.stringify([...s].sort((a, b) => a.chave.localeCompare(b.chave)));

/** RN-AUD-01: antes/depois só do que mudou; as sobreposições vão inteiras (são o que o histórico mostra). */
export function diffAuditavelDePerfil(antes: PerfilAuditavel, depois: PerfilAuditavel): { campos_alterados: string[]; antes: Record<string, unknown>; depois: Record<string, unknown> } {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  const campos: string[] = [];
  for (const c of ['nome', 'descricao', 'ativo'] as const) {
    if (antes[c] === depois[c]) continue;
    campos.push(c);
    a[c] = antes[c];
    d[c] = depois[c];
  }
  if (comoTexto(antes.sobreposicoes) !== comoTexto(depois.sobreposicoes)) {
    campos.push('sobreposicoes');
    a.sobreposicoes = antes.sobreposicoes;
    d.sobreposicoes = depois.sobreposicoes;
  }
  return { campos_alterados: campos, antes: a, depois: d };
}
