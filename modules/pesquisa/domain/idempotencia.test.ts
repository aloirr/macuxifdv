import { describe, expect, it } from 'vitest';
import { decidirInsercao, impressaoDaResposta, processarLote } from './idempotencia';
import { envio, item, u } from './util-teste';

describe('RF-PES-04: respostas só por inserção, idempotentes pelo UUID do aparelho', () => {
  const r = envio([item.simNao(1, true), item.multipla(2, [201, 202])]);

  it('RF-PES-04: resposta nova (id desconhecido) é inserida', () => {
    expect(decidirInsercao(undefined, r)).toEqual({ resultado: 'inserir' });
    expect(decidirInsercao(null, r)).toEqual({ resultado: 'inserir' });
  });

  it('RF-PES-04: reaplicar a mesma resposta é no-op (duplicada)', () => {
    expect(decidirInsercao(r, structuredClone(r))).toEqual({ resultado: 'duplicada' });
  });

  it('RF-PES-04: a ordem dos itens e das opções marcadas não muda o conteúdo', () => {
    const outra = envio([item.multipla(2, [202, 201]), item.simNao(1, true)]);
    expect(decidirInsercao(r, outra)).toEqual({ resultado: 'duplicada' });
    expect(impressaoDaResposta(r)).toBe(impressaoDaResposta(outra));
  });

  it('RF-PES-04: mesmo id com conteúdo diferente é conflito (CONFLITO_DE_CONTEUDO) e não sobrescreve', () => {
    const d = decidirInsercao(r, envio([item.simNao(1, false), item.multipla(2, [201, 202])]));
    expect(d.resultado).toBe('conflito');
    if (d.resultado === 'conflito') expect(d.mensagem).toMatch(/já foi recebida/);
  });

  it('RF-PES-04: mudar a versão, o cliente, a visita ou a hora do aparelho também é conflito', () => {
    expect(decidirInsercao(r, { ...r, versao_id: u(701) }).resultado).toBe('conflito');
    expect(decidirInsercao(r, { ...r, cliente_id: u(60) }).resultado).toBe('conflito');
    expect(decidirInsercao(r, { ...r, visita_id: u(70) }).resultado).toBe('conflito');
    expect(decidirInsercao(r, { ...r, respondida_em: '2026-10-31T13:00:01Z' }).resultado).toBe('conflito');
  });

  it('RF-PES-04: a mesma hora do aparelho em outra grafia (sem milissegundos, ou com microssegundos do banco) não vira conflito', () => {
    const base = { ...r, respondida_em: '2026-10-31T13:00:00Z' };
    expect(decidirInsercao({ ...base, respondida_em: '2026-10-31T13:00:00.000Z' }, base)).toEqual({ resultado: 'duplicada' });
    expect(decidirInsercao({ ...base, respondida_em: '2026-10-31T13:00:00.123456Z' }, { ...base, respondida_em: '2026-10-31T13:00:00.123Z' })).toEqual({ resultado: 'duplicada' });
    expect(decidirInsercao({ ...base, respondida_em: '2026-10-31T13:00:00.000Z' }, { ...base, respondida_em: '2026-10-31T13:00:01Z' }).resultado).toBe('conflito');
  });

  it('RF-PES-04: campos do servidor (recebida_em, usuário) não entram na comparação', () => {
    const gravada = { ...r, tenant_id: u(900), usuario_id: u(1), equipe_id: null, recebida_em: '2026-10-31T14:00:00Z' };
    expect(decidirInsercao(gravada, r)).toEqual({ resultado: 'duplicada' });
  });

  it('RF-PES-04: foto com outra referência é conteúdo diferente', () => {
    const a = envio([item.foto(3, [10])]);
    const b = envio([{ ...item.foto(3, [10]) }]);
    if (b.itens[0]!.tipo === 'foto') b.itens[0]!.fotos[0]!.referencia = 'fotos/outra.jpg';
    expect(decidirInsercao(a, b).resultado).toBe('conflito');
  });

  it('RF-PES-04: lote — cada resposta recebe seu resultado; reenviar o lote inteiro não grava nada de novo', () => {
    const a = envio([item.simNao(1, true)], { id: u(5001) });
    const b = envio([item.simNao(1, false)], { id: u(5002) });
    const primeiro = processarLote([], [a, b]);
    expect(primeiro.map((x) => x.resultado)).toEqual(['inserir', 'inserir']);
    const segundo = processarLote([a, b], [a, b]);
    expect(segundo.map((x) => x.resultado)).toEqual(['duplicada', 'duplicada']);
  });

  it('RF-PES-04: lote — o mesmo id repetido dentro do lote vale uma vez; com conteúdo diferente, o 2º é conflito', () => {
    const a = envio([item.simNao(1, true)], { id: u(5001) });
    const igual = structuredClone(a);
    const diferente = envio([item.simNao(1, false)], { id: u(5001) });
    expect(processarLote([], [a, igual]).map((x) => x.resultado)).toEqual(['inserir', 'duplicada']);
    expect(processarLote([], [a, diferente]).map((x) => x.resultado)).toEqual(['inserir', 'conflito']);
  });

  it('RF-PES-04: lote devolve o id de cada resposta, na ordem recebida', () => {
    const a = envio([item.simNao(1, true)], { id: u(5001) });
    const b = envio([item.simNao(1, true)], { id: u(5002) });
    expect(processarLote([], [b, a]).map((x) => x.id)).toEqual([u(5002), u(5001)]);
  });
});
