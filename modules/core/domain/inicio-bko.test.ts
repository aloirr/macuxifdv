import { describe, expect, it } from 'vitest';
import {
  cadastroIncompletoDoEscopo,
  aprovacaoMaisAntiga,
  aprovacoesSolicitadasHoje,
  cargasAtrasadas,
  horarioCargaDasLinhas,
  lotesFalhosParaOInicio,
  montarAlertasInicio,
  pedidosDeHoje,
  rotuloDaEntidade,
  saudacaoDoBko,
  validarHorarioCarga,
  type EntradaAlertasInicio,
} from './inicio-bko';

const MANAUS = 'America/Manaus';
const CFG = { padrao: '06:00', entidades: {} };
const base: EntradaAlertasInicio = { agora: new Date('2026-11-20T15:00:00Z'), fuso: MANAUS, licencas: { integracao: true, gestor: true, vendedor: true } };

describe('RN-CORE-64: saudação e data do Início do BKO', () => {
  it('RN-CORE-64: bom dia, boa tarde e boa noite pela hora no fuso do tenant', () => {
    expect(saudacaoDoBko(new Date('2026-11-20T12:00:00Z'), MANAUS, 'Ana Souza')).toBe('Bom dia, Ana.');
    expect(saudacaoDoBko(new Date('2026-11-20T16:00:00Z'), MANAUS, 'Ana Souza')).toBe('Boa tarde, Ana.');
    expect(saudacaoDoBko(new Date('2026-11-21T02:00:00Z'), MANAUS, 'Ana Souza')).toBe('Boa noite, Ana.');
  });
  it('RN-CORE-64: sem nome, cai na saudação sem o nome', () => {
    expect(saudacaoDoBko(new Date('2026-11-20T16:00:00Z'), MANAUS, null)).toBe('Boa tarde.');
  });
});

describe('RN-CORE-64: pedidos de hoje e em aprovação', () => {
  it('RN-CORE-64: Pedidos de hoje inclui os em aprovação, e "N em aprovação" é um subconjunto dele', () => {
    expect(pedidosDeHoje(8, 3)).toEqual({ total: 11, em_aprovacao: 3 });
    expect(pedidosDeHoje(0, 0)).toEqual({ total: 0, em_aprovacao: 0 });
  });
});

