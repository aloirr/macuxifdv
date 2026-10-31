import { defineModule } from '@macuxi/platform-sdk';

/** Quem vê painéis, ranking e alertas: supervisor e gerente (equipe, RN-CORE-04); analista e admin só leem (tenant). */
const PERFIS_LEITURA = ['supervisor', 'gerente', 'analista', 'admin'] as const;
/** Quem decide aprovações e dispensa alertas: só supervisor e gerente (doc 03 §2). A alçada em si é do Vendedor. */
const PERFIS_GESTAO = ['supervisor', 'gerente'] as const;
/** Quem configura as regras de alerta (BKO): analista e admin. */
const PERFIS_CONFIG = ['analista', 'admin'] as const;

/**
 * Manifesto do Gestor (T-0014: domínio, contratos e manifesto).
 * - RN-PRO-01: nenhuma ação de pedido aqui; o pedido em nome usa a extensão `pedido.criar_em_nome` e a ação de mesmo
 *   nome, ambas do Vendedor (supervisor e gerente). Vendedor inativo ⇒ a função some, sem erro (RN-CORE-03).
 * - Nomes das ações são globais na plataforma (conflito = erro na montagem): por isso o prefixo da entidade do Gestor.
 * - Aprovação: `fila_aprovacao.decidir` é a tela do Gestor; quem executa e valida a alçada é a API pública do Vendedor
 *   (`pedido.aprovar`).
 * - `consome`: só eventos já registrados em `.coord/contratos/eventos.md`. PENDENTES de registro (pedido T-0014 ao
 *   engenheiro-software): `core.rota.dia_planejado@1` (visitas planejadas) e `core.meta.definida@1` (meta mensal);
 *   entram aqui quando existirem. Não consome `vendedor.pedido.faturado@1`: o `status_alterado` já traz o faturamento.
 */
export const manifest = defineModule({
  id: 'gestor',
  versao: '0.2.0',
  depende: ['core'],
  opcionais: ['vendedor', 'promotor', 'pesquisa', 'treinamento'],
  perfis: ['supervisor', 'gerente', 'analista', 'admin'],
  apps: { gestao: { abas: ['Equipe', 'Aprovações', 'Alertas'] }, web: { menus: ['Painel da equipe', 'Ranking', 'Aprovações', 'Alertas', 'Regras de alerta'] } },
  sync: ['painel_vendedor_dia', 'alerta'],
  consome: [
    'core.cliente.atualizado@1',
    'core.visita.checkin@1',
    'core.visita.checkout@1',
    'vendedor.pedido.criado@1',
    'vendedor.pedido.status_alterado@1',
    'vendedor.pedido.aprovacao_solicitada@1',
    'promotor.visita_loja.concluida@1',
    'promotor.gondola.registrada@1',
    'promotor.share.medido@1',
    'promotor.preco.coletado@1',
    'promotor.ruptura.registrada@1',
    'promotor.tarefa.concluida@1',
    'pesquisa.resposta.registrada@1',
    'treinamento.licao.concluida@1',
    'treinamento.medalha.conquistada@1',
  ],
  acoes: {
    'painel_equipe.ver': { perfis: [...PERFIS_LEITURA], descricao: 'Ver painel da equipe, ficha do vendedor e do promotor (RF-GES-01/02/10); o escopo vem da hierarquia (RN-CORE-04)' },
    'ranking_equipe.ver': { perfis: [...PERFIS_LEITURA], descricao: 'Ver o ranking da equipe por indicador e período (RF-GES-03)' },
    'fila_aprovacao.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver a fila de aprovações da equipe, com prazos (RF-GES-04)' },
    'fila_aprovacao.decidir': { perfis: [...PERFIS_GESTAO], descricao: 'Aprovar ou rejeitar com comentário; a alçada é validada pela API do Vendedor (RF-GES-04, RN-VEN-10)' },
    'alerta_equipe.ver': { perfis: [...PERFIS_LEITURA], descricao: 'Ver os alertas da equipe (RF-GES-07)' },
    'alerta_equipe.dispensar': { perfis: [...PERFIS_GESTAO], descricao: 'Dispensar um alerta enquanto a condição persistir (RF-GES-07)' },
    'alerta_regra.gerenciar': { perfis: [...PERFIS_CONFIG], descricao: 'Ligar, desligar e ajustar as regras de alerta do tenant (BKO)' },
  },
  // Pedido em nome: extensão opcional do Vendedor; some sem erro se o Vendedor estiver inativo.
  usaExtensoes: ['pedido.criar_em_nome', 'cliente.abas', 'inicio.cards'],
});

export default manifest;
