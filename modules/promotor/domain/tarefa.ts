/** Tarefas pontuais criadas no BKO, com prazo e comprovação por foto (RF-PRO-10). */

export type SituacaoTarefa = 'pendente' | 'atrasada' | 'concluida' | 'concluida_com_atraso';

/** Datas civis `AAAA-MM-DD` no fuso do tenant. Sem prazo, a tarefa nunca atrasa. */
export function situacaoTarefa(t: { prazo: string | null; concluida_em: string | null; hoje: string }): SituacaoTarefa {
  if (t.concluida_em) return t.prazo !== null && t.concluida_em > t.prazo ? 'concluida_com_atraso' : 'concluida';
  return t.prazo !== null && t.hoje > t.prazo ? 'atrasada' : 'pendente';
}

/** RF-PRO-10: concluir exige ao menos uma foto de comprovação. */
export function validarConclusaoTarefa(t: { qtd_fotos: number }): string[] {
  return t.qtd_fotos >= 1 ? [] : ['Tire ao menos uma foto para comprovar a tarefa.'];
}
