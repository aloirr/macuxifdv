import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { ehConsultaIndisponivel } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_QUESTIONARIOS_PARA_TAREFA, QuestionariosParaTarefaEntradaSchema as Entrada, QuestionariosParaTarefaSaidaSchema } from '../contracts/consulta-tarefa';
import type { Questionario } from '../contracts';
import { publicada, QUEST, TENANT, u } from '../domain/util-teste';
import { criarConsultaQuestionariosParaTarefa } from './consulta-questionarios-para-tarefa';
import { criarRepositorioEmMemoria } from './repositorio-memoria';

const AGORA = '2026-10-31T15:00:00.000Z';
const db: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) };
const ctx = (perfil = 'promotor', modulos = ['core', 'pesquisa'], tenant = TENANT): ContextoConsulta =>
  ({ db, usuario: { id: u(1), tenant_id: tenant, perfil, modulos }, requestId: 'r', agora: () => new Date(AGORA), fuso: () => 'America/Manaus', parametros: () => ({}), log: { debug() {}, info() {}, warn() {}, error() {} } }) as unknown as ContextoConsulta;
const q: Questionario = { id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null };

async function ambiente(versao = publicada({ titulo: 'Gôndola', publico_alvo: { perfis: ['promotor'], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] } })) {
  const fabrica = criarRepositorioEmMemoria();
  const repo = fabrica(TENANT, db);
  await repo.criarQuestionario(q, { ...versao, status: 'rascunho' }, AGORA);
  await repo.gravarVersao(versao, AGORA);
  return { repo, consulta: criarConsultaQuestionariosParaTarefa(fabrica) };
}

describe('pesquisa.questionarios_para_tarefa@1 (RF-PES-02, RN-PES-02)', () => {
  it('RN-PES-02: devolve o questionário vigente conforme o contrato; o perfil do próprio usuário dentro do público não é marcado', async () => {
    const { consulta } = await ambiente();
    const saida = QuestionariosParaTarefaSaidaSchema.parse(await consulta.executar(Entrada.parse({ usuario_ids: [u(1), u(2)] }), ctx()));
    expect(saida).toEqual([{ questionario_id: QUEST, titulo: 'Gôndola', vigente_ate: null, fora_do_publico: [] }]);
  });

  it('RF-PES-02: perfil do solicitante fora do público aparece em fora_do_publico', async () => {
    const { consulta } = await ambiente();
    const saida = await consulta.executar(Entrada.parse({ usuario_ids: [u(1)] }), ctx('vendedor'));
    expect(saida[0]?.fora_do_publico).toEqual([u(1)]);
  });

  it('RN-CORE-03: sem a licença da Pesquisa a consulta fica indisponível', async () => {
    const { consulta } = await ambiente();
    const erro = await consulta.executar(Entrada.parse({ usuario_ids: [u(1)] }), ctx('promotor', ['core'])).catch((e: unknown) => e);
    expect(ehConsultaIndisponivel(erro)).toBe(true);
  });

  it('RN-PES-01: isolamento por tenant e arquivada sai da lista', async () => {
    const a = await ambiente();
    expect(await a.consulta.executar(Entrada.parse({ usuario_ids: [u(1)] }), ctx('promotor', ['core', 'pesquisa'], u(9999)))).toEqual([]);
    await a.repo.arquivar(QUEST, AGORA);
    expect(await a.consulta.executar(Entrada.parse({ usuario_ids: [u(1)] }), ctx())).toEqual([]);
  });

  it('RN-CORE-12: entrada com 0 ou mais de 500 ids, id inválido ou campo extra é recusada', () => {
    expect(CONSULTA_QUESTIONARIOS_PARA_TAREFA.nome).toBe('pesquisa.questionarios_para_tarefa@1');
    expect(Entrada.safeParse({ usuario_ids: [] }).success).toBe(false);
    expect(Entrada.safeParse({ usuario_ids: Array.from({ length: 501 }, (_, i) => u(i + 1)) }).success).toBe(false);
    expect(Entrada.safeParse({ usuario_ids: Array.from({ length: 500 }, (_, i) => u(i + 1)) }).success).toBe(true);
    expect(Entrada.safeParse({ usuario_ids: ['x'] }).success).toBe(false);
    expect(Entrada.safeParse({ usuario_ids: [u(1)], extra: 1 }).success).toBe(false);
  });
});
