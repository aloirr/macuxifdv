import { LoteEnvelope } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { chaveDoLote, montarLotes } from '../src/lotes';
import { limitarLinhasInvalidas, resumirLinha } from '../src/mapeamento';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { VERSAO_CONECTOR } from '../src/versao';
import { type Ambiente, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente;
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined as unknown as Ambiente;
});

const ruim = (id: string, seg: number) => ({ ...cliente(id, `2026-03-01T10:${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}Z`), razao_social: null });
/** O Hub já tem cursor: o Conector segue por delta (sem carga completa). */
function emDelta(a: Ambiente) {
  a.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
}
async function volta(a: Ambiente) {
  await sincronizarEntidade(a.ctx, 'cliente');
  for (let i = 0; i < 4; i++) {
    await processarFila(a.ctx);
    a.relogio.avancar(6_000);
  }
}

describe('RN-INT-03: linhas inválidas do Conector vão ao Hub com o motivo (decisão do Alexandre, T-0023)', () => {
  it('RN-INT-03: o lote leva linhas_invalidas (external_id, código, campo, mensagem) fora de registros, sem valor de dado', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z', 'Padaria 12.345.678/0001-95'), ruim('c2', 1)]);
    await volta(amb);
    const env = amb.hub.envelopes[0] as LoteEnvelope;
    expect(env.registros).toHaveLength(1);
    expect(env.linhas_invalidas).toEqual([{ external_id: 'c2', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor' }]);
    expect(env.linhas_invalidas_omitidas).toBeUndefined();
    expect(LoteEnvelope.safeParse(env).success).toBe(true);
    expect(JSON.stringify(env.linhas_invalidas)).not.toMatch(/Padaria|12\.345/);
  });

  it('RN-INT-03: o lote informa conector_id e versao_conector (T-0023)', async () => {
    amb = await criarAmbiente();
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    await volta(amb);
    expect(amb.hub.envelopes[0]).toMatchObject({ conector_id: 'cnx-teste-01', versao_conector: VERSAO_CONECTOR });
    expect(amb.hub.chamadas.find((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes'))).toMatchObject({ conectorId: 'cnx-teste-01', versao: VERSAO_CONECTOR });
  });

  it('RN-INT-03 (delta): acima do limite por lote (padrão 500) vão só as 500 primeiras com motivo; as restantes só em contagem', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 5000 } });
    emDelta(amb);
    const linhas = [cliente('ok1', '2026-03-01T09:00:00Z'), ...Array.from({ length: 520 }, (_, i) => ruim(`r${String(i).padStart(3, '0')}`, i + 1))];
    amb.erp.definir('cliente', linhas);
    await volta(amb);
    const env = amb.hub.envelopes[0] as LoteEnvelope;
    expect(env.registros).toHaveLength(1);
    expect(env.linhas_invalidas).toHaveLength(500);
    expect(env.linhas_invalidas?.[0]?.external_id).toBe('r000');
    expect(env.linhas_invalidas_omitidas).toBe(20);
    // o cursor andou por todas as linhas (as inválidas não travam o delta)
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('r519');
    // as primeiras 200 por página ficam nos erros locais (conector status) para o técnico do cliente
    expect(amb.ctx.store.contarErros().find((e) => e.entidade === 'cliente' && e.origem === 'local')?.total).toBe(200);
  });

  it('RN-INT-03 (delta): o limite é parâmetro (lote.maxLinhasInvalidas) e 0 desliga o detalhe (só a contagem)', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10, maxLinhasInvalidas: 2 } });
    emDelta(amb);
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T09:00:00Z'), ruim('c2', 1), ruim('c3', 2), ruim('c4', 3)]);
    await volta(amb);
    expect(amb.hub.envelopes[0]?.linhas_invalidas?.map((l) => l.external_id)).toEqual(['c2', 'c3']);
    expect(amb.hub.envelopes[0]?.linhas_invalidas_omitidas).toBe(1);
    expect(limitarLinhasInvalidas([{ codigo: 'registro_invalido', mensagem: 'x' }], 0)).toEqual({ enviadas: [], omitidas: 1 });
  });

  it('RN-INT-03: o Hub devolve as linhas com origem `conector`; o Conector não as conta de novo como erro do Hub', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z'), ruim('c2', 1)]);
    await volta(amb);
    const lote = [...amb.hub.lotes.values()][0];
    expect(lote?.status).toBe('concluido_com_erros');
    expect(lote?.erros[0]).toMatchObject({ origem: 'conector', external_id: 'c2' });
    expect(amb.ctx.store.contarErros().find((e) => e.origem === 'hub')).toBeUndefined();
    expect(amb.ctx.store.estado('cliente')?.confirmado?.external_id).toBe('c2');
  });

  it('RN-INT-03 (delta): com linhasInvalidas=descartar nada vai ao Hub (fica só no log e nos erros locais)', async () => {
    amb = await criarAmbiente();
    emDelta(amb);
    (amb.ctx.config.entidades.cliente as { linhasInvalidas: string }).linhasInvalidas = 'descartar';
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z'), ruim('c2', 1)]);
    await volta(amb);
    expect(amb.hub.envelopes[0]?.linhas_invalidas).toBeUndefined();
    expect(amb.ctx.store.contarErros().find((e) => e.origem === 'local')?.total).toBe(1);
  });

  it('RN-INT-01 (exceção, D-2 da T-0027): página só com linhas inválidas vira lote SÓ com elas (registros vazio) e o cursor segue', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    emDelta(amb);
    amb.erp.definir('cliente', [ruim('c1', 1), ruim('c2', 2)]);
    await volta(amb);
    expect(amb.hub.envelopes).toHaveLength(1);
    expect(amb.hub.envelopes[0]).toMatchObject({ modo: 'delta', registros: [] });
    expect(amb.hub.envelopes[0]?.linhas_invalidas?.map((l) => l.external_id)).toEqual(['c1', 'c2']);
    expect([...amb.hub.lotes.values()][0]?.status).toBe('concluido_com_erros');
    expect(amb.logs.join('\n')).not.toContain('linhas_invalidas_sem_lote');
    expect(amb.ctx.store.estado('cliente')).toMatchObject({ bloqueio: null, confirmado: { external_id: 'c2' } });
  });

  it('uma linha com vários campos ruins vira UMA entrada, com o primeiro campo e a mensagem resumida, sem valores', () => {
    const r = resumirLinha([
      { posicao: 0, external_id: 'c9', campo: 'razao_social', codigo: 'campo_obrigatorio', mensagem: 'campo obrigatório sem valor' },
      { posicao: 0, external_id: 'c9', campo: 'limite_credito_cents', codigo: 'tipo_invalido', mensagem: 'tipo inválido (esperado number)' },
    ]);
    expect(r).toEqual({
      external_id: 'c9',
      codigo: 'campo_obrigatorio',
      campo: 'razao_social',
      mensagem: 'razao_social: campo obrigatório sem valor; limite_credito_cents: tipo inválido (esperado number)',
    });
    const longa = resumirLinha(Array.from({ length: 30 }, (_, i) => ({ posicao: 0, external_id: 'c', campo: `campo_${i}`, codigo: 'tipo_invalido' as const, mensagem: 'tipo inválido (esperado string)' })));
    expect(longa.mensagem.length).toBeLessThanOrEqual(300);
  });

  it('a chave de idempotência não muda para lotes sem linhas inválidas e muda quando elas existem', () => {
    const base = { entidade: 'cliente', modo: 'delta', geracao: 1, registros: [{ external_id: 'c1' }] };
    expect(chaveDoLote(base)).toBe(chaveDoLote({ ...base, linhasInvalidas: [], linhasInvalidasOmitidas: 0 }));
    expect(chaveDoLote(base)).not.toBe(chaveDoLote({ ...base, linhasInvalidas: [{ mensagem: 'x' }] }));
    expect(chaveDoLote(base)).not.toBe(chaveDoLote({ ...base, linhasInvalidasOmitidas: 3 }));
  });

  it('montarLotes: as linhas inválidas vão só no primeiro lote da página', () => {
    const lotes = montarLotes({
      entidade: 'cliente', modo: 'delta', geracao: 1, registros: [{ a: 1 }, { a: 2 }, { a: 3 }], cursorDeclarado: null, cursorLeitura: null,
      maxLinhas: 2, maxBytes: 1_000_000, enviadoEm: '2026-03-10T12:00:00.000Z',
      linhasInvalidas: [{ external_id: 'x', codigo: 'registro_invalido', mensagem: 'm' }], linhasInvalidasOmitidas: 4,
    });
    expect(lotes).toHaveLength(2);
    expect(lotes[0]?.envelope.linhas_invalidas).toHaveLength(1);
    expect(lotes[0]?.envelope.linhas_invalidas_omitidas).toBe(4);
    expect(lotes[1]?.envelope.linhas_invalidas).toBeUndefined();
  });
});
