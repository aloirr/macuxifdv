/**
 * Módulos efetivos do usuário (RN-CORE-01, RN-CORE-03). Aplicado pela plataforma em
 * `GET /v1/me/modulos`, no shell (o que montar) e na verificação de acesso de cada rota.
 */
import type { Manifesto } from './manifesto';
import { ordenarPorDependencia } from './manifesto';
import type { ModuloId } from './nomes';

export interface EntradaModulosEfetivos {
  /** Manifestos instalados (shell/API). */
  manifestos: readonly Manifesto[];
  /** Ativos no tenant (plataforma.tenant_modulo). */
  ativosNoTenant: readonly ModuloId[];
  /** Padrão do perfil do usuário (plataforma.perfil_modulo). */
  doPerfil: readonly ModuloId[];
  /**
   * Exceções do usuário (plataforma.usuario_modulo). Esclarecimento do doc 03 (2026-10-30): na
   * Sprint 0 a exceção só REMOVE módulos; acrescentar módulo que o perfil não tem está no backlog.
   */
  removidosDoUsuario?: readonly ModuloId[];
}

/**
 * RN-CORE-01: efetivos = ativos do tenant ∩ módulos do perfil − exceções do usuário; core sempre ativo.
 * RN-CORE-03: módulo cuja dependência obrigatória não está efetiva sai também (em cascata).
 * Devolve em ordem de dependência (core primeiro). A licença é checada a cada requisição
 * (não congelar o resultado no JWT).
 */
export function modulosEfetivos(e: EntradaModulosEfetivos): ModuloId[] {
  const instalados = new Map(e.manifestos.map((m) => [m.id, m] as const));
  const tenant = new Set(e.ativosNoTenant);
  const doUsuario = new Set<ModuloId>(e.doPerfil);
  for (const m of e.removidosDoUsuario ?? []) doUsuario.delete(m);

  const efetivos = new Set<ModuloId>();
  for (const id of instalados.keys()) {
    if (id === 'core' || (tenant.has(id) && doUsuario.has(id))) efetivos.add(id);
  }

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const id of [...efetivos]) {
      const m = instalados.get(id)!;
      if (m.depende.some((d) => !efetivos.has(d))) {
        efetivos.delete(id);
        mudou = true;
      }
    }
  }

  return ordenarPorDependencia(e.manifestos.filter((m) => efetivos.has(m.id))).map((m) => m.id);
}
