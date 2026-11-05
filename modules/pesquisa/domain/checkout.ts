/**
 * Pesquisa obrigatória no checkout da visita (RF-PES-03, RN-PES-03, RN-CORE-12). O módulo registra uma etapa no
 * ponto de extensão `visita.etapas_checkout`; `concluida` da etapa = `!bloqueia_checkout`. Pesquisa avulsa fica na
 * aba "Pesquisas" e nunca entra aqui. O Core só oferece o ponto de extensão no checkout (não no check-in).
 */
import type { Questionario, QuestionarioVersao } from '../contracts';
import { pesquisaAplicavel, type ClienteAlvo, type RespostaAnterior, type UsuarioAlvo } from './publico';
import { versaoVigente } from './questionario';

export interface PesquisaDoTenant {
  questionario: Questionario;
  versoes: readonly QuestionarioVersao[];
}

export interface EntradaCheckout {
  pesquisas: readonly PesquisaDoTenant[];
  usuario: UsuarioAlvo;
  cliente: ClienteAlvo | null;
  visita_id: string;
  agora: string;
  /** Respostas já feitas (as sincronizadas e as da outbox do aparelho). */
  respostas: readonly RespostaAnterior[];
  fuso: string;
  /** RN-PES-03: visita encerrada como "cliente fechado" dispensa a pesquisa. O Core informa. */
  cliente_fechado: boolean;
}

export type EstadoEtapa = 'pendente' | 'concluida' | 'dispensada';

export interface ItemEtapa {
  questionario_id: string;
  versao_id: string;
  titulo: string;
  estado: EstadoEtapa;
}

export interface ResultadoEtapaCheckout {
  itens: ItemEtapa[];
  pendentes: ItemEtapa[];
  /** RN-PES-03: há pesquisa obrigatória pendente — o checkout fica bloqueado. */
  bloqueia_checkout: boolean;
  /** Valor para `EtapaCheckout.concluida` do Core. */
  concluida: boolean;
  /** Texto para a folha de checkout; `null` quando não há pendência. */
  mensagem: string | null;
}

/** RN-PES-03: quais pesquisas obrigatórias faltam nesta visita e se o checkout está bloqueado. */
export function avaliarEtapaCheckout(entrada: EntradaCheckout): ResultadoEtapaCheckout {
  const itens: ItemEtapa[] = [];
  for (const { questionario, versoes } of entrada.pesquisas) {
    const vigente = versaoVigente(questionario, versoes);
    if (!vigente || vigente.modo !== 'checkout_obrigatoria') continue;
    const base = { questionario_id: questionario.id, versao_id: vigente.id, titulo: vigente.titulo };
    const jaRespondida = entrada.respostas.some((r) => r.questionario_id === questionario.id && r.visita_id === entrada.visita_id);
    if (jaRespondida) {
      itens.push({ ...base, estado: 'concluida' });
      continue;
    }
    const ap = pesquisaAplicavel(questionario, versoes, {
      usuario: entrada.usuario,
      cliente: entrada.cliente,
      agora: entrada.agora,
      visita_id: entrada.visita_id,
      respostas_anteriores: entrada.respostas,
      fuso: entrada.fuso,
    });
    if (!ap.aplicavel) continue;
    itens.push({ ...base, estado: entrada.cliente_fechado ? 'dispensada' : 'pendente' });
  }
  const pendentes = itens.filter((i) => i.estado === 'pendente');
  const bloqueia_checkout = pendentes.length > 0;
  const mensagem = bloqueia_checkout
    ? pendentes.length === 1
      ? `Responda a pesquisa "${pendentes[0]!.titulo}" para concluir o checkout.`
      : `Responda as ${pendentes.length} pesquisas obrigatórias (${pendentes.map((p) => `"${p.titulo}"`).join(', ')}) para concluir o checkout.`
    : null;
  return { itens, pendentes, bloqueia_checkout, concluida: !bloqueia_checkout, mensagem };
}

/** Parte do `ContextoCheckout` do Core (RN-CORE-14) de que a Pesquisa precisa; tipo estrutural, sem importar o Core. */
export interface ContextoClienteFechado {
  clienteFechado?: boolean;
  motivoClienteFechado?: 'loja_fechada' | 'acesso_negado' | null;
}

/**
 * RN-PES-03 / RN-CORE-14: visita sem atendimento por cliente fechado (`loja_fechada` ou `acesso_negado`) dispensa a
 * pesquisa obrigatória. Usado na entrada `cliente_fechado` de `avaliarEtapaCheckout` e no `concluida()` da etapa.
 */
export function clienteFechadoNoContexto(ctx: ContextoClienteFechado): boolean {
  return ctx.clienteFechado === true || ctx.motivoClienteFechado === 'loja_fechada' || ctx.motivoClienteFechado === 'acesso_negado';
}

/** Etapa como o Core espera (`EtapaCheckoutVerificada`); tipo estrutural, sem importar o Core no domain. */
export interface EtapaVerificada {
  etapa: string;
  rotulo: string;
  obrigatoria: boolean;
  concluida: boolean;
}

/** Id da etapa agregada; igual ao `ETAPA_PESQUISA_OBRIGATORIA` dos contracts. */
const ID_ETAPA = 'pesquisa.obrigatoria';
const LIMITE_ROTULO = 120;

const cortar = (s: string) => (s.length <= LIMITE_ROTULO ? s : `${s.slice(0, LIMITE_ROTULO - 1)}…`);

/**
 * RN-PES-03 / RN-CORE-12 no servidor (`pesquisa.etapas_checkout@1`): a resposta só conta se foi registrada no servidor para
 * ESTA visita e ESTE cliente. Devolve no máximo uma etapa agregada (`pesquisa.obrigatoria`); nenhuma pesquisa obrigatória
 * aplicável = lista vazia. Cliente fechado (RN-CORE-14) dispensa: a etapa deixa de ser obrigatória (o Core também dispensa).
 */
export function verificarEtapasCheckoutServidor(entrada: EntradaCheckout): EtapaVerificada[] {
  const doCliente = entrada.respostas.filter(
    (r) => r.visita_id === entrada.visita_id && (r.cliente_id === null || entrada.cliente === null || r.cliente_id === entrada.cliente.id),
  );
  const r = avaliarEtapaCheckout({ ...entrada, respostas: doCliente });
  if (r.itens.length === 0) return [];
  const pend = r.pendentes;
  const rotulo =
    pend.length === 0
      ? 'Pesquisa obrigatória'
      : pend.length === 1
        ? cortar(`Pesquisa obrigatória: "${pend[0]!.titulo}"`)
        : `Pesquisas obrigatórias pendentes: ${pend.length}`;
  return [{ etapa: ID_ETAPA, rotulo, obrigatoria: r.itens.some((i) => i.estado !== 'dispensada'), concluida: !r.bloqueia_checkout }];
}
