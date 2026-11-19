/**
 * Texto do termo de ciência para a tela (T-0156; spec `docs/design/tracking/spec.md` §1): o texto publicado pela empresa, como veio do pull,
 * em parágrafos e itens de lista (linhas iniciadas por "- " ou "• "), com **negrito**. O app não corta, não resume e não reescreve.
 */
export interface ParteDoTermo {
  texto: string;
  negrito: boolean;
}
export interface BlocoDoTermo {
  tipo: 'paragrafo' | 'item';
  partes: ParteDoTermo[];
}

/** Divide uma linha em partes normais e em negrito (`**x**`); marcador sem par fica como texto. */
export function partesDaLinha(linha: string): ParteDoTermo[] {
  const partes: ParteDoTermo[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let ultimo = 0;
  for (const m of linha.matchAll(re)) {
    if (m.index > ultimo) partes.push({ texto: linha.slice(ultimo, m.index), negrito: false });
    partes.push({ texto: m[1]!, negrito: true });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < linha.length) partes.push({ texto: linha.slice(ultimo), negrito: false });
  return partes;
}

export function blocosDoTermo(texto: string): BlocoDoTermo[] {
  const blocos: BlocoDoTermo[] = [];
  let paragrafo: string[] = [];
  const fechar = () => {
    if (paragrafo.length > 0) blocos.push({ tipo: 'paragrafo', partes: partesDaLinha(paragrafo.join(' ')) });
    paragrafo = [];
  };
  for (const bruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = bruta.trim();
    if (linha === '') fechar();
    else if (/^[-•]\s+/.test(linha)) {
      fechar();
      blocos.push({ tipo: 'item', partes: partesDaLinha(linha.replace(/^[-•]\s+/, '')) });
    } else paragrafo.push(linha);
  }
  fechar();
  return blocos;
}

/** Divide um texto nas ocorrências de "Meu trajeto" (viram link no termo só leitura). */
export function partesComLinkDoTrajeto(texto: string): Array<{ texto: string; link: boolean }> {
  return texto
    .split(/(Meu trajeto)/)
    .filter((p) => p !== '')
    .map((p) => ({ texto: p, link: p === 'Meu trajeto' }));
}
