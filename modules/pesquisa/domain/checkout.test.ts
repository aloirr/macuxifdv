import { describe, expect, it } from 'vitest';
import { avaliarEtapaCheckout, clienteFechadoNoContexto, verificarEtapasCheckoutServidor, type EntradaCheckout } from './checkout';
import type { Questionario } from '../contracts';
import { QUEST, TENANT, publicada, u } from './util-teste';

const q = (id: string): Questionario => ({ id, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null });
const entrada = (extra: Partial<EntradaCheckout> = {}): EntradaCheckout => ({
  pesquisas: [{ questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria', titulo: 'Gôndola do mês' })] }],
  usuario: { id: u(1), perfil: 'promotor', equipe_ids: [] },
  cliente: { id: u(60), segmento: null, regiao: null },
  visita_id: u(70),
  agora: '2026-10-31T15:00:00Z',
  respostas: [],
  fuso: 'America/Manaus',
  cliente_fechado: false,
  ...extra,
});

describe('RN-PES-03 / RF-PES-03: pesquisa obrigatória no checkout', () => {
  it('RN-PES-03: pesquisa obrigatória aplicável e não respondida nesta visita bloqueia o checkout', () => {
    const r = avaliarEtapaCheckout(entrada());
    expect(r.bloqueia_checkout).toBe(true);
    expect(r.pendentes).toEqual([{ questionario_id: QUEST, versao_id: u(700), titulo: 'Gôndola do mês', estado: 'pendente' }]);
    expect(r.mensagem).toMatch(/Gôndola do mês/);
  });

  it('RN-PES-03: respondida nesta visita libera o checkout', () => {
    const r = avaliarEtapaCheckout(entrada({ respostas: [{ questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(70), respondida_em: '2026-10-31T14:00:00Z' }] }));
    expect(r.bloqueia_checkout).toBe(false);
    expect(r.itens[0]!.estado).toBe('concluida');
  });

  it('RN-PES-03: resposta de outra visita não libera o checkout desta (a cada visita)', () => {
    const r = avaliarEtapaCheckout(entrada({ respostas: [{ questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(71), respondida_em: '2026-10-30T14:00:00Z' }] }));
    expect(r.bloqueia_checkout).toBe(true);
  });

  it('RN-PES-03: exceção "cliente fechado" — a pesquisa pendente é dispensada e não bloqueia', () => {
    const r = avaliarEtapaCheckout(entrada({ cliente_fechado: true }));
    expect(r.bloqueia_checkout).toBe(false);
    expect(r.itens[0]!.estado).toBe('dispensada');
    expect(r.pendentes).toEqual([]);
  });

  it('RN-PES-03: cliente fechado não desfaz uma pesquisa já respondida', () => {
    const r = avaliarEtapaCheckout(entrada({ cliente_fechado: true, respostas: [{ questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(70), respondida_em: '2026-10-31T14:00:00Z' }] }));
    expect(r.itens[0]!.estado).toBe('concluida');
  });

  it('RF-PES-03: pesquisa avulsa nunca entra na etapa do checkout', () => {
    const r = avaliarEtapaCheckout(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [publicada({ modo: 'avulsa' })] }] }));
    expect(r.itens).toEqual([]);
    expect(r.bloqueia_checkout).toBe(false);
  });

  it('RF-PES-03: pesquisa fora do público (perfil), da vigência ou rascunho não bloqueia', () => {
    const outroPerfil = publicada({ modo: 'checkout_obrigatoria', publico_alvo: { perfis: ['vendedor'], equipes: [], segmentos: [], regioes: [], clientes: [] } });
    expect(avaliarEtapaCheckout(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [outroPerfil] }] })).bloqueia_checkout).toBe(false);
    const vencida = publicada({ modo: 'checkout_obrigatoria', vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-10-01T00:00:00Z' } });
    expect(avaliarEtapaCheckout(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [vencida] }] })).bloqueia_checkout).toBe(false);
  });

  it('RN-PES-02: frequência mensal já cumprida em outra visita do mês não bloqueia este checkout', () => {
    const mensal = publicada({ modo: 'checkout_obrigatoria', frequencia: 'mensal' });
    const r = avaliarEtapaCheckout(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [mensal] }], respostas: [{ questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(71), respondida_em: '2026-10-05T14:00:00Z' }] }));
    expect(r.bloqueia_checkout).toBe(false);
    expect(r.itens).toEqual([]);
  });

  it('RN-PES-03: a versão vigente é a que vale — v2 obrigatória substitui v1 avulsa', () => {
    const v1 = publicada({ modo: 'avulsa' });
    const v2 = publicada({ id: u(701), numero: 2, modo: 'checkout_obrigatoria' });
    const r = avaliarEtapaCheckout(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [v1, v2] }] }));
    expect(r.pendentes[0]!.versao_id).toBe(u(701));
  });

  it('RN-PES-03: com várias obrigatórias, bloqueia enquanto restar qualquer uma', () => {
    const outra = u(801);
    const r = avaliarEtapaCheckout(
      entrada({
        pesquisas: [
          { questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria' })] },
          { questionario: q(outra), versoes: [publicada({ id: u(702), questionario_id: outra, modo: 'checkout_obrigatoria', titulo: 'Preço' })] },
        ],
        respostas: [{ questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(70), respondida_em: '2026-10-31T14:00:00Z' }],
      }),
    );
    expect(r.bloqueia_checkout).toBe(true);
    expect(r.pendentes.map((p) => p.titulo)).toEqual(['Preço']);
  });

  it('RN-CORE-12: sem pesquisa obrigatória o checkout está liberado e a mensagem vem vazia', () => {
    const r = avaliarEtapaCheckout(entrada({ pesquisas: [] }));
    expect(r).toMatchObject({ bloqueia_checkout: false, concluida: true, mensagem: null });
  });
});

