import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { comVisitas } from './components/visit-sheets';
import { consultaFinanceiroClienteAparelho } from './consultas';
import { etapasCore } from './lib/cargas';
import { entidadesCliente } from './lib/entidades-cliente';
import { entidadesMeta } from './lib/entidades-meta';
import { entidadesNotificacao } from './lib/entidades-notificacao';
import { entidadesProduto } from './lib/entidades-produto';
import { entidadesRota } from './lib/entidades-rota';
import { TelaCliente } from './telas/cliente';
import { TelaClientes } from './telas/clientes';
import { TelaMetas } from './telas/metas';
import { TelaNotificacoes } from './telas/notificacoes';
import { TelaMeusModulos } from './telas/meus-modulos';
import { TelaRota } from './telas/rota';

export { definirAbrirFotoPdv, definirCapturaFoto, type AbrirFotoPdv, type CapturaFoto, type PedidoAbrirFotoPdv } from './lib/foto-fachada';
export { useInicio } from './lib/usar-inicio';
export { useNotificacoes } from './lib/usar-notificacoes';
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
    // Produto (T-0029): catálogo mestre para o Novo pedido do Vendedor
    ...entidadesProduto,
  ],
  // O card antigo de notificações saiu do slot `inicio.cards` (T-0073): o Início novo mostra as 3 últimas pelo `useInicio()`.
  extensoes: [],
  etapasSync: etapasCore,
  consultas: [consultaFinanceiroClienteAparelho],
});

export { TelaLogin, type PropsTelaLogin } from './components/tela-login';
export { TelaCrieSuaSenha, type PropsTelaCrieSuaSenha } from './components/tela-crie-sua-senha';
export { TelaEsqueciSenha, type PropsTelaEsqueciSenha } from './components/tela-esqueci-senha';
export { entrarComSenha, mensagemDeErroDeLogin, validarLogin, type CamposLogin } from './lib/login';
export { AVISO_SENHA_CRIADA, detalhesDaTroca, ehSenhaATrocar, pedirSenhaTemporaria, trocarSenhaPeloApp, type CamposEsqueci, type DadosDaTroca } from './lib/senha';
export { ehAparelhoBloqueado, tratarAparelhoBloqueado, type AcoesAparelhoBloqueado } from './lib/aparelho-bloqueado';
