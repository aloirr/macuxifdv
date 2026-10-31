/** Construtores de dados para os testes do domain (não faz parte da API do módulo). */
import type { ItemResposta, Pergunta, QuestionarioVersao, RegraCondicional, RespostaEnvio } from '../contracts';

export const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const T0 = '2026-10-31T13:00:00Z';
export const TENANT = u(900);
export const QUEST = u(800);

export const sim_nao = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'sim_nao', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra }) as Pergunta;
export const unica = (n: number, opcoes = [101, 102, 103], extra: Partial<Pergunta> = {}) =>
  ({ id: u(n), tipo: 'unica', enunciado: `Pergunta ${n}`, obrigatoria: false, opcoes: opcoes.map((o) => ({ id: u(o), rotulo: `Opção ${o}` })), ...extra }) as Pergunta;
export const multipla = (n: number, opcoes = [201, 202, 203], extra: Partial<Pergunta> = {}) =>
  ({ id: u(n), tipo: 'multipla', enunciado: `Pergunta ${n}`, obrigatoria: false, opcoes: opcoes.map((o) => ({ id: u(o), rotulo: `Opção ${o}` })), ...extra }) as Pergunta;
export const numero = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'numero', enunciado: `Pergunta ${n}`, obrigatoria: false, inteiro: false, ...extra }) as Pergunta;
export const texto = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'texto', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra }) as Pergunta;
export const escala = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'escala', enunciado: `Pergunta ${n}`, obrigatoria: false, minimo: 1, maximo: 5, ...extra }) as Pergunta;
export const data = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'data', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra }) as Pergunta;
export const foto = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'foto', enunciado: `Pergunta ${n}`, obrigatoria: false, min_fotos: 1, max_fotos: 3, ...extra }) as Pergunta;
export const codigo = (n: number, extra: Partial<Pergunta> = {}) => ({ id: u(n), tipo: 'codigo_barras', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra }) as Pergunta;

export const regra = (n: number, alvo: number, origem: number, operador: RegraCondicional['operador'], valor?: RegraCondicional['valor'], acao: RegraCondicional['acao'] = 'mostrar'): RegraCondicional => {
  const r: RegraCondicional = { id: u(n), pergunta_id: u(alvo), acao, origem_id: u(origem), operador };
  if (valor !== undefined) r.valor = valor;
  return r;
};

export const versao = (extra: Partial<QuestionarioVersao> = {}): QuestionarioVersao => ({
  id: u(700),
  questionario_id: QUEST,
  tenant_id: TENANT,
  numero: 1,
  status: 'rascunho',
  titulo: 'Pesquisa de gôndola',
  modo: 'avulsa',
  frequencia: 'a_cada_visita',
  publico_alvo: { perfis: [], equipes: [], segmentos: [], canais: [], regioes: [], clientes: [] },
  vigencia: { inicio: '2026-10-01T00:00:00Z', fim: null },
  perguntas: [sim_nao(1)],
  regras: [],
  criada_em: '2026-10-01T00:00:00Z',
  publicada_em: null,
  publicada_por: null,
  ...extra,
});

export const publicada = (extra: Partial<QuestionarioVersao> = {}): QuestionarioVersao =>
  versao({ status: 'publicada', publicada_em: '2026-10-02T12:00:00Z', publicada_por: u(1000), ...extra });

export const item = {
  simNao: (n: number, valor: boolean): ItemResposta => ({ pergunta_id: u(n), tipo: 'sim_nao', valor }),
  unica: (n: number, opcao: number): ItemResposta => ({ pergunta_id: u(n), tipo: 'unica', opcao_id: u(opcao) }),
  multipla: (n: number, opcoes: number[]): ItemResposta => ({ pergunta_id: u(n), tipo: 'multipla', opcao_ids: opcoes.map(u) }),
  numero: (n: number, v: number): ItemResposta => ({ pergunta_id: u(n), tipo: 'numero', numero: v }),
  texto: (n: number, t: string): ItemResposta => ({ pergunta_id: u(n), tipo: 'texto', texto: t }),
  escala: (n: number, v: number): ItemResposta => ({ pergunta_id: u(n), tipo: 'escala', valor: v }),
  data: (n: number, d: string): ItemResposta => ({ pergunta_id: u(n), tipo: 'data', data: d }),
  foto: (n: number, ids: number[]): ItemResposta => ({ pergunta_id: u(n), tipo: 'foto', fotos: ids.map((i) => ({ id: u(i), referencia: `fotos/${i}.jpg`, capturada_em: T0 })) }),
  codigo: (n: number, c: string): ItemResposta => ({ pergunta_id: u(n), tipo: 'codigo_barras', codigo: c }),
};

export const envio = (itens: ItemResposta[], extra: Partial<RespostaEnvio> = {}): RespostaEnvio => ({
  id: u(5000),
  questionario_id: QUEST,
  versao_id: u(700),
  cliente_id: null,
  visita_id: null,
  respondida_em: T0,
  itens,
  ...extra,
});
