/**
 * Regras puras do portal de implantação (T-0087, RF-INT-03): ordem dos cartões de carga, "Conferir sem gravar" e o CSV de erros.
 * Nada aqui guarda o conteúdo do arquivo; as mensagens de erro já nascem sem o valor digitado (dado pessoal).
 */
import { ENTIDADES, type ConferenciaArquivo, type Entidade, type ItemOrdemCarga, type LinhaErro, type LinhaInvalidaConector } from '../contracts';
import { anotarLinhaDoArquivo } from './carga-arquivo';
import { validarLinhas } from './idempotencia';
import { DEPENDENCIAS, ordenarCarga } from './ordem';

/** Ordem dos cartões do portal (RN-INT-04): árvore, produtos, unidades, preços, estoque, clientes, endereços, transportadoras, rotas, títulos, notas. */
const ORDEM_PORTAL: readonly Entidade[] = ['vendedor', 'catalogo_no', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota'];

/** Podem ficar para depois: a operação do vendedor não depende delas. */
export const ENTIDADES_OPCIONAIS_CARGA: readonly Entidade[] = ['titulo', 'nota'];

/** RN-INT-04: a lista dos cartões de carga, já em ordem de dependência. Falha cedo se a lista fixa deixar de cobrir ou respeitar o Hub. */
export function ordemDeCargaDoPortal(): ItemOrdemCarga[] {
  const o = ordenarCarga([...ORDEM_PORTAL]);
  if (!o.ok || o.ordem.some((e, i) => e !== ORDEM_PORTAL[i]) || ORDEM_PORTAL.length !== ENTIDADES.length) {
    throw new Error('Ordem de carga do portal fora da ordem de dependência do Hub (RN-INT-04).');
  }
  return ORDEM_PORTAL.map((entidade, i) => ({ entidade, posicao: i + 1, opcional: ENTIDADES_OPCIONAIS_CARGA.includes(entidade), depende_de: [...DEPENDENCIAS[entidade]] }));
}

// ---------------------------------------------------------------------------------------------------------------- erros em CSV

const BOM = String.fromCharCode(0xfeff);
const CABECALHO_ERROS = ['linha_do_lote', 'external_id', 'codigo', 'campo', 'reprocessavel', 'mensagem'] as const;

function celula(valor: string | number | null | undefined): string {
  let t = valor === null || valor === undefined ? '' : String(valor);
  // planilha não pode tratar a célula como fórmula (CSV injection): apóstrofo antes de = + - @ e controles
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Erros do lote em CSV (UTF-8 com BOM, `;`, CRLF) para o Excel: a mesma linha que o BKO mostra. `linha_do_lote` é base 1. */
export function errosParaCsv(erros: readonly LinhaErro[]): string {
  const linhas: string[] = [CABECALHO_ERROS.join(';')];
  for (const e of erros) linhas.push([e.indice + 1, e.external_id, e.codigo, e.campo, e.reprocessavel ? 'sim' : 'nao', e.mensagem].map(celula).join(';'));
  return `${BOM}${linhas.join('\r\n')}\r\n`;
}

/** `erros-<id>.csv`: só o id do lote (UUID), nada do conteúdo. */
export function nomeArquivoErros(loteId: string): string {
  return `erros-${loteId}.csv`;
}

// ---------------------------------------------------------------------------------------------------------------- conferir sem gravar

export interface EntradaConferencia {
  entidade: Entidade;
  registros: readonly unknown[];
  /** Linha física do arquivo de cada registro. */
  linhasArquivo: readonly number[];
  /** Linhas que já falharam na leitura (célula que não converte, colunas a mais). */
  linhasInvalidasLeitura: readonly LinhaInvalidaConector[];
  totalLinhas: number;
  limite: number;
}

/** Valida as linhas com o MESMO schema do lote (RN-INT-02) sem gravar nada. Referências entre entidades só são conferidas ao gravar. */
export function conferirRegistrosDoArquivo(e: EntradaConferencia): Omit<ConferenciaArquivo, 'entidade' | 'modo'> {
  const v = validarLinhas(e.entidade, e.registros);
  const doHub = anotarLinhaDoArquivo(v.erros, e.linhasArquivo);
  const daLeitura: LinhaErro[] = e.linhasInvalidasLeitura.map((l, i) => ({
    indice: i,
    external_id: l.external_id ?? null,
    codigo: l.codigo,
    campo: l.campo ?? null,
    mensagem: l.mensagem,
    reprocessavel: false,
    origem: 'conector',
  }));
  const todos = [...daLeitura, ...doHub];
  const linhasComErro = new Set(doHub.map((x) => x.indice)).size + daLeitura.length;
  return {
    linhas_lidas: e.totalLinhas,
    linhas_validas: Math.max(0, e.totalLinhas - linhasComErro),
    linhas_com_erro: linhasComErro,
    erros: todos.slice(0, e.limite),
    erros_omitidos: Math.max(0, todos.length - e.limite),
    pode_gravar: linhasComErro === 0,
    gravou: false,
  };
}
