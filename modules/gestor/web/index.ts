import type { ComponentType } from 'react';
import { definirModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { ACAO_VER_TRAJETO } from '../contracts';
import { AlertasPage } from './pages/alertas-page';
import { AprovacoesPage } from './pages/aprovacoes-page';
import { PainelEquipePage } from './pages/painel-page';
import { RankingPage } from './pages/ranking-page';
import { TrajetoDoDiaPage } from './pages/trajeto-do-dia';
import { ProdutividadeDoDiaPanel, RegrasEquipePanel } from './pages/parametros-alertas-page';

/** Leitura no BKO: a equipe (`painel_equipe.ver`) e o tenant em modo leitura (`painel_tenant.ver`, RN-GES-07). */
const PERFIS_LEITURA: readonly Perfil[] = [...new Set([...manifest.acoes['painel_equipe.ver']!.perfis, ...manifest.acoes['painel_tenant.ver']!.perfis])];

/**
 * Páginas do Gestor no BKO (ADR 0003; T-0055), uma por menu do manifesto. O shell só monta com o Gestor efetivo e o
 * perfil certo; a proteção real (licença, perfil, escopo) é na API `/v1/gestor`.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'painel', caminho: 'equipe', titulo: 'Painel da equipe', navegacao: 'Painel da equipe', grupo: 'analise', ordem: 10, perfis: PERFIS_LEITURA, componente: PainelEquipePage },
    { id: 'trajeto', caminho: 'trajeto', titulo: 'Trajeto do dia', navegacao: 'Trajeto do dia', grupo: 'analise', ordem: 15, acao: ACAO_VER_TRAJETO, componente: TrajetoDoDiaPage },
    { id: 'ranking', caminho: 'ranking', titulo: 'Ranking', navegacao: 'Ranking', grupo: 'analise', ordem: 20, perfis: PERFIS_LEITURA, componente: RankingPage },
    { id: 'aprovacoes', caminho: 'aprovacoes', titulo: 'Aprovações da equipe', navegacao: 'Aprovações', grupo: 'operacao', ordem: 30, perfis: PERFIS_LEITURA, componente: AprovacoesPage },
    { id: 'alertas', caminho: 'alertas', titulo: 'Alertas da equipe', navegacao: 'Alertas', grupo: 'operacao', ordem: 40, perfis: PERFIS_LEITURA, componente: AlertasPage },
  ],
  // RD-1988: as regras de alerta são painéis de Parâmetros › Alertas (ADR 0060); o endereço de antes, /parametros/alertas, é a própria seção.
  paineisParametros: [
    { id: 'regras-alerta', secao: 'alertas', titulo: 'Alertas da equipe', ordem: 10, acao: 'alerta_regra.gerenciar', componente: RegrasEquipePanel },
    { id: 'produtividade', secao: 'alertas', titulo: 'Produtividade do dia', ordem: 20, acao: 'parametro.alertas_produtividade', componente: ProdutividadeDoDiaPanel },
  ],
});
