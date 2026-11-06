/**
 * Codificador de QR Code pequeno e sem dependência (T-0087, portal `config.`: QR do cadastro do TOTP; ADR 0029 §3 aceitava o
 * pacote `qrcode`, mas o `otpauth://` cabe numa versão pequena e o código abaixo evita mexer no lockfile no dia do deploy).
 * Só o que o portal precisa: modo byte (UTF-8), correção de erro M (~15%), versões 1 a 10 (até 213 bytes). Segue a ISO/IEC 18004
 * na mesma estrutura do gerador de referência do Nayuki (MIT): dados → blocos com Reed-Solomon → intercalação → módulos em
 * zigue-zague → a máscara de menor penalidade → bits de formato e de versão.
 * Puro (sem DOM): `gerarQr` devolve a matriz; `caminhoSvgDoQr` devolve o `d` de um `<path>` (1 unidade = 1 módulo).
 */

/** Matriz do QR: `modulos[y][x]` verdadeiro = módulo escuro. */
export interface QrCodigo {
  versao: number;
  tamanho: number;
  mascara: number;
  modulos: boolean[][];
}

/** Correção M: codewords de correção por bloco e número de blocos, versões 1 a 10 (índice 0 sem uso). */
const ECC_POR_BLOCO_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
const BLOCOS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
export const VERSAO_MAXIMA_QR = 10;
/** Bits de formato do nível M (00); L=01, Q=11, H=10. */
const NIVEL_M = 0;

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** Módulos de dados (fora dos padrões fixos) da versão, em bits. */
export function modulosDeDados(versao: number): number {
  let r = (16 * versao + 128) * versao + 64;
  if (versao >= 2) {
    const n = Math.floor(versao / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (versao >= 7) r -= 36;
  }
  return r;
}

/** Codewords de dados (sem a correção) da versão no nível M. */
export function codewordsDeDados(versao: number): number {
  return Math.floor(modulosDeDados(versao) / 8) - (ECC_POR_BLOCO_M[versao] as number) * (BLOCOS_M[versao] as number);
}

/** Bits do contador de caracteres no modo byte: 8 até a versão 9; 16 da 10 à 26. */
const bitsDoContador = (versao: number): number => (versao <= 9 ? 8 : 16);

/** Maior quantidade de bytes que cabe na versão (nível M, modo byte). */
export function capacidadeEmBytes(versao: number): number {
  return Math.floor((codewordsDeDados(versao) * 8 - 4 - bitsDoContador(versao)) / 8);
}

// ---------------------------------------------------------------------------------------------------------------- Reed-Solomon

/** Multiplicação no GF(2^8) com o polinômio 0x11D. */
function multiplicarGf(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function divisorReedSolomon(grau: number): number[] {
  const r: number[] = new Array<number>(grau - 1).fill(0);
  r.push(1);
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicarGf(r[j] as number, raiz);
      if (j + 1 < r.length) r[j] = (r[j] as number) ^ (r[j + 1] as number);
    }
    raiz = multiplicarGf(raiz, 0x02);
  }
  return r;
}