describe('RN-PES-03 / RN-CORE-14: cliente fechado vindo do ContextoCheckout do Core', () => {
  it('RN-CORE-14: clienteFechado ou motivo loja_fechada/acesso_negado dispensam; contexto sem o campo não', () => {
    expect(clienteFechadoNoContexto({})).toBe(false);
    expect(clienteFechadoNoContexto({ clienteFechado: false, motivoClienteFechado: null })).toBe(false);
    expect(clienteFechadoNoContexto({ clienteFechado: true })).toBe(true);
    expect(clienteFechadoNoContexto({ motivoClienteFechado: 'loja_fechada' })).toBe(true);
    expect(clienteFechadoNoContexto({ motivoClienteFechado: 'acesso_negado' })).toBe(true);
  });
  it('RN-PES-03: com o contexto de cliente fechado a etapa conclui sem a pesquisa', () => {
    const r = avaliarEtapaCheckout(entrada({ cliente_fechado: clienteFechadoNoContexto({ motivoClienteFechado: 'acesso_negado' }) }));
    expect(r.bloqueia_checkout).toBe(false);
    expect(r.concluida).toBe(true);
  });
});

describe('RN-PES-03 / RN-CORE-12: etapa verificada no servidor (pesquisa.etapas_checkout@1)', () => {
  const resp = (extra: Partial<{ visita_id: string; cliente_id: string | null }> = {}) => ({
    questionario_id: QUEST,
    usuario_id: u(1),
    cliente_id: u(60),
    visita_id: u(70),
    respondida_em: '2026-10-31T14:00:00Z',
    ...extra,
  });
  const semPublico = { perfis: [], equipes: [], segmentos: [], regioes: [], clientes: [] };

  it('RN-PES-03: pesquisa obrigatória aplicável e sem resposta na visita vira etapa obrigatória e não concluída', () => {
    expect(verificarEtapasCheckoutServidor(entrada())).toEqual([
      { etapa: 'pesquisa.obrigatoria', rotulo: 'Pesquisa obrigatória: "Gôndola do mês"', obrigatoria: true, concluida: false },
    ]);
  });

  it('RN-PES-03: resposta registrada para a visita e o cliente conclui a etapa', () => {
    expect(verificarEtapasCheckoutServidor(entrada({ respostas: [resp()] }))[0]).toMatchObject({ obrigatoria: true, concluida: true });
  });

  it('RN-PES-03: resposta da mesma visita mas de outro cliente não conclui a etapa', () => {
    expect(verificarEtapasCheckoutServidor(entrada({ respostas: [resp({ cliente_id: u(61) })] }))[0]).toMatchObject({ concluida: false });
  });

  it('RN-PES-03: resposta de outra visita não conclui a etapa', () => {
    expect(verificarEtapasCheckoutServidor(entrada({ respostas: [resp({ visita_id: u(71) })] }))[0]).toMatchObject({ concluida: false });
  });

  it('RN-PES-03 / RN-CORE-14: cliente fechado dispensa — a etapa deixa de ser obrigatória', () => {
    expect(verificarEtapasCheckoutServidor(entrada({ cliente_fechado: true }))).toEqual([
      { etapa: 'pesquisa.obrigatoria', rotulo: 'Pesquisa obrigatória', obrigatoria: false, concluida: true },
    ]);
  });

  it('RF-PES-02: fora do público (perfil) ou da vigência, nenhuma etapa', () => {
    const restrita = [{ questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria', publico_alvo: { ...semPublico, perfis: ['vendedor'] } })] }];
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas: restrita }))).toEqual([]);
    const vencida = [{ questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria', vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-09-30T00:00:00Z' } })] }];
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas: vencida }))).toEqual([]);
  });

  it('RF-PES-03: pesquisa avulsa nunca vira etapa; sem pesquisas, lista vazia', () => {
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas: [{ questionario: q(QUEST), versoes: [publicada({ modo: 'avulsa' })] }] }))).toEqual([]);
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas: [] }))).toEqual([]);
  });

  it('RN-PES-03: várias pendentes viram um rótulo só e o rótulo nunca passa de 120 caracteres', () => {
    const outra = u(801);
    const pesquisas = [
      { questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria' })] },
      { questionario: q(outra), versoes: [publicada({ id: u(701), questionario_id: outra, modo: 'checkout_obrigatoria', titulo: 'Outra' })] },
    ];
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas }))[0]).toMatchObject({ rotulo: 'Pesquisas obrigatórias pendentes: 2', concluida: false });
    const longa = [{ questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria', titulo: 'X'.repeat(200) })] }];
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas: longa }))[0]!.rotulo.length).toBeLessThanOrEqual(120);
  });

  it('RN-PES-03: uma concluída e outra pendente — etapa obrigatória, não concluída, com o título da pendente', () => {
    const outra = u(801);
    const pesquisas = [
      { questionario: q(QUEST), versoes: [publicada({ modo: 'checkout_obrigatoria' })] },
      { questionario: q(outra), versoes: [publicada({ id: u(701), questionario_id: outra, modo: 'checkout_obrigatoria', titulo: 'Outra' })] },
    ];
    expect(verificarEtapasCheckoutServidor(entrada({ pesquisas, respostas: [resp()] }))[0]).toMatchObject({
      obrigatoria: true,
      concluida: false,
      rotulo: 'Pesquisa obrigatória: "Outra"',
    });
  });
});
