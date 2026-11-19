import { describe, expect, it } from 'vitest';

import { creditoDisponivel } from '../../../vendedor/contracts';

import {
  abasDoApp,
  agruparDocumentos,
  agruparNotasPorMes,
  pedidosQuePesamNoCredito,
  chipsDoFiltro,
  contarFiltros,
  dataDoDocumento,
  FILTRO_PADRAO,
  filtroPrecisaDoServidor,
  intervaloDoFiltro,
  linhasCartaoCredito,
  linhasDadosCadastrais,
  linhasDoDetalheDaNota,
  linhasPerformance,
  perfilDeGestao,
  removerChip,
  segundaLinhaDoDocumento,
  textoContagemNotas,
  valorSemMoeda,
  faixaDoMes,
  lerDataBr,
  mascararData,
  periodoEscolhido,
  tituloDaCarteira,
} from './ficha-v2';
import type { NotaDetalhe } from '../../contracts';
import type { PerformanceCalculada } from '../../domain';

const HOJE = '2026-11-19';

describe('T-0186 / P12: abas da ficha', () => {
  it('P12: vendedor vê Resumo, Histórico e Documentação, nessa ordem', () => {
    expect(abasDoApp('vendedor', true).map((a) => a.rotulo)).toEqual(['Resumo', 'Histórico', 'Documentação']);
  });
  it('P12: promotor sem promotor_ve_pedidos não vê o Histórico', () => {
    expect(abasDoApp('promotor', false).map((a) => a.id)).toEqual(['resumo', 'documentacao']);
    expect(abasDoApp('promotor', true).map((a) => a.id)).toContain('historico');
  });
  it('spec §6: só supervisor e gerente são o Gestão ("Visitada por")', () => {
    expect(perfilDeGestao('supervisor')).toBe(true);
    expect(perfilDeGestao('vendedor')).toBe(false);
  });
});

