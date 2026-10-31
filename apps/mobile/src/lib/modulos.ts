/**
 * Módulos instalados no shell mobile e o registro das telas, entidades e etapas de sync deles
 * (platform-sdk `criarShell`). O app monta abas e telas só dos módulos EFETIVOS do usuário
 * (RN-CORE-01/03), da variante atual (`manifest.apps.campo | gestao`), do perfil e com permissão por
 * ação (ADR 0004). Desenho T-0001 §13–14.
 *
 * Ponto de extensão da B2: cada módulo exporta de `modules/<m>/app/index.ts`
 *   export const moduloApp = definirModuloShell<ComponentType>({ manifesto, paginas, entidadesSync, etapasSync });
 * Enquanto o módulo não exporta `moduloApp`, o shell usa só o manifesto (sem telas).
 * Instalados (T-0001 A3): core e vendedor; catálogo desde a T-0007 (o Vendedor depende dele, ADR-0005).
 * Os demais entram na T-0004.
 */
import type { ComponentType } from 'react';
import * as appCatalogo from '@macuxi/catalogo/app';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import * as appCore from '@macuxi/core/app';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { criarShell, type Manifesto, type ModuloShell } from '@macuxi/platform-sdk';
import * as appVendedor from '@macuxi/vendedor/app';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';

import type { Variante } from './variante';

export type ComponenteTela = ComponentType;

function registroApp(manifesto: Manifesto, exportado: unknown): ModuloShell<ComponenteTela> {
  const m = (exportado as { moduloApp?: ModuloShell<ComponenteTela> } | undefined)?.moduloApp;
  if (m && m.manifesto.id !== manifesto.id) throw new Error(`moduloApp de ${manifesto.id} aponta para ${m.manifesto.id}`);
  return m ?? { manifesto, paginas: [] };
}

export const MODULOS_APP: readonly ModuloShell<ComponenteTela>[] = [
  registroApp(manifestoCore, appCore),
  registroApp(manifestoCatalogo, appCatalogo),
  registroApp(manifestoVendedor, appVendedor),
];

export const MANIFESTOS_APP: readonly Manifesto[] = MODULOS_APP.map((m) => m.manifesto);

const shells = new Map<Variante, ReturnType<typeof criarShell<ComponenteTela>>>();

/** Shell da variante (validado na primeira chamada: manifestos, rótulos de aba, caminhos, ações, entidades). */
export function shellDaVariante(variante: Variante) {
  let s = shells.get(variante);
  if (!s) {
    s = criarShell<ComponenteTela>(variante, MODULOS_APP);
    shells.set(variante, s);
  }
  return s;
}
