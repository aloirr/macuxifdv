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

/** Quem entrou, como o menu mostra. `nome` nulo = portal (a sessão do portal não traz o nome). */
export interface IdentidadeDoUsuario {
  nome: string | null;
  perfil: string;
  cargo: string | null;
  email: string | null;
  empresa: string | null;
  /** A tela já mostra a empresa fora do botão (portal: título da página da empresa); ela não conta como dado novo. */
  empresaNaTela?: boolean;
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

/** Identidade do portal: time Macuxi (sem empresa nem cargo) ou o admin do cliente, com a empresa atual. */
export function identidadeDoPortal(s: { tipo: 'super_admin' | 'admin_cliente'; empresa: { nome: string } | null }): IdentidadeDoUsuario {
  if (s.tipo === 'super_admin') return { nome: null, perfil: PERFIL_TIME_MACUXI, cargo: null, email: null, empresa: null };
  return { nome: null, perfil: rotuloDoPerfil('admin'), cargo: rotuloDoCargo('admin'), email: null, empresa: s.empresa?.nome ?? null, empresaNaTela: true };
}

/**
 * O que o botão do menu mostra: o nome (ou o perfil, no portal) e, embaixo, o perfil e o cargo — o cargo igual ao perfil
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
 * "Dados cadastrais" só quando a gaveta mostra alguma linha além do que a tela já mostra: o botão e, no portal, a empresa do
 * título (designer-ux, S8; RD-3122: o time Macuxi fica com "Sair" e o admin do cliente com "Trocar a senha" e "Sair").
 */
export function temDadosAlemDoBotao(id: IdentidadeDoUsuario): boolean {
  const { titulo, detalhe } = identificacaoDoBotao(id);
  const noBotao = new Set([titulo, ...(detalhe ? detalhe.split(' · ') : [])]);
  return linhasDosDados(id).some((l) => !noBotao.has(l.valor) && !(l.chave === 'empresa' && id.empresaNaTela));
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
