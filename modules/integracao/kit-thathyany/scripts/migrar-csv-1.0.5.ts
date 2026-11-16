/**
 * Conversor dos CSVs do kit da thathyany 1.0.5 para o modelo atual (marca do produto e de cada referência cruzada; R-20261115-094000-alexandre).
 * Para cada `<entidade>.csv` da pasta de entrada:
 *  - as colunas que existem nos dois modelos são copiadas sem mudar o valor; coluna nova do modelo atual sai vazia (= o Macuxi não altera);
 *  - coluna da entrada que o modelo atual não tem, ou arquivo sem modelo, é erro (nada some calado);
 *  - no produto.csv, `marca_referencia_codigo_N` vazio com `marca_referencia_N` preenchido recebe o código pela regra de
 *    `domain/marca-referencia-codigo.ts` (código do ERP da mesma marca, se a base tiver; senão gerado pelo nome).
 * O cabeçalho de destino é lido de `modelos/<entidade>.csv` (gerado do contrato por `gerar.ts`), nunca de lista manual.
 * Saída: UTF-8 com BOM, `;`, CRLF (o formato dos modelos). Com `--zip`, também `macuxi-kit-thathyany-<versao>.zip` (o kit inteiro
 * + `csv/<entidade>.csv` com os dados) e o `.sha256`.
 *
 * Uso: pnpm --filter @macuxi/integracao exec tsx kit-thathyany/scripts/migrar-csv-1.0.5.ts --entrada <pasta 1.0.5> --saida <pasta> [--zip]
 * Os CSVs da empresa têm dados reais: entrada e saída ficam FORA do repositório; o script só imprime contagens.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOM_CSV } from '@macuxi/comum/csv';
import { LIMITES_CATALOGO_PRODUTO } from '../../contracts';
import { lerCsv } from '../../domain/carga-arquivo';
import { completarCodigosMarcaReferencia, type ResumoCodigosMarcaReferencia } from '../../domain/marca-referencia-codigo';
// @ts-expect-error módulo .mjs sem tipos (kit em Node puro)
import { VERSAO_KIT, montarEntradas } from './gerar-zip.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit em Node puro)
import { criarZip } from '../../kit-piloto/scripts/zip.mjs';

const MODELOS = fileURLToPath(new URL('../modelos', import.meta.url));

/** A pasta (ou uma acima dela) é um repositório git? Os dados da empresa não podem cair num. */
function dentroDeRepositorioGit(pasta: string): boolean {
  for (let p = resolve(pasta); ; p = dirname(p)) {
    if (existsSync(join(p, '.git'))) return true;
    if (dirname(p) === p) return false;
  }
}

export interface ArquivoConvertido {
  arquivo: string;
  linhas: number;
  colunasNovas: string[];
  csv: string;
}

const celula = (v: string): string => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const montarCsv = (cab: readonly string[], linhas: readonly Record<string, string>[]): string =>
  BOM_CSV + [cab, ...linhas.map((l) => cab.map((c) => l[c] ?? ''))].map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';

function cabecalhoDoModelo(arquivo: string, modelos: string): string[] {
  const r = lerCsv(readFileSync(join(modelos, arquivo), 'utf8'));
  if (!r.ok) throw new Error(`modelos/${arquivo}: ${r.mensagem}`);
  return r.cabecalho;
}

