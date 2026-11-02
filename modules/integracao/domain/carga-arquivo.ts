/**
 * Carga por arquivo (RF-INT-03): CSV UTF-8 enviado pelo BKO vira o MESMO envelope canônico do lote do Hub (entidade, modo, registros,
 * linhas inválidas) e segue o pipeline de sempre (RN-INT-01/02/03/06/12). Aqui só a parte pura: ler o CSV, casar o cabeçalho com o
 * contrato da entidade, converter célula a célula, resolver o Conector do tipo `arquivo` (RN-INT-13) e montar a chave de conteúdo.
 *
 * Formato: UTF-8 com ou sem BOM; separador `;` ou `,` (detectado no cabeçalho); aspas duplas para texto com separador/quebra;
 * cabeçalho = nomes dos campos do contrato (`external_id`, `razao_social`, `endereco.cidade`…), sem diferenciar maiúsculas.
 * Célula vazia = campo ausente. `alterado_em` pode ficar de fora (vale o instante do envio). Listas (`contatos`, `paradas`) não
 * cabem em CSV. Nada do valor digitado entra em mensagem (dado pessoal): só a linha, o campo e o tipo esperado.
 */
import { z } from 'zod';
import { ENTIDADES, SCHEMA_REGISTRO, VERSAO_CONTRATO, type Entidade, type LinhaInvalidaConector, type LoteEnvelopeValido, type ModoCarga } from '../contracts';
import { jsonCanonico } from './idempotencia';
import { PARAMETROS_PADRAO } from './parametros';
import { sha256Hex } from './sha256';

// ---------------------------------------------------------------------------------------------------------------- leitura do CSV

export interface LinhaCsv {
  /** Linha física do arquivo onde o registro começa (o cabeçalho é a 1). */
  numero: number;
  celulas: string[];
}

export type ResultadoCsv =
  | { ok: true; separador: ';' | ','; cabecalho: string[]; linhas: LinhaCsv[] }
  | { ok: false; codigo: 'arquivo_vazio' | 'csv_invalido'; mensagem: string };

const BOM = String.fromCharCode(0xfeff);

/** Texto do arquivo sem BOM e com quebras `\n` — a forma em que o conteúdo é comparado (idempotência) e lido. */
export function normalizarTextoCsv(texto: string): string {
  return (texto.startsWith(BOM) ? texto.slice(1) : texto).replace(/\r\n?/g, '\n');
}

function detectarSeparador(texto: string): ';' | ',' {
  const primeira = texto.split('\n', 1)[0] ?? '';
  let pv = 0;
  let v = 0;
  let aspas = false;
  for (const ch of primeira) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas && ch === ';') pv++;
    else if (!aspas && ch === ',') v++;
  }
  return v > pv ? ',' : ';';
}

/** Lê o CSV (RFC 4180 com `;` ou `,`): aspas, aspas escapadas, quebra de linha dentro de aspas; ignora linhas em branco. */
export function lerCsv(entrada: string): ResultadoCsv {
  const texto = normalizarTextoCsv(entrada);
  if (texto.trim() === '') {
    return { ok: false, codigo: 'arquivo_vazio', mensagem: 'O arquivo está vazio. Salve a planilha como CSV (separado por ponto e vírgula, UTF-8) com o cabeçalho na primeira linha e envie de novo.' };
  }
  const separador = detectarSeparador(texto);
  const registros: LinhaCsv[] = [];
  let celulas: string[] = [];
  let atual = '';
  let aspas = false;
  let aspasAbertasNaLinha = 0;
  let linha = 1;
  let inicio = 1;
  let campoComAspas = false;

  const fecharCelula = () => {
    celulas.push(atual);
    atual = '';
    campoComAspas = false;
  };
  const fecharRegistro = () => {
    fecharCelula();
    // linha em branco ou só de separadores (sobra do Excel) não é registro
    if (celulas.some((c) => c.trim() !== '')) registros.push({ numero: inicio, celulas });
    celulas = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i] as string;
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          atual += '"';
          i++;
        } else aspas = false;
      } else {
        if (ch === '\n') linha++;
        atual += ch;
      }
      continue;
    }
    if (ch === '"' && atual === '' && !campoComAspas) {
      aspas = true;
      campoComAspas = true;
      aspasAbertasNaLinha = linha;
    } else if (ch === separador) fecharCelula();
    else if (ch === '\n') {
      fecharRegistro();
      linha++;
      inicio = linha;
    } else atual += ch;
  }
  if (aspas) {
    return { ok: false, codigo: 'csv_invalido', mensagem: `Há aspas abertas na linha ${aspasAbertasNaLinha} sem fechar. Confira essa linha no arquivo (texto com aspas ou ponto e vírgula deve estar entre aspas duplas) e envie de novo.` };
  }
  fecharRegistro();

  const [cab, ...dados] = registros;
  if (!cab) return { ok: false, codigo: 'arquivo_vazio', mensagem: 'O arquivo está vazio. Salve a planilha como CSV (separado por ponto e vírgula, UTF-8) com o cabeçalho na primeira linha e envie de novo.' };
  return { ok: true, separador, cabecalho: cab.celulas, linhas: dados };
}

