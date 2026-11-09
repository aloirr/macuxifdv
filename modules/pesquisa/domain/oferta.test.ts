import { describe, expect, it } from 'vitest';
import type { QuestionarioVersao, QuestionarioVersaoSync, RespostaEnvio, RespostaPesquisaSync } from '../contracts';
import { montarPesquisasDoAparelho, ofertaDePesquisas, respostasConhecidas } from './oferta';
import { publicada, QUEST, sim_nao, TENANT, u } from './util-teste';

const linha = (v: QuestionarioVersao, extra: Partial<QuestionarioVersaoSync> = {}): QuestionarioVersaoSync => ({
  id: v.id,
  updated_at: '2026-10-02T12:00:00.000000Z',
  deleted_at: null,
  questionario_id: v.questionario_id,
  numero: v.numero,
  status: v.status,
  arquivado_em: null,
  questionario_criado_em: '2026-10-01T00:00:00Z',
  versao: v,
  ...extra,
});

const AGORA = '2026-10-31T13:00:00Z';
const USUARIO = { id: u(31), perfil: 'vendedor', equipe_ids: [u(41)] };

describe('RF-PES-03 / RN-PES-01: pesquisas no aparelho a partir do pull', () => {
  it('RN-PES-01: agrupa as versões por questionário e a vigente é a publicada de maior número', () => {
    const v1 = publicada({ id: u(701), numero: 1, titulo: 'V1' });
    const v2 = publicada({ id: u(702), numero: 2, titulo: 'V2' });
    const pesquisas = montarPesquisasDoAparelho([linha(v2), linha(v1)]);
    expect(pesquisas).toHaveLength(1);
    expect(pesquisas[0]!.questionario).toEqual({ id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null });
    expect(pesquisas[0]!.versoes.map((v) => v.numero)).toEqual([1, 2]);
  });

  it('linhas removidas no servidor (deleted_at) e rascunhos nunca entram', () => {
    const v1 = publicada({ id: u(701) });
    const rasc = { ...publicada({ id: u(702), numero: 2 }), status: 'rascunho' as const, publicada_em: null, publicada_por: null };
    expect(montarPesquisasDoAparelho([linha(v1, { deleted_at: '2026-10-03T00:00:00Z' })])).toEqual([]);
    expect(montarPesquisasDoAparelho([linha(v1), linha(rasc, { status: 'rascunho' })])[0]!.versoes).toHaveLength(1);
  });

  it('arquivamento vem na linha (o arquivado_em mais recente vale)', () => {
    const v1 = publicada({ id: u(701) });
    const p = montarPesquisasDoAparelho([linha(v1, { arquivado_em: '2026-10-20T00:00:00Z' })]);
    expect(p[0]!.questionario.arquivado_em).toBe('2026-10-20T00:00:00Z');
  });
});

