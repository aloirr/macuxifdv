/**
 * Fotos dos produtos em lote por ZIP (RN-CAT-14, T-0174, ADR 0058): funções puras. O nome do arquivo vira código e ordem;
 * o código casa com o produto (exato → sem diferenciar maiúsculas → EAN); mais de um casando = ambíguo, nada é ligado.
 * Roda na API (trabalho do lote) e no BKO (conferência do tamanho antes do envio).
 */
import { BOM_CSV, celulaCsv } from '@macuxi/comum/csv';
import { LIMITES_ZIP_TETO, megabytesParaMensagem, type LimitesZip, type MotivoRecusaZip } from '@macuxi/platform-sdk';
import {
  FOTO_LOTE_CODIGO_MAX,
  FOTO_LOTE_ORDEM_MAX,
  PARAMETROS_FOTO_LOTE,
  ROTULO_MOTIVO_ITEM,
  ROTULO_MOTIVO_LOTE,
  ROTULO_SITUACAO_ITEM,
  type MotivoItem,
  type MotivoLote,
  type SituacaoItem,
} from '../contracts/fotos-lote';

// ---------- limites ----------
function baixarTeto(valor: unknown, teto: number): number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 && valor < teto ? valor : teto;
}

/** RN-CAT-14: os tetos do lote. O parâmetro do tenant só BAIXA o teto da plataforma; valor inválido ou maior é ignorado. */
export function limitesFotoLote(parametros: Readonly<Record<string, unknown>>): LimitesZip {
  return {
    ...LIMITES_ZIP_TETO,
    bytesZipMax: baixarTeto(parametros[PARAMETROS_FOTO_LOTE.zip], LIMITES_ZIP_TETO.bytesZipMax),
    arquivosMax: baixarTeto(parametros[PARAMETROS_FOTO_LOTE.arquivos], LIMITES_ZIP_TETO.arquivosMax),
    bytesEntradaMax: baixarTeto(parametros[PARAMETROS_FOTO_LOTE.foto], LIMITES_ZIP_TETO.bytesEntradaMax),
  };
}

/** Bytes em MB (1 MB = 1 MiB, como o envio em partes). */
export const megabytes = (bytes: number): number => bytes / (1024 * 1024);

/** `500 MB`, `1,5 MB`: o único formato de tamanho dos textos do lote (o do SDK). */
export const textoMb = (bytes: number): string => `${megabytesParaMensagem(bytes)} MB`;

/** Linha de limites da área de envio (spec `fotos-em-lote.md` §2.1), com os limites efetivos do tenant. */
export function textoLimitesLote(limites: Pick<LimitesZip, 'bytesZipMax' | 'arquivosMax' | 'bytesEntradaMax'>): string {
  return `JPEG, PNG ou WEBP · até ${textoMb(limites.bytesEntradaMax)} por foto · até ${limites.arquivosMax.toLocaleString('pt-BR')} fotos · ZIP até ${textoMb(limites.bytesZipMax)}`;
}

/** RN-CAT-14: o ZIP acima do teto é recusado antes de qualquer byte (o BKO confere no navegador; a API revalida). */
export function conferirTamanhoZip(tamanhoBytes: number, limites: Pick<LimitesZip, 'bytesZipMax'>): { ok: true } | { ok: false; motivo: Extract<MotivoRecusaZip, 'zip_grande'>; mensagem: string } {
  if (tamanhoBytes <= limites.bytesZipMax) return { ok: true };
  return { ok: false, motivo: 'zip_grande', mensagem: mensagemMotivoLote('zip_grande', limites) };
}

/**
 * Aviso do lote recusado (spec do designer-ux §5.4). Os números saem do limite efetivo do tenant; sem ele, do teto da plataforma.
 */
