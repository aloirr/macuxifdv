import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { migracoesAparelho } from '../db/aparelho';
import { manifest } from '../manifest';
import { comVisitas } from './components/visit-sheets';
import { consultaFinanceiroClienteAparelho } from './consultas';
import { etapasCore } from './lib/cargas';
import { entidadesCliente } from './lib/entidades-cliente';
import { entidadesMeta } from './lib/entidades-meta';
import { entidadesNotificacao } from './lib/entidades-notificacao';
import { entidadesProduto } from './lib/entidades-produto';
import { entidadesRastreamento } from './lib/entidades-rastreamento';
import { entidadesRota } from './lib/entidades-rota';
import { TelaCliente } from './telas/cliente';
import { TelaClientes } from './telas/clientes';
import { TelaMetas } from './telas/metas';
import { TelaNotificacoes } from './telas/notificacoes';
import { TelaMeusModulos } from './telas/meus-modulos';
import { PaginaRecadosETarefas, PaginaTarefa } from './telas/paginas-recados-e-tarefas';
import { TelaPerformance } from './telas/performance';
import { TelaRota } from './telas/rota';

export { definirCapturaFoto, definirCapturaFotoPdv, type CapturaFoto, type CapturaFotoPdv, type FotoPdvCapturada } from './lib/foto-fachada';
export { definirAbrirArquivo, podeAbrirFormato, type AbrirArquivo, type FormatoAbrivel, type OpcoesAbrirArquivo, type PedidoAbrirArquivo } from './lib/abrir-arquivo';
export { BalaoRecadosETarefas, ENTIDADE_TAREFA } from './telas/recados-e-tarefas';
export { abrirTarefaDoCore, ROTA_RECADOS_E_TAREFAS, rotaDaTarefa } from './telas/paginas-recados-e-tarefas';
export { chaveDaCopiaPerformance, ENTIDADES_PERFORMANCE } from './telas/performance';
export { useInicio } from './lib/usar-inicio';
export { TelaInicioCampo, useInicioCampo, ENTIDADE_FRASE_DIA, definirResolvedorFotoPerfil, type ResolvedorFotoPerfil, type PropsTelaInicioCampo, type VisaoInicioCampo } from './telas/inicio';
export { ENTIDADE_USUARIO_AVATAR } from './telas/inicio/foto-perfil';
export { useNotificacoes } from './lib/usar-notificacoes';
export { chaveDeOrdemDaCarga, essencialDaEntrada, etapaQueLibera, progressoDaEntrada } from '../domain/entrada-sync';
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
  migracoesAparelho,
  paginas: [
    { id: 'rota', caminho: 'rota', titulo: 'Rota de hoje', navegacao: 'Rota', icone: 'pin', apps: ['campo'], ordem: 20, componente: comVisitas(TelaRota) },
    { id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', icone: 'users', apps: ['campo', 'gestao'], ordem: 30, componente: comVisitas(TelaClientes) },
    { id: 'metas', caminho: 'metas', titulo: 'Metas', apps: ['campo'], componente: TelaMetas },
    { id: 'meus-modulos', caminho: 'meus-modulos', titulo: 'Meus módulos', apps: ['campo', 'gestao'], componente: TelaMeusModulos },
    { id: 'notificacoes', caminho: 'notificacoes', titulo: 'Notificações', apps: ['campo', 'gestao'], componente: TelaNotificacoes },
    { id: 'cliente', caminho: 'cliente', titulo: 'Ficha do cliente', apps: ['campo', 'gestao'], componente: comVisitas(TelaCliente) },
    { id: 'performance', caminho: 'performance', titulo: 'Performance', navegacao: 'Performance', icone: 'target', ordem: 50, apps: ['campo'], componente: TelaPerformance },
    { id: 'recados-e-tarefas', caminho: 'recados-e-tarefas', titulo: 'Recados e tarefas', apps: ['campo', 'gestao'], componente: PaginaRecadosETarefas },
    { id: 'tarefa', caminho: 'tarefa', titulo: 'Tarefa', apps: ['campo', 'gestao'], componente: PaginaTarefa },
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
    // Rastreamento no expediente (T-0156): ponto só de envio; ausência do próprio usuário no pull (interno, sem tela no Campo)
    ...entidadesRastreamento,
  ],
  // O card antigo de notificações saiu do slot `inicio.cards` (T-0073): o Início novo mostra as 3 últimas pelo `useInicio()`.
  extensoes: [],
  etapasSync: etapasCore,
  consultas: [consultaFinanceiroClienteAparelho],
});

export { TelaLogin, type PropsTelaLogin } from './components/tela-login';
export { TelaCrieSuaSenha, type PropsTelaCrieSuaSenha } from './components/tela-crie-sua-senha';
export { TelaEsqueciSenha, type PropsTelaEsqueciSenha } from './components/tela-esqueci-senha';
export { TelaTrocarSenha, type PropsTelaTrocarSenha } from './components/tela-trocar-senha';
export { erroDaTrocaVoluntaria, precheckDaTrocaVoluntaria, trocarMinhaSenha } from './lib/trocar-senha';
export { entrarComSenha, mensagemDeErroDeLogin, validarLogin, type CamposLogin } from './lib/login';
export { AVISO_SENHA_CRIADA, detalhesDaTroca, ehSenhaATrocar, pedirSenhaTemporaria, trocarSenhaPeloApp, type CamposEsqueci, type DadosDaTroca } from './lib/senha';
export { ehAparelhoBloqueado, tratarAparelhoBloqueado, type AcoesAparelhoBloqueado } from './lib/aparelho-bloqueado';
