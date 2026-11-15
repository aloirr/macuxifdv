/**
 * Laço dos workers (gerador de pacotes, agendador, diagnósticos): ciclo na subida e depois a cada `intervaloMs`.
 * Erro do ciclo vai para `aoFalhar` e o laço segue. O timer não segura o processo (`unref`); `parar()` espera o ciclo em curso.
 * `ligado: false` = não roda nem liga timer (ex.: agendador sem tarefa).
 */
export function iniciarLaco(o: {
  ciclo: () => Promise<void>;
  intervaloMs: number;
  aoFalhar: (e: unknown) => void;
  ligado?: boolean;
}): { parar(): Promise<void> } {
  let ativo = o.ligado ?? true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let atual: Promise<void> = Promise.resolve();
  const passo = async (): Promise<void> => {
    try {
      await o.ciclo();
    } catch (e) {
      o.aoFalhar(e);
    }
    if (ativo) {
      timer = setTimeout(() => (atual = passo()), o.intervaloMs);
      // Sob a lib DOM (tests/tsconfig) o retorno é number; em Node é Timeout com unref (não segura o processo).
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  };
  if (ativo) atual = passo();
  return {
    async parar() {
      ativo = false;
      if (timer) clearTimeout(timer);
      await atual;
    },
  };
}
