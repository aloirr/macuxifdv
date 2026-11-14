/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2): parte pura, roda em Node nos testes.
 * O sino mostra só uma bolinha quando há novo, sem número (dono do produto, 14/11/2026). O total vem do `sino.total` do Core
 * (`useInicioCampo()`, `contarSino`: recados não lidos + tarefas novas, RN-CORE-TAR-07), contado uma vez no layout.
 */
export const ROTA_RECADOS_E_TAREFAS = 'recados-e-tarefas';
/** Central antiga, enquanto o Core não registra a página de Recados e tarefas. */
export const ROTA_NOTIFICACOES = 'notificacoes';

/** Bolinha acesa quando há recado ou tarefa nova. */
export function temNovoNoSino(total: number): boolean {
  return Number.isFinite(total) && total > 0;
}

/** Leitura do botão no TalkBack. */
export function leituraDoSino(total: number): string {
  return temNovoNoSino(total) ? 'Recados e tarefas, há novos' : 'Recados e tarefas';
}

/** "Ver todos": a tela Recados e tarefas quando existe para o usuário; senão a central de notificações. */
export function destinoVerTodos(telaExiste: (caminho: string) => boolean): string {
  return telaExiste(ROTA_RECADOS_E_TAREFAS) ? `/m/${ROTA_RECADOS_E_TAREFAS}` : `/m/${ROTA_NOTIFICACOES}`;
}

/** Detalhe da tarefa aberto pelo balão (página `tarefa` do Core, parâmetro `id`). */
export function destinoDaTarefa(tarefaId: string): string {
  return `/m/tarefa?id=${encodeURIComponent(tarefaId)}`;
}

/** Cores do sino por token (`colors` do kit); `transparente` = sem fundo. Parecer de marca MC-0009 (v1.0.6). */
export interface CoresDoSino {
  botaoFundo: 'surface' | 'transparente';
  botaoBorda: 'line' | 'faixaTrilho';
  icone: 'ink' | 'faixaTitulo';
  bolinhaFundo: 'grafico' | 'graficoEscuro';
  /** aro da bolinha: a cor do fundo atrás do sino, para a bolinha se destacar do ícone */
  bolinhaAro: 'ground' | 'faixa';
}

/**
 * MC-0009: na faixa Azul noite (`CabecalhoTela`) o botão é vazado com borda `faixaTrilho`, o ícone branco e a bolinha Sol claro
 * (`graficoEscuro`, 5,85:1 na faixa) com aro `faixa`. Fora da faixa (Início, no Pérola): botão branco e bolinha laranja (`grafico`)
 * com aro `ground`.
 */
export function coresDoSino(sobreFaixa: boolean): CoresDoSino {
  return sobreFaixa
    ? { botaoFundo: 'transparente', botaoBorda: 'faixaTrilho', icone: 'faixaTitulo', bolinhaFundo: 'graficoEscuro', bolinhaAro: 'faixa' }
    : { botaoFundo: 'surface', botaoBorda: 'line', icone: 'ink', bolinhaFundo: 'grafico', bolinhaAro: 'ground' };
}
