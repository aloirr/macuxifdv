import { describe, expect, it } from 'vitest';
import type { RotasLista, RouteDay } from '../../contracts';
import { corpoDoLote, diaComRascunho, estadoDoDialogo, existentesDoPeriodo, linhasDaPrevia, resumoDaPrevia, textoForaLimite, textoForaSemCoordenada, textosDoConflito, totaisDaPreviaAberta } from './rotas-criar';
import type { DraftStop } from './routes';

const BASE = { tipo: 'casa' as const, cep: '69053000', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.1, lng: -60 };
const HOJE = '2026-11-01';
const MES = { from: '2026-11-01', to: '2026-11-30' };
const cal = { dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [] as string[] };
const pronto = { carteira: 10, base: BASE, existentes: [], calendario: cal, range: MES, hoje: HOJE };

describe('RN-CORE-76: estados do diálogo Criar rota (spec §3.1)', () => {
  it('carregando enquanto falta a carteira, a base ou as rotas do período', () => {
    expect(estadoDoDialogo({ ...pronto, carteira: null })).toEqual({ tipo: 'carregando' });
    expect(estadoDoDialogo({ ...pronto, base: undefined })).toEqual({ tipo: 'carregando' });
    expect(estadoDoDialogo({ ...pronto, existentes: null })).toEqual({ tipo: 'carregando' });
  });

  it('sem endereço base, carteira vazia e período passado bloqueiam, nessa ordem de prioridade (passado, carteira, base)', () => {
    expect(estadoDoDialogo({ ...pronto, base: null })).toEqual({ tipo: 'sem_base' });
    expect(estadoDoDialogo({ ...pronto, carteira: 0, base: null })).toEqual({ tipo: 'carteira_vazia' });
    expect(estadoDoDialogo({ ...pronto, range: { from: '2026-10-01', to: '2026-10-31' } })).toEqual({ tipo: 'passado' });
  });

  it('sem rota existente, está pronto sem conflito', () => {
    expect(estadoDoDialogo(pronto)).toEqual({ tipo: 'pronto', conflito: null });
  });

  it('"Substituir N" conta só as rotas que de fato serão trocadas: a protegida (visita feita ou ERP) e a de dia passado ficam fora', () => {
    const existentes = [
      { data: '2026-11-03', visitas: 9, protegida: false },
      { data: '2026-11-04', visitas: 9, protegida: false },
      { data: '2026-11-05', visitas: 9, protegida: true },
      { data: '2026-10-30', visitas: 9, protegida: false },
    ];
    expect(estadoDoDialogo({ ...pronto, existentes })).toEqual({ tipo: 'pronto', conflito: { total: 3, substituiveis: 2 } });
  });

  it('textos do conflito: a linha de apoio só aparece quando N é menor que o total; no modo Dia o texto fala do dia', () => {
    expect(textosDoConflito(false, { total: 6, substituiveis: 4 })).toEqual({ aviso: 'Já tem rota em 6 dias.', manter: 'Criar só nos dias sem rota', substituir: 'Substituir 4 rotas', apoio: '2 com visita feita ou do ERP ficam.' });
    expect(textosDoConflito(false, { total: 3, substituiveis: 3 }).apoio).toBeNull();
    expect(textosDoConflito(false, { total: 3, substituiveis: 2 }).apoio).toBe('1 com visita feita ou do ERP fica.');
    expect(textosDoConflito(true, { total: 1, substituiveis: 1 })).toMatchObject({ aviso: 'Este dia já tem rota.', manter: 'Manter a rota', substituir: 'Substituir a rota' });
  });

  it('as rotas do período em formato do domínio: protegida pela origem ERP ou por visita feita ou em atendimento', () => {
    const rota = (origem: string) => ({ origem }) as never;
    const itens = [
      { data: '2026-11-03', rota: rota('bko'), paradas: [{ status: 'pendente' }] },
      { data: '2026-11-04', rota: rota('erp'), paradas: [{ status: 'pendente' }] },
      { data: '2026-11-05', rota: rota('bko'), paradas: [{ status: 'feita' }, { status: 'proxima' }] },
      { data: '2026-11-06', rota: null, paradas: [] },
    ] as unknown as RotasLista['itens'];
    expect(existentesDoPeriodo(itens)).toEqual([
      { data: '2026-11-03', visitas: 1, protegida: false },
      { data: '2026-11-04', visitas: 1, protegida: true },
      { data: '2026-11-05', visitas: 2, protegida: true },
    ]);
  });
});

