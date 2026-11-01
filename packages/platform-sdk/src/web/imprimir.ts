/**
 * PDF no BKO pelo diálogo de impressão do navegador ("Salvar como PDF"; desenho T-0029 §9, P-5): o mesmo HTML puro que o
 * app usa no `expo-print` vai para um iframe oculto, e o navegador imprime só o iframe. Sem dependência e sem servidor.
 *
 * - O `titulo` vira o `<title>` do iframe e, durante a impressão, o da página: é o nome de arquivo que o navegador sugere.
 * - O iframe sai do documento no `afterprint` (ou, se o navegador não avisar, depois de `limpezaMs`).
 * - O HTML tem de vir do gerador do domínio (texto já escapado); nada aqui interpreta dado do usuário.
 */

/** Subconjunto do DOM usado (o teste injeta um DOM simulado). */
export interface DocumentoImpressao {
  title: string;
  body: { appendChild(n: unknown): unknown };
  createElement(tag: 'iframe'): IframeImpressao;
}

export interface IframeImpressao {
  setAttribute(nome: string, valor: string): void;
  style: Record<string, string> | CSSStyleDeclaration;
  srcdoc: string;
  onload: (() => void) | null;
  remove(): void;
  contentDocument: { title: string } | null;
  contentWindow: {
    focus(): void;
    print(): void;
    addEventListener(tipo: 'afterprint', fn: () => void, op?: { once?: boolean }): void;
  } | null;
}

export interface OpcoesImpressao {
  /** Padrão: `globalThis.document`. */
  documento?: DocumentoImpressao;
  /** Remoção de segurança do iframe se o `afterprint` não vier (padrão 60 s). */
  limpezaMs?: number;
}

/**
 * Abre o diálogo de impressão com `html`. Resolve quando o diálogo foi pedido ao navegador; rejeita sem DOM ou se o
 * navegador recusar a impressão (o iframe é removido nos dois casos).
 */
export function imprimirHtml(html: string, titulo: string, op: OpcoesImpressao = {}): Promise<void> {
  const doc = op.documento ?? (globalThis as { document?: DocumentoImpressao }).document;
  if (!doc) return Promise.reject(new Error('Impressão só no navegador.'));
  const limpezaMs = op.limpezaMs ?? 60_000;
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('title', titulo);
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  const tituloOriginal = doc.title;
  let removido = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limpar = () => {
    if (removido) return;
    removido = true;
    if (timer) clearTimeout(timer);
    doc.title = tituloOriginal;
    iframe.remove();
  };
  return new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      try {
        const janela = iframe.contentWindow;
        if (!janela) throw new Error('O navegador não abriu a impressão.');
        if (iframe.contentDocument) iframe.contentDocument.title = titulo;
        doc.title = titulo;
        janela.addEventListener('afterprint', limpar, { once: true });
        timer = setTimeout(limpar, limpezaMs);
        janela.focus();
        janela.print();
        resolve();
      } catch (e) {
        limpar();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    iframe.srcdoc = html;
    doc.body.appendChild(iframe);
  });
}