// ---------------------------------------------------------------------------------------------------------------- colunas do contrato

export type TipoColuna = 'texto' | 'numero' | 'booleano';
export interface ColunaContrato {
  /** Caminho com ponto para campo aninhado (`endereco.cidade`). */
  caminho: string;
  tipo: TipoColuna;
  /** O arquivo precisa ter a coluna (o registro não vale sem ela). `alterado_em` nunca é obrigatória no arquivo. */
  obrigatoria: boolean;
}
export interface EstruturaEntidade {
  colunas: ColunaContrato[];
  /** Campos de lista do contrato (`contatos`, `paradas`): não cabem em CSV. */
  listas: string[];
}

/** Colunas que o arquivo pode omitir mesmo sendo obrigatórias no contrato: `alterado_em` assume o instante do envio. */
const COLUNAS_COM_PADRAO = new Set(['alterado_em']);

type Def = { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; type?: z.ZodTypeAny; shape?: () => Record<string, z.ZodTypeAny> };
const defDe = (t: z.ZodTypeAny): Def => t._def as Def;

function desembrulhar(t: z.ZodTypeAny): z.ZodTypeAny {
  let atual = t;
  for (let i = 0; i < 12; i++) {
    const d = defDe(atual);
    const proximo = d.typeName === 'ZodOptional' || d.typeName === 'ZodNullable' || d.typeName === 'ZodDefault' ? d.innerType : d.typeName === 'ZodEffects' ? d.schema : d.typeName === 'ZodBranded' ? d.type : undefined;
    if (!proximo) return atual;
    atual = proximo;
  }
  return atual;
}

function coletar(shape: Record<string, z.ZodTypeAny>, prefixo: string, paiObrigatorio: boolean, saida: EstruturaEntidade): void {
  for (const [nome, campo] of Object.entries(shape)) {
    const caminho = prefixo === '' ? nome : `${prefixo}.${nome}`;
    const base = desembrulhar(campo);
    const tipo = defDe(base).typeName;
    const obrigatoria = paiObrigatorio && !campo.isOptional() && !COLUNAS_COM_PADRAO.has(caminho);
    if (tipo === 'ZodObject') coletar((defDe(base).shape as () => Record<string, z.ZodTypeAny>)(), caminho, obrigatoria, saida);
    else if (tipo === 'ZodArray') saida.listas.push(caminho);
    else saida.colunas.push({ caminho, tipo: tipo === 'ZodNumber' ? 'numero' : tipo === 'ZodBoolean' ? 'booleano' : 'texto', obrigatoria });
  }
}

/** As colunas aceitas no CSV de uma entidade, lidas do schema do contrato (a fonte da verdade: mudou lá, muda aqui). */
export function colunasDaEntidade(entidade: Entidade): EstruturaEntidade {
  const raiz = desembrulhar(SCHEMA_REGISTRO[entidade]);
  const saida: EstruturaEntidade = { colunas: [], listas: [] };
  coletar((defDe(raiz).shape as () => Record<string, z.ZodTypeAny>)(), '', true, saida);
  return saida;
}

// ---------------------------------------------------------------------------------------------------------------- conversão

export type CodigoRecusaArquivo =
  | 'entidade_desconhecida'
  | 'modo_invalido'
  | 'arquivo_vazio'
  | 'csv_invalido'
  | 'colunas_desconhecidas'
  | 'colunas_repetidas'
  | 'coluna_nao_suportada'
  | 'colunas_obrigatorias_ausentes'
  | 'lote_vazio'
  | 'acima_do_limite'
  | 'corpo_grande';

