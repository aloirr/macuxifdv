/**
 * T-0076 (referência aprovada do Início) e T-0124 (redundâncias RD-0002 a RD-0012): textos e tons do Início. O shell não
 * calcula meta (RN-CORE-22/26 são do domain do Core): aqui só se confere que cada `situacao` e cada número pronto do Core
 * vira o texto e a cor da proposta, no fuso do tenant.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { colors } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import {
  avisoDosDados,
  caminhoDoLink,
  dataDoCabecalho,
  desenhoDaLinha,
  desenhoMetaDoMes,
  destinoDaNotificacao,
  duracaoCurta,
  metaPrincipal,
  mostrarPontos,
  mostrarVerTodos,
  notaDaEquipe,
  ordenarCards,
  percentualDoMes,
  recadosDoInicio,
  resumoDoMembro,
  rotuloDaMeta,
  seloNovos,
  situacaoDoMembro,
  textoDoRecado,
  textoVisitasHoje,
  visitasDaEquipe,
  xDeY,
  type RecadosProntos,
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
  it('data no fuso do tenant ("Quarta, 4 de novembro"), com a equipe na Gestão', () => {
    expect(dataDoCabecalho('2026-11-04T20:26:00Z', TZ)).toBe('Quarta, 4 de novembro');
    expect(dataDoCabecalho('2026-11-04T02:00:00Z', TZ)).toBe('Terça, 3 de novembro');
    expect(dataDoCabecalho('2026-11-04T02:00:00Z', TZ, 'Equipe Manaus')).toBe('Terça, 3 de novembro · Equipe Manaus');
  });
  it('"6 visitas hoje · 3 feitas" da rota do aparelho; na Gestão, somadas da Equipe agora', () => {
    expect(textoVisitasHoje({ paradas_hoje: 6, visitadas_hoje: 3 })).toBe('6 visitas hoje · 3 feitas');
    expect(textoVisitasHoje({ paradas_hoje: 1, visitadas_hoje: 1 }, true)).toBe('1 visita hoje · 1 feita');
    expect(textoVisitasHoje(null)).toBeNull();
    expect(visitasDaEquipe([membro({ paradas_hoje: 6, visitadas_hoje: 3 }), membro({ paradas_hoje: 5, visitadas_hoje: 4 })])).toEqual({ paradas_hoje: 11, visitadas_hoje: 7 });
    expect(visitasDaEquipe(null)).toBeNull();
  });
  it('RD-0006: sem paradas, "Sem rota hoje"; em dia não útil (dia_util do Core) "Sem rota hoje · não é dia útil", uma vez só', () => {
    expect(textoVisitasHoje({ paradas_hoje: 0, visitadas_hoje: 0 }, true)).toBe('Sem rota hoje');
    expect(textoVisitasHoje({ paradas_hoje: 0, visitadas_hoje: 0 }, false)).toBe('Sem rota hoje · não é dia útil');
    // com paradas, sem mudança, mesmo num sábado com rota
    expect(textoVisitasHoje({ paradas_hoje: 2, visitadas_hoje: 0 }, false)).toBe('2 visitas hoje · 0 feitas');
  });
});

describe('Recados (RD-0003, RD-0009, RD-0012)', () => {
  const A = '11111111-1111-4111-8111-11111111111a';
  const B = '11111111-1111-4111-8111-11111111111b';
  const C = '11111111-1111-4111-8111-11111111111c';
  type Item = RecadosProntos['itens'][number];
  const r = (x: Partial<Item>): Item => ({ id: A, titulo: 'Pedido 000010 aprovado', subtitulo: 'Mercadinho São Jorge', tipo: 'pedido_aprovado', criada_em: '2026-11-04T18:02:00Z', hora: '14:02', lida: false, link: '/m/pedido?id=1', destaque: false, ...x });

  it('a lista é a do Core (`recados_hoje`): título e corpo num texto só, hora à parte, destaque e lida', () => {
    const itens = recadosDoInicio({ novos: 1, itens: [r({ id: B, titulo: 'Prioridade', subtitulo: 'Passe cedo no Mercadinho São Jorge: tem título vencido.', hora: '09:15', destaque: true, link: null }), r({}), r({ id: C, lida: true, subtitulo: '' })] });
    expect(itens.map((i) => [i.texto, i.hora, i.ponto, i.notificacao_id])).toEqual([
      ['Prioridade: Passe cedo no Mercadinho São Jorge: tem título vencido.', '09:15', 'destaque', B],
      ['Pedido 000010 aprovado: Mercadinho São Jorge', '14:02', 'sucesso', A],
      ['Pedido 000010 aprovado', '14:02', 'lido', null],
    ]);
    expect(itens[0]!.destino).toBe('/m/notificacoes');
    expect(itens[1]!.destino).toBe('/m/pedido?id=1');
  });
  it('sem `recados_hoje` (campo ainda opcional no @1) a lista fica vazia: nada de contorno que repete o domain', () => {
    expect(recadosDoInicio(undefined)).toEqual([]);
    expect(recadosDoInicio(null)).toEqual([]);
  });
  it('texto do recado: "Título: corpo"; título com pontuação final só ganha o espaço; sem corpo, só o título', () => {
    expect(textoDoRecado('Prioridade', 'Passe cedo')).toBe('Prioridade: Passe cedo');
    expect(textoDoRecado('Atenção!', 'Passe cedo')).toBe('Atenção! Passe cedo');
    expect(textoDoRecado('Pedido aprovado', '  ')).toBe('Pedido aprovado');
    expect(textoDoRecado('', 'Só o corpo')).toBe('Só o corpo');
  });
  it('RD-0009: bolinha só com mais de 1 item; "Ver todos" só quando há mais na caixa do que o cartão mostra', () => {
    const um = recadosDoInicio({ novos: 1, itens: [r({})] });
    expect(mostrarPontos(um)).toBe(false);
    expect(mostrarPontos(recadosDoInicio({ novos: 2, itens: [r({}), r({ id: B })] }))).toBe(true);
    // sem o total do Core: menos de 3 = a caixa inteira está no cartão
    expect(mostrarVerTodos({ novos: 1, itens: [r({})] })).toBe(false);
    expect(mostrarVerTodos({ novos: 0, itens: [r({}), r({ id: B }), r({ id: C })] })).toBe(true);
    expect(mostrarVerTodos(undefined)).toBe(false);
    // com o total do Core (aditivo pedido): exatamente 3 na caixa, sem "Ver todos"; 4, com
    expect(mostrarVerTodos({ novos: 0, total: 3, itens: [r({}), r({ id: B }), r({ id: C })] })).toBe(false);
    expect(mostrarVerTodos({ novos: 0, total: 4, itens: [r({}), r({ id: B }), r({ id: C })] })).toBe(true);
  });
  it('selo "N novos"; nada com tudo lido', () => {
    expect(seloNovos(3)).toBe('3 novos');
    expect(seloNovos(1)).toBe('1 novo');
    expect(seloNovos(0)).toBeNull();
  });
  it('só abre link interno de módulo; o resto vai à central', () => {
    expect(destinoDaNotificacao('/m/pedido?id=1')).toBe('/m/pedido?id=1');
    expect(destinoDaNotificacao('https://fora.com')).toBe('/m/notificacoes');
    expect(destinoDaNotificacao(null)).toBe('/m/notificacoes');
  });
  it('link para tela que não existe na visão do usuário vai à central (recado com /m/core-rota)', () => {
    const telas = new Set(['rota', 'clientes', 'notificacoes']);
    const existe = (c: string) => telas.has(c);
    expect(destinoDaNotificacao('/m/core-rota', existe)).toBe('/m/notificacoes');
    expect(destinoDaNotificacao('/m/rota', existe)).toBe('/m/rota');
    expect(destinoDaNotificacao('/m/rota?data=2026-11-08', existe)).toBe('/m/rota?data=2026-11-08');
    expect(caminhoDoLink('/m/cliente?id=1#x')).toBe('cliente');
    expect(caminhoDoLink('/x/rota')).toBeNull();
  });
});

/**
 * T-0124 / RD-0002 (decisão do gerente R-20261108-161557): cartão "Meta do mês" com realizado do mês de meta do mês, barra
 * e o % uma vez; a última linha muda conforme o dia. Caso do teste de campo: meta R$ 180.000, R$ 553 até ontem.
 */
