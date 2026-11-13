/** Zip mínimo (cópia do criarZip do Conector: módulo não importa app). */
import { crc32, deflateRawSync } from 'node:zlib';

/** Zip mínimo (deflate, sem zip64, nomes UTF-8). entradas: [{ nome, dados: Buffer }]. */
export function criarZip(entradas) {
  const partes = [];
  const central = [];
  let deslocamento = 0;
  const dataDos = 0x5a21; // 2025-01-01: data fixa mantém o zip reprodutível
  for (const { nome, dados } of entradas) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comp = deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dataDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    partes.push(local, nomeBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(dataDos, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(nomeBuf.length, 28);
    c.writeUInt32LE(deslocamento, 42);
    central.push(c, nomeBuf);
    deslocamento += 30 + nomeBuf.length + comp.length;
  }
  const dirCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dirCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, dirCentral, fim]);
}
