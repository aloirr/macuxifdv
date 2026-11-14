import { describe, expect, it } from 'vitest';
import { CONSULTA_RESPOSTA_LOCAL, RespostaLocalEntradaSchema, RespostaLocalSaidaSchema } from '../../contracts/consulta-tarefa';
import { QUEST, u } from '../../domain/util-teste';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { criarConsultaRespostaLocal, fonteRespostasLocaisPadrao } from './consulta-resposta-local';
import { definirEstadoLocal } from './local';

const ctx = {} as never;
const entrada = (extra: Record<string, unknown> = {}) => RespostaLocalEntradaSchema.parse({ questionario_id: QUEST, cliente_id: u(60), desde: '2026-10-31T00:00:00.000Z', ...extra });
const resp = (id: number, em: string) => ({ id: u(id), questionario_id: QUEST, cliente_id: u(60), respondida_em: em });

describe('pesquisa.resposta_local@1 (RN-PES-02)', () => {
  it('RN-PES-02: devolve a resposta local mais recente da fonte injetada', async () => {
    const c = criarConsultaRespostaLocal(async () => [resp(1, '2026-10-31T09:00:00.000Z'), resp(2, '2026-10-31T10:00:00.000Z')]);
    expect(RespostaLocalSaidaSchema.parse(await c.executar(entrada(), ctx))).toEqual({ resposta_id: u(2) });
  });
  it('RN-PES-02: sem resposta local a partir de desde, resposta_id nulo', async () => {
    const c = criarConsultaRespostaLocal(async () => [resp(1, '2026-10-30T09:00:00.000Z')]);
    expect(await c.executar(entrada(), ctx)).toEqual({ resposta_id: null });
  });
  it('RN-CORE-12: contrato com nome certo, recusa campo extra, cliente aceita nulo', () => {
    expect(CONSULTA_RESPOSTA_LOCAL.nome).toBe('pesquisa.resposta_local@1');
    expect(RespostaLocalEntradaSchema.safeParse({ questionario_id: QUEST, cliente_id: null, desde: '2026-10-31T00:00:00.000Z' }).success).toBe(true);
    expect(RespostaLocalEntradaSchema.safeParse({ questionario_id: QUEST, cliente_id: null, desde: 'ontem' }).success).toBe(false);
    expect(RespostaLocalEntradaSchema.safeParse({ questionario_id: QUEST, cliente_id: null, desde: '2026-10-31T00:00:00.000Z', x: 1 }).success).toBe(false);
  });
});

describe('fonte padrão da resposta local (RN-PES-02)', () => {
  const linha = (id: number, usuario: number, deleted_at: string | null = null) => ({ id: u(id), questionario_id: QUEST, cliente_id: u(60), respondida_em: '2026-10-31T09:00:00.000Z', usuario_id: u(usuario), deleted_at });
  const envio = { id: u(7), questionario_id: QUEST, versao_id: u(8), cliente_id: u(60), visita_id: null, respondida_em: '2026-10-31T11:00:00.000Z', itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }] };
  const item = { id: u(7), entidade: 'resposta_pesquisa', modulo: 'pesquisa', operacao: 'upsert', payload: envio, rotulo: '', detalhe: '', criado_em: '', tentativas: 0, ultimo_erro: '', ultima_tentativa_em: null, situacao: 'pendente', codigo: null };
  const aparelho = (linhas: unknown[], usuario: number | null = 5) => ({ linhas: async () => linhas, usuario: () => (usuario === null ? null : { id: u(usuario) }) }) as unknown as ContextoConsultaAparelho;
  const comFila = (fila: unknown[]) => definirEstadoLocal({ retrato: { pesquisas: [], respostasPull: [], clientes: new Map() }, leitor: { sobreposicao: () => fila as never }, usuario: { id: u(5), perfil: 'vendedor', equipe_ids: [] }, fuso: 'America/Manaus', agora: () => new Date('2026-10-31T13:00:00Z') });

  it('RN-PES-02: junta o pull do usuário (sem apagadas e sem outros usuários) e a fila do aparelho', async () => {
    comFila([item]);
    const r = await fonteRespostasLocaisPadrao(aparelho([linha(1, 5), linha(2, 6), linha(3, 5, '2026-10-31T12:00:00Z')]));
    expect(r.map((x) => x.id)).toEqual([u(1), u(7)]);
    definirEstadoLocal(null);
  });
  it('RN-PES-02: sem estado local usa só o pull; sem usuário logado, nada', async () => {
    definirEstadoLocal(null);
    expect((await fonteRespostasLocaisPadrao(aparelho([linha(1, 5)]))).map((x) => x.id)).toEqual([u(1)]);
    expect(await fonteRespostasLocaisPadrao(aparelho([linha(1, 5)], null))).toEqual([]);
  });
});
