/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2): parte pura, roda em Node nos testes.
 * O número é a soma das notificações não lidas do Core (`useNotificacoes().naoLidas`, que já inclui os avisos de tarefa nova,
 * RN-CORE-TAR-07): escondido com 0 e "9+" acima de 9.
 */
export const ROTA_RECADOS_E_TAREFAS = 'recados-e-tarefas';
/** Central antiga, enquanto o Core não registra a página de Recados e tarefas. */
export const ROTA_NOTIFICACOES = 'notificacoes';

export function numeroDoSino(naoLidas: number): string | null {
  if (!Number.isFinite(naoLidas) || naoLidas <= 0) return null;
  return naoLidas > 9 ? '9+' : String(Math.floor(naoLidas));
}

/** Leitura do botão no TalkBack. */
export function leituraDoSino(naoLidas: number): string {
  if (!Number.isFinite(naoLidas) || naoLidas <= 0) return 'Recados e tarefas';
  return naoLidas === 1 ? 'Recados e tarefas, 1 novo' : `Recados e tarefas, ${Math.floor(naoLidas)} novos`;
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
  contadorFundo: 'grafico' | 'graficoEscuro';
  contadorNumero: 'surface' | 'ink';
  /** aro do contador: a cor do fundo atrás do sino, para o número não encostar no botão */
  contadorAro: 'ground' | 'faixa';
}

/**
 * MC-0009: na faixa Azul noite (`CabecalhoTela`) o botão é vazado com borda `faixaTrilho`, o ícone branco e o contador Sol claro
 * (`graficoEscuro`, 5,85:1 na faixa) com número grafite (7,56:1). Fora da faixa (Início, no Pérola): botão branco e contador laranja
 * (`grafico`) com número branco (4,60:1).
 */
export function coresDoSino(sobreFaixa: boolean): CoresDoSino {
  return sobreFaixa
    ? { botaoFundo: 'transparente', botaoBorda: 'faixaTrilho', icone: 'faixaTitulo', contadorFundo: 'graficoEscuro', contadorNumero: 'ink', contadorAro: 'faixa' }
    : { botaoFundo: 'surface', botaoBorda: 'line', icone: 'ink', contadorFundo: 'grafico', contadorNumero: 'surface', contadorAro: 'ground' };
}
