/**
 * Mensagem amigável quando a sincronização para (Perfil); o detalhe técnico vai para o log e para o Diagnóstico. As
 * frases que se alternavam na tela de carga saíram na T-0172: a tela de entrada mostra só o nome da etapa e o percentual.
 */
export function mensagemDeErroDaCarga(offline: boolean): string {
  return offline
    ? 'Você está no modo sem sinal. Desligue o modo sem sinal para baixar seus dados.'
    : 'Não conseguimos baixar seus dados. Confira o sinal e tente de novo.';
}
