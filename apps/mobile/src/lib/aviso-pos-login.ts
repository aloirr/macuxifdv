/**
 * Aviso que a primeira tela depois do login mostra uma vez (T-0094, spec docs/design/ciclo-de-senha.md §2: "Senha criada." no
 * rodapé do Início, com vibração leve). Só na memória do processo: nunca em disco, e nunca senha.
 */
let pendente: string | null = null;

export function guardarAvisoPosLogin(texto: string): void {
  pendente = texto;
}

/** Lê e apaga: o aviso aparece uma vez. */
export function consumirAvisoPosLogin(): string | null {
  const t = pendente;
  pendente = null;
  return t;
}
