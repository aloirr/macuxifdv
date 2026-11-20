import type { ComponentType } from 'react';
import type { ContextoCliente } from '@macuxi/core/contracts';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { CardAprovacoes } from './components/card-aprovacoes';
import { AvisoEtapaEquipe } from './components/aviso-etapa-equipe';
import { etapasGestor } from './etapas';
import { extensoesDaFicha, extensoesDoInicio } from './registro-inicio';
import AlertasScreen from './screens/alertas-screen';
import AprovacoesScreen from './screens/aprovacoes-screen';
import EquipeScreen from './screens/equipe-screen';
import FichaScreen from './screens/ficha-screen';
import RankingScreen from './screens/ranking-screen';

/**
 * Telas do Gestor no app Macuxi Gestão (ADR 0003; T-0055; pedido R-20261101-155037 do engenheiro-apps): abas Equipe
 * (ordem 10), Aprovações (20) e Alertas, mais a ficha e o ranking sem aba. `apps: ['gestao']` em todas (o Campo não tem
 * Gestor). Cada página exige a ação do manifesto (supervisor e gerente); analista/admin leem pelo BKO (RN-GES-07).
 * Caminhos literais (iguais às constantes de rotas.ts; o teste de abas da demo lê o fonte). Offline-first: as telas leem o cache do módulo, alimentado pela etapa de sync e pelo "puxar para atualizar".
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'equipe', caminho: 'equipe', titulo: 'Equipe', navegacao: 'Equipe', icone: 'users', apps: ['gestao'], acao: 'painel_equipe.ver', ordem: 10, componente: EquipeScreen },
    { id: 'aprovacoes', caminho: 'aprovacoes', titulo: 'Aprovações', navegacao: 'Aprovações', icone: 'check', apps: ['gestao'], acao: 'fila_aprovacao.ver', ordem: 20, componente: AprovacoesScreen },
    { id: 'alertas', caminho: 'alertas', titulo: 'Alertas', navegacao: 'Alertas', icone: 'alert', apps: ['gestao'], acao: 'alerta_equipe.ver', componente: AlertasScreen },
    { id: 'membro', caminho: 'equipe-membro', titulo: 'Ficha', apps: ['gestao'], acao: 'painel_equipe.ver', componente: FichaScreen },
    { id: 'ranking', caminho: 'equipe-ranking', titulo: 'Ranking', apps: ['gestao'], acao: 'ranking_equipe.ver', componente: RankingScreen },
  ],
  etapasSync: etapasGestor,
  // T-0073: card "Pedidos para aprovar" no Início (slot `inicio.cards`, ordem 10)
  extensoes: [...extensoesDoInicio<ComponentType>(CardAprovacoes), ...extensoesDaFicha<ComponentType<{ contexto: ContextoCliente }>>(AvisoEtapaEquipe)],
});
