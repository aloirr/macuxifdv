/**
 * T-0076 (referência aprovada do Início): textos e tons do Início. O shell não calcula meta (RN-CORE-22/26 são do domain
 * do Core): aqui só se confere que cada `situacao` vira o texto e a cor da referência, no fuso do tenant.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { colors } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import {
  dataDoCabecalho,
  desenhoDaLinha,
  desenhoMetaDeHoje,
  destinoDaNotificacao,
  duracaoCurta,
  horaRelogio,
  metaPrincipal,
  notaDaEquipe,
  ordenarCards,
  quandoCurto,
  recadosDeHoje,
  resumoDoMembro,
  saudacao,
  seloNovos,
  situacaoDoMembro,
  textoBaseDefasada,
  textoVisitasHoje,
  visitasDaEquipe,
} from './inicio';

const TZ = 'America/Manaus'; // UTC−4
const meta = (m: Partial<MetaDoDia>): MetaDoDia => ({
  indicador: 'venda_cents',
  situacao: 'a_cumprir',
  meta_mes: 3_000_000,
  realizado_ate_ontem: 1_200_000,
  realizado_hoje: 30_000,
  meta_dia: 100_000,
  atingimento_hoje_pct: 3000,
  dias_uteis_restantes: 18,
  membros: 1,
  membros_mes_batido: 0,
  ...m,
});
const UUID = '11111111-1111-4111-8111-111111111111';
const membro = (x: Partial<MembroAgoraContrato>): MembroAgoraContrato => ({
  usuario_id: UUID,
  nome: 'Lucas Prado',
  status: 'em_rota',
  desde: '2026-11-04T13:40:00Z',
  cliente_id: null,
  paradas_hoje: 6,
  visitadas_hoje: 2,
  vendas_hoje_cents: 124_000,
  minutos_sem_atividade: 20,
  ...x,
});

describe('boas-vindas', () => {
  it('saudação pela hora do tenant: 5h bom dia, 12h boa tarde, 18h e 4h59 boa noite', () => {
    expect(saudacao('2026-11-03T09:00:00Z', TZ, 'Lucas')).toBe('Bom dia, Lucas'); // 5h
    expect(saudacao('2026-11-03T16:00:00Z', TZ, 'Lucas')).toBe('Boa tarde, Lucas'); // 12h
    expect(saudacao('2026-11-03T22:00:00Z', TZ, 'Lucas')).toBe('Boa noite, Lucas'); // 18h
    expect(saudacao('2026-11-03T08:59:00Z', TZ, 'Lucas')).toBe('Boa noite, Lucas'); // 4h59
  });
  it('data no fuso do tenant ("Quarta, 4 de novembro"), com a equipe na Gestão', () => {
    expect(dataDoCabecalho('2026-11-04T20:26:00Z', TZ)).toBe('Quarta, 4 de novembro');
    expect(dataDoCabecalho('2026-11-04T02:00:00Z', TZ)).toBe('Terça, 3 de novembro');
    expect(dataDoCabecalho('2026-11-04T02:00:00Z', TZ, 'Equipe Manaus')).toBe('Terça, 3 de novembro · Equipe Manaus');
  });
  it('"6 visitas hoje · 3 feitas" da rota do aparelho; na Gestão, somadas da Equipe agora', () => {
    expect(textoVisitasHoje({ paradas_hoje: 6, visitadas_hoje: 3 })).toBe('6 visitas hoje · 3 feitas');
    expect(textoVisitasHoje({ paradas_hoje: 1, visitadas_hoje: 1 })).toBe('1 visita hoje · 1 feita');
    expect(textoVisitasHoje({ paradas_hoje: 0, visitadas_hoje: 0 })).toBe('Nenhuma visita na rota de hoje');
    expect(textoVisitasHoje(null)).toBeNull();
    expect(visitasDaEquipe([membro({ paradas_hoje: 6, visitadas_hoje: 3 }), membro({ paradas_hoje: 5, visitadas_hoje: 4 })])).toEqual({ paradas_hoje: 11, visitadas_hoje: 7 });
    expect(visitasDaEquipe(null)).toBeNull();
  });
});

describe('Recados de hoje', () => {
  const agora = '2026-11-04T19:00:00Z'; // quarta 15h em Manaus
  type Notif = VisaoInicio['notificacoes']['ultimas'][number];
  const notif = (id: string, x: Partial<Notif> = {}): Notif => ({ id, titulo: `n-${id.slice(-1)}`, tipo: 'aviso', criada_em: '2026-11-04T18:02:00Z', lida: false, link: null, ...x });
  const A = '11111111-1111-4111-8111-11111111111a';
  const B = '11111111-1111-4111-8111-11111111111b';
  const C = '11111111-1111-4111-8111-11111111111c';
  const recado: VisaoInicio['recado'] = { origem: 'recado', texto: 'Supervisor: priorize o Atacadinho hoje', titulo: null, autor_nome: 'Marcos', autor_perfil: 'supervisor', notificacao_id: B };

  it('recado do dia primeiro e destacado ("Marcos · 09:15"), sem repetir a notificação dele; até 3 itens', () => {
    const ultimas = [notif(A, { titulo: 'Pedido 000010 aprovado', tipo: 'pedido_aprovado', link: '/m/pedido?id=1' }), notif(B, { criada_em: '2026-11-04T13:15:00Z' }), notif(C, { lida: true })];
    const itens = recadosDeHoje({ recado, notificacoes: { nao_lidas: 3, ultimas } }, agora, TZ);
    expect(itens.map((i) => [i.titulo, i.apoio, i.ponto])).toEqual([
      ['Supervisor: priorize o Atacadinho hoje', 'Marcos · 09:15', 'destaque'],
      ['Pedido 000010 aprovado', '14:02', 'sucesso'],
      ['n-c', '14:02', 'lido'],
    ]);
    expect(itens[1]!.destino).toBe('/m/pedido?id=1');
    expect(itens[2]!.destino).toBe('/m/notificacoes');
  });
  it('sem recado do supervisor (frase padrão), só as notificações', () => {
    const padrao: VisaoInicio['recado'] = { ...recado, origem: 'padrao', autor_nome: null, autor_perfil: null, notificacao_id: null };
    expect(recadosDeHoje({ recado: padrao, notificacoes: { nao_lidas: 1, ultimas: [notif(A)] } }, agora, TZ).map((i) => i.ponto)).toEqual(['novo']);
    expect(recadosDeHoje({ recado: padrao, notificacoes: { nao_lidas: 0, ultimas: [] } }, agora, TZ)).toEqual([]);
  });
  it('com `recados_hoje` do Core, a lista é a dele: "Mercadinho São Jorge · 14:02", destaque e lida', () => {
    const r = { id: A, titulo: 'Pedido 000010 aprovado', subtitulo: 'Mercadinho São Jorge', tipo: 'pedido_aprovado', criada_em: '2026-11-04T18:02:00Z', hora: '14:02', lida: false, link: '/m/pedido?id=1', destaque: false };
    const itens = recadosDeHoje(
      { recado, notificacoes: { nao_lidas: 0, ultimas: [] }, recados_hoje: { novos: 1, itens: [{ ...r, id: B, titulo: 'Recado', subtitulo: 'Marcos', hora: '09:15', destaque: true }, r, { ...r, id: C, lida: true, subtitulo: '' }] } },
      agora,
      TZ,
    );
    expect(itens.map((i) => [i.apoio, i.ponto, i.notificacao_id])).toEqual([
      ['Marcos · 09:15', 'destaque', B],
      ['Mercadinho São Jorge · 14:02', 'sucesso', A],
      ['14:02', 'lido', null],
    ]);
    expect(itens[1]!.destino).toBe('/m/pedido?id=1');
  });
  it('selo "N novos"; nada com tudo lido; hora de relógio', () => {
    expect(seloNovos(3)).toBe('3 novos');
    expect(seloNovos(1)).toBe('1 novo');
    expect(seloNovos(0)).toBeNull();
    expect(horaRelogio('2026-11-04T13:05:00Z', TZ)).toBe('09:05');
  });
  it('quando: hoje "08:02", "ontem", dia da semana e data', () => {
    const quarta9h = '2026-11-04T13:00:00Z';
    expect(quandoCurto('2026-11-04T12:02:00Z', quarta9h, TZ)).toBe('08:02');
    expect(quandoCurto('2026-11-03T12:02:00Z', quarta9h, TZ)).toBe('ontem');
    expect(quandoCurto('2026-11-02T12:02:00Z', quarta9h, TZ)).toBe('seg');
    expect(quandoCurto('2026-10-20T12:02:00Z', quarta9h, TZ)).toBe('20/10');
  });
  it('só abre link interno de módulo; o resto vai à central', () => {
    expect(destinoDaNotificacao('/m/pedido?id=1')).toBe('/m/pedido?id=1');
    expect(destinoDaNotificacao('https://fora.com')).toBe('/m/notificacoes');
    expect(destinoDaNotificacao(null)).toBe('/m/notificacoes');
  });
});

describe('Meta de hoje', () => {
  it('a_cumprir: "R$ 1.240 de R$ 3.200", barra laranja, "Faltam R$ 1.960 hoje" e "mês 40%"', () => {
    const d = desenhoMetaDeHoje(meta({ meta_mes: 3_100_000, realizado_ate_ontem: 1_116_000, realizado_hoje: 124_000, meta_dia: 320_000, atingimento_hoje_pct: 3875 }));
    expect(d).toMatchObject({ valor: 'R$ 1.240', de: 'de R$ 3.200', pct: 39, corBarra: colors.accent, apoio: 'Faltam R$ 1.960 hoje', mes: 'mês 40%', verde: false });
  });
  it('dia_batido verde e "Meta de hoje batida"; mes_batido mostra o mês', () => {
    expect(desenhoMetaDeHoje(meta({ situacao: 'dia_batido', realizado_hoje: 100_000, atingimento_hoje_pct: 10000 }))).toMatchObject({ verde: true, pct: 100, corBarra: colors.success, trilho: colors.successTrack, apoio: 'Meta de hoje batida' });
    expect(desenhoMetaDeHoje(meta({ situacao: 'mes_batido', realizado_ate_ontem: 3_100_000, realizado_hoje: 20_000, meta_dia: 0 })).apoio).toBe('Meta do mês batida · R$ 31.200 de R$ 30.000');
  });
  it('dia_nao_util: realizado do mês, barra cinza e quanto falta no mês', () => {
    const d = desenhoMetaDeHoje(meta({ situacao: 'dia_nao_util', realizado_ate_ontem: 2_820_000, realizado_hoje: 0, meta_dia: null, atingimento_hoje_pct: null }));
    expect(d).toMatchObject({ valor: 'R$ 28.200', corBarra: colors.ink3, pct: 94, apoio: 'Hoje não é dia útil · faltam R$ 1.800 no mês' });
  });
  it('cobertura (do_mes) em pontos-base; visitas e positivação com unidade', () => {
    expect(desenhoMetaDeHoje(meta({ indicador: 'cobertura_pct', situacao: 'do_mes', meta_mes: 8000, realizado_ate_ontem: 6200, realizado_hoje: 0, meta_dia: null, atingimento_hoje_pct: null }))).toMatchObject({ valor: '62%', de: 'meta 80%', pct: 78 });
    expect(desenhoMetaDeHoje(meta({ indicador: 'visitas', meta_mes: 120, realizado_hoje: 2, meta_dia: 6, atingimento_hoje_pct: 3333 })).apoio).toBe('Faltam 4 visitas hoje');
    expect(desenhoDaLinha(meta({ indicador: 'positivacao', meta_mes: 40, realizado_hoje: 2, meta_dia: 6, atingimento_hoje_pct: 3333 }))).toEqual({ rotulo: 'Positivação', valor: '2 clientes de 6 clientes', pct: 33, verde: false });
  });
  it('com `meta_hoje` do Core, "faltam" e "mês" vêm dele', () => {
    const d = desenhoMetaDeHoje(meta({ meta_dia: 320_000, realizado_hoje: 124_000 }), { faltam_hoje: 150_000, mes_pct: 5100 });
    expect(d).toMatchObject({ apoio: 'Faltam R$ 1.500 hoje', mes: 'mês 51%' });
    expect(metaPrincipal([meta({}), meta({ indicador: 'visitas' })], 'visitas').principal!.indicador).toBe('visitas');
  });
  it('principal = vendas; promotor sem meta de vendas usa o primeiro indicador com meta (RN-PRO-01)', () => {
    const vendas = meta({});
    const visitas = meta({ indicador: 'visitas' });
    const cobertura = meta({ indicador: 'cobertura_pct', situacao: 'do_mes' });
    expect(metaPrincipal([visitas, vendas])).toEqual({ principal: vendas, outras: [visitas] });
    expect(metaPrincipal([visitas, cobertura])).toEqual({ principal: visitas, outras: [cobertura] });
    expect(metaPrincipal([])).toEqual({ principal: null, outras: [] });
  });
  it('equipe: "1 de 3 já bateu o mês"', () => {
    expect(notaDaEquipe(meta({ membros: 3, membros_mes_batido: 1 }))).toBe('1 de 3 já bateu o mês');
    expect(notaDaEquipe(meta({ membros: 3, membros_mes_batido: 3 }))).toBeNull();
  });
  it('base defasada: "Vendas até 02/11 às 18h40. Sincronize para atualizar."; base de hoje sem aviso', () => {
    expect(textoBaseDefasada({ dia: '2026-11-02', calculado_em: '2026-11-02T22:40:00.000Z', defasado: true }, TZ)).toBe('Vendas até 02/11 às 18h40. Sincronize para atualizar.');
    expect(textoBaseDefasada({ dia: '2026-11-03', calculado_em: '2026-11-03T12:00:00.000Z', defasado: false }, TZ)).toBeNull();
  });
});

describe('Equipe agora (Gestão)', () => {
  it('situação com texto e cor (cor sempre acompanha o texto)', () => {
    expect(situacaoDoMembro(membro({}), TZ)).toEqual({ texto: 'Em rota · saiu de um cliente às 9h40', cor: colors.ink2 });
    expect(situacaoDoMembro(membro({ status: 'parado', minutos_sem_atividade: 100 }), TZ)).toEqual({ texto: 'Sem check-in há 1h40', cor: colors.warning });
    expect(situacaoDoMembro(membro({ status: 'sem_checkin' }), TZ).texto).toBe('Sem check-in hoje');
    expect(situacaoDoMembro(membro({ status: 'rota_concluida' }), TZ)).toEqual({ texto: 'Rota concluída', cor: colors.success });
    expect(situacaoDoMembro(membro({ status: 'em_visita' }), TZ, 'Atacado Boto Rosa').texto).toBe('Em visita · Atacado Boto Rosa');
  });
  it('resumo "2/6 · R$ 1.240"; sem vendas na cópia, "2/6"', () => {
    expect(resumoDoMembro(membro({}))).toBe('2/6 · R$ 1.240');
    expect(resumoDoMembro(membro({ vendas_hoje_cents: null }))).toBe('2/6');
    expect(duracaoCurta(45)).toBe('45 min');
    expect(duracaoCurta(120)).toBe('2h');
  });
});

describe('cards do slot', () => {
  it('por ordem (ausente = 100), estável no empate', () => {
    const c = (id: string, ordem?: number) => ({ id, payload: { ordem } });
    expect(ordenarCards([c('pesquisa'), c('treinamento'), c('aprovacoes', 10)]).map((x) => x.id)).toEqual(['aprovacoes', 'pesquisa', 'treinamento']);
  });
});
