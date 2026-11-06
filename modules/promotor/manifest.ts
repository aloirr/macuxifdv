import { defineModule } from '@macuxi/platform-sdk';

/** Doc 03 §2: coletas de trade (gôndola, share, preço, ruptura, validade, pontos extras) = só o promotor. */
const PERFIL_COLETA = ['promotor'] as const;
/** Doc 03 §2: cadastros de trade (mix, metas de share, concorrentes, planogramas, checklists, tarefas) = analista e admin. */
const PERFIS_CADASTRO = ['analista', 'admin'] as const;

/**
 * Manifesto do Promotor.
 * RN-PRO-01: o promotor nunca cria/edita/exclui pedido (UI e API); este manifesto não declara nenhuma
 * ação do tipo e o teste `domain/rn-pro-01.test.ts` garante isso.
 * Supervisor, gerente e analista só LEEM coletas e relatórios (perfis do módulo, sem ação de escrita);
 * `admin` entra em `perfis` para o BKO de cadastros de trade (doc 03 §2).
 */
export const manifest = defineModule({
  id: 'promotor',
  versao: '0.1.0',
  depende: ['core'],
  opcionais: ['catalogo', 'pesquisa', 'vendedor'],
  perfis: ['promotor', 'supervisor', 'gerente', 'analista', 'admin'],
  apps: { campo: { abas: ['Loja'] }, gestao: { abas: ['Trade'] }, web: { menus: ['Trade marketing', 'Cadastros de trade'] } },
  // T-0056: cadastros de trade (pull, servidor vence) + coletas (push, offline-first); definições em contracts/entidades.ts
  sync: [
    'categoria_gondola',
    'checklist_loja',
    'mix_obrigatorio',
    'meta_share',
    'concorrente',
    'produto_concorrente',
    'foto_referencia',
    'tarefa_trade',
    'ponto_extra_negociado',
    'visita_loja',
    'foto_coleta',
    'checklist_resposta',
    'gondola_registro',
    'medicao_share',
    'coleta_preco',
    'ruptura_item',
    'validade_item',
    'ponto_extra',
    'acao_concorrencia',
    'tarefa_execucao',
  ],
  publica: [
    'promotor.visita_loja.concluida@1',
    'promotor.gondola.registrada@1',
    'promotor.share.medido@1',
    'promotor.preco.coletado@1',
    'promotor.ruptura.registrada@1',
    'promotor.tarefa.concluida@1',
  ],
  consome: ['core.visita.checkin@1', 'core.visita.checkout@1'],
  usaExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards'],
  // ADR 0012: nome da loja nos relatórios do BKO de trade (T-0056)
  ofereceConsultas: ['promotor.concorrentes@1'],
  usaConsultas: ['core.cadastro_resumo@1'],
  acoes: {
    // --- coletas (app Macuxi Campo; só com check-in aberto, RN-PRO-02) ---
    'coleta.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Registrar a visita de loja e as fotos da coleta (RN-PRO-02)' },
    'checklist_loja.responder': { perfis: [...PERFIL_COLETA], descricao: 'Responder o checklist do dia da loja (RF-PRO-02)' },
    'gondola.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Fotos antes/depois e conformidade da gôndola (RF-PRO-03)' },
    'share.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Medir o share de gôndola por categoria (RF-PRO-04)' },
    'preco.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Coletar preço de prateleira e promoção (RF-PRO-05)' },
    'ruptura.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Registrar presença e ruptura do mix obrigatório (RF-PRO-06)' },
    'validade.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Registrar validade próxima e avarias (RF-PRO-07)' },
    'ponto_extra.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Registrar e conferir pontos extras e material de PDV (RF-PRO-08)' },
    'concorrencia.registrar': { perfis: [...PERFIL_COLETA], descricao: 'Registrar ações e lançamentos da concorrência (RF-PRO-09)' },
    'tarefa_trade.concluir': { perfis: [...PERFIL_COLETA], descricao: 'Concluir tarefa de campanha com foto de comprovação (RF-PRO-10)' },
    // --- cadastros de trade (BKO; RF-PRO-11) ---
    'mix_obrigatorio.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Mix obrigatório por loja, rede ou canal, com vigência (RN-PRO-10)' },
    'meta_share.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Metas de share por loja/categoria, com vigência (RN-PRO-10)' },
    'categoria_gondola.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Categorias de gôndola' },
    'concorrente.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Concorrentes e seus produtos' },
    'foto_referencia.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Fotos e planogramas de referência' },
    'checklist_modelo.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Checklists por loja, rede ou canal, com vigência (RN-PRO-10)' },
    'ponto_extra_negociado.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Pontos extras negociados com a loja' },
    'tarefa_trade.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Criar e acompanhar tarefas pontuais de trade' },
  },
});

export default manifest;
