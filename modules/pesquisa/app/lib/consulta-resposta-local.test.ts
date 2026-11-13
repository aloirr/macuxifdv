import { describe, expect, it } from 'vitest';
import { CONSULTA_RESPOSTA_LOCAL, RespostaLocalEntradaSchema, RespostaLocalSaidaSchema } from '../../contracts/consulta-tarefa';
import { QUEST, u } from '../../domain/util-teste';
import { criarConsultaRespostaLocal } from './consulta-resposta-local';

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
