/**
 * Carga por arquivo em PARTES (RF-INT-03, RN-INT-06, RN-INT-12): um CSV maior que o limite do lote (5.000 linhas) é dividido pela
 * tela do BKO em partes da MESMA sessão de carga completa. Aqui só a parte pura:
 *  - `dividirCsvEmPartes`: corta o texto onde a leitura do CSV vê fim de registro (quebra entre aspas nunca é cortada);
 *  - chave de idempotência por parte (`chaveDaParte`/`lerChaveDaParte`): a MESMA chave base em todas as partes;
 *  - consistência das partes da sessão (`validarParteArquivo`, `conferirParteDaSessao`);
 *  - progresso da sessão (`progressoSessaoArquivo`): partes recebidas/aplicadas/faltando, expiração (TTL) e aviso ao operador.
 * Só quando a ÚLTIMA parte é aplicada e todas as anteriores concluíram a sessão fecha e o que sumiu é inativado (`sessao.ts`).
 */
import type { Entidade, EstadoLote, InativacaoLote } from '../contracts';
import { lerCsvComPosicoes, type ParteArquivo } from './carga-arquivo';
import { PARAMETROS_PADRAO } from './parametros';
import { novaSessao, registrarParte, situacaoSessao, type SituacaoSessao } from './sessao';
import { sha256Hex } from './sha256';

/** Tamanho máximo do texto de cada parte: cabe com folga no limite de 1 MiB do corpo JSON da plataforma (aspas/escapes do JSON crescem o texto). */
export const BYTES_MAX_PARTE_ARQUIVO = 768 * 1024;
/** Teto de partes de uma sessão (a chave da parte tem 4 dígitos). */
export const PARTES_MAX_SESSAO = 1000;

// ---------------------------------------------------------------------------------------------------------------- divisão

export interface ParteDoArquivo {
  /** 1..total_partes. */
  parte: number;
  total_partes: number;
  /** Cabeçalho + registros da parte, em `\n`, terminado em `\n`. */
  texto: string;
  /** Linha física, no arquivo ORIGINAL, do primeiro registro da parte. */
  linha_inicial: number;
  /** Registros (linhas de dados) da parte. */
  linhas: number;
  /** Bytes UTF-8 do `texto`. */
  bytes: number;
}

export type ResultadoDivisao =
  | { ok: true; separador: ';' | ','; totalLinhas: number; partes: ParteDoArquivo[] }
  | { ok: false; codigo: 'arquivo_vazio' | 'csv_invalido' | 'lote_vazio' | 'linha_grande'; mensagem: string };

const bytesUtf8 = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Divide o CSV em partes de até `maxLinhas` linhas de dados e `maxBytes` bytes. Cada parte é o cabeçalho + uma fatia CONTÍGUA do texto
 * (do primeiro ao último registro da parte, mantendo linhas em branco internas, para a numeração relativa continuar certa).
 */
export function dividirCsvEmPartes(texto: string, opcoes: { maxLinhas?: number; maxBytes?: number } = {}): ResultadoDivisao {
  const maxLinhas = Math.max(1, Math.floor(opcoes.maxLinhas ?? PARAMETROS_PADRAO.limiteRegistrosLote));
  const maxBytes = Math.max(1, Math.floor(opcoes.maxBytes ?? BYTES_MAX_PARTE_ARQUIVO));
  const csv = lerCsvComPosicoes(texto);
  if (!csv.ok) return csv;
  if (csv.linhas.length === 0) return { ok: false, codigo: 'lote_vazio', mensagem: 'O arquivo tem só o cabeçalho, sem nenhuma linha de dados. Acrescente ao menos uma linha e envie de novo.' };

  const cabecalho = csv.texto.slice(csv.cabecalhoLinha.inicio, csv.cabecalhoLinha.fim);
  const base = bytesUtf8(cabecalho) + 2; // dois `\n`
  const grupos: { de: number; ate: number; bytes: number }[] = [];
  let de = 0;
  let bytes = 0;
  for (let i = 0; i < csv.linhas.length; i++) {
    const l = csv.linhas[i] as (typeof csv.linhas)[number];
    const sozinha = base + bytesUtf8(csv.texto.slice(l.inicio, l.fim));
    if (sozinha > maxBytes) {
      return {
        ok: false,
        codigo: 'linha_grande',
        mensagem: `A linha ${l.numero} do arquivo é grande demais para caber em um envio (limite de ${Math.floor(maxBytes / 1024)} KiB por parte). Reduza o texto dessa linha e envie de novo.`,
      };
    }
    if (i === de) {
      bytes = sozinha;
      continue;
    }
    const anterior = csv.linhas[i - 1] as (typeof csv.linhas)[number];
    const cresce = bytesUtf8(csv.texto.slice(anterior.fim, l.fim));
    if (i - de + 1 > maxLinhas || bytes + cresce > maxBytes) {
      grupos.push({ de, ate: i - 1, bytes });
      de = i;
      bytes = sozinha;
    } else bytes += cresce;
  }
  grupos.push({ de, ate: csv.linhas.length - 1, bytes });

  const partes = grupos.map((g, idx): ParteDoArquivo => {
    const primeira = csv.linhas[g.de] as (typeof csv.linhas)[number];
    const ultima = csv.linhas[g.ate] as (typeof csv.linhas)[number];
    return {
      parte: idx + 1,
      total_partes: grupos.length,
      texto: `${cabecalho}\n${csv.texto.slice(primeira.inicio, ultima.fim)}\n`,
      linha_inicial: primeira.numero,
      linhas: g.ate - g.de + 1,
      bytes: g.bytes,
    };
  });
  return { ok: true, separador: csv.separador, totalLinhas: csv.linhas.length, partes };
}

