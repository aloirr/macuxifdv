import { describe, expect, it } from 'vitest';
import type { RotasLista, VisitaBko } from '../../contracts';
import { csvDaCarteira, rotuloDia, rotuloFrequencia } from './carteira';
import { clienteDaCarteira, corpoDaRota, donosDeRotaDaHierarquia, equipesDaHierarquia, paraRouteDay } from './rotas-api';
import { csvDeVisitas, permanenciaMin, rotuloResultado, sinais } from './visitas';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOJE = '2026-10-31';

const item: RotasLista['itens'][number] = {
  usuario_id: id(1),
  usuario_nome: 'Vera',
  data: HOJE,
  rota: { id: id(9), updated_at: '2026-10-31T10:00:00.000000Z', deleted_at: null, external_id: null, usuario_id: id(1), data: HOJE, situacao: 'publicada', origem: 'bko', regiao: 'Zona Sul', observacao: null },
  feitas: 1,
  total: 2,
  paradas: [
    { id: id(11), updated_at: '', deleted_at: null, external_id: null, rota_id: id(9), usuario_id: id(1), data: HOJE, cliente_id: id(21), sequencia: 1, janela_inicio: '09:00', janela_fim: '09:40', status: 'feita', visita_id: id(31), cliente_nome: 'Auto Peças Um', cliente_cidade: 'Manaus', cliente_bairro: 'Centro', lat: -3.1, lng: -60 },
    { id: id(12), updated_at: '', deleted_at: null, external_id: null, rota_id: id(9), usuario_id: id(1), data: HOJE, cliente_id: id(22), sequencia: 2, janela_inicio: null, janela_fim: null, status: 'proxima', visita_id: null, cliente_nome: 'Sem Coordenada', lat: null, lng: null },
  ],
};

describe('rotas do BKO: adaptador do servidor para o editor (T-0018)', () => {
  it('RF-CORE-05: a rota do servidor vira o RouteDay do editor com status, janelas e km', () => {
    const r = paraRouteDay(item, HOJE, { lat: -3.12, lng: -60.0 });
    expect(r).toMatchObject({ id: id(9), seller_id: id(1), date: HOJE, region: 'Zona Sul', done_count: 1 });
    expect(r.stops.map((s) => [s.sequence, s.status, s.customer.trade_name, s.window_start])).toEqual([[1, 'done', 'Auto Peças Um', '09:00'], [2, 'next', 'Sem Coordenada', '']]);
    expect(r.total_km).toBeGreaterThan(0);
    expect(r.stops[1]?.customer.lat).toBeNull();
  });

  it('RN-CORE-75: sem base não há ponto de saída: o km conta do 1º cliente, não de um ponto fixo', () => {
    const doisComPonto = { ...item, paradas: [item.paradas[0]!, { ...item.paradas[1]!, lat: -3.1, lng: -60 }] };
    expect(paraRouteDay(doisComPonto, HOJE).total_km).toBe(0);
    expect(paraRouteDay(item, HOJE, { lat: -3.12, lng: -60.0 }).total_km).toBeGreaterThan(0);
  });

  it('corpo do PUT: ordem do rascunho, horário vazio vira nulo', () => {
    const corpo = corpoDaRota([
      { customer: { id: id(22) }, window_start: '', window_end: '' },
      { customer: { id: id(21) }, window_start: '09:00', window_end: '09:40' },
    ]);
    expect(corpo.paradas).toEqual([
      { cliente_id: id(22), janela_inicio: null, janela_fim: null },
      { cliente_id: id(21), janela_inicio: '09:00', janela_fim: '09:40' },
    ]);
  });

  it('equipe de campo: só vendedor/promotor ativos, "equipe" = o supervisor, papel do vínculo = perfil', () => {
    const membros = [
      { id: id(100), nome: 'Gil Gerente', perfil: 'gerente', superior_id: null, ativo: true },
      { id: id(101), nome: 'Sueli Supervisora', perfil: 'supervisor', superior_id: id(100), ativo: true },
      { id: id(1), nome: 'Vera Vendedora', perfil: 'vendedor', superior_id: id(101), ativo: true },
      { id: id(2), nome: 'Paulo Promotor', perfil: 'promotor', superior_id: id(101), ativo: true },
      { id: id(3), nome: 'Inativo', perfil: 'vendedor', superior_id: id(101), ativo: false },
    ] as const;
    const e = equipesDaHierarquia(membros);
    expect(e.sellers.map((s) => s.name)).toEqual(['Paulo Promotor', 'Vera Vendedora']);
    expect(e.sellers[0]).toMatchObject({ short_name: 'Paulo', team_id: id(101), team_name: 'Equipe de Sueli Supervisora' });
    expect(e.teams).toHaveLength(1);
    expect(e.papeis).toEqual({ [id(1)]: 'vendedor', [id(2)]: 'promotor' });
  });

  it('RN-CORE-13: donos de rota no BKO: vendedor, promotor, supervisor e gerente ativos; a "equipe" do supervisor é o gerente dele', () => {
    const membros = [
      { id: id(100), nome: 'Gil Gerente', perfil: 'gerente', superior_id: null, ativo: true },
      { id: id(101), nome: 'Sueli Supervisora', perfil: 'supervisor', superior_id: id(100), ativo: true },
      { id: id(102), nome: 'Saulo Supervisor', perfil: 'supervisor', superior_id: id(100), ativo: false },
      { id: id(1), nome: 'Vera Vendedora', perfil: 'vendedor', superior_id: id(101), ativo: true },
    ] as const;
    const d = donosDeRotaDaHierarquia(membros);
    expect(d.sellers.map((s) => s.name)).toEqual(['Gil Gerente', 'Sueli Supervisora', 'Vera Vendedora']);
    expect(d.sellers[1]).toMatchObject({ team_id: id(100), team_name: 'Equipe de Gil Gerente' });
    expect(d.teams.map((t) => t.name)).toEqual(['Equipe de Gil Gerente', 'Equipe de Sueli Supervisora', 'Sem equipe']);
    // a equipe de campo (carteira, farol, visitas) segue sem o supervisor
    expect(equipesDaHierarquia(membros).sellers.map((s) => s.name)).toEqual(['Vera Vendedora']);
  });

  it('cliente da carteira: dias sem comprar calculados da última compra', () => {
    const c = clienteDaCarteira({ id: id(21), nome: 'X', razao_social: 'X Ltda', cidade: null, bairro: null, lat: null, lng: null, ultima_compra_em: '2026-10-21', frequencia_semanas: 1, dia_semana: 3 }, HOJE);
    expect(c.days_since_purchase).toBe(10);
  });
  it('RF-CORE-02: cliente da carteira leva código e CNPJ para a busca do editor', () => {
    const c = clienteDaCarteira({ id: id(21), nome: 'X', razao_social: 'X Ltda', external_id: 'QX-1', documento: '47111222000133', cidade: null, bairro: null, lat: null, lng: null, ultima_compra_em: null, frequencia_semanas: 1, dia_semana: 3 }, HOJE);
    expect([c.erp_code, c.cnpj]).toEqual(['QX-1', '47111222000133']);
  });
});

