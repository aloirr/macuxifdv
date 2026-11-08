import { defineModule } from '@macuxi/platform-sdk';

/** Quem vê e age sobre a EQUIPE (RN-CORE-04): supervisor e gerente; decidem aprovações e dispensam alertas (doc 03 §2). */
const PERFIS_GESTAO = ['supervisor', 'gerente'] as const;
/** RN-GES-07: analista e admin veem os painéis do TENANT em modo leitura (BKO) e configuram as regras de alerta. */
const PERFIS_TENANT = ['analista', 'admin'] as const;

/**
 * Manifesto do Gestor (T-0014: domínio, contratos e manifesto).
 * - RN-PRO-01: nenhuma ação de pedido aqui; o pedido em nome usa a extensão `pedido.criar_em_nome` e a ação de mesmo
 *   nome, ambas do Vendedor (supervisor e gerente). Vendedor inativo ⇒ a função some, sem erro (RN-CORE-03).
 * - Nomes das ações são globais na plataforma (conflito = erro na montagem): por isso o prefixo da entidade do Gestor.
 * - Aprovação: `fila_aprovacao.decidir` é a tela do Gestor; quem executa e valida a alçada é a API pública do Vendedor
 *   (`pedido.aprovar`).
 * - `consome`: só eventos já registrados em `.coord/contratos/eventos.md`. `core.rota.dia_planejado@1` (visitas planejadas) segue
 *   fora até o Core publicá-lo. T-0024: nenhum payload alheio é copiado; os schemas são os do `contracts` do dono, em leitura
 *   tolerante; `core.meta.definida@1` (indicador `venda_cents`) passa a ser consumido.
 * - RN-GES-06: consome `vendedor.pedido.faturado@1` (itens faturados por retorno do ERP) para o "faturado" parcial.
 * - T-0046: `promotor.*@1` validados com os schemas oficiais do Promotor (contracts); desfecho `realizada` |
 *   `loja_fechada` | `acesso_negado` e tarefas por `execucao_id`. 0.5.0: `PainelTrade` ganhou `visitas_sem_atendimento`
 *   e `tarefas_distintas`. `core.visita.checkout@1` pelo schema do Core (`fechada_por: 'auto'` fora do tempo, RN-CORE-11;
 *   usuario > auto) e `core.cliente.atualizado@1` sem carteira ⇒ aviso de carteira incompleta (`situacaoDaCarteira`).
 * - RN-GES-03: o prazo da aprovação (`prazo_aprovacao_dias_uteis`, 1 dia útil) e o horário comercial são parâmetros do
 *   tenant (contracts/parametros.ts); o manifesto não declara parâmetros.
 * - T-0055 (0.6.0): rotas `/v1/gestor` (leitura por `perfis` = painel_equipe.ver ∪ painel_tenant.ver; escopo pela
 *   plataforma, RN-CORE-04), consumidores dos eventos de `consome` e `usaConsultas: core.cadastro_resumo@1` (nomes da
 *   equipe). A decisão da aprovação continua no Vendedor (ADR 0011): a aba Aprovações abre o detalhe do pedido dele.
 * - RN-GES-07: `painel_tenant.ver` é a leitura do tenant (painel, ranking, alertas e fila) para analista e admin; eles
 *   não têm `fila_aprovacao.decidir` nem `alerta_equipe.dispensar`.
 * - T-0073 (0.7.0): card "Pedidos para aprovar" no slot `inicio.cards` (`ordem` 10, só `gestao` com `fila_aprovacao.ver`) e "Equipe agora"
 *   com a regra de parado (RN-CORE-26; `inicio.parado_min` = 60): fatos da rota no `PainelDia` (aditivos) e `statusAgora` no aparelho.
 */
export const manifest = defineModule({
  id: 'gestor',
  versao: '0.7.0',
  depende: ['core'],
  opcionais: ['vendedor', 'promotor', 'pesquisa', 'treinamento'],
  perfis: ['supervisor', 'gerente', 'analista', 'admin'],
  apps: { gestao: { abas: ['Equipe', 'Aprovações', 'Alertas'] }, web: { menus: ['Painel da equipe', 'Ranking', 'Aprovações', 'Alertas', 'Regras de alerta'] } },
  sync: ['painel_vendedor_dia', 'alerta'],
  consome: [
    'core.cliente.atualizado@1',
    'core.visita.checkin@1',
    'core.visita.checkout@1',
    'core.meta.definida@1',
    'vendedor.pedido.criado@1',
    'vendedor.pedido.status_alterado@1',
    'vendedor.pedido.aprovacao_solicitada@1',
    'vendedor.pedido.faturado@1',
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
    'painel_equipe.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver painel da equipe, ficha do vendedor e do promotor (RF-GES-01/02/10); o escopo vem da hierarquia (RN-CORE-04)' },
    'ranking_equipe.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver o ranking da equipe por indicador e período (RF-GES-03)' },
    'fila_aprovacao.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver a fila de aprovações da equipe, com prazo em dias úteis (RF-GES-04, RN-GES-03)' },
    'fila_aprovacao.decidir': {
      perfis: [...PERFIS_GESTAO],
      descricao: 'Aprovar (sem comentário) ou rejeitar (com motivo); o gerente também decide o nível supervisor e o supervisor é avisado; a alçada é validada pela API do Vendedor (RN-GES-04/08, RN-VEN-10)',
    },
    'alerta_equipe.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver os alertas da equipe (RF-GES-07)' },
    'alerta_equipe.dispensar': { perfis: [...PERFIS_GESTAO], descricao: 'Dispensar um alerta enquanto a condição persistir (RF-GES-07)' },
    'painel_tenant.ver': { perfis: [...PERFIS_TENANT], descricao: 'Ver painéis, ranking, alertas e fila de aprovação do tenant em modo leitura no BKO, sem decidir (RN-GES-07)' },
    'alerta_regra.gerenciar': { perfis: [...PERFIS_TENANT], descricao: 'Ligar, desligar e ajustar as regras de alerta do tenant (BKO)' },
  },
  // T-0055: nomes e perfis da equipe pelo cadastro do Core (ADR 0012), na mesma transação da rota.
  usaConsultas: ['core.cadastro_resumo@1'],
  // Pedido em nome: extensão opcional do Vendedor; some sem erro se o Vendedor estiver inativo.
  usaExtensoes: ['pedido.criar_em_nome', 'cliente.abas', 'cliente.avisos', 'inicio.cards'],
});

export default manifest;