// ---------------------------------------------------------------------------------------------------------------- chave da parte

const pad4 = (n: number): string => String(n).padStart(4, '0');
const REGEX_CHAVE_PARTE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{4})-(\d{4})\.([0-9a-f]{40})$/;

export interface ChaveDaParteLida {
  sessaoId: string;
  parte: number;
  totalPartes: number;
  /** 40 primeiros hexadecimais do SHA-256 da chave base (a mesma em todas as partes da sessão). */
  baseHash: string;
}

/**
 * RN-INT-12: o cliente manda a MESMA chave base em todas as partes; a chave gravada no lote é `<sessao>.<parte>-<total>.<hash da base>`
 * (87 caracteres, só os aceitos por `validarChaveIdempotencia`). Reenviar a mesma parte com o mesmo conteúdo = a mesma chave = repetição.
 */
export function chaveDaParte(e: { chaveBase: string; sessaoId: string; parte: number; totalPartes: number }): string {
  return `${e.sessaoId.toLowerCase()}.${pad4(e.parte)}-${pad4(e.totalPartes)}.${sha256Hex(e.chaveBase).slice(0, 40)}`;
}

export function lerChaveDaParte(chave: string): ChaveDaParteLida | null {
  const m = REGEX_CHAVE_PARTE.exec(chave);
  if (!m) return null;
  return { sessaoId: m[1] as string, parte: Number(m[2]), totalPartes: Number(m[3]), baseHash: m[4] as string };
}

// ---------------------------------------------------------------------------------------------------------------- consistência

export type RecusaParte = { ok: false; status: 409 | 422; codigo: string; mensagem: string };

export type ResultadoParteArquivo = { ok: true; parte: ParteArquivo | null } | RecusaParte;

const recusa422 = (codigo: string, mensagem: string): RecusaParte => ({ ok: false, status: 422, codigo, mensagem });

/**
 * Os campos da parte vêm os três ou nenhum (`sessao_id`, `parte`, `total_partes`); `linha_inicial` só com parte.
 * Sem parte = envio único (comportamento de sempre), `parte: null`.
 */
export function validarParteArquivo(e: { sessao_id?: string | null; parte?: number | null; total_partes?: number | null; linha_inicial?: number | null }): ResultadoParteArquivo {
  const tem = [e.sessao_id, e.parte, e.total_partes].map((v) => v !== undefined && v !== null);
  const temLinha = e.linha_inicial !== undefined && e.linha_inicial !== null;
  if (!tem.some(Boolean)) {
    if (temLinha) return recusa422('partes_incompletas', 'A linha inicial só vale para uma parte de arquivo. Envie também "sessao_id", "parte" e "total_partes", ou tire "linha_inicial".');
    return { ok: true, parte: null };
  }
  if (!tem.every(Boolean)) return recusa422('partes_incompletas', 'Para enviar o arquivo em partes informe os três campos juntos: "sessao_id", "parte" e "total_partes". Complete os campos que faltam e envie de novo.');
  const parte = e.parte as number;
  const total = e.total_partes as number;
  if (!Number.isInteger(total) || total < 1 || total > PARTES_MAX_SESSAO) {
    return recusa422('total_partes_invalido', `"total_partes" deve ser um número inteiro de 1 a ${PARTES_MAX_SESSAO}. Divida o arquivo em menos partes (partes maiores) e envie de novo.`);
  }
  if (!Number.isInteger(parte) || parte < 1 || parte > total) {
    return recusa422('parte_invalida', `A parte ${String(parte)} não existe: "parte" deve ser um número inteiro de 1 até ${total} ("total_partes"). Confira a numeração das partes e envie de novo.`);
  }
  if (temLinha && (!Number.isInteger(e.linha_inicial) || (e.linha_inicial as number) < 2)) {
    return recusa422('linha_inicial_invalida', '"linha_inicial" deve ser a linha do arquivo original onde a parte começa (2 ou mais, pois a linha 1 é o cabeçalho).');
  }
  return { ok: true, parte: { sessaoId: (e.sessao_id as string).toLowerCase(), parte, totalPartes: total, ...(temLinha ? { linhaInicial: e.linha_inicial as number } : {}) } };
}

