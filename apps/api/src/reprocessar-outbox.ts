/**
 * Reprocesso único dos eventos PARADOS da outbox de uma empresa (workflow producao-reprocessar-outbox.yml; desenho
 * docs/desenho/outbox-parada-v1014.md, §7). Regras puras; o caminho no banco é `Despachante.reprocessarParados`
 * (despachante.ts), que entrega pelo MESMO `entregar` do ciclo normal (mesmos consumidores, mesma idempotência
 * `plataforma.evento_consumo`, mesma licença do tenant). A CLI é `cli/reprocessar-outbox.ts`.
 *
 * - Parado = `publicado_em` nulo e `tentativas` = máximo do despachante (10): o despachante não o pega mais.
 * - Uma vez só: a tentativa do reprocesso soma 1 (10 → 11). Se falhar, o evento fica com `tentativas` > máximo, continua
 *   parado (o alerta OUTBOX_PARADA conta `>= 10`) e nenhuma rodada seguinte o seleciona de novo (`jaTentados`).
 * - Saída sem texto livre: só id técnico, nome do evento e a classe do erro (a mesma do producao-diagnostico-outbox.yml).
 */

/** Linha de `plataforma.evento` com o que a seleção usa (envelope pelo `macuxi_worker`; erro e exclusão pelo `macuxi_app`). */
export interface EventoParadoLido {
  id: string;
  tenant_id: string;
  nome: string;
  tentativas: number;
  publicado_em: Date | null;
  deleted_at: Date | null;
  ocorrido_em: Date;
  ultimo_erro: string | null;
}

/** Mais que isto numa empresa = recusa sem mexer em nada (o escopo é a fila parada de uma empresa, não a outbox inteira). */
export const TETO_REPROCESSO = 100;

/**
 * Seleção do reprocesso: só a empresa pedida, só evento com consumidor instalado, não publicado, não apagado e com
 * `tentativas` = máximo. Com `tentativas` > máximo = já passou por um reprocesso e parou de novo: fica fora (`jaTentados`).
 * Ordem do despachante: `ocorrido_em`, depois `id` (os nós da árvore chegam antes dos produtos).
 */
export function selecionarParados(
  linhas: readonly EventoParadoLido[],
  o: { tenantId: string; nomes: readonly string[]; maxTentativas: number },
): { reprocessar: EventoParadoLido[]; jaTentados: EventoParadoLido[] } {
  const nomes = new Set(o.nomes);
  const candidatos = linhas
    .filter((e) => e.tenant_id === o.tenantId && nomes.has(e.nome) && e.publicado_em === null && e.deleted_at === null)
    .sort((a, b) => a.ocorrido_em.getTime() - b.ocorrido_em.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    reprocessar: candidatos.filter((e) => e.tentativas === o.maxTentativas),
    jaTentados: candidatos.filter((e) => e.tentativas > o.maxTentativas),
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
  /** Classe do erro que o deixou parado. */
  classe_antes: string;
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
  constructor(readonly selecionados: number) {
    super(`${selecionados} eventos parados passam do teto de ${TETO_REPROCESSO}: nada foi reprocessado`);
    this.name = 'ErroTetoReprocesso';
  }
}