describe('RN-CORE-65: horário esperado da carga', () => {
  it('RN-CORE-65: sem parâmetro vale 06:00 para todas as entidades', () => {
    expect(horarioCargaDasLinhas([])).toEqual({ padrao: '06:00', entidades: {} });
  });
  it('RN-CORE-65: lê o padrão, o override por entidade e o "sem horário" (null); lixo cai no padrão', () => {
    const linhas = [{ modulo: 'core', chave: 'integracao.horario_carga', valor: { padrao: '07:30', entidades: { cliente: '05:00', preco: null, nota: '25:99' } } }];
    expect(horarioCargaDasLinhas(linhas)).toEqual({ padrao: '07:30', entidades: { cliente: '05:00', preco: null } });
    expect(horarioCargaDasLinhas([{ modulo: 'core', chave: 'integracao.horario_carga', valor: 'x' }])).toEqual({ padrao: '06:00', entidades: {} });
  });
  it('RN-CORE-65: valida HH:MM do padrão e dos overrides, com mensagem e campo', () => {
    expect(validarHorarioCarga({ padrao: '06:00', entidades: { cliente: null, preco: '07:00' } })).toEqual({ ok: true, valores: { padrao: '06:00', entidades: { cliente: null, preco: '07:00' } } });
    const r1 = validarHorarioCarga({ padrao: '6h', entidades: {} });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erros[0]?.campo).toBe('padrao');
    const r2 = validarHorarioCarga({ padrao: '06:00', entidades: { cliente: '24:00' } });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.erros[0]?.campo).toBe('entidades');
  });
  it('RN-CORE-65: entidade desconhecida é rejeitada na validação e descartada na leitura', () => {
    const r = validarHorarioCarga({ padrao: '06:00', entidades: { inexistente: '07:30' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toMatchObject({ campo: 'entidades', mensagem: expect.stringContaining('desconhecida') });
    expect(horarioCargaDasLinhas([{ modulo: 'core', chave: 'integracao.horario_carga', valor: { padrao: '06:00', entidades: { inexistente: '07:30' } } }])).toEqual({ padrao: '06:00', entidades: {} });
  });
  it('RN-CORE-65: alerta quando agora passou do horário de hoje e a última carga é anterior a ele', () => {
    const r = cargasAtrasadas({ agora: new Date('2026-11-20T11:00:00Z'), fuso: MANAUS, dia_util: true, horario: CFG, ultimas: [{ entidade: 'cliente', recebido_em: '2026-11-19T10:05:00Z' }] });
    expect(r).toEqual([{ entidade: 'cliente', ultima_em: '2026-11-19T10:05:00Z' }]);
  });
  it('RN-CORE-65: sem alerta antes do horário, com a carga de hoje já recebida, fora de dia útil ou com "sem horário"', () => {
    const u = [{ entidade: 'cliente', recebido_em: '2026-11-19T10:05:00Z' }];
    expect(cargasAtrasadas({ agora: new Date('2026-11-20T09:59:00Z'), fuso: MANAUS, dia_util: true, horario: CFG, ultimas: u })).toEqual([]);
    expect(cargasAtrasadas({ agora: new Date('2026-11-20T11:00:00Z'), fuso: MANAUS, dia_util: true, horario: CFG, ultimas: [{ entidade: 'cliente', recebido_em: '2026-11-20T10:00:00Z' }] })).toEqual([]);
    expect(cargasAtrasadas({ agora: new Date('2026-11-20T11:00:00Z'), fuso: MANAUS, dia_util: false, horario: CFG, ultimas: u })).toEqual([]);
    expect(cargasAtrasadas({ agora: new Date('2026-11-20T11:00:00Z'), fuso: MANAUS, dia_util: true, horario: { padrao: '06:00', entidades: { cliente: null } }, ultimas: u })).toEqual([]);
  });
  it('RN-CORE-65: o override por entidade vale no lugar do padrão', () => {
    const u = [{ entidade: 'cliente', recebido_em: '2026-11-20T10:30:00Z' }];
    const cfg = { padrao: '06:00', entidades: { cliente: '08:00' } };
    expect(cargasAtrasadas({ agora: new Date('2026-11-20T13:00:00Z'), fuso: MANAUS, dia_util: true, horario: cfg, ultimas: u })).toEqual([{ entidade: 'cliente', ultima_em: '2026-11-20T10:30:00Z' }]);
  });
});

describe('RN-CORE-66: cadastro incompleto no Início', () => {
  const completo = { razao_social: 'A', documento: '11222333000181', logradouro: 'R', numero: '1', bairro: 'B', cidade: 'C', uf: 'AM', cep: '69000000', inscricao_estadual: 'isento', latitude: 1, longitude: 2 };
  it('RN-CORE-66: conta só os incompletos pela lista da RN-CORE-16 e indica o campo que mais falta', () => {
    const r = cadastroIncompletoDoEscopo([completo, { ...completo, cep: null }, { ...completo, cep: '', numero: null }, { ...completo, cep: null }], ['razao_social', 'documento', 'cep', 'numero']);
    expect(r.quantidade).toBe(3);
    expect(r.campo).toBe('CEP');
  });
  it('RN-CORE-66: nada incompleto = zero e sem campo', () => {
    expect(cadastroIncompletoDoEscopo([completo], ['razao_social', 'documento'])).toEqual({ quantidade: 0, campo: null });
  });
});

describe('RN-CORE-64: alertas do Início ("Precisa de você")', () => {
  const texto = (a: { partes: { texto: string }[] }) => a.partes.map((p) => p.texto).join('');
  it('RN-CORE-64: falhas antes de atenção, na ordem fixa, um alerta por fato', () => {
    const r = montarAlertasInicio({
      ...base,
      aprovacoes: { quantidade: 3, mais_antigo_em: '2026-11-20T13:00:00Z' },
      alertas_abertos: 2,
      usuarios_senha_vencida: 1,
      mensagens_paradas: { quantidade: 36, desde: '2026-11-15T04:47:00Z' },
      lotes_falhos: [{ lote_id: 'L1', entidade: 'cliente', quando: '2026-11-15T05:03:00Z', linhas: 3695 }],
      cargas_atrasadas: [{ entidade: 'preco', ultima_em: '2026-11-19T10:00:00Z' }],
      cadastro_incompleto: { quantidade: 12, campo: 'CEP' },
    });
    expect(r.map((a) => a.gravidade)).toEqual(['falha', 'falha', 'atencao', 'atencao', 'atencao', 'atencao', 'atencao']);
    expect(r.map((a) => a.id)).toEqual(['mensagens_paradas', 'lote_falhou:L1', 'carga_atrasada:preco', 'aprovacoes', 'alertas', 'usuarios_senha', 'cadastro_incompleto']);
  });
  it('RN-CORE-64: textos com o número em negrito, data no fuso e ação à direita', () => {
    const r = montarAlertasInicio({
      ...base,
      mensagens_paradas: { quantidade: 36, desde: '2026-11-15T04:47:00Z' },
      lotes_falhos: [{ lote_id: 'L1', entidade: 'cliente', quando: '2026-11-15T05:03:00Z', linhas: 3695 }],
      aprovacoes: { quantidade: 3, mais_antigo_em: '2026-11-20T13:00:00Z' },
      alertas_abertos: 1,
      usuarios_senha_vencida: 1,
    });
    expect(texto(r[0]!)).toBe('Integração com o ERP: 36 mensagens paradas desde 15/11 às 00:47');
    expect(r[0]!.partes.find((p) => p.negrito)?.texto).toBe('36 mensagens paradas');
    expect(r[0]!.acao).toEqual({ rotulo: 'Integração ERP', caminho: '/integracao' });
    expect(texto(r[1]!)).toBe('Lote de Clientes falhou em 15/11 às 01:03 — 3.695 linhas com erro');
    expect(r[1]!.acao.rotulo).toBe('Ver lote');
    expect(texto(r[2]!)).toBe('3 pedidos esperando aprovação — o mais antigo há 2 h');
    expect(r[2]!.acao).toEqual({ rotulo: 'Aprovações', caminho: '/aprovacoes' });
    expect(texto(r[3]!)).toBe('1 alerta aberto');
    expect(texto(r[4]!)).toBe('1 usuário com senha temporária vencida');
    expect(r[4]!.acao.caminho).toBe('/usuarios');
  });
  it('RN-CORE-64: carga que não ocorreu cita a última carga com data e hora; cadastro incompleto cita o campo', () => {
    const r = montarAlertasInicio({ ...base, cargas_atrasadas: [{ entidade: 'cliente', ultima_em: '2026-11-19T10:05:00Z' }, { entidade: 'preco', ultima_em: null }], cadastro_incompleto: { quantidade: 12, campo: 'CEP' } });
    expect(texto(r[0]!)).toBe('Carga de Clientes não chegou hoje — a última foi em 19/11 às 06:05');
    expect(texto(r[1]!)).toBe('Carga de Preços não chegou hoje — ainda não houve carga');
    expect(texto(r[2]!)).toBe('12 clientes com cadastro incompleto — o que mais falta: CEP');
    expect(r[2]!.acao.caminho).toBe('/clientes');
  });
  it('RN-CORE-65: carga que não ocorreu é atenção (amarelo), não falha', () => {
    const r = montarAlertasInicio({ ...base, cargas_atrasadas: [{ entidade: 'preco', ultima_em: null }] });
    expect(r.map((a) => a.gravidade)).toEqual(['atencao']);
  });
  it('RN-CORE-64: alerta de módulo sem licença não aparece', () => {
    const r = montarAlertasInicio({
      ...base,
      licencas: { integracao: false, gestor: false, vendedor: false },
      mensagens_paradas: { quantidade: 5, desde: null },
      lotes_falhos: [{ lote_id: 'L1', entidade: 'cliente', quando: '2026-11-15T05:03:00Z', linhas: 1 }],
      cargas_atrasadas: [{ entidade: 'preco', ultima_em: null }],
      aprovacoes: { quantidade: 3, mais_antigo_em: null },
      alertas_abertos: 2,
      usuarios_senha_vencida: 1,
    });
    expect(r.map((a) => a.id)).toEqual(['usuarios_senha']);
  });
  it('RN-CORE-64: sem pendências a lista vem vazia (a tela mostra só "Nada pendente.")', () => {
    expect(montarAlertasInicio({ ...base, aprovacoes: { quantidade: 0, mais_antigo_em: null }, alertas_abertos: 0, usuarios_senha_vencida: 0, cadastro_incompleto: { quantidade: 0, campo: null } })).toEqual([]);
  });
  it('RN-CORE-64: lote falho só conta se o último da entidade falhou (já recuperado não alerta)', () => {
    const lotes = [
      { lote_id: 'a', entidade: 'cliente', status: 'falhou', recebido_em: '2026-11-15T05:03:00Z', com_erro: 10, recebidas: 10 },
      { lote_id: 'b', entidade: 'cliente', status: 'concluido', recebido_em: '2026-11-16T05:03:00Z', com_erro: 0, recebidas: 10 },
      { lote_id: 'c', entidade: 'preco', status: 'falhou', recebido_em: '2026-11-15T05:03:00Z', com_erro: 0, recebidas: 80 },
    ];
    expect(lotesFalhosParaOInicio(lotes)).toEqual([{ lote_id: 'c', entidade: 'preco', quando: '2026-11-15T05:03:00Z', linhas: 80 }]);
  });
});

describe('RN-CORE-65: erro do horário e rótulo da entidade', () => {
  it('RN-CORE-65: o rótulo da entidade é o do Monitor da Integração (Notas fiscais, Tabela escalonada)', () => {
    expect(rotuloDaEntidade('nota')).toBe('Notas fiscais');
    expect(rotuloDaEntidade('tabela_escalonada')).toBe('Tabela escalonada');
  });
  it('RN-CORE-65: o erro do horário usa o rótulo humano da entidade', () => {
    const r = validarHorarioCarga({ padrao: '06:00', entidades: { forma_pagamento: '25:00' } });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'entidades', mensagem: 'Horário de Formas de pagamento inválido. Use HH:MM, de 00:00 a 23:59, ou deixe sem horário.' }] });
  });
});

