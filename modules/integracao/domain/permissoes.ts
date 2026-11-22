/**
 * Quem faz o quê no BKO da Integração (decisão P-3 do Alexandre, R-20261101-014652; RN-INT-06 e RN-INT-10, T-0031):
 * - **gestão de chaves de API do Conector** (cadastrar Conector, gerar/rotacionar/revogar chave, política de versão): **só admin**;
 * - **confirmação da inativação em massa** da carga completa: **admin ou analista**, sempre com auditoria (`decidirPendencia`).
 *
 * O manifesto (`acoes`) é o que a plataforma usa na rota (403 `PERFIL_SEM_ACESSO`); esta tabela é a mesma regra no domain, para a
 * API revalidar dentro do caso de uso (defesa em profundidade) e para o teste garantir que manifesto e regra não divergem.
 * Perfis de campo (vendedor, promotor, supervisor, gerente) e o assistente nunca tocam no Hub (RN-PRO-01).
 */
import type { Perfil } from '@macuxi/platform-sdk';

export const PERFIS_ACAO_INTEGRACAO = {
  'monitor.ver': ['admin', 'analista'],
  'lote.reprocessar': ['admin', 'analista'],
  'lote.cancelar': ['admin', 'analista'],
  'mapeamento.editar': ['admin', 'analista'],
  'conector.gerenciar': ['admin'],
  'inativacao.decidir': ['admin', 'analista'],
} as const satisfies Record<string, readonly Perfil[]>;

export type AcaoIntegracao = keyof typeof PERFIS_ACAO_INTEGRACAO;

export type ResultadoPermissao = { ok: true } | { ok: false; status: 403; codigo: 'perfil_sem_acesso'; mensagem: string };

const MENSAGENS: Record<AcaoIntegracao, string> = {
  'monitor.ver': 'Seu perfil não acessa o monitor da Integração ERP. Peça acesso ao administrador do Macuxi.',
  'lote.reprocessar': 'Só administrador ou analista reprocessa lotes. Peça a um deles em Integração ERP > Lotes.',
  'lote.cancelar': 'Só administrador ou analista cancela lotes. Peça a um deles em Integração ERP.',
  'mapeamento.editar': 'Só administrador ou analista edita o mapeamento de códigos. Peça a um deles em Integração ERP > Mapeamento.',
  'conector.gerenciar': 'Só o administrador gerencia Conectores e chaves de API. Peça ao administrador do Macuxi em Integração ERP > Conectores.',
  'inativacao.decidir': 'Só administrador ou analista confirma ou recusa a inativação em massa. Peça a um deles em Integração ERP > Inativações.',
};

/** P-3: confere o perfil para a ação do BKO. A API chama antes de executar (além da checagem da rota pelo manifesto). */
export function autorizarAcaoIntegracao(acao: AcaoIntegracao, perfil: Perfil): ResultadoPermissao {
  const permitidos: readonly Perfil[] = PERFIS_ACAO_INTEGRACAO[acao];
  if (permitidos.includes(perfil)) return { ok: true };
  return { ok: false, status: 403, codigo: 'perfil_sem_acesso', mensagem: MENSAGENS[acao] };
}
