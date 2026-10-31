/**
 * Módulos instalados no shell web (BKO) e o registro das páginas deles (platform-sdk `criarShell`).
 * O shell monta menus e páginas só dos módulos EFETIVOS do usuário (RN-CORE-01/03), do perfil e com
 * permissão por ação (ADR 0004). Desenho T-0001 §14.
 *
 * Ponto de extensão da B2: cada módulo exporta de `modules/<m>/web/index.ts`
 *   export const moduloWeb = definirModuloShell<ComponentType>({ manifesto, paginas: [...] });
 * Enquanto o módulo não exporta `moduloWeb`, o shell usa só o manifesto (sem páginas).
 * Instalados: os 8 módulos (T-0004). Módulo novo: manifesto em `instalados.ts` e o `web` dele em PAGINAS.
 * Quem ainda não tem `web/` entra só pelo manifesto (licença e ações valem; nenhuma página aparece).
 * O Catálogo é obrigatório desde a T-0007: o Vendedor depende dele (ADR-0005), senão `criarShell` recusa o Vendedor.
 */
import type { ComponentType } from 'react';
import * as webCatalogo from '@macuxi/catalogo/web';
import * as webCore from '@macuxi/core/web';
import * as webGestor from '@macuxi/gestor/web';
import * as webIntegracao from '@macuxi/integracao/web';
import * as webPesquisa from '@macuxi/pesquisa/web';
import { criarShell, type Manifesto, type ModuloId, type ModuloShell } from '@macuxi/platform-sdk';
import * as webPromotor from '@macuxi/promotor/web';
import * as webTreinamento from '@macuxi/treinamento/web';
import * as webVendedor from '@macuxi/vendedor/web';
import { MANIFESTOS_INSTALADOS } from './instalados';

export type ComponentePagina = ComponentType;

function registroWeb(manifesto: Manifesto, exportado: unknown): ModuloShell<ComponentePagina> {
  const m = (exportado as { moduloWeb?: ModuloShell<ComponentePagina> } | undefined)?.moduloWeb;
  if (m && m.manifesto.id !== manifesto.id) throw new Error(`moduloWeb de ${manifesto.id} aponta para ${m.manifesto.id}`);
  return m ?? { manifesto, paginas: [] };
}

/** Páginas de cada módulo (o módulo sem `web/` exporta `{}`). */
const PAGINAS: Record<ModuloId, unknown> = {
  core: webCore,
  catalogo: webCatalogo,
  vendedor: webVendedor,
  promotor: webPromotor,
  gestor: webGestor,
  pesquisa: webPesquisa,
  treinamento: webTreinamento,
  integracao: webIntegracao,
};

export const MODULOS_WEB: readonly ModuloShell<ComponentePagina>[] = MANIFESTOS_INSTALADOS.map((m) => registroWeb(m, PAGINAS[m.id]));

export const MANIFESTOS_WEB: readonly Manifesto[] = MODULOS_WEB.map((m) => m.manifesto);

/** Valida tudo no carregamento (manifestos, rótulos de menu, caminhos, ações) — falha cedo. */
export const SHELL_WEB = criarShell<ComponentePagina>('web', MODULOS_WEB);