describe('T-0186 / spec §3: Resumo', () => {
  it('spec §3.1: dados cadastrais em rótulo-valor, sem a linha vazia', () => {
    const l = linhasDadosCadastrais({ razao_social: 'Bom Preço LTDA', documento: '12345678000190', segmento: null }, '0002 · Boa Vista/RR', '2019-03-11');
    expect(l.map((x) => x.rotulo)).toEqual(['Razão social', 'CNPJ', 'Filial', 'Cliente desde']);
    expect(l.find((x) => x.rotulo === 'CNPJ')?.valor).toBe('12.345.678/0001-90');
    expect(l.find((x) => x.rotulo === 'Cliente desde')?.valor).toBe('03/2019');
  });
  it('spec §3.2: o cartão tem só Limite, Saldo disponível e Prazo médio; o motivo só com cliente bloqueado', () => {
    const base = { limite_cents: 800000, saldo_disponivel_cents: 188000, prazo_medio_dias: 24, bloqueado: false, motivo_bloqueio: null };
    expect(linhasCartaoCredito(base)?.map((x) => x.rotulo)).toEqual(['Limite', 'Saldo disponível', 'Prazo médio']);
    expect(linhasCartaoCredito(base)?.[1]?.valor).toBe('R$ 1.880,00');
    expect(linhasCartaoCredito({ ...base, bloqueado: true, motivo_bloqueio: 'Limite excedido' })?.at(-1)).toMatchObject({ valor: 'Limite excedido', perigo: true });
    expect(linhasCartaoCredito(null)).toBeNull();
  });
  it('spec §3.2: sem prazo médio o cartão mostra "—"', () => {
    const c = { limite_cents: 100, saldo_disponivel_cents: -50, prazo_medio_dias: null, bloqueado: false, motivo_bloqueio: null };
    expect(linhasCartaoCredito(c)?.[2]?.valor).toBe('—');
  });
  it('RN-VEN-12: aprovados, enviados e integrados pesam no crédito; rascunho e apagado não; o integrado é marcado para o creditoDisponivel', () => {
    const ped = [
      { status: 'approved', total_cents: 1000 },
      { status: 'sent_to_erp', total_cents: 500 },
      { status: 'integrated', total_cents: 200 },
      { status: 'draft', total_cents: 9999 },
      { status: 'approved', total_cents: 70, deleted_at: '2026-11-01T00:00:00Z' },
    ];
    const r = pedidosQuePesamNoCredito(ped);
    expect(r).toEqual([{ total_cents: 1000, integrado: false }, { total_cents: 500, integrado: false }, { total_cents: 200, integrado: true }]);
    const fin = { limite_cents: 10_000, saldo_aberto_cents: 0, credito_disponivel_erp_cents: null };
    expect(creditoDisponivel({ financeiro: fin, pedidos_aprovados: r }).disponivel_cents).toBe(8300);
    expect(creditoDisponivel({ financeiro: { ...fin, credito_disponivel_erp_cents: 5000 }, pedidos_aprovados: r }).disponivel_cents).toBe(3500);
  });
  const perf: PerformanceCalculada = {
    curvas: [
      { dimensao: 'faturamento', curva: 'A', rotulo: 'Curva Faturamento' },
      { dimensao: 'frequencia', curva: 'A', rotulo: 'Curva Frequência' },
      { dimensao: 'volume', curva: 'B', rotulo: 'Curva Volume' },
    ],
    compras: { compra_media_mes_cents: 521000, ticket_medio_cents: 260500, frequencia_media_dias: 14, sem_compras: false },
    visitas_total: 46,
    ultima_visita_em: '2026-11-12',
    ultima_visita_por: 'Carla Lima',
  };
  it('R-20261119-0530: Performance com as três curvas, 3 indicadores e visitas; sem "Última compra"', () => {
    const r = linhasPerformance(perf, { gestao: false });
    expect(r.titulo).toBe('Performance');
    expect(r.linhas.map((x) => x.rotulo)).toEqual(['Curva Faturamento', 'Curva Frequência', 'Curva Volume', 'Compra média/mês', 'Ticket médio', 'Frequência', 'Visitas', 'Última visita']);
    expect(r.linhas.some((x) => /Última compra/.test(x.rotulo))).toBe(false);
  });
  it('spec §6: "Visitada por" só no Gestão, depois da última visita', () => {
    expect(linhasPerformance(perf, { gestao: true }).linhas.at(-1)).toMatchObject({ rotulo: 'Visitada por', valor: 'Carla Lima' });
    expect(linhasPerformance(perf, { gestao: false }).linhas.some((x) => x.rotulo === 'Visitada por')).toBe(false);
  });
  it('RN-CORE-40: sem compra em 12 meses, os indicadores saem e as visitas ficam', () => {
    const r = linhasPerformance({ ...perf, compras: { ...perf.compras!, sem_compras: true } }, { gestao: false });
    expect(r.semCompras).toBe(true);
    expect(r.linhas.map((x) => x.rotulo)).not.toContain('Ticket médio');
    expect(r.linhas.map((x) => x.rotulo)).toContain('Visitas');
  });
  it('P12 / RN-PRO-01: promotor sem acesso a pedidos fica só com "Visitas"', () => {
    const r = linhasPerformance({ ...perf, curvas: [], compras: null }, { gestao: false });
    expect(r.titulo).toBe('Visitas');
    expect(r.linhas.map((x) => x.rotulo)).toEqual(['Visitas', 'Última visita']);
  });
});

