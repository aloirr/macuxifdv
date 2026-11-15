/**
 * Leitor de ZIP seguro do trabalho (ADR 0058 §3; RN-CAT-14), sem dependência nova: `node:fs` (acesso aleatório ao temporário)
 * e `node:zlib` (`inflateRawSync` com `maxOutputLength` e `crc32`).
 *
 * 1. `juntarPartes`: lê as partes de 8 MiB do armazenamento, uma por vez, e grava num temporário do worker calculando o
 *    SHA-256 do ZIP (nunca mais de uma parte em memória). Parte faltando ou tamanho diferente do `concluir` → `zip_incompleto`.
 * 2. `abrirZipLocal`: acha o fim do diretório central (com comentário), recusa ZIP64, vários discos, diretório fora do
 *    arquivo e mais de `ENTRADAS_BRUTAS_MAX` entradas; lê as entradas (nome UTF-8 com o bit 11, senão CP437; NFC) e aplica
 *    `classificarEntradaZip` do SDK: mais considerados que `arquivosMax` → `muitos_arquivos`; soma declarada dos aceitos
 *    acima de `bytesDescompactadosMax` → `descompactado_grande`.
 * 3. `ler(indice)`: reclassifica a entrada, confere o cabeçalho local, descompacta só até o tamanho DECLARADO (já dentro do
 *    teto e da razão) e confere tamanho real e CRC-32 (`entrada_corrompida`); tipo pela assinatura (`tipo_nao_aceito` fora
 *    da lista do módulo ou sem decodificador) e dimensões do cabeçalho dentro do teto (`foto_ilegivel`).
 * Nada é escrito a partir do nome da entrada. Logs ficam com quem chama (sem nome de arquivo).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  classificarEntradaZip,
  detectarTipoImagem,
  dimensoesImagem,
  ENTRADAS_BRUTAS_MAX,
  PARTE_ENVIO_BYTES,
  partesDoEnvio,
  type EntradaZip,
  type LeituraEntradaZip,
  type LimitesZip,
  type MotivoRecusaZip,
  type TipoImagem,
  type ZipAberto,
} from '@macuxi/platform-sdk';
import { chaveDaParte, type ArmazenamentoArquivos } from './arquivos';
import { MAX_MEGAPIXELS } from './miniatura';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIM = 0x06054b50;
const SIG_LOCALIZADOR_ZIP64 = 0x07064b50;
const FIM_MIN = 22;
const COMENTARIO_MAX = 0xffff;

/** Junta as partes num arquivo local (`destino`, sobrescrito) e devolve o SHA-256 do ZIP. */
export async function juntarPartes(o: {
  armazenamento: ArmazenamentoArquivos;
  chaveParte1: string;
  tamanhoBytes: number;
  destino: string;
}): Promise<{ ok: true; sha256: string } | { ok: false; motivo: 'zip_incompleto' }> {
  const partes = partesDoEnvio(o.tamanhoBytes);
  const hash = createHash('sha256');
  const f = await open(o.destino, 'w');
  let total = 0;
  try {
    for (let i = 1; i <= partes; i += 1) {
      const bytes = await o.armazenamento.ler(chaveDaParte(o.chaveParte1, i));
      const esperado = i < partes ? PARTE_ENVIO_BYTES : o.tamanhoBytes - PARTE_ENVIO_BYTES * (partes - 1);
      if (!bytes || bytes.length !== esperado) return { ok: false, motivo: 'zip_incompleto' };
      hash.update(bytes);
      await f.write(bytes);
      total += bytes.length;
    }
  } finally {
    await f.close();
  }
  if (total !== o.tamanhoBytes) return { ok: false, motivo: 'zip_incompleto' };
  return { ok: true, sha256: hash.digest('hex') };
}

/** SHA-256 de um arquivo local, em fluxo. */
async function sha256DoArquivo(caminho: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco as Buffer);
  return hash.digest('hex');
}

// CP437 de 0x80 a 0xFF (nome sem o bit 11 de UTF-8: ZIP do Windows antigo)
const CP437_ALTO =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function nomeDaEntrada(bytes: Uint8Array, utf8: boolean): string {
  const s = utf8 ? new TextDecoder('utf-8').decode(bytes) : Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : CP437_ALTO[b - 0x80]!)).join('');
  return s.normalize('NFC');
}

