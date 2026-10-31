import { defineModule } from '@macuxi/platform-sdk';

/** Doc 03 §2: quem faz o treinamento no app (Campo e Gestão). Analista/assistente/admin administram, não "treinam". */
const PERFIS_ALUNO = ['vendedor', 'promotor', 'supervisor', 'gerente'] as const;
/** Doc 03 §2: "Criar pesquisa / trilha" = analista e admin. */
const PERFIS_CADASTRO = ['analista', 'admin'] as const;
/** RF-TRE-05: adesão, conclusão e notas — gestor (supervisor/gerente, no recorte do escopo) e BKO. */
const PERFIS_GESTAO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

/**
 * Manifesto do Treinamento.
 * Publica `treinamento.licao.concluida@1` e `treinamento.medalha.conquistada@1` (doc 02); outros fatos (trilha
 * concluída, nível) viajam dentro de `licao.concluida` (`trilha_concluida`) e não têm evento próprio.
 * Consome o pedido FATURADO só como opcional (desafios de vendas, RF-TRE-06; paga no faturamento vindo do ERP): o módulo
 * funciona sem o Vendedor. PENDENTE: o nome do evento (`vendedor.pedido.faturado@1` é provisório) será definido por
 * Vendedor + Integração + engenheiro-software.
 * O escopo do dado (equipe/regional no ranking, adesão da equipe) fica no domain + API (RN-CORE-04), não nas ações.
 */
export const manifest = defineModule({
  id: 'treinamento',
  versao: '0.1.0',
  depende: ['core'],
  opcionais: ['vendedor'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'],
  apps: { campo: { abas: ['Treinar'] }, gestao: { abas: ['Treinar'] }, web: { menus: ['Trilhas'] } },
  sync: ['trilha', 'modulo_trilha', 'licao', 'quiz', 'questao', 'alternativa', 'progresso', 'tentativa', 'medalha', 'xp_lancamento', 'medalha_usuario', 'ranking_periodo'],
  publica: ['treinamento.licao.concluida@1', 'treinamento.medalha.conquistada@1'],
  consome: ['vendedor.pedido.faturado@1'],
  usaExtensoes: ['inicio.cards'],
  acoes: {
    // --- aluno (apps Campo e Gestão; funciona offline, a API revalida: RN-TRE-02/04) ---
    'trilha.baixar_offline': { perfis: [...PERFIS_ALUNO], descricao: 'Baixar a trilha para estudar offline (RF-TRE-02); vídeo curto só no Wi-Fi' },
    'licao.concluir': { perfis: [...PERFIS_ALUNO], descricao: 'Concluir lição (tempo mínimo e pré-requisitos validados no servidor, RN-TRE-04)' },
    'quiz.responder': { perfis: [...PERFIS_ALUNO], descricao: 'Responder quiz (nota mínima, tentativas por dia, RN-TRE-02)' },
    'ranking.ver': { perfis: [...PERFIS_ALUNO, ...PERFIS_CADASTRO], descricao: 'Ver o ranking do tenant: a própria posição e a dos colegas (RF-TRE-04, RN-TRE-03)' },
    // --- gestão e BKO (RF-TRE-05) ---
    'adesao.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver adesão do mês e conclusão por trilha, no escopo do perfil (RF-TRE-05)' },
    'notas.ver': { perfis: [...PERFIS_GESTAO], descricao: 'Ver notas por pessoa e por trilha, no escopo do perfil (RF-TRE-05)' },
    // --- cadastros (BKO; doc 03 §2 "Criar trilha": analista e admin; RN-AUD-01 audita a publicação) ---
    'trilha.criar': { perfis: [...PERFIS_CADASTRO], descricao: 'Criar trilha com módulos, lições, público-alvo e prazo (RF-TRE-01)' },
    'trilha.editar': { perfis: [...PERFIS_CADASTRO], descricao: 'Editar trilha em rascunho: módulos, lições, quiz e pré-requisitos (RF-TRE-01)' },
    'trilha.publicar': { perfis: [...PERFIS_CADASTRO], descricao: 'Publicar ou arquivar trilha (RF-TRE-01, auditado: RN-AUD-01)' },
    'quiz.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Criar e editar quiz, questões e alternativas (RF-TRE-01)' },
    'desafio.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Criar desafios de vendas ligados a campanhas (RF-TRE-06)' },
    'medalha.gerenciar': { perfis: [...PERFIS_CADASTRO], descricao: 'Definir o catálogo de medalhas do tenant (RF-TRE-03)' },
  },
});

export default manifest;