export type ResultadoConversaoCsv =
  | {
      ok: true;
      separador: ';' | ',';
      /** Registros convertidos, na ordem do arquivo; `linhasArquivo[i]` é a linha física de `registros[i]`. */
      registros: Record<string, unknown>[];
      linhasArquivo: number[];
      /** Linhas cujo valor não converteu (ou com colunas a mais), já com "Linha N do arquivo:" na mensagem. */
      linhasInvalidas: LinhaInvalidaConector[];
      /** Linhas de dados lidas (válidas + inválidas). */
      totalLinhas: number;
      envelope: LoteEnvelopeValido;
    }
  | {
      ok: false;
      codigo: CodigoRecusaArquivo;
      /** `limite` = tamanho/linhas acima do que o lote aceita (422 com `detalhes.limite`); `arquivo_invalido` = o conteúdo não serve (422). */
      classe: 'limite' | 'arquivo_invalido';
      mensagem: string;
    };

export interface OpcoesConversaoCsv {
  entidade: Entidade;
  modo: ModoCarga;
  texto: string;
  /** Instante do envio (ISO UTC): vira `alterado_em` onde a coluna não vem. */
  agora: string;
  /** UUID da sessão da carga completa (`sessaoDoArquivo`). */
  sessaoId?: string;
  limiteLinhas?: number;
  limiteBytes?: number;
}

const recusa = (codigo: CodigoRecusaArquivo, mensagem: string, classe: 'limite' | 'arquivo_invalido' = 'arquivo_invalido'): ResultadoConversaoCsv => ({ ok: false, codigo, classe, mensagem });

const unidadeTamanho = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MiB` : `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} KiB`);

const NUMERO = /^[+-]?\d+(?:[.,]\d+)?$/;
/** "1.500" / "1,500" (um separador seguido de exatamente 3 dígitos) pode ser milhar ou decimal: recusa em vez de adivinhar (1,5 x 1500). */
const NUMERO_AMBIGUO = /^[+-]?\d{1,3}[.,]\d{3}$/;
const VERDADEIRO = new Set(['true', 'verdadeiro', 'sim', 's', '1', 'yes', 'y']);
const FALSO = new Set(['false', 'falso', 'nao', 'não', 'n', '0', 'no']);
const ROTULO_TIPO: Record<TipoColuna, string> = { texto: 'texto', numero: 'número (ex.: 1500 ou 12,5)', booleano: 'sim/não' };

function converterCelula(valor: string, tipo: TipoColuna): { ok: true; valor: unknown } | { ok: false; ambiguo?: boolean } {
  if (tipo === 'texto') return { ok: true, valor };
  if (tipo === 'numero') {
    if (NUMERO_AMBIGUO.test(valor)) return { ok: false, ambiguo: true };
    return NUMERO.test(valor) ? { ok: true, valor: Number(valor.replace(',', '.')) } : { ok: false };
  }
  const v = valor.toLowerCase();
  if (VERDADEIRO.has(v)) return { ok: true, valor: true };
  if (FALSO.has(v)) return { ok: true, valor: false };
  return { ok: false };
}

function atribuir(registro: Record<string, unknown>, caminho: string, valor: unknown): void {
  const partes = caminho.split('.');
  let alvo = registro;
  for (const p of partes.slice(0, -1)) {
    const filho = alvo[p];
    if (typeof filho === 'object' && filho !== null) alvo = filho as Record<string, unknown>;
    else {
      const novo: Record<string, unknown> = {};
      alvo[p] = novo;
      alvo = novo;
    }
  }
  alvo[partes[partes.length - 1] as string] = valor;
}

const lista = (xs: readonly string[], max = 12): string => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} e mais ${xs.length - max}`);

/**
 * CSV → envelope do lote. Recusa o ARQUIVO inteiro por problema de cabeçalho (coluna fora do contrato, repetida, de lista ou
 * obrigatória ausente: evita milhares de erros iguais) e por limite de tamanho/linhas; problema de valor numa linha só tira
 * aquela linha (vira `linhas_invalidas`, RN-INT-01/03). Validação de regra (formato, faixa, referência) é do Hub, linha a linha.
 */