describe('RN-CORE-76: prévia (spec §4)', () => {
  const dia = (data: string, ids: string[], km = 10): RouteDay => ({
    id: null,
    seller_id: 'v',
    date: data,
    status: 'planejada',
    region: '',
    total_km: km,
    stops: ids.map((id, i) => ({ id, sequence: i + 1, window_start: '', window_end: '', status: 'pending', distance_km: 0, customer: { id, lat: -3.1, lng: -60 } as never, visit: null, order_total_cents: null })),
    done_count: 0,
  });

  it('textos dos alertas no singular e no plural, e o resumo do cabeçalho', () => {
    expect(textoForaSemCoordenada(3)).toBe('3 clientes ficaram fora: sem coordenada.');
    expect(textoForaSemCoordenada(1)).toBe('1 cliente ficou fora: sem coordenada.');
    expect(textoForaLimite(8)).toBe('8 clientes não couberam no limite do dia.');
    expect(textoForaLimite(1)).toBe('1 cliente não coube no limite do dia.');
    expect(resumoDaPrevia({ rotas: 19, visitas: 209, km: 988.4 })).toBe('19 rotas · 209 visitas · 988 km');
    expect(resumoDaPrevia({ rotas: 1, visitas: 1, km: 0 })).toBe('1 rota · 1 visita · 0 km');
  });

  it('a lista de dias junta dias, mantidas e feriados em ordem de data', () => {
    const l = linhasDaPrevia([dia('2026-11-03', ['a']), dia('2026-11-05', ['b'])], { mantidas: [{ data: '2026-11-04', visitas: 9, protegida: false }], feriados: ['2026-11-02'] });
    expect(l.map((x) => `${x.tipo}:${x.data}`)).toEqual(['feriado:2026-11-02', 'dia:2026-11-03', 'mantida:2026-11-04', 'dia:2026-11-05']);
  });

  it('RN-CORE-76: os totais do cabeçalho são os da API; depois da edição, refeitos pelo domain (só dias com paradas, km inteiro por linha)', () => {
    const api = { rotas: 9, visitas: 99, km: 999 };
    const dias = [dia('2026-11-03', ['a', 'b'], 12.34), dia('2026-11-04', [], 5), dia('2026-11-05', ['c'], 7)];
    expect(totaisDaPreviaAberta(api, dias, false)).toBe(api);
    expect(totaisDaPreviaAberta(api, dias, true)).toEqual({ rotas: 2, visitas: 3, km: 19 }); // D2: 12,34 → 12 e 7 → 7, o que as linhas mostram
  });

  it('o editor do dia ("Aplicar") troca as paradas e refaz o km a partir da base', () => {
    const base = dia('2026-11-03', ['a', 'b']);
    const rascunho: DraftStop[] = [{ key: 'b', customer: { id: 'b', lat: -3.2, lng: -60 } as never, window_start: '08:00', window_end: '08:40', status: 'new', locked: false }];
    const novo = diaComRascunho(base, rascunho, { lat: -3.1, lng: -60 });
    expect(novo.stops.map((s) => [s.customer.id, s.window_start])).toEqual([['b', '08:00']]);
    expect(novo.total_km).toBeGreaterThan(10);
  });

  it('o lote leva um id por dia, nulo nas janelas vazias, e não leva dia sem paradas', () => {
    const corpo = corpoDoLote('v', 'so_vazios', [dia('2026-11-03', ['a']), dia('2026-11-04', [])], { '2026-11-03': 'id-3', '2026-11-04': 'id-4' });
    expect(corpo).toEqual({ usuario_id: 'v', modo: 'so_vazios', rotas: [{ id: 'id-3', data: '2026-11-03', paradas: [{ cliente_id: 'a', janela_inicio: null, janela_fim: null }] }] });
  });
});
