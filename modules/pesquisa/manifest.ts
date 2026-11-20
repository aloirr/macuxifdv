import { defineModule } from '@macuxi/platform-sdk';

/** Doc 03 §2: "Responder pesquisa" = vendedor, promotor e supervisor/gerente. Analista, assistente e admin não respondem. */
const PERFIS_CAMPO = ['vendedor', 'promotor', 'supervisor', 'gerente'] as const;
/** Doc 03 §2: "Criar pesquisa / trilha" = analista e admin. */
const PERFIS_CADASTRO = ['analista', 'admin'] as const;
/** RF-PES-06: resultados para a gestão (supervisor/gerente, no recorte do escopo) e o BKO (analista/admin). */
const PERFIS_RESULTADO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

/**
 * Manifesto da Pesquisa.
 * Publica só `pesquisa.resposta.registrada@1` (doc 02): a publicação de uma versão é auditada (RN-AUD-01) pela API e
 * não tem evento próprio até algum consumidor pedir (pergunta aberta no recado da T-0012).
 * Usa `visita.etapas_checkout` (pesquisa obrigatória, RN-PES-03), `cliente.abas` (pesquisas do cliente) e `inicio.cards` (T-0057).
 * O escopo do dado (equipe/regional nos resultados) fica no domain + API (RN-CORE-04), não nas ações.
 */
export const manifest = defineModule({
  id: 'pesquisa',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'],
  apps: { campo: { abas: ['Pesquisas'] }, gestao: { abas: ['Pesquisas'] }, web: { menus: ['Pesquisas'] } },
  sync: ['questionario', 'questionario_versao', 'pergunta', 'resposta_pesquisa'],
  publica: ['pesquisa.resposta.registrada@1'],
  consome: ['core.visita.checkout@1'],
  // T-0039: o Core pergunta no checkout se a pesquisa obrigatória foi cumprida no servidor (RN-PES-03, RN-CORE-12)
  // T-0170 (#145): a tarefa de pesquisa do Core usa `questionarios_para_tarefa` (API) e `resposta_local` (aparelho; a API
  // também responde, só com as respostas sincronizadas do usuário, porque o SDK exige implementação na API)
  ofereceConsultas: ['pesquisa.etapas_checkout@1', 'pesquisa.questionarios_para_tarefa@1', 'pesquisa.resposta_local@1'],
  // T-0187: "Respondida por <nome>" nos resultados (nome do usuário pelo Core, só leitura)
  usaConsultas: ['core.usuarios_resumo@1'],
  usaExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards'],
  acoes: {
    // --- responder (apps Campo e Gestão; funciona offline, a API revalida: RN-PES-01/03/04) ---
    'pesquisa.responder': { perfis: [...PERFIS_CAMPO], descricao: 'Responder pesquisa avulsa ou do checkout, inclusive offline (RF-PES-03, RF-PES-04)' },
    // --- cadastro (BKO; doc 03 §2 "Criar pesquisa": analista e admin; RN-AUD-01 audita a publicação) ---
    'questionario.criar': { perfis: [...PERFIS_CADASTRO], descricao: 'Criar questionário no construtor: perguntas, regras, público e vigência (RF-PES-01, RF-PES-02)' },
    'questionario.editar': { perfis: [...PERFIS_CADASTRO], descricao: 'Editar o rascunho; editar versão publicada cria nova versão (RF-PES-05, RN-PES-01)' },
    'questionario.publicar': { perfis: [...PERFIS_CADASTRO], descricao: 'Publicar a versão e congelá-la (RN-PES-01, auditado: RN-AUD-01)' },
    'questionario.arquivar': { perfis: [...PERFIS_CADASTRO], descricao: 'Arquivar questionário: deixa de ser oferecido, as respostas ficam (RF-PES-05)' },
    // --- resultados (RF-PES-06) ---
    'resultado.ver': { perfis: [...PERFIS_RESULTADO], descricao: 'Ver taxa de resposta, gráficos por pergunta e galeria de fotos, no escopo do perfil (RF-PES-06)' },
    'resultado.exportar': { perfis: [...PERFIS_RESULTADO], descricao: 'Exportar resultados em Excel/CSV, no escopo do perfil (RF-PES-06)' },
  },
});

export default manifest;
