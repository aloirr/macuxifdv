/**
 * Linhas inválidas informadas pelo Conector (RN-INT-03; decisão do Alexandre de 2026-10-31): vão ao Hub com o motivo, sem o valor
 * da linha, até [500] por lote; o excedente só entra na contagem. Viram erros de linha com `origem: 'conector'`, contam em
 * `com_erro` e NÃO são reprocessáveis (exigem correção no ERP). Para a inativação da carga completa (RN-INT-06), o `external_id`
 * de uma linha inválida conta como recebido (o registro ainda existe no ERP); linha sem id ou omitida impede a inativação.
 */
import type { LinhaErro, LinhaInvalidaConector } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export interface EntradaLinhasInvalidas {
  linhas_invalidas?: readonly LinhaInvalidaConector[] | null;
  linhas_invalidas_omitidas?: number | null;
}

export interface TratamentoLinhasInvalidas {
  /** Até o limite; `indice` = posição em `linhas_invalidas`. */
  erros: LinhaErro[];
  /** Linhas contadas sem detalhe: as que o Conector omitiu mais as que passaram do limite do Hub. */
  omitidas: number;
  /** `external_id` (aparados, sem repetição) de todas as linhas recebidas, inclusive as que passaram do limite de detalhe. */
  externalIds: string[];
  /** Linhas cujo registro não dá para identificar: sem `external_id` legível + as omitidas pelo Conector. */
  semIdentificacao: number;
  /** `erros.length + omitidas` — entra em `com_erro` e em `recebidas`. */
  totalComErro: number;
}

const MASCARA = '***';
const PADROES_PESSOAIS: readonly RegExp[] = [
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, // CNPJ formatado
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF formatado
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
  /\(?\b\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/g, // telefone BR
  /\b\d{8,}\b/g, // qualquer sequência longa de dígitos (CPF/CNPJ sem pontuação, cartão…)
];

/**
 * Defesa em profundidade: o Conector já não manda o valor, mas o Hub nunca grava nem loga CPF, CNPJ, e-mail ou telefone.
 * NÃO é a `mascararDadoPessoal` de @macuxi/comum/dado-pessoal (RD-0043): esta é a regra da mensagem de erro do ERP que o Hub grava, com
 * marcador único `***` e apagando também qualquer sequência de 8+ dígitos (inclusive pedaço de UUID). O texto gravado não muda sem teste de contrato.
 */
export function mascararMensagemDoConector(texto: string): string {
  return PADROES_PESSOAIS.reduce((t, re) => t.replace(re, MASCARA), texto);
}

const limpa = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
};

export function tratarLinhasInvalidasConector(entrada: EntradaLinhasInvalidas, opcoes: { limite?: number } = {}): TratamentoLinhasInvalidas {
  const limite = opcoes.limite ?? PARAMETROS_PADRAO.limiteLinhasInvalidas;
  const linhas = entrada.linhas_invalidas ?? [];
  const omitidasDoConector = Math.max(0, entrada.linhas_invalidas_omitidas ?? 0);

  const erros: LinhaErro[] = linhas.slice(0, limite).map((l, indice) => ({
    indice,
    external_id: limpa(l.external_id),
    codigo: l.codigo,
    campo: limpa(l.campo),
    mensagem: mascararMensagemDoConector(l.mensagem).slice(0, 300),
    reprocessavel: false,
    origem: 'conector',
  }));

  const ids = new Set<string>();
  let semId = 0;
  for (const l of linhas) {
    const id = limpa(l.external_id);
    if (id === null) semId++;
    else ids.add(id);
  }
  const omitidas = omitidasDoConector + Math.max(0, linhas.length - limite);
  return {
    erros,
    omitidas,
    externalIds: [...ids],
    semIdentificacao: semId + omitidasDoConector,
    totalComErro: erros.length + omitidas,
  };
}
