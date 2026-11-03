/**
 * Escrita offline idempotente (RF-PES-04, doc 04 "Conflitos": respostas de pesquisa são somente inserção).
 * O aparelho gera o UUID da resposta; reenviar a mesma resposta não duplica; o mesmo id com conteúdo diferente é
 * conflito e NUNCA sobrescreve a resposta gravada.
 */
import type { ItemResposta, RespostaEnvio } from '../contracts';

/** Parte da resposta que identifica o conteúdo (campos do servidor ficam de fora). */
type ConteudoComparavel = Pick<RespostaEnvio, 'id' | 'questionario_id' | 'versao_id' | 'cliente_id' | 'visita_id' | 'respondida_em' | 'itens'>;

function canonicoDoItem(i: ItemResposta): unknown {
  switch (i.tipo) {
    case 'multipla':
      return { ...i, opcao_ids: [...i.opcao_ids].sort() };
    case 'foto':
      return { ...i, fotos: [...i.fotos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
    default:
      return i;
  }
}

/** Mesma hora, mesma grafia: o banco devolve milissegundos (`.000Z`) e o aparelho pode ter enviado sem eles. */
function instanteCanonico(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}

function ordenarChaves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenarChaves);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, ordenarChaves(x)]),
    );
  }
  return v;
}

/** Texto canônico do conteúdo: ignora a ordem dos itens, das opções e das fotos, e campos do servidor. */
export function impressaoDaResposta(r: ConteudoComparavel): string {
  const itens = [...r.itens].sort((a, b) => (a.pergunta_id < b.pergunta_id ? -1 : a.pergunta_id > b.pergunta_id ? 1 : 0)).map(canonicoDoItem);
  return JSON.stringify(
    ordenarChaves({
      id: r.id,
      questionario_id: r.questionario_id,
      versao_id: r.versao_id,
      cliente_id: r.cliente_id ?? null,
      visita_id: r.visita_id ?? null,
      respondida_em: instanteCanonico(r.respondida_em),
      itens,
    }),
  );
}

export type DecisaoInsercao = { resultado: 'inserir' } | { resultado: 'duplicada' } | { resultado: 'conflito'; codigo: 'CONFLITO_DE_CONTEUDO'; mensagem: string };

/** RF-PES-04: o que fazer ao receber `nova` quando já existe (ou não) uma resposta com o mesmo id. */
export function decidirInsercao(existente: ConteudoComparavel | null | undefined, nova: ConteudoComparavel): DecisaoInsercao {
  if (!existente) return { resultado: 'inserir' };
  if (impressaoDaResposta(existente) === impressaoDaResposta(nova)) return { resultado: 'duplicada' };
  return {
    resultado: 'conflito',
    codigo: 'CONFLITO_DE_CONTEUDO',
    mensagem: 'Uma resposta com este código já foi recebida com conteúdo diferente. Respostas não podem ser alteradas: refaça a pesquisa para gerar uma nova.',
  };
}

/** RF-PES-04: processa um lote da outbox na ordem recebida; o mesmo id repetido no lote vale uma vez só. */
export function processarLote(existentes: Iterable<ConteudoComparavel>, lote: readonly ConteudoComparavel[]): ({ id: string } & DecisaoInsercao)[] {
  const gravadas = new Map<string, ConteudoComparavel>();
  for (const e of existentes) gravadas.set(e.id, e);
  return lote.map((nova) => {
    const d = decidirInsercao(gravadas.get(nova.id), nova);
    if (d.resultado === 'inserir') gravadas.set(nova.id, nova);
    return { id: nova.id, ...d };
  });
}
