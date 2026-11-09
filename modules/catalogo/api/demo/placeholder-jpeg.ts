/**
 * Foto de produto GERADA para a base demo (T-0097; sem imagem de marca real): 320 x 320 px, fundo na cor da categoria e o
 * nome do produto em letras brancas. Codificador JPEG baseline mínimo (sem dependência), determinístico: a mesma entrada
 * dá sempre os mesmos bytes (o upload é idempotente por sha256). Cabe com folga no teto de 30 KB da miniatura.
 * Só ASCII maiúsculo, dígitos e `.-/`; acento é removido e o resto vira espaço.
 */
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../../contracts';
import { semAcento } from '../../domain/texto';

export type Rgb = readonly [number, number, number];

const CORES: readonly Rgb[] = [
  [183, 28, 28],
  [21, 101, 192],
  [46, 125, 50],
  [239, 108, 0],
  [106, 27, 154],
  [0, 131, 143],
  [173, 20, 87],
  [78, 52, 46],
];
const NEUTRA: Rgb = [96, 106, 120];

/** Cor estável da categoria (hash do texto sem acento, caixa e espaços); categoria vazia = cinza neutro. */
export function corDaCategoria(categoria: string): Rgb {
  const chave = semAcento(categoria).trim().toUpperCase();
  if (chave === '') return NEUTRA;
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length]!;
}


// ---------- fonte 5 x 7 ----------
const FONTE: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '.': '00000 00000 00000 00000 00000 00000 00100',
  '/': '00001 00010 00010 00100 01000 01000 10000',
};

const LADO = LADO_MAX_MINIATURA_PX;
const ESCALA = 5;
const LARGURA_CHAR = 6 * ESCALA; // 5 colunas + 1 de espaço
const COLUNAS = Math.floor((LADO - 2 * 16) / LARGURA_CHAR);
const ALTURA_LINHA = 9 * ESCALA;
const MAX_LINHAS = 5;

/** Quebra o nome em linhas de até `COLUNAS` letras, sem partir palavras (palavra maior que a linha é cortada). */
export function quebrarNome(nome: string): string[] {
  const palavras = semAcento(nome)
    .toUpperCase()
    .replace(/[^A-Z0-9.\-/ ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p !== '');
  const linhas: string[] = [];
  let atual = '';
  for (const bruta of palavras) {
    const p = bruta.slice(0, COLUNAS);
    if (atual === '') atual = p;
    else if (atual.length + 1 + p.length <= COLUNAS) atual += ` ${p}`;
    else {
      linhas.push(atual);
      atual = p;
    }
  }
  if (atual !== '') linhas.push(atual);
  return linhas.slice(0, MAX_LINHAS);
}

/** Máscara de texto (1 = letra) em LADO x LADO. */
function mascaraDoTexto(linhas: string[]): Uint8Array {
  const m = new Uint8Array(LADO * LADO);
  const topo = Math.floor((LADO - linhas.length * ALTURA_LINHA) / 2);
  linhas.forEach((linha, li) => {
    const esq = Math.floor((LADO - linha.length * LARGURA_CHAR) / 2);
    [...linha].forEach((ch, ci) => {
      const g = FONTE[ch];
      if (!g) return;
      g.split(' ').forEach((bits, ry) => {
        for (let rx = 0; rx < 5; rx++) {
          if (bits[rx] !== '1') continue;
          for (let dy = 0; dy < ESCALA; dy++)
            for (let dx = 0; dx < ESCALA; dx++) m[(topo + li * ALTURA_LINHA + ry * ESCALA + dy) * LADO + esq + ci * LARGURA_CHAR + rx * ESCALA + dx] = 1;
        }
      });
    });
  });
  return m;
}

// ---------- codificador JPEG baseline (4:4:4, tabelas Huffman padrão de luminância para os 3 canais) ----------
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23,
  30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
  0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const QUANT = 32; // tabela plana: bordas do texto legíveis e arquivo pequeno

function tabelaHuffman(bits: number[], vals: number[]): Map<number, { codigo: number; tam: number }> {
  const t = new Map<number, { codigo: number; tam: number }>();
  let codigo = 0;
  let k = 0;
  for (let tam = 1; tam <= 16; tam++) {
    for (let i = 0; i < bits[tam - 1]!; i++) t.set(vals[k++]!, { codigo: codigo++, tam });
    codigo <<= 1;
  }
  return t;
}
const DC = tabelaHuffman(DC_BITS, DC_VALS);
const AC = tabelaHuffman(AC_BITS, AC_VALS);

class Bits {
  readonly bytes: number[] = [];
  private acc = 0;
  private n = 0;
  escrever(valor: number, tam: number): void {
    for (let i = tam - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((valor >> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        if (this.acc === 0xff) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  fechar(): void {
    if (this.n > 0) this.escrever(0x7f, 8 - this.n);
  }
}

const COS: number[][] = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) * 0.5));

function dct(bloco: number[]): number[] {
  const tmp = new Array<number>(64).fill(0);
  const out = new Array<number>(64).fill(0);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) tmp[y * 8 + u]! += bloco[y * 8 + x]! * COS[x]![u]!;
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) for (let y = 0; y < 8; y++) out[v * 8 + u]! += tmp[y * 8 + u]! * COS[y]![v]!;
  return out;
}