export function converterCsvParaLote(o: OpcoesConversaoCsv): ResultadoConversaoCsv {
  if (!(ENTIDADES as readonly string[]).includes(o.entidade)) return recusa('entidade_desconhecida', `Entidade desconhecida. Use uma de: ${ENTIDADES.join(', ')}.`);
  const limiteBytes = o.limiteBytes ?? PARAMETROS_PADRAO.limiteCorpoLoteBytes;
  const limiteLinhas = o.limiteLinhas ?? PARAMETROS_PADRAO.limiteRegistrosLote;
  const bytes = new TextEncoder().encode(o.texto).length;
  if (bytes > limiteBytes) {
    return recusa('corpo_grande', `O arquivo passa do limite de ${unidadeTamanho(limiteBytes)} por envio. Divida em arquivos menores (na carga completa, use o modo delta para as partes).`, 'limite');
  }

  const csv = lerCsv(o.texto);
  if (!csv.ok) return recusa(csv.codigo, csv.mensagem);

  const estrutura = colunasDaEntidade(o.entidade);
  const porNome = new Map(estrutura.colunas.map((c) => [c.caminho, c] as const));
  const cabecalho = csv.cabecalho.map((c) => c.trim().toLowerCase());

  const repetidas = [...new Set(cabecalho.filter((c, i) => c !== '' && cabecalho.indexOf(c) !== i))];
  if (repetidas.length > 0) return recusa('colunas_repetidas', `O cabeçalho repete a coluna ${lista(repetidas.map((c) => `"${c}"`))}. Cada coluna deve aparecer uma vez; apague a repetida e envie de novo.`);

  const deLista = cabecalho.filter((c) => estrutura.listas.includes(c));
  if (deLista.length > 0) {
    return recusa('coluna_nao_suportada', `A coluna ${lista(deLista.map((c) => `"${c}"`))} é uma lista e não cabe em CSV. Retire a coluna do arquivo; esses dados vêm pelo Conector.`);
  }
  // coluna sem nome (célula de cabeçalho vazia) com dados é sobra do Excel e é ignorada; nome fora do contrato recusa
  const desconhecidas = cabecalho.filter((c) => c !== '' && !porNome.has(c));
  if (desconhecidas.length > 0) {
    return recusa(
      'colunas_desconhecidas',
      `O cabeçalho tem ${desconhecidas.length > 1 ? 'colunas' : 'uma coluna'} que não existe${desconhecidas.length > 1 ? 'm' : ''} no contrato de "${o.entidade}": ${lista(desconhecidas.map((c) => `"${c}"`))}. Colunas aceitas: ${estrutura.colunas.map((c) => c.caminho).join(', ')}. Corrija o nome (ou apague a coluna) e envie de novo.`,
    );
  }
  const faltando = estrutura.colunas.filter((c) => c.obrigatoria && !cabecalho.includes(c.caminho)).map((c) => c.caminho);
  if (faltando.length > 0) {
    return recusa('colunas_obrigatorias_ausentes', `Faltam no cabeçalho ${faltando.length > 1 ? 'as colunas obrigatórias' : 'a coluna obrigatória'} ${lista(faltando.map((c) => `"${c}"`))} de "${o.entidade}". Acrescente ${faltando.length > 1 ? 'as colunas' : 'a coluna'} (a primeira linha do arquivo é o cabeçalho) e envie de novo.`);
  }

  if (csv.linhas.length === 0) return recusa('lote_vazio', 'O arquivo tem só o cabeçalho, sem nenhuma linha de dados. Acrescente ao menos uma linha e envie de novo.');
  if (csv.linhas.length > limiteLinhas) {
    return recusa('acima_do_limite', `O arquivo tem ${csv.linhas.length} linhas de dados e o limite é ${limiteLinhas} por envio. Divida em arquivos menores (modo delta) e envie um de cada vez.`, 'limite');
  }

  const registros: Record<string, unknown>[] = [];
  const linhasArquivo: number[] = [];
  const invalidas: LinhaInvalidaConector[] = [];
  const idxId = cabecalho.indexOf('external_id');

  for (const linha of csv.linhas) {
    const idBruto = idxId >= 0 ? (linha.celulas[idxId] ?? '').trim() : '';
    const external_id = idBruto !== '' && idBruto.length <= 200 ? idBruto : null;
    // `idConfiavel = false`: linha com colunas a mais está deslocada e a célula do external_id pode ser outro pedaço do texto (RN-INT-06:
    // `external_id` nulo faz `calcularInativacao` recusar a inativação com `linhas_sem_external_id`, em vez de marcar outro registro como visto)
    const invalida = (codigo: LinhaInvalidaConector['codigo'], campo: string | null, detalhe: string, idConfiavel = true) =>
      invalidas.push({ external_id: idConfiavel ? external_id : null, codigo, campo, mensagem: `Linha ${linha.numero} do arquivo: ${detalhe}`.slice(0, 300) });

    const extras = linha.celulas.slice(cabecalho.length);
    if (extras.some((c) => c.trim() !== '')) {
      invalida('registro_invalido', null, `a linha tem ${linha.celulas.length} colunas e o cabeçalho tem ${cabecalho.length}. Se o texto tem ponto e vírgula, coloque-o entre aspas duplas.`, false);
      continue;
    }

    const registro: Record<string, unknown> = {};
    let falhou = false;
    for (let c = 0; c < cabecalho.length; c++) {
      const coluna = porNome.get(cabecalho[c] as string);
      const valor = (linha.celulas[c] ?? '').trim();
      if (!coluna || valor === '') continue;
      const r = converterCelula(valor, coluna.tipo);
      if (!r.ok) {
        invalida(coluna.tipo === 'booleano' ? 'valor_nao_permitido' : 'tipo_invalido', coluna.caminho, r.ambiguo
            ? `o campo "${coluna.caminho}" tem ponto ou vírgula seguido de 3 dígitos, que pode ser milhar ou decimal e não será adivinhado. Escreva sem separador de milhar (1500) ou com os decimais sem zeros à direita (1,5) e envie de novo.`
            : `o campo "${coluna.caminho}" deve ser ${ROTULO_TIPO[coluna.tipo]}. Corrija a célula e envie de novo.`);
        falhou = true;
        break;
      }
      atribuir(registro, coluna.caminho, r.valor);
    }
    if (falhou) continue;
    if (registro.alterado_em === undefined) registro.alterado_em = o.agora;
    registros.push(registro);
    linhasArquivo.push(linha.numero);
  }
  // o primeiro erro de cada linha basta; `tipo_invalido` x `valor_nao_permitido` seguem os códigos de LinhaInvalidaConector
  const sessao = o.modo === 'completo' ? { id: o.sessaoId ?? sessaoDoArquivo('sem-chave'), parte: 1, ultimo: true } : undefined;
  const envelope: LoteEnvelopeValido = {
    versao_contrato: VERSAO_CONTRATO,
    entidade: o.entidade,
    modo: o.modo,
    ...(sessao ? { sessao } : {}),
    enviado_em: o.agora,
    registros,
    linhas_invalidas: invalidas,
  };
  return { ok: true, separador: csv.separador, registros, linhasArquivo, linhasInvalidas: invalidas, totalLinhas: csv.linhas.length, envelope };
}

