/** Regras puras do reprocesso (desenho, §7); o caminho no banco é `Despachante.reprocessarParados`. */

/** Mais que isto numa empresa = recusa sem mexer em nada (o escopo é a fila parada de uma empresa, não a outbox inteira). */
export const TETO_REPROCESSO = 100;

/** `tentativas` = máximo entra; > máximo já foi reprocessado e parou de novo, e fica fora (o SQL já filtra e ordena). */
export function selecionarParados<T extends { tentativas: number }>(linhas: readonly T[], maxTentativas: number): { reprocessar: T[]; jaTentados: T[] } {
  return {
    reprocessar: linhas.filter((e) => e.tentativas === maxTentativas),
    jaTentados: linhas.filter((e) => e.tentativas > maxTentativas),
  };
}

const RE_INDICE_23505 = /SQLSTATE 23505, [a-z_][a-z0-9_]{0,62}/;
const RE_SQLSTATE = /SQLSTATE [0-9A-Z]{5}/;
const RE_HTTP = /HTTP [0-9]{3}/;
const RE_NOME_ERRO = /^(Erro[A-Z][A-Za-z]{0,40}|[A-Z][A-Za-z]{0,40}Error|ReferenciaAusenteErp)$/;

/**
 * Classe do erro sem texto livre (o mesmo `case` do producao-diagnostico-outbox.yml): o módulo e um rótulo fixo, um código
 * (SQLSTATE, HTTP), o índice único do 23505 ou o nome da classe do erro. Só a 1ª falha (antes de " | ").
 */
export function classeDoErro(ultimoErro: string | null): string {
  const x = (ultimoErro ?? '').split(' | ')[0] ?? '';
  if (x === '') return '(sem erro)';
  const partes = x.split(':');
  const modulo = /^[a-z_]{1,20}$/.test(partes[0] ?? '') ? partes[0]! : '?';
  const nome = (partes[1] ?? '').trim();
  let rotulo: string;
  if (x.includes('Lote aguardando o lote anterior da mesma entidade')) rotulo = 'espera da mesma entidade';
  else if (x.includes('Lote aguardando a carga de')) rotulo = 'espera de dependência';
  else if (x.includes(': efeito depois do commit: ')) rotulo = `efeito ${RE_HTTP.exec(x)?.[0] ?? RE_SQLSTATE.exec(x)?.[0] ?? 'outro'}`;
  else if (RE_INDICE_23505.test(x)) rotulo = RE_INDICE_23505.exec(x)![0];
  else if (RE_SQLSTATE.test(x)) rotulo = RE_SQLSTATE.exec(x)![0];
  else if (RE_NOME_ERRO.test(nome)) rotulo = nome;
  else rotulo = 'outro';
  return `${modulo}: ${rotulo}`;
}

/** Contagem por evento e classe, na ordem da 1ª ocorrência. */
export function resumirPorClasse(itens: readonly { nome: string; classe: string }[]): { nome: string; classe: string; eventos: number }[] {
  const mapa = new Map<string, { nome: string; classe: string; eventos: number }>();
  for (const i of itens) {
    const k = `${i.nome}\u0000${i.classe}`;
    const atual = mapa.get(k);
    if (atual) atual.eventos += 1;
    else mapa.set(k, { nome: i.nome, classe: i.classe, eventos: 1 });
  }
  return [...mapa.values()];
}

/** Resultado de um evento reprocessado (sem payload nem mensagem). */
export interface ItemReprocesso {
  evento_id: string;
  nome: string;
  resultado: 'publicado' | 'parado_de_novo';
  /** Classe da nova falha (`parado_de_novo`); `null` quando publicou. */
  classe_depois: string | null;
}

export interface ResultadoReprocesso {
  /** `leitura` = só a lista (transação desfeita); `reprocessado` = cada evento tentado uma vez. */
  modo: 'leitura' | 'reprocessado';
  maxTentativas: number;
  /** Selecionados (parados, `tentativas` = máximo), com a classe do erro de antes. */
  selecionados: { evento_id: string; nome: string; classe: string }[];
  /** Já reprocessados antes e parados de novo (`tentativas` > máximo): não entram. */
  ja_tentados: number;
  /** Só no modo `reprocessado`. */
  itens: ItemReprocesso[];
}

export class ErroTetoReprocesso extends Error {
  constructor(
    readonly selecionados: number,
    readonly teto: number = TETO_REPROCESSO,
  ) {
    super(`${selecionados} eventos parados passam do teto de ${teto}: nada foi reprocessado`);
    this.name = 'ErroTetoReprocesso';
  }
}
