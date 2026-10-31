import { describe, expect, it } from 'vitest';
import { agregarResultados, consolidarEntreVersoes } from './resultados';
import type { RespostaPesquisa } from '../contracts';
import { codigo, data, envio, escala, foto, item, multipla, numero, publicada, sim_nao, texto, u, unica } from './util-teste';
import type { ItemResposta } from '../contracts';

const resp = (n: number, itens: ItemResposta[], extra: Partial<RespostaPesquisa> = {}): RespostaPesquisa => ({
  ...envio(itens, { id: u(6000 + n) }),
  tenant_id: u(900),
  usuario_id: u(100 + n),
  equipe_id: u(50),
  recebida_em: '2026-10-31T14:00:00Z',
  suspeita: false,
  motivos_suspeita: [],
  ...extra,
});

describe('RF-PES-06: resultados — contagem por opção', () => {
  const v = publicada({ perguntas: [sim_nao(1), unica(2, [101, 102, 103]), multipla(3, [201, 202, 203])] });
  const respostas = [
    resp(1, [item.simNao(1, true), item.unica(2, 101), item.multipla(3, [201, 202])]),
    resp(2, [item.simNao(1, true), item.unica(2, 101), item.multipla(3, [201])]),
    resp(3, [item.simNao(1, false), item.unica(2, 102)]),
    resp(4, [item.simNao(1, true)]),
  ];

  it('RF-PES-06: total de respostas e contagem de sim/não com percentual sobre quem respondeu', () => {
    const r = agregarResultados({ versao: v, respostas });
    expect(r.total_respostas).toBe(4);
    const p = r.por_pergunta[0]!;
    expect(p).toMatchObject({ tipo: 'sim_nao', respondentes: 4, pct_das_respostas: 100 });
    if (p.tipo === 'sim_nao') {
      expect(p.opcoes).toEqual([
        { opcao_id: 'sim', rotulo: 'Sim', contagem: 3, pct: 75 },
        { opcao_id: 'nao', rotulo: 'Não', contagem: 1, pct: 25 },
      ]);
    }
  });

  it('RF-PES-06: única escolha — contagem por opção, inclusive as que ninguém marcou (0)', () => {
    const p = agregarResultados({ versao: v, respostas }).por_pergunta[1]!;
    if (p.tipo !== 'unica') throw new Error('tipo');
    expect(p.respondentes).toBe(3);
    expect(p.pct_das_respostas).toBe(75);
    expect(p.opcoes.map((o) => [o.contagem, o.pct])).toEqual([
      [2, 66.67],
      [1, 33.33],
      [0, 0],
    ]);
  });

  it('RF-PES-06: múltipla escolha — cada opção conta quem a marcou (a soma pode passar de 100%)', () => {
    const p = agregarResultados({ versao: v, respostas }).por_pergunta[2]!;
    if (p.tipo !== 'multipla') throw new Error('tipo');
    expect(p.respondentes).toBe(2);
    expect(p.opcoes.map((o) => [o.contagem, o.pct])).toEqual([
      [2, 100],
      [1, 50],
      [0, 0],
    ]);
  });
});

describe('RF-PES-06: resultados — número e escala', () => {
  const v = publicada({ perguntas: [numero(1), escala(2, { minimo: 1, maximo: 5 })] });

  it('RF-PES-06: média (2 casas, meio para cima), mínimo e máximo do número', () => {
    const rs = [10, 20, 25].map((n, i) => resp(i + 1, [item.numero(1, n)]));
    const p = agregarResultados({ versao: v, respostas: rs }).por_pergunta[0]!;
    expect(p).toMatchObject({ tipo: 'numero', respondentes: 3, media: 18.33, minimo: 10, maximo: 25, distribuicao: [] });
  });

  it('RF-PES-06: escala — média, mínimo, máximo e distribuição por ponto (inclui pontos com zero)', () => {
    const rs = [5, 4, 4, 1].map((n, i) => resp(i + 1, [item.escala(2, n)]));
    const p = agregarResultados({ versao: v, respostas: rs }).por_pergunta[1]!;
    expect(p).toMatchObject({ tipo: 'escala', respondentes: 4, media: 3.5, minimo: 1, maximo: 5 });
    if (p.tipo === 'escala') expect(p.distribuicao).toEqual([
      { valor: 1, contagem: 1 },
      { valor: 2, contagem: 0 },
      { valor: 3, contagem: 0 },
      { valor: 4, contagem: 2 },
      { valor: 5, contagem: 1 },
    ]);
  });

  it('RF-PES-06: sem resposta numérica a média é null (nunca divide por zero)', () => {
    const p = agregarResultados({ versao: v, respostas: [resp(1, [item.numero(1, 1)])] }).por_pergunta[1]!;
    expect(p).toMatchObject({ respondentes: 0, media: null, minimo: null, maximo: null, pct_das_respostas: 0 });
  });
});

