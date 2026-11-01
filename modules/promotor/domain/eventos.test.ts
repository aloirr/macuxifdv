/**
 * T-0040: emissão dos eventos `promotor.*@1` — o payload é montado pelo tipo do contrato a partir da coleta e
 * validado antes de publicar; inválido = `ErroPayloadEvento`, nada para publicar. Sem relógio real.
 */
import { describe, expect, it } from 'vitest';
import { ColetaPreco, GondolaRegistro, MedicaoShare, RupturaItem, TarefaExecucao, VisitaLoja, EVENTOS_PROMOTOR } from '../contracts';
import {
  ErroPayloadEvento,
  eventoGondolaRegistrada,
  eventoPrecoColetado,
  eventoRupturaRegistrada,
  eventoShareMedido,
  eventoTarefaConcluida,
  eventoVisitaLojaConcluida,
  montarEventoPromotor,
  rupturaGeraAlerta,
} from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';
const PROMOTOR = u(10);
const CLIENTE = u(20);
const origem = { promotor_id: PROMOTOR, cliente_id: CLIENTE };

/** Erro lançado por `fn` (falha o teste se não lançar `ErroPayloadEvento`). */
const erroDe = (fn: () => unknown): ErroPayloadEvento => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErroPayloadEvento);
    return e as ErroPayloadEvento;
  }
  throw new Error('esperava ErroPayloadEvento');
};

const visita = VisitaLoja.parse({
  id: u(3001), visita_id: u(1), cliente_id: CLIENTE, checklist_modelo_id: null,
  checkin_em: T0, checkout_em: '2026-10-31T13:18:00Z', permanencia_min: 18, desfecho: 'realizada', foto_fachada_id: null,
});
const fotos = [
  { visita_loja_id: u(3001), sem_gps: false },
  { visita_loja_id: u(3001), sem_gps: true },
  { visita_loja_id: u(3001), sem_gps: false },
];

describe('montarEventoPromotor', () => {
  it('devolve nome@versão e o payload validado, congelado', () => {
    const ev = eventoRupturaRegistrada(RupturaItem.parse({ id: u(6001), visita_loja_id: u(3001), produto_id: u(90), mix_obrigatorio_id: u(80), status: 'presente', registrado_em: T0 }), origem);
    expect(ev.nome).toBe('promotor.ruptura.registrada@1');
    expect(EVENTOS_PROMOTOR[ev.nome].safeParse(ev.payload).success).toBe(true);
    expect(Object.isFrozen(ev)).toBe(true);
    expect(Object.isFrozen(ev.payload)).toBe(true);
  });

  it('payload inválido lança ErroPayloadEvento com evento e campos, sem devolver nada para publicar', () => {
    const e = erroDe(() => montarEventoPromotor('promotor.tarefa.concluida@1', {
      execucao_id: u(1), tarefa_id: 'x', visita_loja_id: u(2), promotor_id: PROMOTOR, cliente_id: CLIENTE, fotos_total: 0, concluida_em: T0,
    }));
    expect(e.evento).toBe('promotor.tarefa.concluida@1');
    expect(e.problemas.some((p) => p.startsWith('tarefa_id:'))).toBe(true);
    expect(e.problemas.some((p) => p.startsWith('fotos_total:'))).toBe(true);
    expect(e.message).toMatch(/^Evento promotor\.tarefa\.concluida@1 não publicado: payload inválido/);
  });

  it('chave a mais (ex.: dado pessoal) não passa: o payload é exatamente o do contrato', () => {
    const payload = { gondola_id: u(1), visita_loja_id: u(2), promotor_id: PROMOTOR, cliente_id: CLIENTE, categoria_gondola_id: u(3), conformidade: 'conforme', foto_antes_id: u(4), foto_depois_id: u(5), foto_referencia_id: null, registrado_em: T0, nome_promotor: 'Fulano' } as const;
    // o TypeScript aceita a chave a mais vinda de variável (tipagem estrutural); o schema estrito do contrato barra
    erroDe(() => montarEventoPromotor('promotor.gondola.registrada@1', payload));
  });

  it('nome que não é evento do Promotor é recusado', () => {
    // @ts-expect-error nome fora do registro
    const e = erroDe(() => montarEventoPromotor('vendedor.pedido.criado@1', {}));
    expect(e.evento).toBe('vendedor.pedido.criado@1');
  });
});

