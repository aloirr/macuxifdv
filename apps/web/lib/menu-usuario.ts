/**
 * Regras puras do menu do usuário (`components/menu-usuario.tsx`). A troca voluntária da senha usa a tabela do Core
 * (`precheckDaTrocaVoluntaria`/`erroDaTrocaVoluntaria`) e, no BKO, vai sem o token de acesso (`pedirTrocaDeSenha` em `session.ts`).
 */
import { ROTULO_CARGO } from '@macuxi/core/contracts';
import { cargoDaBase, type Perfil } from '@macuxi/platform-sdk';
import { rotuloDoPerfil } from '@macuxi/ui/web';

export const TEXTOS_MENU_USUARIO = Object.freeze({
  rotulo: 'Menu do usuário',
  dadosCadastrais: 'Dados cadastrais',
  trocarSenha: 'Trocar a senha',
  sair: 'Sair',
  nome: 'Nome',
  email: 'E-mail',
  perfil: 'Perfil',
  cargo: 'Cargo',
  empresa: 'Empresa',
  cancelar: 'Cancelar',
  /** Senha atual vazia ao tentar salvar (spec §4: borda e foco no campo). */
  atualVazia: 'Digite a senha atual.',
});

/** Perfil do time Macuxi no portal (super-admin), que não é um dos perfis do tenant. */
export const PERFIL_TIME_MACUXI = 'Time Macuxi';

/** Cargo do perfil base (exato nos 7 perfis base; base desconhecida = Administrativo, como o banco). */
export function rotuloDoCargo(perfil: Perfil | string): string {
  return ROTULO_CARGO[cargoDaBase(perfil)];
}

/** Quem entrou, como o menu mostra. `nome` nulo = portal de API anterior à 0102 (a sessão sem `usuario`). */
export interface IdentidadeDoUsuario {
  nome: string | null;
  perfil: string;
  cargo: string | null;
  email: string | null;
  empresa: string | null;
}

/** Identidade do BKO, da sessão (login real: nome, e-mail, perfil e empresa; o cargo vem do perfil). */
export function identidadeDoBko(u: { name: string; email: string; perfil: Perfil | null }, empresa: string | null): IdentidadeDoUsuario {
  return {
    nome: u.name.trim() || null,
    perfil: u.perfil ? rotuloDoPerfil(u.perfil) : '',
    cargo: u.perfil ? rotuloDoCargo(u.perfil) : null,
    email: u.email.trim() || null,
    empresa: empresa?.trim() || null,
  };
}

/** Rótulo do cargo que a sessão do portal traz (código `administrativo`...; outro texto volta como veio). */
function rotuloDoCargoDoPortal(cargo: string | null | undefined): string | null {
  if (!cargo) return null;
  return (ROTULO_CARGO as Readonly<Record<string, string>>)[cargo] ?? cargo;
}

/**
 * Identidade do portal (ADR 0075, `SessaoPortal.usuario`): o nome de quem entrou e, para o admin do cliente, o perfil e o cargo na
 * empresa escolhida. Time Macuxi: perfil "Time Macuxi", sem empresa nem cargo. Sem `usuario` (API anterior à 0102), sem o nome e,
 * no admin do cliente, o perfil e o cargo do perfil base `admin`.
 */
export function identidadeDoPortal(s: {
  tipo: 'super_admin' | 'admin_cliente';
  empresa: { nome: string } | null;
  usuario?: { nome: string; perfil: string | null; cargo: string | null } | null;
}): IdentidadeDoUsuario {
  const nome = s.usuario?.nome.trim() || null;
  if (s.tipo === 'super_admin') return { nome, perfil: PERFIL_TIME_MACUXI, cargo: null, email: null, empresa: null };
  return {
    nome,
    perfil: s.usuario?.perfil?.trim() || rotuloDoPerfil('admin'),
    cargo: s.usuario ? rotuloDoCargoDoPortal(s.usuario.cargo) : rotuloDoCargo('admin'),
    email: null,
    empresa: s.empresa?.nome ?? null,
  };
}

/**
 * O que o botão do menu mostra: o nome (sem ele, o perfil) e, embaixo, o perfil e o cargo — o cargo igual ao perfil
 * ("Supervisor · Supervisor") aparece uma vez. A empresa não entra no botão: o BKO já a mostra na marca do menu e o portal no
 * título da página da empresa (uma informação, um lugar); ela fica nos "Dados cadastrais".
 */
export function identificacaoDoBotao(id: IdentidadeDoUsuario): { titulo: string; detalhe: string | null } {
  const titulo = id.nome ?? id.perfil;
  const partes = [id.nome ? id.perfil : null, id.cargo].filter((p): p is string => !!p && p !== titulo);
  const unicas = partes.filter((p, i) => partes.indexOf(p) === i);
  return { titulo, detalhe: unicas.length > 0 ? unicas.join(' · ') : null };
}

/** Iniciais do círculo do botão: primeira e última palavra do nome (ou do perfil). */
export function iniciais(texto: string): string {
  const p = texto.trim().split(/\s+/).filter(Boolean);
  const primeira = p[0]?.[0] ?? '';
  const ultima = p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '';
  return `${primeira}${ultima}`.toUpperCase();
}

/** Linhas dos "Dados cadastrais" (só leitura): as que a sessão tem, na ordem nome, e-mail, perfil, cargo e empresa. */
export function linhasDosDados(id: IdentidadeDoUsuario): { rotulo: string; valor: string; chave: string }[] {
  const T = TEXTOS_MENU_USUARIO;
  const todas: [string, string, string | null][] = [
    ['nome', T.nome, id.nome],
    ['email', T.email, id.email],
    ['perfil', T.perfil, id.perfil || null],
    ['cargo', T.cargo, id.cargo],
    ['empresa', T.empresa, id.empresa],
  ];
  return todas.filter((l): l is [string, string, string] => !!l[2]).map(([chave, rotulo, valor]) => ({ chave, rotulo, valor }));
}

/**
 * "Dados cadastrais" só quando a gaveta mostra alguma linha além do que o botão já mostra (designer-ux, S8: o time Macuxi, só
 * com o perfil, fica com "Sair").
 */
export function temDadosAlemDoBotao(id: IdentidadeDoUsuario): boolean {
  const { titulo, detalhe } = identificacaoDoBotao(id);
  const noBotao = new Set([titulo, ...(detalhe ? detalhe.split(' · ') : [])]);
  return linhasDosDados(id).some((l) => !noBotao.has(l.valor));
}

/**
 * Erro do `api()` do BKO (`code`/`details`) no formato que a tabela do Core lê para os textos do login (`codigo`/`detalhes`);
 * o `ErroPortal` já vem assim. Sem isso, "Muitas tentativas" e "bloqueado" caíam no texto genérico.
 */
export function erroNoFormatoDoCore(e: unknown): unknown {
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown; details?: unknown; message?: unknown } | null;
  if (!x || typeof x !== 'object' || x.codigo !== undefined || typeof x.code !== 'string') return e;
  return { status: x.status, codigo: x.code, detalhes: x.details, message: x.message };
}
