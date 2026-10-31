import type { ComponentType } from 'react';
import { definirEntidadeSync, definirModuloShell } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CheckoutVisitRequest, CreateVisitRequest, Id } from '../contracts';
import { manifest } from '../manifest';
import { comVisitas } from './components/visit-sheets';
import { etapasCore } from './lib/cargas';
import { TelaCliente } from './telas/cliente';
import { TelaClientes } from './telas/clientes';
import { TelaMetas } from './telas/metas';
import { TelaMeusModulos } from './telas/meus-modulos';
import { TelaRota } from './telas/rota';

export { OpenVisitBar } from './components/open-visit-bar';
export { VisitSheetsProvider, useVisitSheets } from './components/visit-sheets';

/**
 * Telas do Core no app Android (ADR 0003; desenho T-0001 §6 e §14). O shell monta `/m/<caminho>` e as abas
 * a partir daqui; os rótulos de `navegacao` são os de `manifest.apps.campo|gestao.abas`.
 * "Início" é do shell (`app/(tabs)/index.tsx`), que mostra os itens do slot `inicio.cards`.
 * A ficha do cliente (`/m/cliente?id=…`) não tem aba: abre da carteira, da rota e do Início.
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'rota', caminho: 'rota', titulo: 'Rota de hoje', navegacao: 'Rota', icone: 'pin', apps: ['campo'], ordem: 20, componente: comVisitas(TelaRota) },
    { id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', icone: 'users', apps: ['campo', 'gestao'], ordem: 30, componente: comVisitas(TelaClientes) },
    { id: 'metas', caminho: 'metas', titulo: 'Metas', navegacao: 'Metas', icone: 'target', apps: ['campo'], ordem: 50, componente: TelaMetas },
    { id: 'meus-modulos', caminho: 'meus-modulos', titulo: 'Meus módulos', apps: ['campo', 'gestao'], componente: TelaMeusModulos },
    { id: 'cliente', caminho: 'cliente', titulo: 'Ficha do cliente', apps: ['campo', 'gestao'], componente: comVisitas(TelaCliente) },
  ],
  entidadesSync: [
    definirEntidadeSync({
      nome: 'visita',
      modulo: 'core',
      direcao: 'ambos',
      conflito: 'servidor_vence',
      // push: check-in (CreateVisitRequest) ou checkout ({ visit_id, ...CheckoutVisitRequest }); pull: visita do servidor
      schema: z.union([CreateVisitRequest, z.intersection(z.object({ visit_id: Id }), CheckoutVisitRequest)]),
    }),
  ],
  etapasSync: etapasCore,
});

export { TelaLogin, type PropsTelaLogin } from './components/tela-login';
export { entrarComSenha, mensagemDeErroDeLogin, validarLogin, type CamposLogin } from './lib/login';
