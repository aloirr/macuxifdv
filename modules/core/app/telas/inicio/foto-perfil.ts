/**
 * Foto do perfil no Início do Campo (RN-CORE-42). A escolha viva vem da entidade de sync `usuario_avatar` (uma linha por troca;
 * `escolhaAtual` do domain). Só `tipo: 'foto'` vira imagem: o contrato traz o `arquivo_id` (ADR 0010) e o shell resolve esse id
 * numa URI local (cache do aparelho, como o Catálogo faz com a miniatura). Sem foto, sem resolvedor ou resolvedor sem a imagem
 * (ainda não baixada, sem sinal) = iniciais; avatar escolhido do app também fica nas iniciais até a arte dos 6 entrar na tela.
 */
import { escolhaAtual, type AvatarGravado } from '../../../domain/frase-avatar/avatar';

/** Entidade do pull da foto/avatar (`core.usuario_avatar`). */
export const ENTIDADE_USUARIO_AVATAR = 'usuario_avatar';

/** O shell devolve a URI (`file://` ou http autenticado já resolvido) do arquivo, ou null se ainda não está no aparelho. */
export type ResolvedorFotoPerfil = (arquivoId: string) => string | null | Promise<string | null>;

let resolvedor: ResolvedorFotoPerfil | null = null;
export function definirResolvedorFotoPerfil(r: ResolvedorFotoPerfil | null): void {
  resolvedor = r;
}

/** URI da foto do usuário, ou null (= iniciais). Nunca lança: falha do resolvedor vira iniciais. */
export async function fotoDoPerfil(linhas: readonly AvatarGravado[] | null, usuarioId: string, resolver: ResolvedorFotoPerfil | null = resolvedor): Promise<string | null> {
  if (!linhas || !resolver) return null;
  const escolha = escolhaAtual(linhas, usuarioId);
  if (escolha.tipo !== 'foto') return null;
  try {
    return (await resolver(escolha.arquivo_id)) || null;
  } catch {
    return null;
  }
}
