/**
 * Sessão guardada e banco do usuário para as tarefas sem tela (`macuxi-sync-delta`, ADR 0017; `macuxi-trajeto`, T-0156):
 * a mesma regra da abertura do app (`state/plataforma.tsx`) e a mesma abertura do armazenamento (uma instância por arquivo).
 */
import type { AberturaArmazenamento, Perfil } from '@macuxi/platform-sdk';

import { abrirArmazenamentoDoUsuario } from './armazenamento';
import { lerTokens } from './credenciais';
import { modoApi } from './device';
import { keys, readJson } from './storage';

export interface SessaoGuardada {
  user?: { id?: string; name?: string; perfil?: Perfil | null };
  tenant?: { id?: string; fuso?: string } | null;
  modo?: string;
}

export async function usuarioDaSessao(): Promise<string | null> {
  const [s, tokens] = await Promise.all([readJson<SessaoGuardada>(keys.session), lerTokens()]);
  // mesma regra da abertura do app (`state/plataforma.tsx`): sessão do modo deste build e com token
  if (!s?.user?.id || !tokens?.access || (s.modo ?? 'demo') !== modoApi()) return null;
  return s.user.id;
}

/**
 * T-0088: o armazenamento do usuário e tenant da sessão guardada, pela MESMA abertura do app (uma instância por arquivo no
 * processo; a passagem do AsyncStorage roda uma vez só, aqui mesmo se o app ainda não abriu depois da atualização).
 */
export async function abrirArmazenamentoDaSessao(usuarioId: string): Promise<AberturaArmazenamento> {
  const s = await readJson<SessaoGuardada>(keys.session);
  return abrirArmazenamentoDoUsuario({ usuarioId, tenantId: s?.tenant?.id ?? null, ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}) });
}