export function restoReedSolomon(dados: readonly number[], divisor: readonly number[]): number[] {
  const r: number[] = divisor.map(() => 0);
  for (const b of dados) {
    const fator = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((coef, i) => {
      r[i] = (r[i] as number) ^ multiplicarGf(coef, fator);
    });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------- dados

/** Codewords de dados da versão: modo byte, contador, bytes, terminador, alinhamento e preenchimento 0xEC/0x11. */
export function codewordsDaMensagem(bytes: Uint8Array, versao: number): number[] {
  const bits: number[] = [];
  const por = (valor: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  por(0b0100, 4);
  por(bytes.length, bitsDoContador(versao));
  for (const b of bytes) por(b, 8);
  const capacidade = codewordsDeDados(versao) * 8;
  por(0, Math.min(4, capacidade - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  const r: number[] = [];
  for (let i = 0; i < bits.length; i += 8) r.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; r.length < capacidade / 8; pad ^= 0xec ^ 0x11) r.push(pad);
  return r;
}

/** Divide em blocos, calcula a correção de cada um e intercala (blocos curtos primeiro). */
export function intercalarComCorrecao(dados: readonly number[], versao: number): number[] {
  const nBlocos = BLOCOS_M[versao] as number;
  const eccLen = ECC_POR_BLOCO_M[versao] as number;
  const brutos = Math.floor(modulosDeDados(versao) / 8);
  const nCurtos = nBlocos - (brutos % nBlocos);
  const tamCurto = Math.floor(brutos / nBlocos);
  const divisor = divisorReedSolomon(eccLen);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const dat = dados.slice(k, k + tamCurto - eccLen + (i < nCurtos ? 0 : 1));
    k += dat.length;
    const ecc = restoReedSolomon(dat, divisor);
    if (i < nCurtos) dat.push(0);
    blocos.push([...dat, ...ecc]);
  }
  const r: number[] = [];
  const largura = (blocos[0] as number[]).length;
  for (let i = 0; i < largura; i++) {
    blocos.forEach((b, j) => {
      if (i !== tamCurto - eccLen || j >= nCurtos) r.push(b[i] as number);
    });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------- matriz

/** Bits de formato (15) do nível M com a máscara: BCH(15,5) com 0x537 e o XOR 0x5412. */
export function bitsDeFormato(mascara: number, nivel = NIVEL_M): number {
  const dados = (nivel << 3) | mascara;
  let rem = dados;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((dados << 10) | rem) ^ 0x5412;
}

/** Bits de versão (18), da versão 7 em diante: BCH(18,6) com 0x1F25. */
export function bitsDeVersao(versao: number): number {
  let rem = versao;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (versao << 12) | rem;
}

/** Centros dos padrões de alinhamento. */
export function posicoesDeAlinhamento(versao: number): number[] {
  if (versao === 1) return [];
  const n = Math.floor(versao / 7) + 2;
  const passo = Math.floor((versao * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let pos = versao * 4 + 17 - 7; r.length < n; pos -= passo) r.splice(1, 0, pos);
  return r;
}

const MASCARAS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matriz {
  readonly tamanho: number;
  readonly modulos: boolean[][];
  readonly funcao: boolean[][];

  constructor(readonly versao: number) {
    this.tamanho = versao * 4 + 17;
    this.modulos = Array.from({ length: this.tamanho }, () => new Array<boolean>(this.tamanho).fill(false));
    this.funcao = Array.from({ length: this.tamanho }, () => new Array<boolean>(this.tamanho).fill(false));
  }

  fixar(x: number, y: number, escuro: boolean) {
    (this.modulos[y] as boolean[])[x] = escuro;
    (this.funcao[y] as boolean[])[x] = true;
  }

  desenharPadroesFixos() {
    const t = this.tamanho;
    for (let i = 0; i < t; i++) {
      this.fixar(6, i, i % 2 === 0);
      this.fixar(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [t - 4, 3],
      [3, t - 4],
    ] as const) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < t && y >= 0 && y < t) this.fixar(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const pos = posicoesDeAlinhamento(this.versao);
    const ultimo = pos.length - 1;
    pos.forEach((px, i) => {
      pos.forEach((py, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.fixar(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    this.desenharFormato(0);
    if (this.versao >= 7) {
      const b = bitsDeVersao(this.versao);
      for (let i = 0; i < 18; i++) {
        const a = t - 11 + (i % 3);
        const c = Math.floor(i / 3);
        this.fixar(a, c, bit(b, i));
        this.fixar(c, a, bit(b, i));
      }
    }
  }

  desenharFormato(mascara: number) {
    const b = bitsDeFormato(mascara);
    const t = this.tamanho;
    for (let i = 0; i <= 5; i++) this.fixar(8, i, bit(b, i));
    this.fixar(8, 7, bit(b, 6));
    this.fixar(8, 8, bit(b, 7));
    this.fixar(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) this.fixar(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) this.fixar(t - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) this.fixar(8, t - 15 + i, bit(b, i));
    this.fixar(8, t - 8, true);
  }

  desenharCodewords(dados: readonly number[]) {
    const t = this.tamanho;
    let i = 0;
    for (let direita = t - 1; direita >= 1; direita -= 2) {
      if (direita === 6) direita = 5;
      for (let v = 0; v < t; v++) {
        for (let j = 0; j < 2; j++) {
          const x = direita - j;
          const subindo = ((direita + 1) & 2) === 0;
          const y = subindo ? t - 1 - v : v;
          if (!(this.funcao[y] as boolean[])[x] && i < dados.length * 8) {
            (this.modulos[y] as boolean[])[x] = bit(dados[i >>> 3] as number, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  aplicarMascara(m: number) {
    const f = MASCARAS[m] as (x: number, y: number) => boolean;
    for (let y = 0; y < this.tamanho; y++) {
      for (let x = 0; x < this.tamanho; x++) {
        if (!(this.funcao[y] as boolean[])[x] && f(x, y)) (this.modulos[y] as boolean[])[x] = !(this.modulos[y] as boolean[])[x];
      }
    }
  }

  /** Penalidade da ISO (N1 sequências, N2 blocos 2x2, N3 padrão parecido com o localizador, N4 equilíbrio). */
  penalidade(): number {
    const t = this.tamanho;
    const m = this.modulos;
    let p = 0;
    const linha = (ler: (i: number) => boolean) => {
      let corrida = 1;
      for (let i = 1; i < t; i++) {
        if (ler(i) === ler(i - 1)) {
          corrida++;
          if (corrida === 5) p += 3;
          else if (corrida > 5) p += 1;
        } else corrida = 1;
      }
      const padrao = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= t; i++) {
        if (!padrao.every((v, k) => ler(i + k) === v)) continue;
        const antes = i >= 4 && [1, 2, 3, 4].every((k) => !ler(i - k));
        const depois = i + 11 <= t && [7, 8, 9, 10].every((k) => !ler(i + k));
        if (antes || depois) p += 40;
      }
    };
    for (let y = 0; y < t; y++) linha((x) => (m[y] as boolean[])[x] as boolean);
    for (let x = 0; x < t; x++) linha((y) => (m[y] as boolean[])[x] as boolean);
    for (let y = 0; y + 1 < t; y++) {
      for (let x = 0; x + 1 < t; x++) {
        const c = (m[y] as boolean[])[x];
        if (c === (m[y] as boolean[])[x + 1] && c === (m[y + 1] as boolean[])[x] && c === (m[y + 1] as boolean[])[x + 1]) p += 3;
      }
    }
    const escuros = m.reduce((a, l) => a + l.filter(Boolean).length, 0);
    const total = t * t;
    p += Math.floor(Math.abs(escuros * 20 - total * 10) / total) * 10;
    return p;
  }
}

/** Menor versão (1 a 10) em que os bytes cabem; `null` = não cabe. */
export function versaoParaBytes(n: number): number | null {
  for (let v = 1; v <= VERSAO_MAXIMA_QR; v++) if (n <= capacidadeEmBytes(v)) return v;
  return null;
}

/** Gera o QR do texto (UTF-8, nível M). Lança erro se passar de 213 bytes. `mascara` fixa a máscara (testes). */
export function gerarQr(texto: string, opcoes: { mascara?: number } = {}): QrCodigo {
  const bytes = new TextEncoder().encode(texto);
  const versao = versaoParaBytes(bytes.length);
  if (versao === null) throw new Error(`Texto grande demais para o QR (${bytes.length} bytes; máximo ${capacidadeEmBytes(VERSAO_MAXIMA_QR)}).`);
  const codewords = intercalarComCorrecao(codewordsDaMensagem(bytes, versao), versao);
  const base = new Matriz(versao);
  base.desenharPadroesFixos();
  base.desenharCodewords(codewords);

  const tentar = (m: number): Matriz => {
    const q = new Matriz(versao);
    for (let y = 0; y < q.tamanho; y++) {
      (q.modulos[y] as boolean[]).splice(0, q.tamanho, ...(base.modulos[y] as boolean[]));
      (q.funcao[y] as boolean[]).splice(0, q.tamanho, ...(base.funcao[y] as boolean[]));
    }
    q.aplicarMascara(m);
    q.desenharFormato(m);
    return q;
  };
  let melhor: { m: number; q: Matriz; p: number } | null = null;
  const candidatas = opcoes.mascara !== undefined ? [opcoes.mascara] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const m of candidatas) {
    const q = tentar(m);
    const p = q.penalidade();
    if (!melhor || p < melhor.p) melhor = { m, q, p };
  }
  const escolhida = melhor as { m: number; q: Matriz; p: number };
  return { versao, tamanho: escolhida.q.tamanho, mascara: escolhida.m, modulos: escolhida.q.modulos };
}

/** `d` de um `<path>` SVG com um quadrado por módulo escuro, deslocado pela margem (zona de silêncio). */
export function caminhoSvgDoQr(qr: QrCodigo, margem = 4): string {
  const partes: string[] = [];
  qr.modulos.forEach((linha, y) => {
    linha.forEach((escuro, x) => {
      if (escuro) partes.push(`M${x + margem} ${y + margem}h1v1h-1z`);
    });
  });
  return partes.join('');
}
