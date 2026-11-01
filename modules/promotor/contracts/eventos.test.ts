/**
 * T-0040: payloads Zod dos eventos `promotor.*@1`. Um válido e os inválidos relevantes por evento, e o formato
 * congelado (tipo e chaves): se o `@1` mudar sem virar `@2`, este arquivo quebra no `pnpm typecheck` e no teste.
 * Instantes fixos só como dado de entrada; nada aqui compara com o relógio real.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { manifest } from '../manifest';
import {
  EVENTO_GONDOLA_REGISTRADA,
  EVENTO_PRECO_COLETADO,
  EVENTO_RUPTURA_REGISTRADA,
  EVENTO_SHARE_MEDIDO,
  EVENTO_TAREFA_CONCLUIDA,
  EVENTO_VISITA_LOJA_CONCLUIDA,
  EVENTOS_PROMOTOR,
  GondolaRegistradaV1,
  GondolaRegistradaV1Objeto,
  NOMES_EVENTOS_PROMOTOR,
  PrecoColetadoV1,
  PrecoColetadoV1Objeto,
  RupturaRegistradaV1,
  RupturaRegistradaV1Objeto,
  ShareMedidoV1,
  ShareMedidoV1Objeto,
  STATUS_RUPTURA_COM_ALERTA,
  TarefaConcluidaV1,
  TarefaConcluidaV1Objeto,
  VisitaLojaConcluidaV1,
  VisitaLojaConcluidaV1Objeto,
} from './index';
import type { z } from 'zod';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';
const T25 = '2026-10-31T13:25:00Z';

const falha = (schema: z.ZodTypeAny, dado: unknown) => {
  const r = schema.safeParse(dado);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

// ---------- exemplos válidos ----------
const visita: VisitaLojaConcluidaV1 = {
  visita_loja_id: u(3001), visita_id: u(1), promotor_id: u(10), cliente_id: u(20), checklist_modelo_id: u(40),
  checkin_em: T0, checkout_em: T25, permanencia_min: 25, desfecho: 'realizada', foto_fachada_id: null, fotos_total: 4, fotos_sem_gps: 1,
};
const gondola: GondolaRegistradaV1 = {
  gondola_id: u(4001), visita_loja_id: u(3001), promotor_id: u(10), cliente_id: u(20), categoria_gondola_id: u(50),
  conformidade: 'conforme', foto_antes_id: u(61), foto_depois_id: u(62), foto_referencia_id: u(63), registrado_em: T0,
};
const share: ShareMedidoV1 = {
  medicao_id: u(5001), visita_loja_id: u(3001), promotor_id: u(10), cliente_id: u(20), categoria_gondola_id: u(50),
  frentes_nossas: 6, frentes_total: 20, cm_nossos: null, cm_total: null, share_pct: 30, meta_share_id: u(70), meta_pct: 40, atingimento_pct: 75, medido_em: T0,
};
const precoNosso: PrecoColetadoV1 = {
  coleta_id: u(8001), visita_loja_id: u(3001), promotor_id: u(10), cliente_id: u(20), produto_id: u(90), concorrente_id: null, produto_concorrente_id: null,
  preco_cents: 1000, em_promocao: false, em_encarte: false, preco_promocional_cents: null, preco_efetivo_cents: 1000,
  preco_nosso_ref_cents: null, indice_preco: null, variacao_confirmada: false, coletado_em: T0,
};
const precoConcorrente: PrecoColetadoV1 = {
  ...precoNosso, coleta_id: u(8002), concorrente_id: u(91), produto_concorrente_id: u(92),
  preco_cents: 900, em_promocao: true, preco_promocional_cents: 800, preco_efetivo_cents: 800, preco_nosso_ref_cents: 1000, indice_preco: 125,
};
const ruptura: RupturaRegistradaV1 = {
  registro_id: u(6001), visita_loja_id: u(3001), promotor_id: u(10), cliente_id: u(20), produto_id: u(90), mix_obrigatorio_id: u(80),
  status: 'ruptura_gondola', quantidade_reposta: 12, registrado_em: T0,
};
const tarefa: TarefaConcluidaV1 = {
  execucao_id: u(9101), tarefa_id: u(9001), visita_loja_id: u(3001), promotor_id: u(10), cliente_id: u(20), fotos_total: 2, concluida_em: T0,
};

describe('T-0040: registro dos eventos do Promotor', () => {
  it('EVENTOS_PROMOTOR cobre exatamente o publica do manifesto', () => {
    expect([...NOMES_EVENTOS_PROMOTOR].sort()).toEqual([...manifest.publica].sort());
  });

  it('cada definição tem nome com versão @1 e o schema do registro', () => {
    const defs = [EVENTO_VISITA_LOJA_CONCLUIDA, EVENTO_GONDOLA_REGISTRADA, EVENTO_SHARE_MEDIDO, EVENTO_PRECO_COLETADO, EVENTO_RUPTURA_REGISTRADA, EVENTO_TAREFA_CONCLUIDA];
    expect(defs.map((d) => d.nome).sort()).toEqual([...NOMES_EVENTOS_PROMOTOR].sort());
    for (const d of defs) {
      expect(d.modulo).toBe('promotor');
      expect(d.versao).toBe(1);
      expect(d.schema).toBe(EVENTOS_PROMOTOR[d.nome as keyof typeof EVENTOS_PROMOTOR]);
    }
  });

  it('RN-PRO-01: nenhum evento do Promotor fala de pedido', () => {
    for (const nome of NOMES_EVENTOS_PROMOTOR) expect(nome).not.toMatch(/pedido/);
    const chaves = [VisitaLojaConcluidaV1Objeto, GondolaRegistradaV1Objeto, ShareMedidoV1Objeto, PrecoColetadoV1Objeto, RupturaRegistradaV1Objeto, TarefaConcluidaV1Objeto].flatMap((o) => Object.keys(o.shape));
    expect(chaves.filter((c) => /pedido/.test(c))).toEqual([]);
  });

  it('payload completo e estrito: chave a mais ou faltando é recusada em todos os eventos', () => {
    const validos: Record<string, Record<string, unknown>> = {
      'promotor.visita_loja.concluida@1': visita,
      'promotor.gondola.registrada@1': gondola,
      'promotor.share.medido@1': share,
      'promotor.preco.coletado@1': precoNosso,
      'promotor.ruptura.registrada@1': ruptura,
      'promotor.tarefa.concluida@1': tarefa,
    };
    for (const nome of NOMES_EVENTOS_PROMOTOR) {
      const schema = EVENTOS_PROMOTOR[nome];
      const ok = validos[nome]!;
      expect(schema.safeParse(ok).success, nome).toBe(true);
      expect(schema.safeParse({ ...ok, nome_cliente: 'Mercado X' }).success, `${nome} com chave a mais`).toBe(false);
      for (const chave of Object.keys(ok)) {
        const { [chave]: _fora, ...sem } = ok;
        expect(schema.safeParse(sem).success, `${nome} sem ${chave}`).toBe(false);
      }
      expect(schema.safeParse({ ...ok, promotor_id: '123' }).success, `${nome} com id que não é UUID`).toBe(false);
    }
  });
});

describe('promotor.visita_loja.concluida@1', () => {
  it('aceita a visita concluída com fotos e permanência que confere', () => {
    expect(VisitaLojaConcluidaV1.parse(visita)).toEqual(visita);
  });
  it('instantes só em UTC com Z', () => {
    expect(falha(VisitaLojaConcluidaV1, { ...visita, checkout_em: '2026-10-31T09:25:00-04:00' })).toContain('checkout_em');
  });
  it('checkout antes do check-in é recusado', () => {
    expect(falha(VisitaLojaConcluidaV1, { ...visita, checkout_em: '2026-10-31T12:59:00Z', permanencia_min: 0 })).toContain('checkout_em');
  });
  it('RN-PRO-07: permanência que não confere com check-in/checkout é recusada (tolerância de 0,5 min)', () => {
    expect(VisitaLojaConcluidaV1.safeParse({ ...visita, permanencia_min: 25.4 }).success).toBe(true);
    expect(falha(VisitaLojaConcluidaV1, { ...visita, permanencia_min: 40 })).toContain('permanencia_min');
  });
  it('RN-PRO-06: loja fechada ou acesso negado sem foto da fachada é recusado', () => {
    expect(falha(VisitaLojaConcluidaV1, { ...visita, desfecho: 'loja_fechada' })).toContain('foto_fachada_id');
    expect(falha(VisitaLojaConcluidaV1, { ...visita, desfecho: 'acesso_negado' })).toContain('foto_fachada_id');
    expect(VisitaLojaConcluidaV1.safeParse({ ...visita, desfecho: 'loja_fechada', foto_fachada_id: u(64) }).success).toBe(true);
  });
  it('desfecho fora do vocabulário do domain é recusado', () => {
    expect(falha(VisitaLojaConcluidaV1, { ...visita, desfecho: 'concluida' })).toContain('desfecho');
  });
  it('RN-PRO-02: fotos sem GPS não passam do total; contagens inteiras e não negativas', () => {
    expect(falha(VisitaLojaConcluidaV1, { ...visita, fotos_sem_gps: 5 })).toContain('fotos_sem_gps');
    expect(falha(VisitaLojaConcluidaV1, { ...visita, fotos_total: -1, fotos_sem_gps: 0 })).toContain('fotos_total');
    expect(falha(VisitaLojaConcluidaV1, { ...visita, fotos_total: 1.5 })).toContain('fotos_total');
  });
});

describe('promotor.gondola.registrada@1', () => {
  it('aceita o registro com fotos antes/depois e referência opcional', () => {
    expect(GondolaRegistradaV1.parse(gondola)).toEqual(gondola);
    expect(GondolaRegistradaV1.safeParse({ ...gondola, foto_referencia_id: null }).success).toBe(true);
  });
  it('conformidade fora do vocabulário é recusada', () => {
    expect(falha(GondolaRegistradaV1, { ...gondola, conformidade: 'ok' })).toContain('conformidade');
  });
  it('a foto do depois é outra foto, diferente da do antes', () => {
    expect(falha(GondolaRegistradaV1, { ...gondola, foto_depois_id: gondola.foto_antes_id })).toContain('foto_depois_id');
  });
});

describe('promotor.share.medido@1', () => {
  it('RN-PRO-03: aceita share e atingimento que conferem (frentes e cm)', () => {
    expect(ShareMedidoV1.parse(share)).toEqual(share);
    expect(ShareMedidoV1.safeParse({ ...share, cm_nossos: 50, cm_total: 200, share_pct: 25, atingimento_pct: 62.5 }).success).toBe(true);
  });
  it('RN-PRO-03: sem frentes o share é nulo e não há atingimento', () => {
    expect(ShareMedidoV1.safeParse({ ...share, frentes_nossas: 0, frentes_total: 0, share_pct: null, atingimento_pct: null }).success).toBe(true);
  });
  it('RN-PRO-03: share ou atingimento que não conferem são recusados', () => {
    expect(falha(ShareMedidoV1, { ...share, share_pct: 31 })).toContain('share_pct');
    expect(falha(ShareMedidoV1, { ...share, atingimento_pct: 80 })).toContain('atingimento_pct');
  });
  it('frentes nossas acima do total são recusadas', () => {
    expect(falha(ShareMedidoV1, { ...share, frentes_nossas: 21 })).toContain('frentes_nossas');
  });
  it('RN-PRO-10: meta vigente e valor da meta vêm juntos', () => {
    expect(falha(ShareMedidoV1, { ...share, meta_share_id: null })).toContain('meta_share_id');
    expect(ShareMedidoV1.safeParse({ ...share, meta_share_id: null, meta_pct: null, atingimento_pct: null }).success).toBe(true);
  });
});

describe('promotor.preco.coletado@1', () => {
  it('RN-PRO-04: aceita o preço do nosso item e o do concorrente com índice sobre o preço efetivo', () => {
    expect(PrecoColetadoV1.parse(precoNosso)).toEqual(precoNosso);
    expect(PrecoColetadoV1.parse(precoConcorrente)).toEqual(precoConcorrente);
  });
  it('dinheiro em centavos inteiros e positivos', () => {
    expect(falha(PrecoColetadoV1, { ...precoNosso, preco_cents: 10.5, preco_efetivo_cents: 10.5 })).toContain('preco_cents');
    expect(falha(PrecoColetadoV1, { ...precoNosso, preco_cents: 0, preco_efetivo_cents: 0 })).toContain('preco_cents');
  });
  it('RN-PRO-04: preço efetivo que não é o promocional em promoção é recusado', () => {
    expect(falha(PrecoColetadoV1, { ...precoConcorrente, preco_efetivo_cents: 900 })).toContain('preco_efetivo_cents');
  });
  it('RN-PRO-04: promoção sem preço promocional é recusada', () => {
    expect(falha(PrecoColetadoV1, { ...precoNosso, em_encarte: true })).toContain('preco_promocional_cents');
  });
  it('RN-PRO-04: índice só na linha do concorrente, com referência, e conferido', () => {
    expect(falha(PrecoColetadoV1, { ...precoNosso, indice_preco: 100, preco_nosso_ref_cents: 1000 })).toContain('indice_preco');
    expect(falha(PrecoColetadoV1, { ...precoConcorrente, preco_nosso_ref_cents: null })).toContain('preco_nosso_ref_cents');
    expect(falha(PrecoColetadoV1, { ...precoConcorrente, indice_preco: 111.11 })).toContain('indice_preco');
  });
  it('produto concorrente exige o concorrente', () => {
    expect(falha(PrecoColetadoV1, { ...precoConcorrente, concorrente_id: null })).toContain('concorrente_id');
  });
});

describe('promotor.ruptura.registrada@1', () => {
  it('RN-PRO-05: aceita os três status, inclusive presente (o Gestor precisa do total)', () => {
    expect(RupturaRegistradaV1.parse(ruptura)).toEqual(ruptura);
    expect(RupturaRegistradaV1.safeParse({ ...ruptura, status: 'presente', quantidade_reposta: 0 }).success).toBe(true);
    expect(RupturaRegistradaV1.safeParse({ ...ruptura, status: 'ruptura_total', quantidade_reposta: 0 }).success).toBe(true);
  });
  it('RN-PRO-05: ruptura total com quantidade reposta é recusada', () => {
    expect(falha(RupturaRegistradaV1, { ...ruptura, status: 'ruptura_total' })).toContain('quantidade_reposta');
  });
  it('status fora do vocabulário e quantidade negativa são recusados', () => {
    expect(falha(RupturaRegistradaV1, { ...ruptura, status: 'falta' })).toContain('status');
    expect(falha(RupturaRegistradaV1, { ...ruptura, quantidade_reposta: -1 })).toContain('quantidade_reposta');
  });
  it('RN-PRO-05: só ruptura na gôndola e total geram alerta ao vendedor', () => {
    expect([...STATUS_RUPTURA_COM_ALERTA]).toEqual(['ruptura_gondola', 'ruptura_total']);
  });
});

describe('promotor.tarefa.concluida@1', () => {
  it('aceita a tarefa concluída com foto de comprovação', () => {
    expect(TarefaConcluidaV1.parse(tarefa)).toEqual(tarefa);
  });
  it('RF-PRO-10: sem foto de comprovação é recusada', () => {
    expect(falha(TarefaConcluidaV1, { ...tarefa, fotos_total: 0 })).toContain('fotos_total');
  });
  it('instante sem fuso UTC é recusado', () => {
    expect(falha(TarefaConcluidaV1, { ...tarefa, concluida_em: '31/10/2026 13:00' })).toContain('concluida_em');
  });
});

// ---------- formato congelado do @1 ----------
// Mudou um campo? Então é `@2` (novo schema + nova definição + ADR) e o `@1` fica como está.
type Id = string;
type Instante = string;

describe('T-0040: formato congelado dos payloads @1 (tipo e chaves)', () => {
  it('tipos inferidos não mudam sem versão nova (quebra no typecheck)', () => {
    expectTypeOf<VisitaLojaConcluidaV1>().toEqualTypeOf<{
      visita_loja_id: Id; visita_id: Id; promotor_id: Id; cliente_id: Id; checklist_modelo_id: Id | null;
      checkin_em: Instante; checkout_em: Instante; permanencia_min: number; desfecho: 'realizada' | 'loja_fechada' | 'acesso_negado';
      foto_fachada_id: Id | null; fotos_total: number; fotos_sem_gps: number;
    }>();
    expectTypeOf<GondolaRegistradaV1>().toEqualTypeOf<{
      gondola_id: Id; visita_loja_id: Id; promotor_id: Id; cliente_id: Id; categoria_gondola_id: Id;
      conformidade: 'conforme' | 'parcial' | 'nao_conforme'; foto_antes_id: Id; foto_depois_id: Id; foto_referencia_id: Id | null; registrado_em: Instante;
    }>();
    expectTypeOf<ShareMedidoV1>().toEqualTypeOf<{
      medicao_id: Id; visita_loja_id: Id; promotor_id: Id; cliente_id: Id; categoria_gondola_id: Id;
      frentes_nossas: number; frentes_total: number; cm_nossos: number | null; cm_total: number | null;
      share_pct: number | null; meta_share_id: Id | null; meta_pct: number | null; atingimento_pct: number | null; medido_em: Instante;
    }>();
    expectTypeOf<PrecoColetadoV1>().toEqualTypeOf<{
      coleta_id: Id; visita_loja_id: Id; promotor_id: Id; cliente_id: Id; produto_id: Id; concorrente_id: Id | null; produto_concorrente_id: Id | null;
      preco_cents: number; em_promocao: boolean; em_encarte: boolean; preco_promocional_cents: number | null; preco_efetivo_cents: number;
      preco_nosso_ref_cents: number | null; indice_preco: number | null; variacao_confirmada: boolean; coletado_em: Instante;
    }>();
    expectTypeOf<RupturaRegistradaV1>().toEqualTypeOf<{
      registro_id: Id; visita_loja_id: Id; promotor_id: Id; cliente_id: Id; produto_id: Id; mix_obrigatorio_id: Id;
      status: 'presente' | 'ruptura_gondola' | 'ruptura_total'; quantidade_reposta: number; registrado_em: Instante;
    }>();
    expectTypeOf<TarefaConcluidaV1>().toEqualTypeOf<{
      execucao_id: Id; tarefa_id: Id; visita_loja_id: Id; promotor_id: Id; cliente_id: Id; fotos_total: number; concluida_em: Instante;
    }>();
    // entrada = saída (sem default/transform): o publicador manda exatamente o tipo do contrato
    expectTypeOf<z.input<typeof VisitaLojaConcluidaV1>>().toEqualTypeOf<VisitaLojaConcluidaV1>();
    expectTypeOf<z.input<typeof PrecoColetadoV1>>().toEqualTypeOf<PrecoColetadoV1>();
  });

  it('chaves de cada payload não mudam sem versão nova (quebra no teste)', () => {
    const chaves = (o: { shape: Record<string, unknown> }) => Object.keys(o.shape).sort();
    expect({
      'promotor.visita_loja.concluida@1': chaves(VisitaLojaConcluidaV1Objeto),
      'promotor.gondola.registrada@1': chaves(GondolaRegistradaV1Objeto),
      'promotor.share.medido@1': chaves(ShareMedidoV1Objeto),
      'promotor.preco.coletado@1': chaves(PrecoColetadoV1Objeto),
      'promotor.ruptura.registrada@1': chaves(RupturaRegistradaV1Objeto),
      'promotor.tarefa.concluida@1': chaves(TarefaConcluidaV1Objeto),
    }).toEqual({
      'promotor.visita_loja.concluida@1': ['checkin_em', 'checklist_modelo_id', 'checkout_em', 'cliente_id', 'desfecho', 'foto_fachada_id', 'fotos_sem_gps', 'fotos_total', 'permanencia_min', 'promotor_id', 'visita_id', 'visita_loja_id'],
      'promotor.gondola.registrada@1': ['categoria_gondola_id', 'cliente_id', 'conformidade', 'foto_antes_id', 'foto_depois_id', 'foto_referencia_id', 'gondola_id', 'promotor_id', 'registrado_em', 'visita_loja_id'],
      'promotor.share.medido@1': ['atingimento_pct', 'categoria_gondola_id', 'cliente_id', 'cm_nossos', 'cm_total', 'frentes_nossas', 'frentes_total', 'medicao_id', 'medido_em', 'meta_pct', 'meta_share_id', 'promotor_id', 'share_pct', 'visita_loja_id'],
      'promotor.preco.coletado@1': ['cliente_id', 'coleta_id', 'coletado_em', 'concorrente_id', 'em_encarte', 'em_promocao', 'indice_preco', 'preco_cents', 'preco_efetivo_cents', 'preco_nosso_ref_cents', 'preco_promocional_cents', 'produto_concorrente_id', 'produto_id', 'promotor_id', 'variacao_confirmada', 'visita_loja_id'],
      'promotor.ruptura.registrada@1': ['cliente_id', 'mix_obrigatorio_id', 'produto_id', 'promotor_id', 'quantidade_reposta', 'registrado_em', 'registro_id', 'status', 'visita_loja_id'],
      'promotor.tarefa.concluida@1': ['cliente_id', 'concluida_em', 'execucao_id', 'fotos_total', 'promotor_id', 'tarefa_id', 'visita_loja_id'],
    });
  });

  it('campos que o Gestor já espera (espelho em modules/gestor/contracts) existem no contrato oficial', () => {
    // Nomes do espelho `eventos-consumidos.ts` do Gestor (T-0014); o contrato oficial é superconjunto.
    const espelho: Record<string, string[]> = {
      'promotor.visita_loja.concluida@1': ['visita_loja_id', 'visita_id', 'promotor_id', 'cliente_id', 'checkin_em', 'checkout_em', 'permanencia_min', 'desfecho', 'fotos_total', 'fotos_sem_gps'],
      'promotor.gondola.registrada@1': ['gondola_id', 'visita_loja_id', 'promotor_id', 'cliente_id', 'conformidade', 'registrado_em'],
      'promotor.share.medido@1': ['medicao_id', 'visita_loja_id', 'promotor_id', 'cliente_id', 'share_pct', 'meta_pct', 'medido_em'],
      'promotor.preco.coletado@1': ['coleta_id', 'visita_loja_id', 'promotor_id', 'cliente_id', 'indice_preco', 'coletado_em'],
      'promotor.ruptura.registrada@1': ['registro_id', 'visita_loja_id', 'promotor_id', 'cliente_id', 'produto_id', 'status', 'registrado_em'],
      'promotor.tarefa.concluida@1': ['tarefa_id', 'promotor_id', 'cliente_id', 'concluida_em'],
    };
    const objetos = {
      'promotor.visita_loja.concluida@1': VisitaLojaConcluidaV1Objeto,
      'promotor.gondola.registrada@1': GondolaRegistradaV1Objeto,
      'promotor.share.medido@1': ShareMedidoV1Objeto,
      'promotor.preco.coletado@1': PrecoColetadoV1Objeto,
      'promotor.ruptura.registrada@1': RupturaRegistradaV1Objeto,
      'promotor.tarefa.concluida@1': TarefaConcluidaV1Objeto,
    } as const;
    for (const nome of NOMES_EVENTOS_PROMOTOR) {
      const oficiais = Object.keys(objetos[nome].shape);
      expect(espelho[nome]!.filter((c) => !oficiais.includes(c)), nome).toEqual([]);
    }
  });
});