describe('Meta do mês (RD-0002, RD-0004)', () => {
  const campo = (m: Partial<MetaDoDia>) => meta({ meta_mes: 18_000_000, realizado_ate_ontem: 55_300, realizado_hoje: 0, ...m });
  const domingo = campo({ situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null });

  it('dia não útil (domingo 08/11) com os números do Core: "R$ 553 de R$ 180.000", "0,3%" e "Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)"', () => {
    const d = desenhoMetaDoMes(domingo, { mes_pct: 31, faltam_mes: 17_944_700, por_dia_util: 944_458, dias_uteis_por_dia: 19 });
    expect(d).toMatchObject({ valor: 'R$ 553', de: 'de R$ 180.000', mes: '0,3%', corBarra: colors.ink3, apoio: 'Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)', verde: false });
    expect(d.pct).toBeCloseTo(0.31);
  });
  it('dia não útil sem o aditivo do Core: a linha fica oculta (o shell não faz a conta); só com o "faltam", só ele', () => {
    expect(desenhoMetaDoMes(domingo, { mes_pct: 31 }).apoio).toBeNull();
    expect(desenhoMetaDoMes(domingo, { mes_pct: 31, faltam_mes: 17_944_700 }).apoio).toBe('Faltam R$ 179.447');
    expect(desenhoMetaDoMes(domingo, { mes_pct: 31, faltam_mes: 100_000, por_dia_util: 100_000, dias_uteis_por_dia: 1 }).apoio).toBe('Faltam R$ 1.000 · R$ 1.000 por dia útil (1 dia)');
  });
  it('dia útil (terça 10/11): a mesma linha do mês e, no fim, "Meta de hoje R$ 9.969" (meta do dia da RN-CORE-26, vinda do Core)', () => {
    const d = desenhoMetaDoMes(campo({ meta_dia: 996_928, atingimento_hoje_pct: 0 }), { mes_pct: 31 });
    expect(d).toMatchObject({ valor: 'R$ 553', de: 'de R$ 180.000', mes: '0,3%', corBarra: colors.accent, apoio: 'Meta de hoje R$ 9.969', verde: false, apoioVerde: false });
    // o realizado de HOJE entra no mês e sai do Início (decisão do gerente): R$ 553 + R$ 1.240
    expect(desenhoMetaDoMes(campo({ realizado_hoje: 124_000, meta_dia: 996_928 }), { mes_pct: 100 }).valor).toBe('R$ 1.793');
  });
  it('dia batido: a linha do dia fica verde ("Meta de hoje R$ 1.000 · batida"); mês batido: cartão verde, barra cheia, "Meta batida"', () => {
    expect(desenhoMetaDoMes(meta({ situacao: 'dia_batido', realizado_hoje: 100_000 }), { mes_pct: 4333 })).toMatchObject({ apoio: 'Meta de hoje R$ 1.000 · batida', apoioVerde: true, verde: false, mes: '43%' });
    expect(desenhoMetaDoMes(meta({ situacao: 'mes_batido', realizado_ate_ontem: 3_100_000, realizado_hoje: 20_000, meta_dia: 0 }), { mes_pct: 10400 })).toMatchObject({ valor: 'R$ 31.200', de: 'de R$ 30.000', apoio: 'Meta batida', verde: true, pct: 100, corBarra: colors.success, trilho: colors.successTrack, mes: '104%' });
  });
  it('RD-0004: "mês" só no título — nem no %, nem na última linha', () => {
    for (const d of [desenhoMetaDoMes(domingo, { mes_pct: 31, faltam_mes: 17_944_700, por_dia_util: 944_458, dias_uteis_por_dia: 19 }), desenhoMetaDoMes(campo({ meta_dia: 996_928 }), { mes_pct: 31 })]) {
      expect(`${d.mes} ${d.apoio}`).not.toMatch(/mês/);
    }
    expect(rotuloDaMeta(false)).toBe('Meta do mês');
    expect(rotuloDaMeta(true)).toBe('Meta do mês da equipe');
    expect(rotuloDaMeta(false, 'visitas')).toBe('Meta do mês · Visitas');
  });
  it('% do mês pronto do Core: abaixo de 1% com 1 casa ("0,3%"), senão inteiro; sem o número do Core, sem % e barra vazia', () => {
    expect(percentualDoMes(0)).toBe('0%');
    expect(percentualDoMes(4)).toBe('0%');
    expect(percentualDoMes(31)).toBe('0,3%');
    expect(percentualDoMes(94)).toBe('0,9%');
    expect(percentualDoMes(96)).toBe('1%');
    expect(percentualDoMes(4000)).toBe('40%');
    expect(desenhoMetaDoMes(campo({}), null)).toMatchObject({ mes: null, pct: 0 });
  });
  it('cobertura principal (do_mes): "62% de 80%", sem última linha (o título já diz o período)', () => {
    expect(desenhoMetaDoMes(meta({ indicador: 'cobertura_pct', situacao: 'do_mes', meta_mes: 8000, realizado_ate_ontem: 6200, realizado_hoje: 0, meta_dia: null, atingimento_hoje_pct: null }), { mes_pct: 7750 })).toMatchObject({ valor: '62%', de: 'de 80%', apoio: null, mes: '78%' });
  });
  it('visitas como principal (promotor): "Meta de hoje 6 visitas" no dia útil', () => {
    expect(desenhoMetaDoMes(meta({ indicador: 'visitas', meta_mes: 120, realizado_ate_ontem: 40, realizado_hoje: 3, meta_dia: 6 }), { mes_pct: 3583 })).toMatchObject({ valor: '43', de: 'de 120', apoio: 'Meta de hoje 6 visitas' });
  });
  it('principal = o do Core; sem ele vendas; promotor sem meta de vendas usa o primeiro indicador com meta (RN-PRO-01)', () => {
    const vendas = meta({});
    const visitas = meta({ indicador: 'visitas' });
    const cobertura = meta({ indicador: 'cobertura_pct', situacao: 'do_mes' });
    expect(metaPrincipal([vendas, visitas], 'visitas').principal!.indicador).toBe('visitas');
    expect(metaPrincipal([visitas, vendas])).toEqual({ principal: vendas, outras: [visitas] });
    expect(metaPrincipal([visitas, cobertura])).toEqual({ principal: visitas, outras: [cobertura] });
    expect(metaPrincipal([])).toEqual({ principal: null, outras: [] });
  });
  it('equipe: "1 de 3 já bateu a meta"', () => {
    expect(notaDaEquipe(meta({ membros: 3, membros_mes_batido: 1 }))).toBe('1 de 3 já bateu a meta');
    expect(notaDaEquipe(meta({ membros: 3, membros_mes_batido: 3 }))).toBeNull();
  });
});

