/**
 * Quem pode definir a meta de quem (RN-CORE-20; T-0068). Função pura: o escopo de EDIÇÃO é mais estreito que o de
 * leitura (`usuariosVisiveis` dá o tenant ao analista, que só lê). Supervisor = ele + a equipe que responde;
 * gerente = + equipes abaixo; admin = tenant; os demais nunca editam.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { escopoDeUsuarios } from './clientes';

export type DecisaoEdicaoMeta = { ok: true } | { ok: false; codigo: 'META_FORA_DA_EQUIPE' | 'META_SEM_PERMISSAO'; mensagem: string };

export interface EntradaEdicaoMeta {
  perfil: Perfil;
  alvoId: string;
  editorId: string;
  /** Usuários da(s) equipe(s) que o editor responde. */
  equipe: ReadonlySet<string>;
  /** Usuários das equipes abaixo (gerente). */
  equipesAbaixo: ReadonlySet<string>;
}

export function podeEditarMetaDe(e: EntradaEdicaoMeta): DecisaoEdicaoMeta {
  if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'admin') {
    return { ok: false, codigo: 'META_SEM_PERMISSAO', mensagem: 'Seu perfil só consulta metas. Peça a um supervisor ou gerente para definir.' };
  }
  const escopo = escopoDeUsuarios(e.perfil, { proprio: e.editorId, equipe: e.equipe, equipesAbaixo: e.equipesAbaixo });
  if (escopo === 'tenant' || escopo.has(e.alvoId)) return { ok: true };
  return { ok: false, codigo: 'META_FORA_DA_EQUIPE', mensagem: 'Este usuário não está na sua equipe. Escolha alguém da sua equipe para definir a meta.' };
}

export interface MembroMeta {
  id: string;
  perfil: Perfil;
  ativo: boolean;
}

/** Alvos válidos de uma meta por equipe: usuários ativos de perfil vendedor ou promotor, sem repetição. */
export function expandirEquipe(membros: readonly MembroMeta[]): string[] {
  const vistos = new Set<string>();
  for (const m of membros) if (m.ativo && (m.perfil === 'vendedor' || m.perfil === 'promotor')) vistos.add(m.id);
  return [...vistos];
}
