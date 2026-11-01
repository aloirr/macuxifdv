/**
 * T-0046: o Gestor consome `promotor.*@1` com os schemas OFICIAIS do Promotor (T-0040), sem espelho próprio.
 * Um evento real válido e os inválidos relevantes de cada tipo, passando pela projeção (`aplicarEvento`).
 * Instantes fixos só como dado de entrada; nada aqui compara com o relógio real.
 */
import { describe, expect, it } from 'vitest';
import { EVENTOS_PROMOTOR, NOMES_EVENTOS_PROMOTOR } from '../../promotor/contracts';
import { EVENTOS_CONSUMIDOS } from '../contracts';
import { manifest } from '../manifest';
import { CLIENTE_A, gondola, precoColetado, rupturaRegistrada, shareMedido, tarefaConcluida, u, visitaLoja } from './fixtures';
import { aplicarEvento, estadoInicial, type EventoRecebido } from './projecao';

const EM = '2026-10-30T13:00:00Z';
const comPayload = (e: EventoRecebido, mudar: Record<string, unknown>, tirar: string[] = []): EventoRecebido => {
  const p = { ...(e.payload as Record<string, unknown>), ...mudar };
  for (const k of tirar) delete p[k];
  return { ...e, evento_id: `${e.evento_id}-x`, payload: p };
};
const situacao = (e: EventoRecebido) => aplicarEvento(estadoInicial(), e);

/** Um evento válido de cada tipo, como o Promotor publica. */
const VALIDOS: Record<(typeof NOMES_EVENTOS_PROMOTOR)[number], EventoRecebido> = {
  'promotor.visita_loja.concluida@1': visitaLoja(1, { em: EM, fotos: [4, 1] }),
  'promotor.gondola.registrada@1': gondola(1, 1, 'parcial', EM),
  'promotor.share.medido@1': shareMedido(1, 1, 30, 40, EM),
  'promotor.preco.coletado@1': precoColetado(1, 1, 125, EM),
  'promotor.ruptura.registrada@1': rupturaRegistrada(1, 1, 'ruptura_gondola', EM),
  'promotor.tarefa.concluida@1': tarefaConcluida({ execucao: 1, tarefa: 1, loja: 1, em: EM }),
};

describe('T-0046: eventos promotor.*@1 validados com o contrato oficial do Promotor', () => {
  it('EVENTOS_CONSUMIDOS usa a MESMA referência de schema do EVENTOS_PROMOTOR (sem cópia do formato)', () => {
    for (const nome of NOMES_EVENTOS_PROMOTOR) expect(EVENTOS_CONSUMIDOS[nome], nome).toBe(EVENTOS_PROMOTOR[nome]);
  });

  it('o Gestor consome todos os eventos que o Promotor publica (manifesto)', () => {
    expect(NOMES_EVENTOS_PROMOTOR.filter((n) => !(manifest.consome as readonly string[]).includes(n))).toEqual([]);
  });

  it('um evento real válido de cada tipo é aplicado e gravado na tabela do read-model', () => {
    let estado = estadoInicial();
    for (const nome of NOMES_EVENTOS_PROMOTOR) {
      const r = aplicarEvento(estado, VALIDOS[nome]);
      expect(r.situacao, nome).toBe('aplicado');
      estado = r.estado;
    }
    expect(estado.visitas_loja[u(3001)]?.desfecho).toBe('realizada');
    expect(estado.gondolas[u(4001)]?.conformidade).toBe('parcial');
    expect(estado.shares[u(5001)]?.atingimento_pct).toBe(75);
    expect(estado.precos[u(8001)]?.indice_preco).toBe(125);
    expect(estado.rupturas[u(6001)]?.status).toBe('ruptura_gondola');
    expect(estado.tarefas[u(9101)]?.tarefa_id).toBe(u(9001));
  });

  it('payload incompleto, com chave a mais ou id que não é UUID é inválido em todos os tipos (estado intacto)', () => {
    for (const nome of NOMES_EVENTOS_PROMOTOR) {
      const ok = VALIDOS[nome];
      const casos = [comPayload(ok, { nome_loja: 'Mercado X' }), comPayload(ok, {}, ['cliente_id']), comPayload(ok, { promotor_id: '123' })];
      for (const e of casos) {
        const r = situacao(e);
        expect(r.situacao, `${nome} ${JSON.stringify(e.payload).slice(0, 40)}`).toBe('invalido');
        expect(r.estado).toEqual(estadoInicial());
        expect(r.motivo).toMatch(new RegExp(`^Payload de ${nome.replace(/[.@]/g, '\\$&')} inválido`));
      }
    }
  });

  it('RN-PRO-07: visita de loja com permanência que não confere com check-in/checkout é inválida', () => {
    expect(situacao(comPayload(VALIDOS['promotor.visita_loja.concluida@1'], { permanencia_min: 12 })).situacao).toBe('invalido');
  });

  it('RN-PRO-06: loja fechada ou acesso negado sem a foto da fachada é inválida; com a foto, aceita', () => {
    for (const desfecho of ['loja_fechada', 'acesso_negado'] as const) {
      const e = visitaLoja(2, { em: EM, min: 3, desfecho });
      expect(situacao(e).situacao, desfecho).toBe('aplicado');
      expect(situacao(comPayload(e, { foto_fachada_id: null })).situacao, desfecho).toBe('invalido');
    }
  });

  it('RN-PRO-02: fotos sem GPS acima do total é inválido', () => {
    expect(situacao(comPayload(VALIDOS['promotor.visita_loja.concluida@1'], { fotos_total: 1, fotos_sem_gps: 2 })).situacao).toBe('invalido');
  });

  it('gôndola: a foto do depois igual à do antes é inválida', () => {
    const e = VALIDOS['promotor.gondola.registrada@1'];
    expect(situacao(comPayload(e, { foto_depois_id: (e.payload as { foto_antes_id: string }).foto_antes_id })).situacao).toBe('invalido');
  });

  it('RN-PRO-03: share ou atingimento que não confere com as frentes e a meta é inválido', () => {
    const e = VALIDOS['promotor.share.medido@1'];
    expect(situacao(comPayload(e, { share_pct: 31 })).situacao).toBe('invalido');
    expect(situacao(comPayload(e, { atingimento_pct: 80 })).situacao).toBe('invalido');
  });

  it('RN-PRO-04: índice de preço que não confere, ou índice na linha do nosso item, é inválido', () => {
    expect(situacao(comPayload(VALIDOS['promotor.preco.coletado@1'], { indice_preco: 120 })).situacao).toBe('invalido');
    expect(situacao(comPayload(precoColetado(2, 1, null, EM), { indice_preco: 100 })).situacao).toBe('invalido');
  });

  it('RN-PRO-05: ruptura total com quantidade reposta é inválida; status fora do vocabulário também', () => {
    const e = rupturaRegistrada(3, 1, 'ruptura_total', EM);
    expect(situacao(e).situacao).toBe('aplicado');
    expect(situacao(comPayload(e, { quantidade_reposta: 2 })).situacao).toBe('invalido');
    expect(situacao(comPayload(e, { status: 'ausente' })).situacao).toBe('invalido');
  });

  it('tarefa: cliente_id nunca é nulo e exige pelo menos uma foto', () => {
    const e = VALIDOS['promotor.tarefa.concluida@1'];
    expect(situacao(comPayload(e, { cliente_id: null })).situacao).toBe('invalido');
    expect(situacao(comPayload(e, { fotos_total: 0 })).situacao).toBe('invalido');
    expect((e.payload as { cliente_id: string }).cliente_id).toBe(CLIENTE_A);
  });
});