describe('RN-CORE-64: aprovação mais antiga e pedidos de hoje em aprovação', () => {
  it('RN-CORE-64: a aprovação mais antiga é a menor data; fila vazia = null', () => {
    expect(aprovacaoMaisAntiga(['2026-11-20T13:00:00Z', '2026-11-18T09:00:00Z', '2026-11-19T01:00:00Z'])).toBe('2026-11-18T09:00:00Z');
    expect(aprovacaoMaisAntiga([])).toBeNull();
  });
  it('RN-CORE-64: "N em aprovação" conta só os pedidos solicitados no dia do fuso do tenant', () => {
    const agora = new Date('2026-11-20T15:00:00Z'); // 11h em Manaus
    const itens = [
      { pedido_id: 'a', solicitada_em: '2026-11-20T04:30:00Z' }, // 00:30 de 20/11 em Manaus: hoje
      { pedido_id: 'b', solicitada_em: '2026-11-20T03:30:00Z' }, // 23:30 de 19/11 em Manaus: ontem
      { pedido_id: 'c', solicitada_em: '2026-11-20T14:00:00Z' },
      { pedido_id: 'c', solicitada_em: '2026-11-20T14:01:00Z' },
    ];
    expect(aprovacoesSolicitadasHoje(itens, agora, 'America/Manaus')).toBe(2);
    expect(aprovacoesSolicitadasHoje([], agora, 'America/Manaus')).toBe(0);
  });
});
