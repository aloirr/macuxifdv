import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import type { CardInicio } from '../contracts';
import { comVisitas } from './components/visit-sheets';
import { etapasCore } from './lib/cargas';
import { entidadesCliente } from './lib/entidades-cliente';
import { entidadesMeta } from './lib/entidades-meta';
import { entidadesNotificacao } from './lib/entidades-notificacao';
import { entidadesRota } from './lib/entidades-rota';
import { TelaCliente } from './telas/cliente';
import { TelaClientes } from './telas/clientes';
import { TelaMetas } from './telas/metas';
import { CardNotificacoes } from './components/card-notificacoes';
import { TelaNotificacoes } from './telas/notificacoes';
import { TelaMeusModulos } from './telas/meus-modulos';
import { TelaRota } from './telas/rota';

export { definirCapturaFoto, type CapturaFoto } from './lib/foto-fachada';
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
    { id: 'notificacoes', caminho: 'notificacoes', titulo: 'Notificações', apps: ['campo', 'gestao'], componente: TelaNotificacoes },
    { id: 'cliente', caminho: 'cliente', titulo: 'Ficha do cliente', apps: ['campo', 'gestao'], componente: comVisitas(TelaCliente) },
  ],
  entidadesSync: [
    // Cliente 360 offline (T-0017): pull filtrado pela carteira no servidor; a ficha e a lista leem do aparelho
    ...entidadesCliente,
    // Rota e visitas reais (T-0018): pull de motivo/rota/rota_parada/visita; push de visita (check-in) e visita_checkout
    ...entidadesRota,
    // Metas e vendas diárias (T-0020): pull dos usuários visíveis; o painel lê do aparelho
    ...entidadesMeta,
    // Central de notificações (T-0019): pull do próprio usuário; push da leitura
    ...entidadesNotificacao,
  ],
  extensoes: [{ slot: 'inicio.cards', id: 'notificacoes', payload: { testID: 'inicio.card-notificacoes', componente: CardNotificacoes } satisfies CardInicio<ComponentType> }],
  etapasSync: etapasCore,
});

export { TelaLogin, type PropsTelaLogin } from './components/tela-login';
export { entrarComSenha, mensagemDeErroDeLogin, validarLogin, type CamposLogin } from './lib/login';
export { ehAparelhoBloqueado, tratarAparelhoBloqueado, type AcoesAparelhoBloqueado } from './lib/aparelho-bloqueado';