describe('RF-PES-06: resultados — outros tipos', () => {
  const v = publicada({ perguntas: [texto(1), data(2), foto(3), codigo(4)] });
  it('RF-PES-06: texto, data, foto e código de barras', () => {
    const rs = [
      resp(1, [item.texto(1, 'ótimo'), item.data(2, '2026-10-10'), item.foto(3, [10, 11]), item.codigo(4, '4006381333931')]),
      resp(2, [item.texto(1, ' '), item.data(2, '2026-10-20'), item.foto(3, [12]), item.codigo(4, '4006381333931')]),
    ];
    const [t, d, f, c] = agregarResultados({ versao: v, respostas: rs }).por_pergunta;
    expect(t).toMatchObject({ tipo: 'texto', respondentes: 1 });
    expect(d).toMatchObject({ tipo: 'data', respondentes: 2, mais_antiga: '2026-10-10', mais_recente: '2026-10-20' });
    expect(f).toMatchObject({ tipo: 'foto', respondentes: 2, total_fotos: 3 });
    expect(c).toMatchObject({ tipo: 'codigo_barras', respondentes: 2, codigos_distintos: 1 });
  });
});

describe('RF-PES-06: taxa de resposta sobre o público', () => {
  const v = publicada({ perguntas: [sim_nao(1)] });
  const universo = [1, 2, 3, 4].map((n) => ({ id: u(100 + n), equipe_id: u(50) }));

  it('RF-PES-06: taxa = do público, quem respondeu ao menos uma vez ÷ público × 100 (respostas repetidas contam uma vez)', () => {
    const rs = [resp(1, [item.simNao(1, true)]), resp(11, [item.simNao(1, true)], { usuario_id: u(101) }), resp(2, [item.simNao(1, true)])];
    const r = agregarResultados({ versao: v, respostas: rs, universo });
    expect(r).toMatchObject({ total_respostas: 3, respondentes_distintos: 2, publico_total: 4, taxa_resposta_pct: 50, base: 'usuario' });
  });

  it('RF-PES-06: sem universo informado a taxa é null; universo vazio também (sem divisão por zero)', () => {
    expect(agregarResultados({ versao: v, respostas: [resp(1, [item.simNao(1, true)])] })).toMatchObject({ publico_total: null, taxa_resposta_pct: null });
    expect(agregarResultados({ versao: v, respostas: [], universo: [] })).toMatchObject({ publico_total: 0, taxa_resposta_pct: null });
  });

  it('RF-PES-06: quem respondeu mas saiu do público não infla a taxa (nunca passa de 100%)', () => {
    const r = agregarResultados({ versao: v, respostas: [resp(1, [item.simNao(1, true)]), resp(9, [item.simNao(1, true)])], universo: universo.slice(0, 1) });
    expect(r.taxa_resposta_pct).toBe(100);
  });

  it('RF-PES-06: base cliente — conta clientes atendidos; resposta sem cliente fica de fora', () => {
    const clientes = [60, 61, 62].map((n) => ({ id: u(n), equipe_id: u(50) }));
    const rs = [resp(1, [item.simNao(1, true)], { cliente_id: u(60) }), resp(2, [item.simNao(1, true)], { cliente_id: u(60) }), resp(3, [item.simNao(1, true)], { cliente_id: null })];
    const r = agregarResultados({ versao: v, respostas: rs, universo: clientes, base: 'cliente' });
    expect(r).toMatchObject({ base: 'cliente', respondentes_distintos: 1, publico_total: 3, taxa_resposta_pct: 33.33 });
  });
});

