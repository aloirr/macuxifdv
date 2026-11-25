/**
 * RN-VEN-48: a trava única contra o duplo toque no "Enviar pedido" da aba Pedidos, por chave do pedido salvo. Pura, sem React:
 * o hook guarda uma instância; o 2º toque com o 1º em curso devolve `false` e a tela o ignora, sem aviso e sem nada na fila.
 */
export interface TravaDeEnvio {
  /** `true` = pode seguir (a chave ficou presa); `false` = já há um envio dessa chave em curso */
  prender(chave: string): boolean;
  soltar(chave: string): void;
}

export function criarTravaDeEnvio(): TravaDeEnvio {
  const emCurso = new Set<string>();
  return {
    prender(chave) {
      if (emCurso.has(chave)) return false;
      emCurso.add(chave);
      return true;
    },
    soltar(chave) {
      emCurso.delete(chave);
    },
  };
}
