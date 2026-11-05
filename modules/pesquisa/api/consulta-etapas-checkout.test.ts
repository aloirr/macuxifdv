import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EtapasCheckoutEntradaSchema, EtapasCheckoutSaidaSchema } from '@macuxi/core/contracts';
import { CONSULTA_ETAPAS_CHECKOUT_PESQUISA, type Questionario, type RespostaPesquisa } from '../contracts';
import { publicada, QUEST, TENANT, u } from '../domain/util-teste';
import manifest from '../manifest';
import { criarApiPesquisa } from './index';
import { criarConsultaEtapasCheckout } from './consulta-etapas-checkout';
import { criarRepositorioEmMemoria } from './repositorio-memoria';

const AGORA = '2026-10-31T15:00:00.000Z';
const VISITA = u(70);
const CLIENTE = u(60);
const USUARIO = u(1);
const db: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) };

const ctx = (perfil = 'promotor', id = USUARIO, tenant = TENANT): ContextoConsulta =>
  ({
    db,
    usuario: { id, tenant_id: tenant, perfil, modulos: ['core', 'pesquisa'] },
    requestId: 'req-teste',
    agora: () => new Date(AGORA),
    parametros: () => ({}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  }) as unknown as ContextoConsulta;

const q = (id: string): Questionario => ({ id, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null });
const resposta = (extra: Partial<RespostaPesquisa> = {}): RespostaPesquisa => ({
  id: u(900),
  tenant_id: TENANT,
  questionario_id: QUEST,
  versao_id: u(700),
  cliente_id: CLIENTE,
  visita_id: VISITA,
  respondida_em: '2026-10-31T14:00:00.000Z',
  itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }],
  usuario_id: USUARIO,
  equipe_id: null,
  recebida_em: '2026-10-31T14:00:01.000Z',
  suspeita: false,
  motivos_suspeita: [],
  ...extra,
});
const entrada = (extra: Record<string, unknown> = {}) =>
  EtapasCheckoutEntradaSchema.parse({ visita_id: VISITA, cliente_id: CLIENTE, usuario_id: USUARIO, cliente_fechado: false, ...extra });

async function ambiente(versao = publicada({ modo: 'checkout_obrigatoria', titulo: 'Gôndola do mês' })) {
  const fabrica = criarRepositorioEmMemoria();
  const repo = fabrica(TENANT, db);
  await repo.criarQuestionario(q(QUEST), { ...versao, status: 'rascunho' }, AGORA);
  await repo.gravarVersao(versao, AGORA);
  return { fabrica, repo, consulta: criarConsultaEtapasCheckout(fabrica) };
}

describe('pesquisa.etapas_checkout@1 (RN-PES-03, RN-CORE-12)', () => {
  it('RN-PES-03: o manifesto oferece a consulta e a API a implementa (contrato do Core)', () => {
    expect(manifest.ofereceConsultas).toEqual(['pesquisa.etapas_checkout@1']);
    expect(CONSULTA_ETAPAS_CHECKOUT_PESQUISA.nome).toBe('pesquisa.etapas_checkout@1');
    const api = criarApiPesquisa(criarRepositorioEmMemoria());
    expect((api.consultas ?? []).map((c) => c.consulta.nome)).toEqual(['pesquisa.etapas_checkout@1']);
  });

  it('RN-PES-03: pesquisa obrigatória sem resposta na visita = etapa obrigatória e pendente', async () => {
    const { consulta } = await ambiente();
    const saida = EtapasCheckoutSaidaSchema.parse(await consulta.executar(entrada(), ctx()));
    expect(saida.etapas).toEqual([{ etapa: 'pesquisa.obrigatoria', rotulo: 'Pesquisa obrigatória: "Gôndola do mês"', obrigatoria: true, concluida: false }]);
  });

  it('RN-PES-03: resposta registrada no servidor para a visita e o cliente conclui a etapa', async () => {
    const { consulta, repo } = await ambiente();
    await repo.inserirResposta(resposta(), AGORA);
    const saida = EtapasCheckoutSaidaSchema.parse(await consulta.executar(entrada(), ctx()));
    expect(saida.etapas[0]).toMatchObject({ obrigatoria: true, concluida: true });
  });

  it('RN-PES-03: resposta de outra visita ou de outro cliente não conclui a etapa', async () => {
    const { consulta, repo } = await ambiente();
    await repo.inserirResposta(resposta({ id: u(901), visita_id: u(71) }), AGORA);
    await repo.inserirResposta(resposta({ id: u(902), cliente_id: u(61) }), AGORA);
    const saida = await consulta.executar(entrada(), ctx());
    expect(saida.etapas[0]).toMatchObject({ concluida: false });
  });

  it('RN-PES-03 / RN-CORE-14: cliente fechado dispensa a etapa', async () => {
    const { consulta } = await ambiente();
    const saida = await consulta.executar(entrada({ cliente_fechado: true }), ctx());
    expect(saida.etapas[0]).toMatchObject({ obrigatoria: false, concluida: true });
  });

  it('RF-PES-02: pesquisa só para vendedor não é etapa do promotor', async () => {
    const restrita = publicada({ modo: 'checkout_obrigatoria', publico_alvo: { perfis: ['vendedor'], equipes: [], segmentos: [], regioes: [], clientes: [] } });
    const { consulta } = await ambiente(restrita);
    expect((await consulta.executar(entrada(), ctx('promotor'))).etapas).toEqual([]);
    expect((await consulta.executar(entrada(), ctx('vendedor'))).etapas).toHaveLength(1);
  });

  it('RF-PES-02: público por segmento, que a consulta não consegue verificar, não bloqueia a visita', async () => {
    const porSegmento = publicada({ modo: 'checkout_obrigatoria', publico_alvo: { perfis: [], equipes: [], segmentos: ['mercado'], regioes: [], clientes: [] } });
    const { consulta } = await ambiente(porSegmento);
    expect((await consulta.executar(entrada(), ctx())).etapas).toEqual([]);
  });

  it('RF-PES-02: público com o cliente nominal é verificado normalmente', async () => {
    const nominal = publicada({ modo: 'checkout_obrigatoria', publico_alvo: { perfis: [], equipes: [], segmentos: ['mercado'], regioes: [], clientes: [CLIENTE] } });
    const { consulta } = await ambiente(nominal);
    expect((await consulta.executar(entrada(), ctx())).etapas).toHaveLength(1);
  });

  it('RF-PES-02: fora da vigência ou arquivada, sem etapa; avulsa nunca é etapa', async () => {
    const vencida = publicada({ modo: 'checkout_obrigatoria', vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-09-30T00:00:00Z' } });
    expect((await (await ambiente(vencida)).consulta.executar(entrada(), ctx())).etapas).toEqual([]);
    const avulsa = publicada({ modo: 'avulsa' });
    expect((await (await ambiente(avulsa)).consulta.executar(entrada(), ctx())).etapas).toEqual([]);
    const a = await ambiente();
    await a.repo.arquivar(QUEST, AGORA);
    expect((await a.consulta.executar(entrada(), ctx())).etapas).toEqual([]);
  });

  it('RN-PES-01: isolamento por tenant — pesquisa de outro tenant não vira etapa', async () => {
    const { consulta } = await ambiente();
    expect((await consulta.executar(entrada(), ctx('promotor', USUARIO, u(9999)))).etapas).toEqual([]);
  });

  it('RN-CORE-12: entrada fora do contrato (campo extra ou id inválido) é recusada pelo schema', () => {
    expect(() => entrada({ extra: 1 })).toThrow();
    expect(() => entrada({ visita_id: 'x' })).toThrow();
  });
});