describe('RF-PES-06: filtros por período e equipe', () => {
  const v = publicada({ perguntas: [sim_nao(1)] });
  const rs = [
    resp(1, [item.simNao(1, true)], { respondida_em: '2026-10-10T15:00:00Z', equipe_id: u(50) }),
    resp(2, [item.simNao(1, true)], { respondida_em: '2026-10-20T15:00:00Z', equipe_id: u(51) }),
    resp(3, [item.simNao(1, false)], { respondida_em: '2026-10-25T15:00:00Z', equipe_id: u(51) }),
  ];

  it('RF-PES-06: período em dias civis, inclusivo nas duas pontas', () => {
    expect(agregarResultados({ versao: v, respostas: rs, filtro: { de: '2026-10-20', ate: '2026-10-25' } }).total_respostas).toBe(2);
    expect(agregarResultados({ versao: v, respostas: rs, filtro: { de: '2026-10-21' } }).total_respostas).toBe(1);
    expect(agregarResultados({ versao: v, respostas: rs, filtro: { ate: '2026-10-10' } }).total_respostas).toBe(1);
  });

  it('RF-PES-06: o dia é o do fuso do tenant (01/11 02:00Z ainda é 31/10 em Manaus)', () => {
    const tarde = [resp(1, [item.simNao(1, true)], { respondida_em: '2026-11-01T02:00:00Z' })];
    expect(agregarResultados({ versao: v, respostas: tarde, filtro: { ate: '2026-10-31' } }).total_respostas).toBe(1);
    expect(agregarResultados({ versao: v, respostas: tarde, filtro: { de: '2026-11-01' } }).total_respostas).toBe(0);
  });

  it('RF-PES-06: filtro por equipe — respostas e universo', () => {
    const universo = [{ id: u(101), equipe_id: u(50) }, { id: u(102), equipe_id: u(51) }, { id: u(103), equipe_id: u(51) }];
    const r = agregarResultados({ versao: v, respostas: rs, universo, filtro: { equipe_ids: [u(51)] } });
    expect(r).toMatchObject({ total_respostas: 2, publico_total: 2 });
  });

  it('RF-PES-06: período e equipe combinados', () => {
    const r = agregarResultados({ versao: v, respostas: rs, filtro: { de: '2026-10-21', equipe_ids: [u(51)] } });
    expect(r.total_respostas).toBe(1);
    const p = r.por_pergunta[0]!;
    if (p.tipo === 'sim_nao') expect(p.opcoes.map((o) => o.contagem)).toEqual([0, 1]);
  });
});

describe('RN-PES-01: resultados são por versão', () => {
  it('RN-PES-01: respostas de outra versão ficam de fora e são contadas à parte', () => {
    const v2 = publicada({ id: u(701), numero: 2, perguntas: [sim_nao(1)] });
    const rs = [resp(1, [item.simNao(1, true)]), resp(2, [item.simNao(1, true)], { versao_id: u(701) })];
    expect(agregarResultados({ versao: v2, respostas: rs })).toMatchObject({ total_respostas: 1, ignoradas_outra_versao: 1, versao_id: u(701) });
  });

  it('RF-PES-04: resposta repetida (mesmo id) conta uma vez só', () => {
    const v = publicada({ perguntas: [sim_nao(1)] });
    const a = resp(1, [item.simNao(1, true)]);
    expect(agregarResultados({ versao: v, respostas: [a, structuredClone(a)] }).total_respostas).toBe(1);
  });

  it('RF-PES-06: sem nenhuma resposta, percentuais são null e contagens zero', () => {
    const v = publicada({ perguntas: [sim_nao(1), unica(2)] });
    const r = agregarResultados({ versao: v, respostas: [] });
    expect(r.total_respostas).toBe(0);
    expect(r.por_pergunta[0]).toMatchObject({ respondentes: 0, pct_das_respostas: null });
    const p = r.por_pergunta[1]!;
    if (p.tipo === 'unica') expect(p.opcoes.every((o) => o.contagem === 0 && o.pct === null)).toBe(true);
  });
});