describe('T-0186 / P8, P14, P17: filtro do Histórico', () => {
  it('P8: o padrão é 90 dias, sem filtro e sem selo no botão', () => {
    expect(contarFiltros(FILTRO_PADRAO)).toBe(0);
    expect(intervaloDoFiltro(FILTRO_PADRAO, HOJE)).toEqual({ de: '2026-08-21', ate: HOJE });
    expect(filtroPrecisaDoServidor(FILTRO_PADRAO, HOJE)).toBe(false);
  });
  it('P17: 12 meses e datas além de 90 dias só online', () => {
    expect(filtroPrecisaDoServidor({ ...FILTRO_PADRAO, periodo: '12m' }, HOJE)).toBe(true);
    expect(filtroPrecisaDoServidor({ ...FILTRO_PADRAO, periodo: '30d' }, HOJE)).toBe(false);
    expect(filtroPrecisaDoServidor({ ...FILTRO_PADRAO, periodo: 'datas', de: '2026-01-01', ate: '2026-02-01' }, HOJE)).toBe(true);
  });
  it('P14: um chip por filtro fora do padrão ("Em atraso", "NF 004655"), e o × tira', () => {
    const f = { ...FILTRO_PADRAO, numero: '004655', status: ['em_atraso' as const], formas: ['Boleto 28 dias'] };
    expect(chipsDoFiltro(f).map((c) => c.texto)).toEqual(['NF 004655', 'Em atraso', 'Boleto 28 dias']);
    expect(contarFiltros(f)).toBe(3);
    expect(removerChip(f, 'numero').numero).toBe('');
    expect(removerChip(f, 'status:em_atraso').status).toEqual([]);
    expect(removerChip({ ...f, periodo: '12m' }, 'periodo').periodo).toBe('90d');
  });
  it('spec §4: contagem "8 notas · últimos 90 dias" e, com um status só, "1 nota em atraso · últimos 90 dias"', () => {
    expect(textoContagemNotas(8, FILTRO_PADRAO)).toBe('8 notas · últimos 90 dias');
    expect(textoContagemNotas(1, { ...FILTRO_PADRAO, status: ['em_atraso'] })).toBe('1 nota em atraso · últimos 90 dias');
    expect(textoContagemNotas(2, { ...FILTRO_PADRAO, periodo: '12m' })).toBe('2 notas · últimos 12 meses');
  });
  it('spec §4: uma faixa por mês, na ordem em que as notas chegam', () => {
    const g = agruparNotasPorMes([{ data: '2026-11-07' }, { data: '2026-11-02' }, { data: '2026-10-28' }]);
    expect(g.map((x) => [x.faixa, x.notas.length])).toEqual([['NOVEMBRO DE 2026', 2], ['OUTUBRO DE 2026', 1]]);
    expect(faixaDoMes('2026-03-05')).toBe('MARÇO DE 2026');
  });
  it('spec §4: valor da célula sem "R$"', () => {
    expect(valorSemMoeda(128000)).toBe('1.280,00');
  });
});

describe('T-0186 / P17: detalhe da NF', () => {
  const nota: NotaDetalhe = {
    id: '11111111-1111-4111-8111-111111111111',
    numero_nf: '004655',
    serie: '1',
    data: '2026-10-10',
    forma_pagamento: 'Boleto 14/21 dias',
    status: 'em_atraso',
    valor_cents: 128000,
    devolvido_cents: 33000,
    devolvido_em: '2026-10-29',
    valor_final_cents: 95000,
    em_atraso: true,
    parcelas: [
      { parcela: '1/2', vencimento: '2026-10-24', valor_cents: 64000, saldo_cents: 0, situacao: 'liquidado', liquidado_em: '2026-10-23', em_atraso: false },
      { parcela: '2/2', vencimento: '2026-10-31', valor_cents: 64000, saldo_cents: 64000, situacao: 'aberto', liquidado_em: null, em_atraso: true },
    ],
    itens: [],
    pdf_arquivo_id: null,
  };
  it('spec §4: "Valor da nota", "Em atraso" (vermelho), "Devolvido em 29/10" e "Valor final"', () => {
    const l = linhasDoDetalheDaNota(nota);
    expect(l.map((x) => x.rotulo)).toEqual(['Valor da nota', 'Em atraso', 'Devolvido em 29/10', 'Valor final']);
    expect(l[1]).toMatchObject({ valor: 'R$ 640,00', perigo: true });
    expect(l[2]?.valor).toBe('− R$ 330,00');
  });
  it('spec §4: sem atraso nem devolução só "Valor da nota"', () => {
    expect(linhasDoDetalheDaNota({ ...nota, em_atraso: false, devolvido_cents: 0, parcelas: [] }).map((x) => x.rotulo)).toEqual(['Valor da nota']);
  });
});

