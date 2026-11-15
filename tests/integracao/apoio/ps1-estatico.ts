/**
 * T-0174 — checagem estática dos .ps1 dos kits (camada 2 do `tests/integracao/kits-ps1-parse.test.ts`).
 *
 * Acusa, dentro de strings de aspas duplas (inclusive here-strings @"..."@ e strings dentro de $(...)), a referência
 * `$nome:` em que o `:` não forma escopo/drive válido. Foi o defeito do kit da thathyany (1.0.0, linha 243):
 * `"Conector $versao: ..."` — o PowerShell lê `$versao:` como variável com escopo/drive e o parse falha no 5.1.
 * O certo é `"${versao}: ..."`.
 *
 * Aceita `$env:`, `$script:`, `$global:`, `$local:`, `$private:`, `$using:`, `$variable:` e `$function:` seguidos de um
 * nome; `${...}`, `$(...)` e o `$` escapado com crase. Ignora comentários (`#` de linha e `<# #>`) e strings de aspas
 * simples (inclusive @'...'@). Não substitui o parser real (camada 1, com pwsh): é a rede que roda sempre.
 */

export interface AchadoPs1 {
  linha: number;
  coluna: number;
  trecho: string;
  mensagem: string;
}

const ESCOPOS_VALIDOS = new Set(['env', 'script', 'global', 'local', 'private', 'using', 'variable', 'function']);
// Aspas que o PowerShell aceita (ASCII e as tipográficas que ele também reconhece).
const DUPLAS = new Set(['"', '\u201C', '\u201D', '\u201E']);
const SIMPLES = new Set(["'", '\u2018', '\u2019', '\u201A', '\u201B']);
const CARACTER_DE_NOME = /[\p{L}\p{Nd}_]/u;
// `#` só abre comentário no início de um token (o `a#b` é uma palavra só).
const ANTES_DE_COMENTARIO = /[\s;(){}|,=]/;

export function checarPs1(fonte: string): AchadoPs1[] {
  const texto = fonte.replace(/^\uFEFF/, '');
  const achados: AchadoPs1[] = [];
  const inicioDasLinhas = [0];
  for (let i = 0; i < texto.length; i++) if (texto[i] === '\n') inicioDasLinhas.push(i + 1);
  const posicao = (i: number): { linha: number; coluna: number } => {
    let baixo = 0;
    let alto = inicioDasLinhas.length - 1;
    while (baixo < alto) {
      const meio = (baixo + alto + 1) >> 1;
      if (inicioDasLinhas[meio]! <= i) baixo = meio;
      else alto = meio - 1;
    }
    return { linha: baixo + 1, coluna: i - inicioDasLinhas[baixo]! + 1 };
  };

  const fimDaLinha = (i: number): number => {
    const n = texto.indexOf('\n', i);
    return n === -1 ? texto.length : n;
  };

  // `$` dentro de string expansível em `i`; devolve o índice seguinte ao que foi consumido.
  const variavelNaString = (i: number): number => {
    const prox = texto[i + 1];
    if (prox === '(') return codigo(i + 2, true);
    if (prox === '{') {
      const fim = texto.indexOf('}', i + 2);
      return fim === -1 ? texto.length : fim + 1;
    }
    let j = i + 1;
    while (j < texto.length && CARACTER_DE_NOME.test(texto[j]!)) j++;
    if (j === i + 1 || texto[j] !== ':') return j;
    const nome = texto.slice(i + 1, j);
    const depois = texto[j + 1];
    const temNome = depois !== undefined && (CARACTER_DE_NOME.test(depois) || depois === '{');
    if (!ESCOPOS_VALIDOS.has(nome.toLowerCase())) {
      achados.push({
        ...posicao(i),
        trecho: `$${nome}:`,
        mensagem: `"$${nome}:" em string de aspas duplas: o PowerShell lê como escopo/drive "${nome}:" e o parse falha. Use "\${${nome}}:".`,
      });
    } else if (!temNome) {
      achados.push({
        ...posicao(i),
        trecho: `$${nome}:`,
        mensagem: `"$${nome}:" sem nome de variável depois do ":" (o parse falha). Use "\${${nome}}:" ou complete o nome.`,
      });
    }
    return j + 1;
  };

  // String de aspas duplas (ou here-string @"..."@) começando DEPOIS da abertura em `i`.
  const stringDupla = (i: number, here: boolean): number => {
    let k = i;
    while (k < texto.length) {
      const c = texto[k]!;
      if (c === '`') {
        k += 2;
        continue;
      }
      if (here) {
        if (c === '\n' && DUPLAS.has(texto[k + 1] ?? '') && texto[k + 2] === '@') return k + 3;
      } else if (DUPLAS.has(c)) {
        if (DUPLAS.has(texto[k + 1] ?? '')) {
          k += 2; // "" = aspas escapadas
          continue;
        }
        return k + 1;
      }
      if (c === '$') {
        k = variavelNaString(k);
        continue;
      }
      k++;
    }
    return k;
  };

  const stringSimples = (i: number, here: boolean): number => {
    let k = i;
    while (k < texto.length) {
      const c = texto[k]!;
      if (here) {
        if (c === '\n' && SIMPLES.has(texto[k + 1] ?? '') && texto[k + 2] === '@') return k + 3;
      } else if (SIMPLES.has(c)) {
        if (SIMPLES.has(texto[k + 1] ?? '')) {
          k += 2; // '' = aspa escapada
          continue;
        }
        return k + 1;
      }
      k++;
    }
    return k;
  };

  // Modo código. Com `subexpressao`, para no `)` que fecha o `$(` e devolve o índice seguinte.
  function codigo(i: number, subexpressao: boolean): number {
    let k = i;
    let parenteses = 0;
    while (k < texto.length) {
      const c = texto[k]!;
      const anterior = k === 0 ? '\n' : texto[k - 1]!;
      if (c === '`') {
        k += 2;
      } else if (c === '<' && texto[k + 1] === '#') {
        const fim = texto.indexOf('#>', k + 2);
        k = fim === -1 ? texto.length : fim + 2;
      } else if (c === '#' && ANTES_DE_COMENTARIO.test(anterior)) {
        k = fimDaLinha(k);
      } else if (c === '@' && DUPLAS.has(texto[k + 1] ?? '') && /^[ \t]*\r?\n/.test(texto.slice(k + 2, k + 40))) {
        k = stringDupla(fimDaLinha(k + 2), true);
      } else if (c === '@' && SIMPLES.has(texto[k + 1] ?? '') && /^[ \t]*\r?\n/.test(texto.slice(k + 2, k + 40))) {
        k = stringSimples(fimDaLinha(k + 2), true);
      } else if (DUPLAS.has(c)) {
        k = stringDupla(k + 1, false);
      } else if (SIMPLES.has(c)) {
        k = stringSimples(k + 1, false);
      } else if (c === '(') {
        parenteses++;
        k++;
      } else if (c === ')') {
        if (subexpressao && parenteses === 0) return k + 1;
        parenteses--;
        k++;
      } else {
        k++;
      }
    }
    return k;
  }

  codigo(0, false);
  return achados;
}