describe('telas Visitas e Carteira: funções puras', () => {
  const v: VisitaBko = {
    id: id(40), usuario_id: id(1), usuario_nome: 'Vera', cliente_id: id(21), cliente_nome: 'Auto "Um"', data_local: HOJE, checkin_em: '2026-10-31T13:00:00Z', checkout_em: '2026-10-31T13:40:00Z',
    fora_do_raio: true, distancia_m: 850, justificativa_fora_raio: 'Atendeu ao lado', sem_gps: false, sugere_coordenada: false, extra: true, resultado: 'cliente_fechado', fechada_por: 'usuario',
    motivo_codigo: 'loja_fechada', motivo_descricao: 'Loja fechada', motivo_texto: null, foto_fachada_id: id(50), etapas: [],
  };

  it('RN-CORE-10: fora do raio e visita extra ficam sinalizados; permanência em minutos', () => {
    expect(sinais(v)).toEqual(['Fora do raio', 'Visita extra']);
    expect(permanenciaMin(v)).toBe(40);
    expect(permanenciaMin({ ...v, checkout_em: null })).toBeNull();
    expect(rotuloResultado('cliente_fechado')).toBe('Cliente fechado');
    expect(rotuloResultado(null)).toBe('Em atendimento');
  });

  it('CSV das visitas: separador ;, aspas escapadas, fuso do tenant e marca de foto', () => {
    const csv = csvDeVisitas([v], 'America/Manaus');
    const linhas = csv.slice(1).trim().split('\r\n');
    expect(linhas[0]).toContain('"Cliente"');
    expect(linhas[1]).toContain('"Auto ""Um"""');
    expect(linhas[1]).toContain('"Fora do raio, Visita extra"');
    expect(linhas[1]).toContain('"31/10/2026');
    expect(linhas[1]?.endsWith('"sim";"0"')).toBe(true);
  });

  it('carteira: rótulos de frequência/dia e CSV', () => {
    expect(rotuloFrequencia(null)).toBe('Sem frequência');
    expect(rotuloFrequencia(1)).toBe('Toda semana');
    expect(rotuloFrequencia(4)).toBe('A cada 4 semanas');
    expect(rotuloDia(3)).toBe('Quarta');
    const csv = csvDaCarteira([{ id: id(21), nome: 'Auto Um', razao_social: 'Auto Um Ltda', cidade: 'Manaus', bairro: null, lat: null, lng: null, ultima_compra_em: null, frequencia_semanas: 2, dia_semana: 5 }], 'Vera');
    expect(csv).toContain('"A cada 2 semanas";"Sexta";"sem coordenada"');
  });
});
