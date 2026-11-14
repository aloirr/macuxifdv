/**
 * Leituras de recado feitas neste aparelho (RF-CORE-09), compartilhadas por todas as instâncias de `useNotificacoes`.
 *
 * Defeito que isto corrige: o "1" do sino só sumia na segunda abertura do recado. O sync solta o aceito
 * (`liberarAceitos`) antes de gravar `sincronizado_em`, e o hook só relê as linhas de `notificacao` depois disso, de forma
 * assíncrona. Nesse intervalo a caixa era montada com a linha antiga (`lida_em` nulo) e sem a leitura na fila, e o recado
 * voltava a "não lido". Aqui a leitura fica guardada no aparelho até o servidor devolver a linha com `lida_em`.
 * A lista é por motor (WeakMap): trocar de usuário cria outro motor e começa vazia.
 */
export interface LeiturasLocais {
  /** Nova a cada mudança (identidade estável entre mudanças, para `useSyncExternalStore`). */
  lidas(): ReadonlyMap<string, string>;
  /** A primeira hora vale; repetir não muda nem avisa. */
  registrar(id: string, lidaEm: string): void;
  desfazer(id: string): void;
  assinar(fn: () => void): () => void;
}

export function criarLeiturasLocais(): LeiturasLocais {
  let atual: ReadonlyMap<string, string> = new Map();
  const ouvintes = new Set<() => void>();
  const trocar = (proxima: Map<string, string>) => {
    atual = proxima;
    for (const fn of [...ouvintes]) fn();
  };
  return {
    lidas: () => atual,
    registrar(id, lidaEm) {
      if (atual.has(id)) return;
      trocar(new Map(atual).set(id, lidaEm));
    },
    desfazer(id) {
      if (!atual.has(id)) return;
      const proxima = new Map(atual);
      proxima.delete(id);
      trocar(proxima);
    },
    assinar(fn) {
      ouvintes.add(fn);
      return () => {
        ouvintes.delete(fn);
      };
    },
  };
}

const porMotor = new WeakMap<object, LeiturasLocais>();

export function leiturasDoMotor(motor: object): LeiturasLocais {
  let l = porMotor.get(motor);
  if (!l) {
    l = criarLeiturasLocais();
    porMotor.set(motor, l);
  }
  return l;
}