const categoria = (v: number): number => (v === 0 ? 0 : Math.floor(Math.log2(Math.abs(v))) + 1);
function codificarValor(b: Bits, v: number, tam: number): void {
  if (tam > 0) b.escrever(v >= 0 ? v : v + (1 << tam) - 1, tam);
}

function cabecalho(): number[] {
  const u16 = (n: number) => [n >> 8, n & 0xff];
  const h: number[] = [0xff, 0xd8];
  h.push(0xff, 0xdb, ...u16(67), 0, ...new Array<number>(64).fill(QUANT));
  h.push(0xff, 0xc0, ...u16(17), 8, ...u16(LADO), ...u16(LADO), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0);
  h.push(0xff, 0xc4, ...u16(19 + DC_VALS.length), 0x00, ...DC_BITS, ...DC_VALS);
  h.push(0xff, 0xc4, ...u16(19 + AC_VALS.length), 0x10, ...AC_BITS, ...AC_VALS);
  h.push(0xff, 0xda, ...u16(12), 3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0);
  return h;
}

export interface EntradaPlaceholder {
  nome: string;
  categoria: string;
}

export function gerarPlaceholderJpeg(e: EntradaPlaceholder): Uint8Array {
  const fundo = corDaCategoria(e.categoria);
  const texto = mascaraDoTexto(quebrarNome(e.nome));
  const planos = [0, 1, 2].map(() => new Float64Array(LADO * LADO));
  const ycc = (r: number, g: number, b: number): [number, number, number] => [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
    0.5 * r - 0.418688 * g - 0.081312 * b + 128,
  ];
  const yF = ycc(...fundo);
  const yT = ycc(255, 255, 255);
  for (let i = 0; i < LADO * LADO; i++) {
    const c = texto[i] ? yT : yF;
    planos[0]![i] = c[0];
    planos[1]![i] = c[1];
    planos[2]![i] = c[2];
  }
  const b = new Bits();
  const dcAnterior = [0, 0, 0];
  const bloco = new Array<number>(64);
  for (let by = 0; by < LADO; by += 8) {
    for (let bx = 0; bx < LADO; bx += 8) {
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bloco[y * 8 + x] = planos[c]![(by + y) * LADO + bx + x]! - 128;
        const q = dct(bloco).map((v) => Math.round(v / QUANT));
        const z = ZIGZAG.map((i) => q[i]!);
        const diff = z[0]! - dcAnterior[c]!;
        dcAnterior[c] = z[0]!;
        const tamDc = categoria(diff);
        const hdc = DC.get(tamDc)!;
        b.escrever(hdc.codigo, hdc.tam);
        codificarValor(b, diff, tamDc);
        let zeros = 0;
        for (let k = 1; k < 64; k++) {
          const v = z[k]!;
          if (v === 0) {
            zeros++;
            continue;
          }
          while (zeros > 15) {
            const zrl = AC.get(0xf0)!;
            b.escrever(zrl.codigo, zrl.tam);
            zeros -= 16;
          }
          const tam = categoria(v);
          const h = AC.get((zeros << 4) | tam)!;
          b.escrever(h.codigo, h.tam);
          codificarValor(b, v, tam);
          zeros = 0;
        }
        if (zeros > 0) {
          const eob = AC.get(0x00)!;
          b.escrever(eob.codigo, eob.tam);
        }
      }
    }
  }
  b.fechar();
  const saida = Uint8Array.from([...cabecalho(), ...b.bytes, 0xff, 0xd9]);
  if (saida.length > BYTES_MAX_MINIATURA) throw new Error('Foto gerada acima do teto da miniatura.');
  return saida;
}
