/**
 * Módulos instalados no shell web (BKO) e o registro das páginas deles (platform-sdk `criarShell`).
 * O shell monta menus e páginas só dos módulos EFETIVOS do usuário (RN-CORE-01/03), do perfil e com
 * permissão por ação (ADR 0004). Desenho T-0001 §14.
 *
 * Ponto de extensão da B2: cada módulo exporta de `modules/<m>/web/index.ts`
 *   export const moduloWeb = definirModuloShell<ComponentType>({ manifesto, paginas: [...] });
 * Enquanto o módulo não exporta `moduloWeb`, o shell usa só o manifesto (sem páginas).
 * Para instalar um módulo novo: importe o manifesto e o `web` dele aqui e acrescente na lista.
 */
import type { ComponentType } from 'react';
import { manifest as manifestoCore } from '@macuxi/core';
import { criarShell, type Manifesto, type ModuloShell } from '@macuxi/platform-sdk';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import * as webVendedor from '@macuxi/vendedor/web';

export type ComponentePagina = ComponentType;

function registroWeb(manifesto: Manifesto, exportado: unknown): ModuloShell<ComponentePagina> {
  const m = (exportado as { moduloWeb?: ModuloShell<ComponentePagina> } | undefined)?.moduloWeb;
  if (m && m.manifesto.id !== manifesto.id) throw new Error(`moduloWeb de ${manifesto.id} aponta para ${m.manifesto.id}`);
  return m ?? { manifesto, paginas: [] };
}

export const MODULOS_WEB: readonly ModuloShell<ComponentePagina>[] = [
  // core ainda exporta só "." (manifesto); ./web entra na B2 (recado ao modulo-core)
  registroWeb(manifestoCore, undefined),
  registroWeb(manifestoVendedor, webVendedor),
];

export const MANIFESTOS_WEB: readonly Manifesto[] = MODULOS_WEB.map((m) => m.manifesto);

/** Valida tudo no carregamento (manifestos, rótulos de menu, caminhos, ações) — falha cedo. */
export const SHELL_WEB = criarShell<ComponentePagina>('web', MODULOS_WEB);