describe('linhas Positivação, Visitas e Cobertura (RD-0005, RD-0007, RD-0010)', () => {
  it('"x de y" com a unidade uma vez, no fim, só quando o rótulo não a diz', () => {
    expect(desenhoDaLinha(meta({ indicador: 'positivacao', meta_mes: 15, realizado_ate_ontem: 1, realizado_hoje: 0 }))).toEqual({ rotulo: 'Positivação', valor: '1 de 15 clientes', verde: false });
    expect(desenhoDaLinha(meta({ indicador: 'visitas', meta_mes: 90, realizado_ate_ontem: 0, realizado_hoje: 0 }))).toEqual({ rotulo: 'Visitas', valor: '0 de 90', verde: false });
    expect(desenhoDaLinha(meta({ indicador: 'cobertura_pct', situacao: 'do_mes', meta_mes: 9000, realizado_ate_ontem: 0, realizado_hoje: 0 }))).toEqual({ rotulo: 'Cobertura', valor: '0% de 90%', verde: false });
    expect(desenhoDaLinha(meta({ indicador: 'positivacao', meta_mes: 1, realizado_ate_ontem: 1, realizado_hoje: 0, situacao: 'mes_batido' }))).toEqual({ rotulo: 'Positivação', valor: '1 de 1 cliente', verde: true });
  });
  it('mesma gramática em todas: nenhuma "meta N%" nem unidade repetida', () => {
    const textos = [xDeY('venda_cents', 55_300, 18_000_000), xDeY('positivacao', 1, 15), xDeY('visitas', 0, 90), xDeY('cobertura_pct', 0, 9000)].map((x) => `${x.valor} ${x.de}`);
    expect(textos).toEqual(['R$ 553 de R$ 180.000', '1 de 15 clientes', '0 de 90', '0% de 90%']);
    for (const t of textos) expect(t).not.toMatch(/meta|(clientes?|visitas?).*\1/);
  });
});

describe('aviso de dado antigo (RD-0008, RD-0012)', () => {
  const base = (x: Partial<VisaoInicio['base']>): VisaoInicio['base'] => ({ dia: '2026-11-06', calculado_em: '2026-11-06T10:28:00.000Z', defasado: true, ...x });
  it('base defasada: "Dados de 06/11, 6h28" no fuso do tenant; base em dia: nada', () => {
    expect(avisoDosDados({ base: base({}), sem_realizado: [] }, TZ)).toBe('Dados de 06/11, 6h28');
    expect(avisoDosDados({ base: base({ defasado: false }), sem_realizado: [] }, TZ)).toBeNull();
  });
  it('sem cópia de vendas (`sem_realizado` do Core): "Sincronize para ver as vendas"; sem o campo, nenhuma regra local', () => {
    expect(avisoDosDados({ base: base({}), sem_realizado: ['venda_cents'] }, TZ)).toBe('Sincronize para ver as vendas');
    expect(avisoDosDados({ base: base({ dia: null, calculado_em: null, defasado: false }) }, TZ)).toBeNull();
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
