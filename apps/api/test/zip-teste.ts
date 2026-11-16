/**
 * Monta ZIPs de teste em memória (cabeçalhos locais, diretório central e fim do diretório), com como mexer no que é
 * declarado: CRC, tamanhos, método, bits de flag e ZIP64 — para os casos de ZIP malformado e zip bomb (ADR 0058 §3).
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface EntradaTeste {
  nome: string;
  dados?: Uint8Array;
  /** 0 = stored, 8 = deflate (padrão). */
  metodo?: number;
  /** Bits do campo de flags (bit 0 = criptografada; o bit 11 = UTF-8 entra sozinho em nome não ASCII). */
  flags?: number;
  /** Sobrescreve o que o diretório central declara. */
  crc?: number;
  compactado?: number;
  descompactado?: number;
  /** Nome em bytes crus (ex.: CP437), em vez do UTF-8 de `nome`. */
  nomeBytes?: Uint8Array;
}

const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};

export function montarZip(entradas: readonly EntradaTeste[], op: { zip64?: boolean; comentario?: string; discos?: boolean } = {}): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const dados = Buffer.from(e.dados ?? new Uint8Array());
    const metodo = e.metodo ?? 8;
    const comp = metodo === 8 ? deflateRawSync(dados) : dados;
    const nome = e.nomeBytes ? Buffer.from(e.nomeBytes) : Buffer.from(e.nome, 'utf8');
    const utf8 = !e.nomeBytes && /[^\x20-\x7e]/.test(e.nome) ? 0x0800 : 0;
    const flags = (e.flags ?? 0) | utf8;
    const crc = e.crc ?? crc32(dados);
    const tc = e.compactado ?? comp.length;
    const td = e.descompactado ?? dados.length;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(metodo), u16(0), u16(0x21), u32(crc), u32(tc), u32(td), u16(nome.length), u16(0), nome, comp]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(metodo), u16(0), u16(0x21), u32(crc), u32(tc), u32(td),
      u16(nome.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(deslocamento), nome,
    ]);
    locais.push(local);
    centrais.push(central);
    deslocamento += local.length;
  }
  const cd = Buffer.concat(centrais);
  const comentario = Buffer.from(op.comentario ?? '', 'utf8');
  const n = op.zip64 ? 0xffff : entradas.length;
  const disco = op.discos ? 1 : 0;
  const fim = Buffer.concat([u32(0x06054b50), u16(disco), u16(disco), u16(n), u16(n), u32(cd.length), u32(deslocamento), u16(comentario.length), comentario]);
  return Buffer.concat([...locais, cd, fim]);
}
