/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2): parte pura, roda em Node nos testes.
 * Aqui ficam só os destinos do balão; o botão, a bolinha, as cores e a leitura são do `SinoNotificacoes` do kit (RD-2450).
 * O total vem do `sino.total` do Core
 * (`useInicioCampo()`, `contarSino`: recados não lidos + tarefas novas, RN-CORE-TAR-07), contado uma vez no layout.
 */
export const ROTA_RECADOS_E_TAREFAS = 'recados-e-tarefas';
/** Central antiga, enquanto o Core não registra a página de Recados e tarefas. */
export const ROTA_NOTIFICACOES = 'notificacoes';

/** "Ver todos": a tela Recados e tarefas quando existe para o usuário; senão a central de notificações. */
export function destinoVerTodos(telaExiste: (caminho: string) => boolean): string {
  return telaExiste(ROTA_RECADOS_E_TAREFAS) ? `/m/${ROTA_RECADOS_E_TAREFAS}` : `/m/${ROTA_NOTIFICACOES}`;
}

/** Detalhe da tarefa aberto pelo balão (página `tarefa` do Core, parâmetro `id`). */
export function destinoDaTarefa(tarefaId: string): string {
  return `/m/tarefa?id=${encodeURIComponent(tarefaId)}`;
}