async function lerEm(f: FileHandle, posicao: number, tamanho: number): Promise<Buffer> {
  const b = Buffer.alloc(tamanho);
  const { bytesRead } = await f.read(b, 0, tamanho, posicao);
  return bytesRead === tamanho ? b : b.subarray(0, bytesRead);
}

type Recusa = { ok: false; motivo: MotivoRecusaZip };

interface Diretorio {
  entradas: EntradaZip[];
  deslocamentos: number[];
  inicioDiretorio: number;
}

async function lerDiretorio(f: FileHandle, tamanho: number, limites: LimitesZip): Promise<Diretorio | Recusa> {
  const invalido: Recusa = { ok: false, motivo: 'zip_invalido' };
  if (tamanho < FIM_MIN) return invalido;
  const cauda = Math.min(tamanho, FIM_MIN + COMENTARIO_MAX);
  const base = tamanho - cauda;
  const t = await lerEm(f, base, cauda);
  let fim = -1;
  // de trás para frente; a assinatura só vale se o comentário declarado termina exatamente no fim do arquivo
  for (let i = t.length - FIM_MIN; i >= 0; i -= 1) {
    if (t.readUInt32LE(i) === SIG_FIM && i + FIM_MIN + t.readUInt16LE(i + 20) === t.length) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return invalido;
  if (fim >= 20 && t.readUInt32LE(fim - 20) === SIG_LOCALIZADOR_ZIP64) return { ok: false, motivo: 'zip64_nao_suportado' };
  const disco = t.readUInt16LE(fim + 4);
  const discoDiretorio = t.readUInt16LE(fim + 6);
  const noDisco = t.readUInt16LE(fim + 8);
  const total = t.readUInt16LE(fim + 10);
  const tamanhoDiretorio = t.readUInt32LE(fim + 12);
  const inicioDiretorio = t.readUInt32LE(fim + 16);
  if (total === 0xffff || tamanhoDiretorio === 0xffffffff || inicioDiretorio === 0xffffffff) return { ok: false, motivo: 'zip64_nao_suportado' };
  if (disco !== 0 || discoDiretorio !== 0 || noDisco !== total) return invalido;
  if (total > ENTRADAS_BRUTAS_MAX) return { ok: false, motivo: 'muitos_arquivos' };
  const posFim = base + fim;
  if (inicioDiretorio + tamanhoDiretorio > posFim) return { ok: false, motivo: 'zip_incompleto' };
  const d = await lerEm(f, inicioDiretorio, tamanhoDiretorio);
  if (d.length !== tamanhoDiretorio) return { ok: false, motivo: 'zip_incompleto' };
  const entradas: EntradaZip[] = [];
  const deslocamentos: number[] = [];
  let p = 0;
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > d.length || d.readUInt32LE(p) !== SIG_CENTRAL) return invalido;
    const flags = d.readUInt16LE(p + 8);
    const metodo = d.readUInt16LE(p + 10);
    const crc = d.readUInt32LE(p + 16);
    const compactado = d.readUInt32LE(p + 20);
    const descompactado = d.readUInt32LE(p + 24);
    const n = d.readUInt16LE(p + 28);
    const extra = d.readUInt16LE(p + 30);
    const comentario = d.readUInt16LE(p + 32);
    const local = d.readUInt32LE(p + 42);
    if (compactado === 0xffffffff || descompactado === 0xffffffff || local === 0xffffffff) return { ok: false, motivo: 'zip64_nao_suportado' };
    if (p + 46 + n > d.length) return invalido;
    const caminho = nomeDaEntrada(d.subarray(p + 46, p + 46 + n), (flags & 0x0800) !== 0);
    entradas.push({ indice: i, caminho, pasta: caminho.endsWith('/') || caminho.endsWith('\\'), metodo, criptografada: (flags & 1) !== 0, compactado, descompactado, crc32: crc });
    deslocamentos.push(local);
    p += 46 + n + extra + comentario;
  }
  let considerados = 0;
  let soma = 0;
  for (const e of entradas) {
    const c = classificarEntradaZip(e, limites);
    if (c.acao === 'ignorar') continue;
    considerados += 1;
    if (c.acao === 'aceitar') soma += e.descompactado;
  }
  if (considerados > limites.arquivosMax) return { ok: false, motivo: 'muitos_arquivos' };
  if (soma > limites.bytesDescompactadosMax) return { ok: false, motivo: 'descompactado_grande' };
  return { entradas, deslocamentos, inicioDiretorio };
}