describe('RN-PES-04: resposta suspeita aparece no resultado', () => {
  it('RN-PES-04: respostas aceitas com flag de suspeita são contadas em respostas_suspeitas (e continuam no total)', () => {
    const v = publicada({ perguntas: [sim_nao(1)] });
    const r = agregarResultados({
      versao: v,
      respostas: [resp(1, [item.simNao(1, true)]), resp(2, [item.simNao(1, true)], { suspeita: true, motivos_suspeita: ['RELOGIO_ADIANTADO'] })],
    });
    expect(r.total_respostas).toBe(2);
    expect(r.respostas_suspeitas).toBe(1);
  });
});

describe('RN-PES-01: consolidação entre versões só por identificador estável', () => {
  const v1 = publicada({ id: u(701), numero: 1, perguntas: [sim_nao(1), unica(2, [101, 102]), texto(3)] });
  // v2: P1 mantida; P2 mantida com nova opção 103; P3 removida; P4 nova; P5 reaproveita o enunciado de P3 com outro id.
  const v2 = publicada({ id: u(702), numero: 2, perguntas: [sim_nao(1), unica(2, [101, 102, 103]), sim_nao(4), texto(5, { enunciado: 'Pergunta 3' })] });
  const r1 = (n: number, itens: ItemResposta[]) => resp(n, itens, { versao_id: u(701) });
  const r2 = (n: number, itens: ItemResposta[]) => resp(n, itens, { versao_id: u(702) });
  const respostas = [
    r1(1, [item.simNao(1, true), item.unica(2, 101), item.texto(3, 'a')]),
    r1(2, [item.simNao(1, false), item.unica(2, 102)]),
    r2(3, [item.simNao(1, true), item.unica(2, 103), item.simNao(4, true), item.texto(5, 'b')]),
  ];
  const c = consolidarEntreVersoes({ versoes: [v2, v1], respostas });

  it('RN-PES-01: pergunta com o mesmo id nas duas versões soma as respostas das duas', () => {
    const p1 = c.consolidadas.find((x) => x.pergunta.pergunta_id === u(1))!;
    expect(p1.versoes_ids).toEqual([u(701), u(702)]);
    expect(p1.total_respostas).toBe(3);
    expect(p1.pergunta).toMatchObject({ tipo: 'sim_nao', respondentes: 3 });
  });

  it('RN-PES-01: única com opção nova na v2 consolida pela união das opções (por id da opção)', () => {
    const p2 = c.consolidadas.find((x) => x.pergunta.pergunta_id === u(2))!.pergunta;
    if (p2.tipo !== 'unica') throw new Error('tipo');
    expect(p2.opcoes.map((o) => [o.opcao_id, o.contagem])).toEqual([[u(101), 1], [u(102), 1], [u(103), 1]]);
  });

  it('RN-PES-01: pergunta removida, nova ou com id diferente aparece por versão, mesmo com o mesmo enunciado', () => {
    expect(c.consolidadas.map((x) => x.pergunta.pergunta_id)).toEqual([u(1), u(2)]);
    expect(c.por_versao.map((x) => [x.numero, x.perguntas.map((p) => p.pergunta_id)])).toEqual([
      [1, [u(3)]],
      [2, [u(4), u(5)]],
    ]);
  });

  it('RN-PES-01: pergunta com o mesmo id mas outro tipo não é consolidada', () => {
    const v3 = publicada({ id: u(703), numero: 3, perguntas: [texto(1)] });
    const x = consolidarEntreVersoes({ versoes: [v1, v3], respostas: [] });
    expect(x.consolidadas).toEqual([]);
    expect(x.por_versao[1]!.perguntas.map((p) => p.tipo)).toEqual(['texto']);
  });

  it('RN-PES-01: versão em rascunho e resposta de versão desconhecida ficam de fora; id de resposta repetido conta uma vez', () => {
    const rasc = publicada({ id: u(704), numero: 3, status: 'rascunho' });
    const x = consolidarEntreVersoes({ versoes: [v1, v2, rasc], respostas: [...respostas, respostas[0]!, resp(9, [item.simNao(1, true)], { versao_id: u(999) })] });
    expect(x.versoes.map((v) => [v.numero, v.respostas])).toEqual([[1, 2], [2, 1]]);
  });
});