export function mensagemMotivoLote(motivo: MotivoLote, limites: Partial<Pick<LimitesZip, 'bytesZipMax' | 'arquivosMax' | 'bytesDescompactadosMax'>> = {}): string {
  const l = { ...LIMITES_ZIP_TETO, ...limites };
  switch (motivo) {
    case 'zip_grande':
      return `O ZIP passa de ${textoMb(l.bytesZipMax)}. Divida as fotos em mais de um ZIP.`;
    case 'muitos_arquivos':
      return `O ZIP passa de ${l.arquivosMax.toLocaleString('pt-BR')} arquivos. Divida as fotos em mais de um ZIP.`;
    case 'descompactado_grande':
      return `As fotos passam de ${textoMb(l.bytesDescompactadosMax)} descompactadas. Divida em mais de um ZIP.`;
    default:
      return ROTULO_MOTIVO_LOTE[motivo];
  }
}

// ---------- nome → código e ordem ----------
export interface InterpretacaoNome {
  codigo: string;
  ordem: number;
}
export type NomeInterpretado = { ok: true; interpretacoes: InterpretacaoNome[] } | { ok: false; motivo: 'nome_invalido' };

/**
 * RN-CAT-14: o nome-base (com extensão) vira código e ordem. Tira a última extensão; o radical (1 a 100 caracteres) é sempre
 * um código na ordem 1; se termina em `_N` (N de 1 a 99) é também o código sem o sufixo na ordem N. `A1_2.jpg` →
 * `[A1_2 / 1, A1 / 2]`: quem decide qual vale é o casamento com os produtos (`resolverItem`).
 */
export function interpretarNome(nomeBase: string): NomeInterpretado {
  const ponto = nomeBase.lastIndexOf('.');
  const radical = (ponto > 0 ? nomeBase.slice(0, ponto) : ponto === 0 ? '' : nomeBase).trim();
  if (radical === '' || radical.length > FOTO_LOTE_CODIGO_MAX) return { ok: false, motivo: 'nome_invalido' };
  const interpretacoes: InterpretacaoNome[] = [{ codigo: radical, ordem: 1 }];
  const sufixo = /^(.+)_(\d{1,2})$/.exec(radical);
  if (sufixo) {
    const ordem = Number(sufixo[2]);
    const codigo = sufixo[1]!.trim();
    if (ordem >= 1 && ordem <= FOTO_LOTE_ORDEM_MAX && codigo !== '') interpretacoes.push({ codigo, ordem });
  }
  return { ok: true, interpretacoes };
}

/** Códigos distintos de todas as interpretações de vários arquivos, para uma consulta só ao Core (até 500 por chamada). */
export function codigosParaConsulta(interpretacoesPorArquivo: readonly (readonly InterpretacaoNome[])[]): string[] {
  const vistos = new Set<string>();
  for (const lista of interpretacoesPorArquivo) for (const i of lista) vistos.add(i.codigo);
  return [...vistos];
}

// ---------- casamento ----------
/** Produto devolvido por `core.produtos_por_sku@1`. Inativo também casa (só o removido fica de fora, na consulta). */
export interface ProdutoParaCasar {
  id: string;
  sku: string;
  ean: string | null;
  ativo: boolean;
}
export type Casamento = { tipo: 'casou'; produto: ProdutoParaCasar } | { tipo: 'ambiguo'; codigos: string[] } | { tipo: 'nenhum' };

/** O banco guarda de 1 a 5 candidatos (`codigos_candidatos`). */
export const CANDIDATOS_MAX = 5;

function decidir(achados: readonly ProdutoParaCasar[]): Casamento | null {
  if (achados.length === 0) return null;
  if (achados.length === 1) return { tipo: 'casou', produto: achados[0]! };
  return { tipo: 'ambiguo', codigos: achados.slice(0, CANDIDATOS_MAX).map((p) => p.sku) };
}

/** RN-CAT-14: código exato → código sem diferenciar maiúsculas → EAN; o primeiro passo que acha decide; mais de um = ambíguo. */
export function casarCodigo(codigo: string, produtos: readonly ProdutoParaCasar[]): Casamento {
  const minusculo = codigo.toLowerCase();
  return (
    decidir(produtos.filter((p) => p.sku === codigo)) ??
    decidir(produtos.filter((p) => p.sku.toLowerCase() === minusculo)) ??
    decidir(produtos.filter((p) => p.ean !== null && p.ean === codigo)) ?? { tipo: 'nenhum' }
  );
}