// ---------------------------------------------------------------------------------------------------------------- idempotência e sessão

/** O que identifica o arquivo para a Idempotency-Key (RN-INT-12): entidade, modo e o texto normalizado (BOM, CRLF e linhas em branco no fim não contam). */
export function conteudoCanonicoArquivo(e: { entidade: string; modo: string; texto: string }): string {
  return jsonCanonico({ origem: 'arquivo', entidade: e.entidade, modo: e.modo, csv: normalizarTextoCsv(e.texto).replace(/\s+$/, '') });
}

/** UUID estável (formato v4) derivado da chave de idempotência: a mesma chave é a mesma sessão; arquivo igual com chave nova é sessão nova (RN-INT-06). */
export function sessaoDoArquivo(chave: string): string {
  const h = sha256Hex(`sessao-arquivo:${chave}`);
  const variante = '89ab'[Number.parseInt(h.charAt(16), 16) % 4] as string;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Hash do conteúdo do lote do arquivo (o `hash_conteudo` do lote). */
export const hashConteudoArquivo = (e: { entidade: string; modo: string; texto: string }): string => sha256Hex(conteudoCanonicoArquivo(e));

// ---------------------------------------------------------------------------------------------------------------- erros com a linha do arquivo

const JA_ANOTADA = /^Linha \d+ do arquivo:/;

/**
 * O lote do arquivo guarda, junto ao staging, a linha física de cada registro (`linhas_arquivo`). Os erros e avisos do Hub vêm com o
 * índice do lote; aqui ganham "Linha N do arquivo:" para o operador achar a linha na planilha. Sem mapa (lote do Conector), nada muda.
 */
export function anotarLinhaDoArquivo<T extends { indice: number; mensagem: string }>(itens: readonly T[], linhasArquivo: readonly number[] | null | undefined): T[] {
  if (!linhasArquivo || linhasArquivo.length === 0) return [...itens];
  return itens.map((i) => {
    const n = linhasArquivo[i.indice];
    if (n === undefined || JA_ANOTADA.test(i.mensagem)) return i;
    return { ...i, mensagem: `Linha ${n} do arquivo: ${i.mensagem}`.slice(0, 1000) };
  });
}

// ---------------------------------------------------------------------------------------------------------------- Conector do tipo arquivo

export interface ConectorDoArquivo {
  id: string;
  identificador: string;
  tipo: 'conector' | 'nuvem' | 'arquivo';
  ativo: boolean;
  entidades: readonly Entidade[];
}

export type ResultadoConectorArquivo =
  | { ok: true; conector: ConectorDoArquivo }
  | { ok: false; codigo: 'sem_conector_arquivo' | 'entidade_de_outro_conector' | 'conector_nao_encontrado' | 'conector_nao_e_arquivo' | 'conector_ambiguo'; mensagem: string };

/**
 * RN-INT-13: o lote do arquivo pertence a um Conector `arquivo` ativo do tenant que recebe a entidade. Entidade que um Conector de
 * ERP (outro tipo) já recebe é recusada — cursor, reconciliação e inativação são por (Conector, entidade), e dois donos se
 * inativariam. `identificador` (opcional) escolhe o Conector quando a empresa tem mais de um de arquivo.
 */
export function resolverConectorDoArquivo(entidade: Entidade, conectores: readonly ConectorDoArquivo[], identificador: string | null | undefined): ResultadoConectorArquivo {
  const ativos = conectores.filter((c) => c.ativo);
  const donoErp = ativos.find((c) => c.tipo !== 'arquivo' && c.entidades.includes(entidade));
  const recusaDono = (c: ConectorDoArquivo): ResultadoConectorArquivo => ({
    ok: false,
    codigo: 'entidade_de_outro_conector',
    mensagem: `A entidade "${entidade}" já é recebida pelo Conector "${c.identificador}" (na v1 cada entidade vem de um único Conector por empresa). Carregue "${entidade}" por ele, ou tire "${entidade}" da lista dele em Integração ERP > Conectores para passar a carregá-la por arquivo.`,
  });

  if (identificador) {
    const escolhido = conectores.find((c) => c.identificador === identificador);
    if (!escolhido || !escolhido.ativo) {
      return { ok: false, codigo: 'conector_nao_encontrado', mensagem: `Não há Conector ativo com o identificador "${identificador}" nesta empresa. Confira em Integração ERP > Conectores.` };
    }
    if (escolhido.tipo !== 'arquivo') {
      return { ok: false, codigo: 'conector_nao_e_arquivo', mensagem: `O Conector "${identificador}" não é do tipo arquivo. Escolha um Conector tipo arquivo ou cadastre um em Integração ERP > Conectores.` };
    }
    if (donoErp) return recusaDono(donoErp);
    if (!escolhido.entidades.includes(entidade)) {
      return { ok: false, codigo: 'entidade_de_outro_conector', mensagem: `O Conector "${identificador}" não está cadastrado para a entidade "${entidade}" (na v1 cada entidade vem de um único Conector por empresa). Inclua "${entidade}" na lista de entidades dele em Integração ERP > Conectores.` };
    }
    return { ok: true, conector: escolhido };
  }

  if (donoErp) return recusaDono(donoErp);
  const doArquivo = ativos.filter((c) => c.tipo === 'arquivo' && c.entidades.includes(entidade));
  if (doArquivo.length === 0) {
    return { ok: false, codigo: 'sem_conector_arquivo', mensagem: `Nenhum Conector do tipo arquivo recebe a entidade "${entidade}". Cadastre um em Integração ERP > Conectores (tipo arquivo, com "${entidade}" na lista de entidades) e envie o arquivo de novo.` };
  }
  if (doArquivo.length > 1) {
    return { ok: false, codigo: 'conector_ambiguo', mensagem: `Mais de um Conector do tipo arquivo recebe "${entidade}" (${doArquivo.map((c) => `"${c.identificador}"`).join(', ')}). Informe qual usar ou deixe só um deles com a entidade em Integração ERP > Conectores.` };
  }
  return { ok: true, conector: doArquivo[0] as ConectorDoArquivo };
}
