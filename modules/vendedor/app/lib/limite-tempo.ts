/** Limite de tempo para promessas que podem não voltar (ex.: módulo nativo de PDF no Android). Puro, sem React Native. */
export class ErroTempoEsgotado extends Error {
  constructor(public readonly operacao: string) {
    super(`Tempo esgotado: ${operacao}`);
    this.name = 'ErroTempoEsgotado';
  }
}

/** Rejeita com `ErroTempoEsgotado` se `promessa` não resolver em `ms`; limpa o timer ao terminar. */
export function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number, operacao: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ErroTempoEsgotado(operacao)), ms);
    promessa.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Resolve com 'aberto' se `promessa` ainda não terminou em `ms` (o diálogo do sistema segue aberto); repassa erro que vier antes. */
export function aguardarAteAbrir<T>(promessa: Promise<T>, ms: number): Promise<'concluido' | 'aberto'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('aberto'), ms);
    promessa.then(
      () => {
        clearTimeout(timer);
        resolve('concluido');
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const MENSAGEM_PDF_FALHA = 'Não foi possível gerar o PDF. Tente de novo.';