describe('promotor.visita_loja.concluida@1 a partir da visita de loja', () => {
  it('RN-PRO-02/07: monta com permanência da visita e conta as fotos sem GPS', () => {
    const ev = eventoVisitaLojaConcluida(visita, { promotor_id: PROMOTOR }, fotos);
    expect(ev.payload).toEqual({
      visita_loja_id: u(3001), visita_id: u(1), promotor_id: PROMOTOR, cliente_id: CLIENTE, checklist_modelo_id: null,
      checkin_em: T0, checkout_em: '2026-10-31T13:18:00Z', permanencia_min: 18, desfecho: 'realizada', foto_fachada_id: null,
      fotos_total: 3, fotos_sem_gps: 1,
    });
  });
  it('visita ainda aberta (sem checkout) não vira evento', () => {
    const aberta = VisitaLoja.parse({ ...visita, checkout_em: null, permanencia_min: null, desfecho: null });
    expect(erroDe(() => eventoVisitaLojaConcluida(aberta, { promotor_id: PROMOTOR }, [])).problemas[0]).toMatch(/^checkout_em:/);
  });
  it('foto de outra visita é recusada', () => {
    erroDe(() => eventoVisitaLojaConcluida(visita, { promotor_id: PROMOTOR }, [...fotos, { visita_loja_id: u(9999), sem_gps: false }]));
  });
  it('promotor_id que não é UUID (token inválido) não publica', () => {
    expect(erroDe(() => eventoVisitaLojaConcluida(visita, { promotor_id: 'admin' }, fotos)).problemas[0]).toMatch(/^promotor_id:/);
  });
});

describe('demais eventos a partir das coletas', () => {
  it('promotor.gondola.registrada@1: sem o motivo (texto livre) no payload', () => {
    const g = GondolaRegistro.parse({ id: u(4001), visita_loja_id: u(3001), categoria_gondola_id: u(50), foto_antes_id: u(61), foto_depois_id: u(62), foto_referencia_id: null, conformidade: 'nao_conforme', motivo: 'Faltou espaço', registrado_em: T0 });
    const ev = eventoGondolaRegistrada(g, origem);
    expect(ev.payload).toMatchObject({ gondola_id: u(4001), conformidade: 'nao_conforme', cliente_id: CLIENTE, promotor_id: PROMOTOR });
    expect(ev.payload).not.toHaveProperty('motivo');
  });

  it('promotor.share.medido@1: RN-PRO-03 share e atingimento da medição', () => {
    const m = MedicaoShare.parse({ id: u(5001), visita_loja_id: u(3001), categoria_gondola_id: u(50), frentes_nossas: 6, frentes_total: 20, share_pct: 30, meta_share_id: u(70), meta_pct: 40, atingimento_pct: 75, medido_em: T0 });
    expect(eventoShareMedido(m, origem).payload).toMatchObject({ medicao_id: u(5001), share_pct: 30, meta_pct: 40, atingimento_pct: 75, cm_nossos: null, cm_total: null });
  });

  it('promotor.preco.coletado@1: RN-PRO-04 preço efetivo é o promocional na promoção', () => {
    const c = ColetaPreco.parse({ id: u(8002), visita_loja_id: u(3001), produto_id: u(90), concorrente_id: u(91), produto_concorrente_id: u(92), preco_cents: 900, em_promocao: true, preco_promocional_cents: 800, preco_nosso_ref_cents: 1000, indice_preco: 125, coletado_em: T0 });
    expect(eventoPrecoColetado(c, origem).payload).toMatchObject({ coleta_id: u(8002), preco_efetivo_cents: 800, indice_preco: 125, em_encarte: false, variacao_confirmada: false });
  });

  it('promotor.preco.coletado@1: coleta com preço inválido não vira evento pela metade', () => {
    const c = { ...ColetaPreco.parse({ id: u(8003), visita_loja_id: u(3001), produto_id: u(90), concorrente_id: null, produto_concorrente_id: null, preco_cents: 1000, coletado_em: T0 }), em_promocao: true };
    expect(erroDe(() => eventoPrecoColetado(c, origem)).problemas[0]).toMatch(/promocional/);
  });

  it('promotor.ruptura.registrada@1: RN-PRO-05 alerta ao vendedor só em ruptura', () => {
    const base = { id: u(6001), visita_loja_id: u(3001), produto_id: u(90), mix_obrigatorio_id: u(80), registrado_em: T0 };
    const gondola = eventoRupturaRegistrada(RupturaItem.parse({ ...base, status: 'ruptura_gondola', quantidade_reposta: 6 }), origem);
    const total = eventoRupturaRegistrada(RupturaItem.parse({ ...base, status: 'ruptura_total' }), origem);
    const presente = eventoRupturaRegistrada(RupturaItem.parse({ ...base, status: 'presente' }), origem);
    expect([gondola, total, presente].map((e) => rupturaGeraAlerta(e.payload))).toEqual([true, true, false]);
    expect(gondola.payload).toMatchObject({ registro_id: u(6001), mix_obrigatorio_id: u(80), quantidade_reposta: 6 });
  });

  it('promotor.tarefa.concluida@1: execução, tarefa de trade e nº de fotos', () => {
    const t = TarefaExecucao.parse({ id: u(9101), tarefa_trade_id: u(9001), visita_loja_id: u(3001), cliente_id: CLIENTE, foto_ids: [u(1), u(2)], concluida_em: T0 });
    expect(eventoTarefaConcluida(t, { promotor_id: PROMOTOR }).payload).toEqual({
      execucao_id: u(9101), tarefa_id: u(9001), visita_loja_id: u(3001), promotor_id: PROMOTOR, cliente_id: CLIENTE, fotos_total: 2, concluida_em: T0,
    });
  });
});
