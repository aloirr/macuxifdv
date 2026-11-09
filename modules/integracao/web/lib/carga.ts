/**
 * Carga por arquivo no BKO (T-0100; RF-INT-03): partes puras da tela de autoatendimento do admin da empresa. A divisão do arquivo é a
 * MESMA função da API (`dividirCsvEmPartes`, RN-INT-06); a chave de idempotência (RN-INT-12) é uma por arquivo e vale em todas as partes.
 * O conteúdo do CSV nunca é guardado nem logado aqui; o tenant vem do token (a tela não envia nem escolhe empresa).
 */
import { BOM_CSV, protegerFormula } from '@macuxi/comum/csv';
import type { CampoDicionario, CargaArquivoEntrada, DicionarioModelo, Entidade, ModoCarga } from '../../contracts';
import { BYTES_MAX_PARTE_ARQUIVO, PARTES_MAX_SESSAO, dividirCsvEmPartes, type ParteDoArquivo } from '../../domain';

/** Teto do arquivo escolhido (a API limita cada parte; acima disto o navegador nem lê). */
export const BYTES_MAX_ARQUIVO = 25 * 1024 * 1024;

export type EscolhaDeArquivo = { ok: true } | { ok: false; mensagem: string };

/** Confere o arquivo escolhido (extensão, vazio, tamanho) antes de ler. A API revalida tudo (formato, limites, linhas). */
export function conferirArquivoEscolhido(a: { nome: string; tamanho: number }): EscolhaDeArquivo {
  if (!/\.csv$/i.test(a.nome)) return { ok: false, mensagem: 'O arquivo precisa ser um CSV (.csv). Baixe o modelo, preencha e salve como CSV (separado por ponto e vírgula).' };
  if (a.tamanho <= 0) return { ok: false, mensagem: 'O arquivo está vazio. Preencha o modelo e escolha o arquivo de novo.' };
  if (a.tamanho > BYTES_MAX_ARQUIVO) return { ok: false, mensagem: `O arquivo passa de ${BYTES_MAX_ARQUIVO / 1024 / 1024} MB. Divida em arquivos menores (por exemplo, por região) e envie um de cada vez.` };
  return { ok: true };
}

/** Chave de idempotência da carga: a mesma em todas as partes e em cada nova tentativa do MESMO arquivo. */
export function novaChaveDeCarga(uuid: () => string = () => crypto.randomUUID()): string {
  return `bko-${uuid()}`;
}

export type PlanoDeEnvio = { ok: true; totalLinhas: number; partes: ParteDoArquivo[] } | { ok: false; mensagem: string };

/** Divide o arquivo em partes (5.000 linhas e 768 KiB por parte). Arquivo pequeno = uma parte. */
export function planejarEnvio(texto: string): PlanoDeEnvio {
  const r = dividirCsvEmPartes(texto);
  if (!r.ok) return { ok: false, mensagem: r.mensagem };
  if (r.partes.length > PARTES_MAX_SESSAO) return { ok: false, mensagem: `O arquivo daria mais de ${PARTES_MAX_SESSAO} partes. Divida em arquivos menores e envie um de cada vez.` };
  return { ok: true, totalLinhas: r.totalLinhas, partes: r.partes };
}

/** Corpo do `POST cargas-arquivo` de uma parte; uma parte só vai sem os campos de sessão. */
export function corpoDaParte(e: { entidade: Entidade; modo: ModoCarga; chave: string; sessaoId: string | null; parte: ParteDoArquivo }): CargaArquivoEntrada {
  const base: CargaArquivoEntrada = { entidade: e.entidade, modo: e.modo, conteudo: e.parte.texto, chave_idempotencia: e.chave };
  if (e.parte.total_partes === 1 || !e.sessaoId) return base;
  return { ...base, sessao_id: e.sessaoId, parte: e.parte.parte, total_partes: e.parte.total_partes, linha_inicial: e.parte.linha_inicial };
}

/** Limite de texto da parte, exposto para a ajuda da tela. */
export const KB_POR_PARTE = BYTES_MAX_PARTE_ARQUIVO / 1024;

const celula = (v: string | number | boolean | null | undefined): string => {
  const t = protegerFormula(v === null || v === undefined ? '' : String(v));
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const LINHAS_DICIONARIO = (c: CampoDicionario): (string | number | boolean | null)[] => [c.campo, c.obrigatorio ? 'sim' : 'não', c.tipo, c.tamanho_max, c.formato, c.exemplo, c.observacao];

/** Dicionário de campos em CSV (BOM_CSV, `;`, CRLF; `protegerFormula` em toda célula de texto). */
export function dicionarioParaCsv(d: DicionarioModelo): string {
  const linhas = [['campo', 'obrigatorio', 'tipo', 'tamanho_max', 'formato', 'exemplo', 'observacao'], ...d.campos.map(LINHAS_DICIONARIO)];
  return BOM_CSV + linhas.map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

export const nomeArquivoDicionario = (entidade: Entidade): string => `${entidade}_dicionario.csv`;