export type ResolucaoItem =
  | { situacao: 'ligar'; produto: ProdutoParaCasar; ordem: number }
  | { situacao: 'sem_produto' }
  | { situacao: 'ambiguo'; codigos: string[] };

/**
 * RN-CAT-14: nenhuma interpretação casa → sem produto; exatamente uma casa → liga na ordem dela; alguma ambígua ou mais de
 * uma interpretação casando (existem `CX` e `CX_12`, arquivo `CX_12.jpg`) → ambíguo, e nada é ligado.
 */
export function resolverItem(interpretacoes: readonly InterpretacaoNome[], produtos: readonly ProdutoParaCasar[]): ResolucaoItem {
  const casadas: { c: Casamento; ordem: number }[] = [];
  for (const i of interpretacoes) {
    const c = casarCodigo(i.codigo, produtos);
    if (c.tipo !== 'nenhum') casadas.push({ c, ordem: i.ordem });
  }
  if (casadas.length === 0) return { situacao: 'sem_produto' };
  const unica = casadas.length === 1 ? casadas[0]! : null;
  if (unica && unica.c.tipo === 'casou') return { situacao: 'ligar', produto: unica.c.produto, ordem: unica.ordem };
  const codigos: string[] = [];
  for (const { c } of casadas) {
    for (const cod of c.tipo === 'casou' ? [c.produto.sku] : c.tipo === 'ambiguo' ? c.codigos : []) if (!codigos.includes(cod)) codigos.push(cod);
  }
  return { situacao: 'ambiguo', codigos: codigos.slice(0, CANDIDATOS_MAX) };
}

// ---------- relatório ----------
export interface ItemRelatorioFoto {
  arquivo: string;
  situacao: SituacaoItem;
  motivo: MotivoItem | null;
  codigo: string | null;
  produto_codigo: string | null;
  ordem: number | null;
  codigos_candidatos: readonly string[] | null;
}

/** "A", "A e B", "A, B e C". */
export function listaComE(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** Coluna Motivo da tela e do CSV (spec §5.3): vazia quando a situação já diz tudo; ambígua lista os produtos candidatos. */
export function textoMotivoItem(i: Pick<ItemRelatorioFoto, 'situacao' | 'motivo' | 'codigos_candidatos'>, limites: Partial<Pick<LimitesZip, 'bytesEntradaMax'>> = {}): string {
  if (i.motivo === 'foto_grande') return `Foto acima de ${textoMb(limites.bytesEntradaMax ?? LIMITES_ZIP_TETO.bytesEntradaMax)}`;
  if (i.motivo) return ROTULO_MOTIVO_ITEM[i.motivo];
  if (i.situacao === 'ambiguo' && i.codigos_candidatos && i.codigos_candidatos.length > 0) return `Serve para ${listaComE(i.codigos_candidatos)}`;
  return '';
}

const CABECALHO_RELATORIO = ['Arquivo', 'Situação', 'Motivo', 'Código no nome', 'Produto', 'Ordem'] as const;

/**
 * RN-CAT-14: CSV do relatório por arquivo (UTF-8 com BOM, `;`, CRLF). Toda célula passa por `celulaCsv`: a que começa com
 * `=`, `+`, `-`, `@`, tab ou CR ganha `'` na frente (o nome do arquivo vem do ZIP, que é entrada não confiável).
 */
export function csvRelatorioFotos(
  itens: readonly ItemRelatorioFoto[],
  limites: Partial<Pick<LimitesZip, 'bytesEntradaMax'>> = {},
): string {
  const linhas = [CABECALHO_RELATORIO.map(celulaCsv).join(';')];
  for (const i of itens) {
    linhas.push(
      [i.arquivo, ROTULO_SITUACAO_ITEM[i.situacao], textoMotivoItem(i, limites), i.codigo ?? '', i.produto_codigo ?? '', i.ordem === null ? '' : String(i.ordem)].map(celulaCsv).join(';'),
    );
  }
  return `${BOM_CSV}${linhas.join('\r\n')}\r\n`;
}
