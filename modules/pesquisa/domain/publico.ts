/**
 * Público-alvo, vigência e frequência (RF-PES-02, RN-PES-02) e a pergunta "esta pesquisa vale para este usuário,
 * neste cliente, agora?". Funções puras: o Core entrega equipe/cliente já resolvidos; a Pesquisa não lê tabela alheia.
 */
import { diaLocal, somarDias } from './util';
import type { Frequencia, PublicoAlvo, Questionario, QuestionarioVersao, Vigencia } from '../contracts';
import { versaoVigente } from './questionario';
import { instanteMs } from './util';

export interface UsuarioAlvo {
  id: string;
  perfil: string;
  /** Equipe do usuário e as equipes acima dela na árvore (o Core informa; premissa T-0012). */
  equipe_ids: readonly string[];
}

export interface ClienteAlvo {
  id: string;
  segmento: string | null;
  regiao: string | null;
}

export interface RespostaAnterior {
  questionario_id: string;
  usuario_id: string;
  cliente_id: string | null;
  visita_id: string | null;
  respondida_em: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const contem = (lista: readonly string[], valor: string | null) => valor !== null && lista.some((x) => norm(x) === norm(valor));

/** RF-PES-02: o perfil do usuário está no público? Lista vazia = sem restrição. */
export function perfilNoPublico(publico: PublicoAlvo, usuario: Pick<UsuarioAlvo, 'perfil'>): boolean {
  return publico.perfis.length === 0 || (publico.perfis as readonly string[]).includes(usuario.perfil);
}

/** RF-PES-02: alguma equipe do usuário (ou acima) está no público? Lista vazia = sem restrição. */
export function equipeNoPublico(publico: PublicoAlvo, usuario: Pick<UsuarioAlvo, 'equipe_ids'>): boolean {
  return publico.equipes.length === 0 || usuario.equipe_ids.some((e) => publico.equipes.includes(e));
}

/** RF-PES-02: perfis e equipes valem juntos (E). */
export function publicoContemUsuario(publico: PublicoAlvo, usuario: UsuarioAlvo): boolean {
  return perfilNoPublico(publico, usuario) && equipeNoPublico(publico, usuario);
}

/**
 * RF-PES-02: critérios de cliente. Segmento e região preenchidos (sem canal: RN-PES-05) valem juntos (E); a lista de clientes soma a
 * eles (OU). Sem nenhum critério, vale para qualquer cliente e também para pesquisa sem cliente (avulsa);
 * com critério e sem cliente em contexto, não se aplica.
 */
export function publicoContemCliente(publico: PublicoAlvo, cliente: ClienteAlvo | null): boolean {
  const temAtributos = publico.segmentos.length + publico.regioes.length > 0;
  const temLista = publico.clientes.length > 0;
  if (!temAtributos && !temLista) return true;
  if (cliente === null) return false;
  const porAtributo =
    temAtributos &&
    (publico.segmentos.length === 0 || contem(publico.segmentos, cliente.segmento)) &&
    (publico.regioes.length === 0 || contem(publico.regioes, cliente.regiao));
  return porAtributo || (temLista && publico.clientes.includes(cliente.id));
}

/** RF-PES-02: início e fim inclusivos, em UTC; fim nulo = sem prazo. */
export function vigenteEm(vigencia: Vigencia, instante: string): boolean {
  const t = instanteMs(instante);
  return t >= instanteMs(vigencia.inicio) && (vigencia.fim === null || t <= instanteMs(vigencia.fim));
}

export type MotivoFrequencia = 'JA_RESPONDIDA_PARA_O_CLIENTE' | 'JA_RESPONDIDA_NA_VISITA' | 'JA_RESPONDIDA_NA_SEMANA' | 'JA_RESPONDIDA_NO_MES';

export interface ResultadoFrequencia {
  permite: boolean;
  motivo?: MotivoFrequencia;
  /** Primeiro dia civil (fuso do tenant) em que reaparece; `null` = não reaparece / só na próxima visita. */
  liberada_em?: string | null;
}

export interface ContextoFrequencia {
  questionario_id: string;
  usuario_id: string;
  cliente_id: string | null;
  visita_id: string | null;
  /** Instante atual (UTC). */
  agora: string;
  fuso: string;
}

/** Segunda-feira da semana civil da data (semana de segunda a domingo). */
function inicioDaSemana(dia: string): string {
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((dow + 6) % 7));
}