/** Converte um CSV 1.0.5 (texto) para o cabeçalho de destino. Sem I/O: o teste chama direto. */
export function converterCsv(arquivo: string, texto: string, destino: readonly string[]): { convertido: ArquivoConvertido; resumo: ResumoCodigosMarcaReferencia | null } {
  const r = lerCsv(texto);
  if (!r.ok) throw new Error(`${arquivo}: ${r.mensagem}`);
  const cab = r.cabecalho.map((c) => c.trim());
  const sobra = cab.filter((c) => !destino.includes(c));
  if (sobra.length > 0) throw new Error(`${arquivo}: coluna(s) sem lugar no modelo atual: ${sobra.join(', ')}. Ajuste o conversor antes de seguir.`);
  const repetida = cab.find((c, i) => cab.indexOf(c) !== i);
  if (repetida) throw new Error(`${arquivo}: coluna repetida no cabeçalho: ${repetida}.`);
  let linhas = r.linhas.map((l) => {
    if (l.celulas.length > cab.length) throw new Error(`${arquivo}, linha ${l.numero}: mais células que colunas no cabeçalho.`);
    return Object.fromEntries(destino.map((c) => [c, l.celulas[cab.indexOf(c)] ?? '']));
  });
  let resumo: ResumoCodigosMarcaReferencia | null = null;
  if (arquivo === 'produto.csv') {
    const c = completarCodigosMarcaReferencia(linhas, LIMITES_CATALOGO_PRODUTO.referencias);
    linhas = c.linhas;
    resumo = c.resumo;
  }
  return { convertido: { arquivo, linhas: linhas.length, colunasNovas: destino.filter((c) => !cab.includes(c)), csv: montarCsv(destino, linhas) }, resumo };
}

/** Converte a pasta inteira (só os `.csv`); devolve os arquivos e o resumo dos códigos de marca (do produto.csv). */
export function converterPasta(entrada: string, modelos: string = MODELOS): { arquivos: ArquivoConvertido[]; resumo: ResumoCodigosMarcaReferencia | null } {
  const conhecidos = new Set(readdirSync(modelos).filter((f) => f.endsWith('.csv')));
  const arquivos: ArquivoConvertido[] = [];
  let resumo: ResumoCodigosMarcaReferencia | null = null;
  for (const f of readdirSync(entrada).filter((n) => n.toLowerCase().endsWith('.csv')).sort()) {
    if (!conhecidos.has(f)) throw new Error(`${f}: não há modelo com esse nome no kit (${[...conhecidos].join(', ')}).`);
    const r = converterCsv(f, readFileSync(join(entrada, f), 'utf8'), cabecalhoDoModelo(f, modelos));
    arquivos.push(r.convertido);
    resumo = r.resumo ?? resumo;
  }
  if (arquivos.length === 0) throw new Error(`Nenhum .csv em ${entrada}.`);
  return { arquivos, resumo };
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entrada = argumento('entrada');
  const saida = argumento('saida');
  if (!entrada || !saida || !existsSync(entrada)) {
    console.error('Uso: tsx kit-thathyany/scripts/migrar-csv-1.0.5.ts --entrada <pasta com os CSVs 1.0.5> --saida <pasta> [--zip]');
    process.exit(2);
  }
  if (dentroDeRepositorioGit(saida)) {
    console.error('A saída tem dados da empresa: use uma pasta fora de qualquer repositório git.');
    process.exit(2);
  }
  const { arquivos, resumo } = converterPasta(entrada);
  mkdirSync(join(saida, 'csv'), { recursive: true });
  for (const a of arquivos) {
    writeFileSync(join(saida, 'csv', a.arquivo), a.csv);
    console.log(`${a.arquivo}: ${a.linhas} linha(s)${a.colunasNovas.length ? `; colunas novas: ${a.colunasNovas.join(', ')}` : ''}`);
  }
  if (resumo) console.log(`Marcas das referências: ${resumo.codigosGerados} código(s) gerado(s) pelo nome, ${resumo.codigosDoErp} com o código do ERP, ${resumo.celulasPreenchidas} célula(s) preenchida(s).`);
  if (process.argv.includes('--zip')) {
    const entradas = [...(montarEntradas() as { nome: string; dados: Buffer }[]), ...arquivos.map((a) => ({ nome: `csv/${a.arquivo}`, dados: Buffer.from(a.csv, 'utf8') }))];
    const zip = criarZip(entradas) as Buffer;
    const destino = join(saida, `macuxi-kit-thathyany-${VERSAO_KIT as string}.zip`);
    writeFileSync(destino, zip);
    writeFileSync(`${destino}.sha256`, `${createHash('sha256').update(zip).digest('hex')}  ${basename(destino)}\n`);
    console.log(`Zip: ${destino}`);
  }
}