describe('RF-PES-03: oferta da aba "Pesquisas" (avulsas aplicáveis)', () => {
  const avulsa = publicada({ id: u(701), titulo: 'Avulsa', perguntas: [sim_nao(1)] });
  const obrig = publicada({ id: u(711), questionario_id: u(811), titulo: 'Obrigatória', modo: 'checkout_obrigatoria', perguntas: [sim_nao(1)] });
  const soPromotor = publicada({ id: u(721), questionario_id: u(821), titulo: 'Promotor', perguntas: [sim_nao(1)], publico_alvo: { perfis: ['promotor'], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] } });
  const pesquisas = montarPesquisasDoAparelho([linha(avulsa), linha(obrig), linha(soPromotor)]);

  it('RF-PES-03: a aba mostra só avulsas; a obrigatória fica no checkout', () => {
    const o = ofertaDePesquisas({ pesquisas, usuario: USUARIO, cliente: null, visita_id: null, agora: AGORA, respostas: [], fuso: 'America/Manaus' });
    expect(o.disponiveis.map((d) => d.titulo)).toEqual(['Avulsa']);
  });

  it('RF-PES-02: fora do público não aparece como disponível nem como indisponível (não é para o usuário)', () => {
    const o = ofertaDePesquisas({ pesquisas, usuario: USUARIO, cliente: null, visita_id: null, agora: AGORA, respostas: [], fuso: 'America/Manaus' });
    expect(o.indisponiveis.map((d) => d.titulo)).toEqual([]);
  });

  it('RN-PES-02: respondida no mês aparece como indisponível com a data em que volta', () => {
    const mensal = publicada({ id: u(731), questionario_id: u(831), titulo: 'Mensal', frequencia: 'mensal', perguntas: [sim_nao(1)] });
    const ps = montarPesquisasDoAparelho([linha(mensal)]);
    const resp = [{ questionario_id: u(831), usuario_id: u(31), cliente_id: u(51), visita_id: u(61), respondida_em: '2026-10-05T15:00:00Z' }];
    const o = ofertaDePesquisas({ pesquisas: ps, usuario: USUARIO, cliente: { id: u(51), segmento: null, regiao: null }, visita_id: u(62), agora: AGORA, respostas: resp, fuso: 'America/Manaus' });
    expect(o.disponiveis).toEqual([]);
    expect(o.indisponiveis).toEqual([expect.objectContaining({ titulo: 'Mensal', motivo: 'FREQUENCIA', liberada_em: '2026-11-01' })]);
  });

  it('RF-PES-02: pesquisa só para clientes da lista pede o cliente quando aberta sem cliente', () => {
    const lista = publicada({ id: u(741), questionario_id: u(841), titulo: 'Lista', perguntas: [sim_nao(1)], publico_alvo: { perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [u(51)] } });
    const ps = montarPesquisasDoAparelho([linha(lista)]);
    const semCliente = ofertaDePesquisas({ pesquisas: ps, usuario: USUARIO, cliente: null, visita_id: null, agora: AGORA, respostas: [], fuso: 'America/Manaus' });
    expect(semCliente.indisponiveis).toEqual([expect.objectContaining({ motivo: 'CLIENTE_FORA_DO_PUBLICO' })]);
    const comCliente = ofertaDePesquisas({ pesquisas: ps, usuario: USUARIO, cliente: { id: u(51), segmento: null, regiao: null }, visita_id: null, agora: AGORA, respostas: [], fuso: 'America/Manaus' });
    expect(comCliente.disponiveis.map((d) => d.titulo)).toEqual(['Lista']);
  });

  it('RF-PES-02: fora da vigência não é oferecida', () => {
    const futura = publicada({ id: u(751), questionario_id: u(851), titulo: 'Futura', perguntas: [sim_nao(1)], vigencia: { inicio: '2026-12-01T00:00:00Z', fim: null } });
    const o = ofertaDePesquisas({ pesquisas: montarPesquisasDoAparelho([linha(futura)]), usuario: USUARIO, cliente: null, visita_id: null, agora: AGORA, respostas: [], fuso: 'America/Manaus' });
    expect(o.disponiveis).toEqual([]);
  });
});

describe('RN-PES-02 / RF-PES-04: respostas conhecidas no aparelho (pull + fila)', () => {
  const pull: RespostaPesquisaSync = {
    id: u(1),
    updated_at: '2026-10-05T15:00:00.000000Z',
    deleted_at: null,
    questionario_id: QUEST,
    versao_id: u(700),
    usuario_id: u(32),
    cliente_id: u(51),
    visita_id: null,
    respondida_em: '2026-10-05T15:00:00Z',
    recebida_em: '2026-10-05T15:00:01Z',
  };
  const fila: RespostaEnvio = { id: u(2), questionario_id: QUEST, versao_id: u(700), cliente_id: u(51), visita_id: u(61), respondida_em: AGORA, itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }] };

  it('RN-PES-02: junta as do pull (de qualquer usuário do cliente) e as da fila do aparelho, sem repetir id', () => {
    const r = respostasConhecidas({ linhas: [pull, { ...pull, id: u(3), deleted_at: '2026-10-06T00:00:00Z' }], fila: [fila, { ...fila }], usuario_id: u(31) });
    expect(r.map((x) => x.usuario_id)).toEqual([u(32), u(31)]);
    expect(r[1]).toMatchObject({ visita_id: u(61), cliente_id: u(51) });
  });
});