function primeiroDiaDoProximoMes(dia: string): string {
  const [a, m] = dia.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * RN-PES-02: a frequência controla quando a pesquisa reaparece para o mesmo cliente/usuário. A chave é o cliente
 * quando há cliente em contexto (qualquer usuário conta, RN-PES-02) e o usuário quando não há (premissa). Semana = segunda
 * a domingo e mês = mês civil, no fuso do tenant. A frequência controla a OFERTA; resposta recebida nunca é recusada por ela.
 */
export function frequenciaPermite(frequencia: Frequencia, anteriores: readonly RespostaAnterior[], ctx: ContextoFrequencia): ResultadoFrequencia {
  const mesmaChave = (r: RespostaAnterior) => (ctx.cliente_id !== null ? r.cliente_id === ctx.cliente_id : r.cliente_id === null && r.usuario_id === ctx.usuario_id);
  const relevantes = anteriores.filter((r) => r.questionario_id === ctx.questionario_id && mesmaChave(r));
  const hoje = diaLocal(ctx.agora, ctx.fuso);

  switch (frequencia) {
    case 'uma_vez_por_cliente':
      return relevantes.length > 0 ? { permite: false, motivo: 'JA_RESPONDIDA_PARA_O_CLIENTE', liberada_em: null } : { permite: true };
    case 'a_cada_visita':
      if (ctx.visita_id !== null && relevantes.some((r) => r.visita_id === ctx.visita_id)) return { permite: false, motivo: 'JA_RESPONDIDA_NA_VISITA', liberada_em: null };
      return { permite: true };
    case 'semanal': {
      const semana = inicioDaSemana(hoje);
      if (relevantes.some((r) => inicioDaSemana(diaLocal(r.respondida_em, ctx.fuso)) === semana)) return { permite: false, motivo: 'JA_RESPONDIDA_NA_SEMANA', liberada_em: somarDias(semana, 7) };
      return { permite: true };
    }
    case 'mensal': {
      const mes = hoje.slice(0, 7);
      if (relevantes.some((r) => diaLocal(r.respondida_em, ctx.fuso).slice(0, 7) === mes)) return { permite: false, motivo: 'JA_RESPONDIDA_NO_MES', liberada_em: primeiroDiaDoProximoMes(hoje) };
      return { permite: true };
    }
  }
}

export type MotivoInaplicavel =
  | 'QUESTIONARIO_ARQUIVADO'
  | 'SEM_VERSAO_PUBLICADA'
  | 'FORA_DA_VIGENCIA'
  | 'PERFIL_FORA_DO_PUBLICO'
  | 'EQUIPE_FORA_DO_PUBLICO'
  | 'CLIENTE_FORA_DO_PUBLICO'
  | 'FREQUENCIA';

export interface ContextoAplicabilidade {
  usuario: UsuarioAlvo;
  /** Cliente da visita/da tela; `null` na pesquisa avulsa sem cliente. */
  cliente: ClienteAlvo | null;
  agora: string;
  visita_id: string | null;
  respostas_anteriores: readonly RespostaAnterior[];
  fuso: string;
}

export interface Aplicabilidade {
  aplicavel: boolean;
  /** Versão vigente avaliada (null se não há publicada). */
  versao: QuestionarioVersao | null;
  motivo?: MotivoInaplicavel;
  mensagem?: string;
  /** Quando `motivo = FREQUENCIA`: dia em que reaparece. */
  liberada_em?: string | null;
}

/**
 * RF-PES-02: esta pesquisa vale para este usuário, neste cliente, agora? Avalia a versão vigente (publicada de maior
 * número): arquivada → vigência → perfil → equipe → cliente → frequência.
 */
export function pesquisaAplicavel(questionario: Questionario, versoes: readonly QuestionarioVersao[], ctx: ContextoAplicabilidade): Aplicabilidade {
  const nao = (versao: QuestionarioVersao | null, motivo: MotivoInaplicavel, mensagem: string, extra: Partial<Aplicabilidade> = {}): Aplicabilidade => ({ aplicavel: false, versao, motivo, mensagem, ...extra });
  if (questionario.arquivado_em !== null) return nao(null, 'QUESTIONARIO_ARQUIVADO', 'Esta pesquisa foi arquivada e não é mais oferecida.');
  const v = versaoVigente(questionario, versoes);
  if (!v) return nao(null, 'SEM_VERSAO_PUBLICADA', 'Esta pesquisa ainda não tem versão publicada.');
  if (!vigenteEm(v.vigencia, ctx.agora)) return nao(v, 'FORA_DA_VIGENCIA', 'Esta pesquisa está fora do período de vigência.');
  if (!perfilNoPublico(v.publico_alvo, ctx.usuario)) return nao(v, 'PERFIL_FORA_DO_PUBLICO', 'Esta pesquisa não é para o seu perfil.');
  if (!equipeNoPublico(v.publico_alvo, ctx.usuario)) return nao(v, 'EQUIPE_FORA_DO_PUBLICO', 'Esta pesquisa não é para a sua equipe.');
  if (!publicoContemCliente(v.publico_alvo, ctx.cliente)) {
    return nao(v, 'CLIENTE_FORA_DO_PUBLICO', ctx.cliente === null ? 'Esta pesquisa vale para clientes específicos. Escolha o cliente para responder.' : 'Esta pesquisa não é para este cliente.');
  }
  const f = frequenciaPermite(v.frequencia, ctx.respostas_anteriores, { questionario_id: questionario.id, usuario_id: ctx.usuario.id, cliente_id: ctx.cliente?.id ?? null, visita_id: ctx.visita_id, agora: ctx.agora, fuso: ctx.fuso });
  if (!f.permite) return nao(v, 'FREQUENCIA', 'Esta pesquisa já foi respondida e só reaparece conforme a frequência definida.', { liberada_em: f.liberada_em ?? null });
  return { aplicavel: true, versao: v };
}
