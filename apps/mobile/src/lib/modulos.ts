/**
 * Módulos instalados no shell mobile e o registro das telas, entidades e etapas de sync deles
 * (platform-sdk `criarShell`). O app monta abas e telas só dos módulos EFETIVOS do usuário
 * (RN-CORE-01/03), da variante atual (`manifest.apps.campo | gestao`), do perfil e com permissão por
 * ação (ADR 0004). Desenho T-0001 §13–14.
 *
 * Ponto de extensão da B2: cada módulo exporta de `modules/<m>/app/index.ts`
 *   export const moduloApp = definirModuloShell<ComponentType>({ manifesto, paginas, entidadesSync, etapasSync });
 * Enquanto o módulo não exporta `moduloApp`, o shell usa só o manifesto (sem telas).
 * Instalados: os 8 módulos (T-0004, lista em `instalados.ts`). Quem ainda não tem `app/` entra só pelo manifesto
 * (licença, sync e ações valem; nenhuma tela aparece) e ganha telas quando exportar `moduloApp`.
 * O Catálogo é obrigatório desde a T-0007: o Vendedor depende dele (ADR-0005), senão `criarShell` recusa o Vendedor.
 * T-0170: o Core ganha aqui as entidades de sync da tarefa, frase, avatar e performance que ainda não registra (`sync-t0170.ts`).
 */
import type { ComponentType } from 'react';
import * as appCatalogo from '@macuxi/catalogo/app';
import * as appCore from '@macuxi/core/app';
import * as appGestor from '@macuxi/gestor/app';
import * as appIntegracao from '@macuxi/integracao/app';
import * as appPesquisa from '@macuxi/pesquisa/app';
import { criarShell, type Manifesto, type ModuloId, type ModuloShell } from '@macuxi/platform-sdk';
import * as appPromotor from '@macuxi/promotor/app';
import * as appTreinamento from '@macuxi/treinamento/app';
import * as appVendedor from '@macuxi/vendedor/app';

import { MANIFESTOS_INSTALADOS } from './instalados';
import { comSyncT0170 } from './sync-t0170';
import type { Variante } from './variante';

export type ComponenteTela = ComponentType;

function registroApp(manifesto: Manifesto, exportado: unknown): ModuloShell<ComponenteTela> {
  const m = (exportado as { moduloApp?: ModuloShell<ComponenteTela> } | undefined)?.moduloApp;
  if (m && m.manifesto.id !== manifesto.id) throw new Error(`moduloApp de ${manifesto.id} aponta para ${m.manifesto.id}`);
  return comSyncT0170(m ?? { manifesto, paginas: [] });
}

/** Telas de cada módulo (o módulo sem `app/` exporta `{}`). */
const TELAS: Record<ModuloId, unknown> = {
  core: appCore,
  catalogo: appCatalogo,
  vendedor: appVendedor,
  promotor: appPromotor,
  gestor: appGestor,
  pesquisa: appPesquisa,
  treinamento: appTreinamento,
  integracao: appIntegracao,
};

export const MODULOS_APP: readonly ModuloShell<ComponenteTela>[] = MANIFESTOS_INSTALADOS.map((m) => registroApp(m, TELAS[m.id]));

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