describe('T-0186 / P10, P15, P16: Documentação', () => {
  const base = { formato: 'pdf', validade: '2027-03-31', validade_situacao: 'valido' as const, acesso: 'abrir' as const, data: '2026-05-02' };
  it('spec §5: segunda linha "PDF · válido até 03/2027"', () => {
    expect(segundaLinhaDoDocumento(base)).toEqual({ texto: 'PDF · válido até 03/2027', perigo: false });
  });
  it('P16: vencido aparece só na linha, em vermelho, no lugar do "válido até"', () => {
    expect(segundaLinhaDoDocumento({ ...base, validade: '2026-10-31', validade_situacao: 'vencido' })).toEqual({ texto: 'PDF · Vencido em 10/2026', perigo: true });
  });
  it('P10: exceção por documento = "Sem permissão para abrir" e data "—"', () => {
    const d = { ...base, acesso: 'bloqueado' as const };
    expect(segundaLinhaDoDocumento(d).texto).toBe('Sem permissão para abrir');
    expect(dataDoDocumento(d)).toBe('—');
    expect(dataDoDocumento(base)).toBe('02/05/2026');
  });
  it('spec §5: uma faixa por grupo, na ordem em que a lista chega', () => {
    const g = agruparDocumentos([{ grupo: 'Cadastro' }, { grupo: 'Cadastro' }, { grupo: 'Contratos' }]);
    expect(g.map((x) => [x.grupo, x.documentos.length])).toEqual([['Cadastro', 2], ['Contratos', 1]]);
  });
});

describe('Cliente 360 v2: Escolher datas e Carteira (spec §3.5 e §4)', () => {
  it('spec §4: a data digitada ganha as barras e só aceita dígitos', () => {
    expect(mascararData('1910')).toBe('19/10');
    expect(mascararData('19102026x')).toBe('19/10/2026');
    expect(mascararData('')).toBe('');
  });
  it('spec §4: dd/mm/aaaa vira AAAA-MM-DD; dia que não existe dá nulo', () => {
    expect(lerDataBr('19/10/2026')).toBe('2026-10-19');
    expect(lerDataBr('31/02/2026')).toBeNull();
    expect(lerDataBr('19/10')).toBeNull();
  });
  it('spec §4: "Escolher datas" pede a data inicial, não aceita início depois do fim nem fim depois de hoje', () => {
    expect(periodoEscolhido('', '', HOJE)).toEqual({ ok: false, erro: 'Informe a data inicial.' });
    expect(periodoEscolhido('20/10/2026', '10/10/2026', HOJE)).toEqual({ ok: false, erro: 'A data inicial vem depois da final.' });
    expect(periodoEscolhido('10/10/2026', '20/11/2026', HOJE)).toEqual({ ok: false, erro: 'A data final não pode ser depois de hoje.' });
    expect(periodoEscolhido('10/10/2026', '', HOJE)).toEqual({ ok: true, de: '2026-10-10', ate: HOJE });
  });
  it('spec §4 (P17): datas além dos 90 dias consultam o servidor', () => {
    expect(filtroPrecisaDoServidor({ ...FILTRO_PADRAO, periodo: 'datas', de: '2026-01-10', ate: '2026-02-10' }, HOJE)).toBe(true);
    expect(filtroPrecisaDoServidor({ ...FILTRO_PADRAO, periodo: 'datas', de: '2026-10-10', ate: '2026-11-10' }, HOJE)).toBe(false);
  });
  it('spec §3.5: a tabela Carteira chama a coluna de "Pessoa" com mais de uma pessoa', () => {
    expect(tituloDaCarteira(1)).toBe('Vendedor');
    expect(tituloDaCarteira(2)).toBe('Pessoa');
  });
});