/**
 * Abre o ZIP local (já juntado). `tiposDecodificaveis` = os tipos com decodificador na API (`decodificadores.ts`); o que o
 * módulo aceita vem em cada `ler`. `sha256` ausente = calcula em fluxo.
 */
export async function abrirZipLocal(
  caminho: string,
  limites: LimitesZip,
  op: { tiposDecodificaveis: readonly TipoImagem[]; sha256?: string },
): Promise<{ ok: true; zip: ZipAberto } | Recusa> {
  const f = await open(caminho, 'r');
  let aberto = false;
  try {
    const tamanho = (await f.stat()).size;
    if (tamanho > limites.bytesZipMax) return { ok: false, motivo: 'zip_grande' };
    const lido = await lerDiretorio(f, tamanho, limites);
    if ('ok' in lido) return lido;
    const d: Diretorio = lido;
    const sha256 = op.sha256 ?? (await sha256DoArquivo(caminho));
    const pixelsMax = MAX_MEGAPIXELS * 1_000_000;

    async function ler(indice: number, o: { tipos: readonly TipoImagem[] }): Promise<LeituraEntradaZip> {
      const e = d.entradas[indice];
      if (!e) throw new Error(`entrada ${indice} fora do ZIP`);
      const recusa = (motivo: Extract<LeituraEntradaZip, { ok: false }>['motivo'], tipo: TipoImagem | null = null): LeituraEntradaZip => ({ ok: false, motivo, tipo_detectado: tipo });
      const c = classificarEntradaZip(e, limites);
      if (c.acao === 'ignorar') throw new Error(`entrada ${indice} é ignorada (pasta ou oculto)`);
      if (c.acao === 'recusar') return recusa(c.motivo);
      const off = d.deslocamentos[indice]!;
      const cab = await lerEm(f, off, 30);
      if (cab.length < 30 || cab.readUInt32LE(0) !== SIG_LOCAL) return recusa('entrada_corrompida');
      const inicio = off + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      if (inicio + e.compactado > d.inicioDiretorio) return recusa('entrada_corrompida');
      // A-T0174-1: a classificação acima já limitou o compactado ao teto por foto + folga; a alocação nunca vai além disso
      const bruto = await lerEm(f, inicio, e.compactado);
      if (bruto.length !== e.compactado) return recusa('entrada_corrompida');
      let bytes: Buffer;
      if (e.metodo === 0) bytes = bruto;
      else {
        try {
          // só até o declarado (já dentro do teto e da razão): bomba que mente o tamanho para aqui
          bytes = inflateRawSync(bruto, { maxOutputLength: e.descompactado });
        } catch {
          return recusa('entrada_corrompida');
        }
      }
      if (bytes.length !== e.descompactado || crc32(bytes) !== e.crc32) return recusa('entrada_corrompida');
      const tipo = detectarTipoImagem(bytes);
      if (!tipo || !o.tipos.includes(tipo) || !op.tiposDecodificaveis.includes(tipo)) return recusa('tipo_nao_aceito', tipo);
      const dim = dimensoesImagem(bytes, tipo);
      if (!dim || dim.largura * dim.altura > pixelsMax) return recusa('foto_ilegivel', tipo);
      const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
      return { ok: true, bytes: u8, sha256: createHash('sha256').update(u8).digest('hex'), tipo, largura: dim.largura, altura: dim.altura };
    }

    aberto = true;
    return {
      ok: true,
      zip: { sha256, tamanho_bytes: tamanho, entradas: d.entradas, ler, fechar: () => f.close() },
    };
  } finally {
    if (!aberto) await f.close();
  }
}

/** Apaga o temporário (melhor esforço). */
export async function apagarTemporario(caminho: string): Promise<void> {
  await rm(caminho, { force: true });
}