export interface ParteDaSessao {
  entidade: string;
  modo: string;
  totalPartes: number;
  baseHash: string;
}

/** A parte nova combina com o que a sessão já recebeu: mesma chave base, mesmo total de partes, mesma entidade e modo. */
export function conferirParteDaSessao(e: { nova: ParteDaSessao; existentes: readonly ParteDaSessao[] }): { ok: true } | RecusaParte {
  const { nova } = e;
  if (e.existentes.some((x) => x.baseHash !== nova.baseHash)) {
    return {
      ok: false,
      status: 409,
      codigo: 'sessao_de_outra_chave',
      mensagem: 'Esta sessão de carga já foi iniciada com outra chave de idempotência. Use a mesma chave em todas as partes do arquivo, ou envie o arquivo inteiro de novo com uma sessão nova.',
    };
  }
  if (e.existentes.some((x) => x.entidade !== nova.entidade || x.modo !== nova.modo)) {
    return recusa422('sessao_de_outra_entidade', 'Esta sessão de carga já recebeu partes de outra entidade ou de outro modo (completo/delta). Todas as partes do arquivo devem ser da mesma entidade e do mesmo modo.');
  }
  if (e.existentes.some((x) => x.totalPartes !== nova.totalPartes)) {
    return recusa422('total_partes_divergente', `O total de partes (${nova.totalPartes}) não bate com o das partes já enviadas desta sessão. Todas as partes devem informar o mesmo "total_partes"; divida o arquivo de novo e envie com uma sessão nova.`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------- progresso

const APLICADAS: ReadonlySet<EstadoLote> = new Set<EstadoLote>(['concluido', 'concluido_com_erros']);

export interface ParteLida {
  parte: number;
  totalPartes: number;
  lote_id: string;
  status: EstadoLote;
  recebidas: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  obsoletas: number;
  /** Instante (ISO UTC) em que a parte chegou. */
  recebido_em: string;
}

export interface ProgressoSessao {
  sessao_id: string;
  entidade: Entidade;
  modo: 'completo' | 'delta';
  total_partes: number;
  situacao: SituacaoSessao;
  partes_recebidas: number;
  partes_aplicadas: number;
  partes_com_falha: number;
  partes_faltando: number[];
  partes: { parte: number; lote_id: string; status: EstadoLote; recebidas: number; com_erro: number; novas: number; atualizadas: number; inalteradas: number; obsoletas: number }[];
  contagens: { recebidas: number; com_erro: number; novas: number; atualizadas: number; inalteradas: number; obsoletas: number };
  erros_total: number;
  inativacao?: InativacaoLote;
  aviso?: { codigo: 'sessao_expirada' | 'partes_faltando' | 'parte_falhou'; mensagem: string };
  iniciada_em: string;
  expira_em: string;
}

export interface EntradaProgressoSessao {
  sessaoId: string;
  entidade: Entidade;
  modo: 'completo' | 'delta';
  /** Partes já recebidas (uma por número; se repetir, vale a mais recente na lista). */
  partes: readonly ParteLida[];
  /** `integracao.sessao_carga` (só no modo completo): a situação gravada vale quando não é `aberta`. */
  sessaoCarga?: { situacao: SituacaoSessao; iniciada_em: string } | null;
  /** Soma de `lote_linha_erro` das partes. */
  errosTotal: number;
  /** Inativação do último lote (só vale com a sessão completa). */
  inativacao?: InativacaoLote | null;
  agora: string;
  ttlMin?: number;
}

const listaPartes = (ns: readonly number[]): string => (ns.length <= 8 ? ns.join(', ') : `${ns.slice(0, 8).join(', ')} e mais ${ns.length - 8}`);

/**
 * Progresso da sessão em partes (função pura; a rota só lê o banco). Usa `registrarParte`/`situacaoSessao`: completa = todas as partes
 * 1..n aplicadas. Passou o TTL com parte faltando = `expirada` + aviso, mesmo que o banco ainda diga `aberta` (a consulta não grava).
 */
export function progressoSessaoArquivo(e: EntradaProgressoSessao): ProgressoSessao {
  const ttlMin = e.ttlMin ?? PARAMETROS_PADRAO.ttlSessaoMin;
  const porNumero = new Map<number, ParteLida>();
  for (const p of e.partes) porNumero.set(p.parte, p);
  const ordenadas = [...porNumero.values()].sort((a, b) => a.parte - b.parte);
  const total = Math.max(1, ...ordenadas.map((p) => p.totalPartes));
  const iniciadaEm = e.sessaoCarga?.iniciada_em ?? ordenadas.map((p) => p.recebido_em).sort()[0] ?? e.agora;

  let estado = novaSessao(e.sessaoId, e.entidade, iniciadaEm);
  for (const p of ordenadas) estado = registrarParte(estado, { parte: p.parte, ultimo: p.parte === total, status: p.status });
  const calculada = situacaoSessao(estado, e.agora, { ttlMin });
  const gravada = e.sessaoCarga?.situacao;
  const situacao: SituacaoSessao = gravada && gravada !== 'aberta' ? gravada : calculada;

  const faltando: number[] = [];
  for (let n = 1; n <= total; n++) if (!porNumero.has(n)) faltando.push(n);
  const comFalha = ordenadas.filter((p) => p.status === 'falhou').length;

  let aviso: ProgressoSessao['aviso'];
  if (situacao === 'expirada') {
    const quais = faltando.length > 0 ? `faltou a parte ${listaPartes(faltando)}` : 'a carga não terminou';
    aviso = {
      codigo: 'sessao_expirada',
      mensagem: `A sessão expirou: ${quais} no prazo de ${Math.round((ttlMin / 60) * 10) / 10} h. Nada foi inativado. Envie o arquivo inteiro de novo com uma chave nova.`,
    };
  } else if (situacao === 'aberta' && faltando.length > 0) {
    aviso = { codigo: 'partes_faltando', mensagem: `Ainda faltam as partes ${listaPartes(faltando)} de ${total}. Envie-as para fechar a carga; enquanto isso nada é inativado.` };
  } else if (situacao === 'aberta' && comFalha > 0) {
    aviso = { codigo: 'parte_falhou', mensagem: `${comFalha === 1 ? 'Uma parte falhou' : `${comFalha} partes falharam`} ao ser aplicada. Reprocesse em Integração ERP > Lotes; a carga só fecha quando todas as partes concluírem.` };
  }

  const soma = (k: 'recebidas' | 'com_erro' | 'novas' | 'atualizadas' | 'inalteradas' | 'obsoletas') => ordenadas.reduce((acc, p) => acc + p[k], 0);
  return {
    sessao_id: e.sessaoId,
    entidade: e.entidade,
    modo: e.modo,
    total_partes: total,
    situacao,
    partes_recebidas: ordenadas.length,
    partes_aplicadas: ordenadas.filter((p) => APLICADAS.has(p.status)).length,
    partes_com_falha: comFalha,
    partes_faltando: faltando,
    partes: ordenadas.map((p) => ({ parte: p.parte, lote_id: p.lote_id, status: p.status, recebidas: p.recebidas, com_erro: p.com_erro, novas: p.novas, atualizadas: p.atualizadas, inalteradas: p.inalteradas, obsoletas: p.obsoletas })),
    contagens: { recebidas: soma('recebidas'), com_erro: soma('com_erro'), novas: soma('novas'), atualizadas: soma('atualizadas'), inalteradas: soma('inalteradas'), obsoletas: soma('obsoletas') },
    erros_total: e.errosTotal,
    ...(e.inativacao && e.modo === 'completo' && situacao === 'completa' ? { inativacao: e.inativacao } : {}),
    ...(aviso ? { aviso } : {}),
    iniciada_em: iniciadaEm,
    expira_em: new Date(Date.parse(iniciadaEm) + ttlMin * 60_000).toISOString(),
  };
}
