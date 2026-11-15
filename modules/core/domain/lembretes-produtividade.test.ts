import { describe, expect, it } from 'vitest';
import { PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as PADRAO, type ParametrosAlertasProdutividade } from '../contracts';
import { agendaDeLembretes, duracaoCurta, somarSemAlmoco, type EntradaLembretes } from './lembretes-produtividade';

// segunda, 16/11/2026, fuso de Manaus (UTC-4): 00:00 local = 04:00Z
const DIA = '2026-11-16T04:00:00.000Z';
const em = (hhmm: string) => new Date(Date.parse(DIA) + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000).toISOString();
const hora = (iso: string) => {
  const m = (Date.parse(iso) - Date.parse(DIA)) / 60_000;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const ALMOCO = { inicio_min: 720, fim_min: 780 };
const paradas = [
  { cliente_id: 'c1', cliente_nome: 'Mercado Bom Preço', sequencia: 1 },
  { cliente_id: 'c2', cliente_nome: 'Padaria Sol', sequencia: 2 },
  { cliente_id: 'c3', cliente_nome: 'Loja Norte', sequencia: 3 },
];
const entrada = (o: Partial<EntradaLembretes> = {}, agoraHhmm = '07:00'): EntradaLembretes => ({
  agora: new Date(em(agoraHhmm)),
  inicio_do_dia_em: DIA,
  perfil: 'vendedor',
  dia_util: true,
  parametros: PADRAO,
  parado_min: 60,
  almoco: ALMOCO,
  paradas,
  visitas: [],
  fila: [],
  enviados: [],
  ...o,
});
const so = (p: Partial<{ [K in keyof ParametrosAlertasProdutividade]: unknown }>): ParametrosAlertasProdutividade => {
  const desligadas = Object.fromEntries(
    (['fim_almoco', 'parado_entre_visitas', 'sem_checkin_inicio', 'rota_incompleta', 'visita_aberta', 'envio_pendente'] as const).map((k) => [k, { ...PADRAO[k], ativa: false }]),
  );
  return { ...PADRAO, ...desligadas, ...p } as ParametrosAlertasProdutividade;
};
const v = (cliente: string, ci: string, co: string | null) => ({ cliente_id: cliente, checkin_em: em(ci), checkout_em: co ? em(co) : null });

describe('RN-CORE-26 (D4/D6): lembretes locais de produtividade no Campo', () => {
  it('RN-CORE-26: só vendedor e promotor, e só em dia útil', () => {
    const visitas = [v('c1', '08:00', '09:00')];
    expect(agendaDeLembretes(entrada({ perfil: 'supervisor', visitas }))).toEqual([]);
    expect(agendaDeLembretes(entrada({ perfil: 'gerente', visitas }))).toEqual([]);
    expect(agendaDeLembretes(entrada({ dia_util: false, visitas }))).toEqual([]);
    expect(agendaDeLembretes(entrada({ perfil: 'promotor', visitas })).length).toBeGreaterThan(0);
  });
  it('RN-CORE-44 (D5): fim do almoço sai 10 min antes do fim cadastrado, com título curto e corpo "Próxima visita: <cliente>."', () => {
    const r = agendaDeLembretes(entrada({ parametros: so({ fim_almoco: PADRAO.fim_almoco }), visitas: [v('c1', '08:00', '11:30')] }, '11:40'));
    expect(r).toEqual([{ id: `fim_almoco:${DIA}`, tipo: 'fim_almoco', em: em('12:50'), titulo: 'Seu almoço termina às 13:00', corpo: 'Próxima visita: Padaria Sol.' }]);
  });
  it('RN-CORE-44 (D5): o horário de almoço do usuário muda a hora do aviso (11:30 às 12:30 avisa às 12:20)', () => {
    const r = agendaDeLembretes(entrada({ almoco: { inicio_min: 690, fim_min: 750 }, parametros: so({ fim_almoco: PADRAO.fim_almoco }), visitas: [v('c1', '08:00', '11:00')] }, '11:10'));
    expect(hora(r[0]!.em)).toBe('12:20');
    expect(r[0]!.titulo).toBe('Seu almoço termina às 12:30');
  });
  it('RN-CORE-26: fim do almoço não sai sem check-in no dia, em visita aberta ou se voltou antes do fim do almoço', () => {
    const p = so({ fim_almoco: PADRAO.fim_almoco });
    expect(agendaDeLembretes(entrada({ parametros: p }, '11:00'))).toEqual([]);
    expect(agendaDeLembretes(entrada({ parametros: p, visitas: [v('c1', '11:00', null)] }, '11:30'))).toEqual([]);
    expect(agendaDeLembretes(entrada({ parametros: p, visitas: [v('c1', '08:00', '09:00'), v('c2', '12:20', '12:40')] }, '12:45'))).toEqual([]);
  });
  it('RN-CORE-26: sem rota no dia o lembrete vai sem corpo', () => {
    const r = agendaDeLembretes(entrada({ paradas: [], parametros: so({ fim_almoco: PADRAO.fim_almoco }), visitas: [v('c1', '08:00', '09:00')] }, '11:00'));
    expect(r[0]).toMatchObject({ tipo: 'fim_almoco' });
    expect(r[0]).not.toHaveProperty('corpo');
  });
  it('RN-CORE-26: parado entre visitas sai 60 min depois do último checkout, com paradas pendentes e sem visita aberta', () => {
    const p = so({ parado_entre_visitas: PADRAO.parado_entre_visitas });
    const base = { parametros: p, visitas: [v('c1', '08:00', '09:00')] };
    const r = agendaDeLembretes(entrada(base, '09:05'));
    expect(r).toEqual([{ id: `parado_entre_visitas:${em('09:00')}`, tipo: 'parado_entre_visitas', em: em('10:00'), titulo: 'Há 1 h sem visita', corpo: 'Próxima visita: Padaria Sol.' }]);
    expect(agendaDeLembretes(entrada({ ...base, visitas: [v('c1', '08:00', '09:00'), v('c2', '09:10', null)] }, '09:15'))).toEqual([]);
    expect(agendaDeLembretes(entrada({ ...base, paradas: [paradas[0]!] }, '09:05'))).toEqual([]);
    expect(agendaDeLembretes(entrada({ ...base, visitas: [] }, '09:05'))).toEqual([]);
  });
  it('RN-CORE-44: o tempo do almoço não conta no "parado" (checkout 11:30 + 60 min dentro do almoço vira 13:30)', () => {
    const r = agendaDeLembretes(entrada({ parametros: so({ parado_entre_visitas: PADRAO.parado_entre_visitas }), visitas: [v('c1', '08:00', '11:30')] }, '11:40'));
    expect(hora(r[0]!.em)).toBe('13:30');
    expect(duracaoCurta(90)).toBe('1 h 30 min');
    expect(duracaoCurta(45)).toBe('45 min');
    const a = { inicio: 10, fim: 20 };
    expect(somarSemAlmoco(25, 1, a)).toBe(25 + 60_000); // depois do almoço
    expect(somarSemAlmoco(0, 0.0001, a)).toBeLessThan(10); // antes e sem tocar
    expect(somarSemAlmoco(12, 1, a)).toBe(20 + 60_000); // começou dentro: conta do fim do almoço
  });
  it('RN-CORE-26: rota incompleta às 16:00 com os clientes que faltam; não sai se o "parado" disparou na última hora', () => {
    const p = so({ rota_incompleta: PADRAO.rota_incompleta, parado_entre_visitas: PADRAO.parado_entre_visitas });
    const visitas = [v('c1', '08:00', '09:00')];
    const r = agendaDeLembretes(entrada({ parametros: so({ rota_incompleta: PADRAO.rota_incompleta }), visitas }, '09:05'));
    expect(r).toEqual([{ id: `rota_incompleta:${DIA}`, tipo: 'rota_incompleta', em: em('16:00'), titulo: 'Faltam 2 clientes da rota', corpo: 'Próxima visita: Padaria Sol.' }]);
    // parado agendado para 15:30 (checkout 14:30): 30 min antes das 16:00 → a rota fica de fora
    const tarde = agendaDeLembretes(entrada({ parametros: p, visitas: [v('c1', '08:00', '14:30')] }, '14:40'));
    expect(tarde.map((x) => x.tipo)).toEqual(['parado_entre_visitas']);
    // o parado já saiu às 15:20 (dentro da última hora antes das 16:00)
    const saiu = agendaDeLembretes(entrada({ parametros: so({ rota_incompleta: PADRAO.rota_incompleta }), visitas, enviados: [{ id: 'parado_entre_visitas:x', em: em('15:20') }] }, '15:30'));
    expect(saiu).toEqual([]);
    // parado de manhã (mais de 1 h antes): a rota sai
    const manha = agendaDeLembretes(entrada({ parametros: so({ rota_incompleta: PADRAO.rota_incompleta }), visitas, enviados: [{ id: 'parado_entre_visitas:x', em: em('10:00') }] }, '15:00'));
    expect(manha.map((x) => x.tipo)).toEqual(['rota_incompleta']);
    expect(agendaDeLembretes(entrada({ parametros: so({ rota_incompleta: PADRAO.rota_incompleta }), paradas: [paradas[0]!], visitas }, '09:05'))).toEqual([]);
  });
  it('RN-CORE-26: visita aberta há 120 min avisa uma vez por visita, com a próxima fora o cliente aberto', () => {
    const r = agendaDeLembretes(entrada({ parametros: so({ visita_aberta: PADRAO.visita_aberta }), visitas: [v('c1', '09:00', null)] }, '09:30'));
    expect(r).toEqual([{ id: `visita_aberta:c1:${em('09:00')}`, tipo: 'visita_aberta', em: em('11:00'), titulo: 'Visita aberta há 2 h', corpo: 'Próxima visita: Padaria Sol.' }]);
  });
  it('RN-CORE-26: envio pendente passa de 4 h do item mais antigo e conta os registros', () => {
    const r = agendaDeLembretes(entrada({ parametros: so({ envio_pendente: PADRAO.envio_pendente }), fila: [{ criado_em: em('09:00') }, { criado_em: em('09:30') }, { criado_em: em('10:00') }] }, '09:40'));
    expect(r).toMatchObject([{ tipo: 'envio_pendente', em: em('13:00'), titulo: '3 registros sem enviar', corpo: 'Próxima visita: Mercado Bom Preço.' }]);
    expect(agendaDeLembretes(entrada({ parametros: so({ envio_pendente: PADRAO.envio_pendente }), fila: [{ criado_em: em('09:00') }] }, '09:40'))[0]!.titulo).toBe('1 registro sem enviar');
    expect(agendaDeLembretes(entrada({ parametros: so({ envio_pendente: PADRAO.envio_pendente }) }, '09:40'))).toEqual([]);
  });
  it('RN-CORE-26: sem check-in até 10:00 avisa só quando ainda não houve nenhuma visita', () => {
    const p = so({ sem_checkin_inicio: PADRAO.sem_checkin_inicio });
    expect(agendaDeLembretes(entrada({ parametros: p }, '08:30'))).toEqual([expect.objectContaining({ tipo: 'sem_checkin_inicio', em: em('10:00'), titulo: 'Nenhuma visita hoje', corpo: 'Próxima visita: Mercado Bom Preço.' })]);
    expect(agendaDeLembretes(entrada({ parametros: p, visitas: [v('c1', '09:00', '09:30')] }, '09:40'))).toEqual([]);
  });
  it('RN-CORE-26: regra desligada ou sem o destino vendedor não gera lembrete', () => {
    const visitas = [v('c1', '08:00', '09:00')];
    expect(agendaDeLembretes(entrada({ parametros: so({}), visitas }))).toEqual([]);
    expect(agendaDeLembretes(entrada({ parametros: so({ fim_almoco: { ...PADRAO.fim_almoco, vendedor: false } }), visitas }))).toEqual([]);
  });
  it('RN-CORE-26: teto de 4 por dia: o que já saiu conta e a prioridade corta (fim do almoço, parado, rota, visita aberta, envio)', () => {
    const todas = { ...PADRAO, sem_checkin_inicio: { ...PADRAO.sem_checkin_inicio, ativa: false } };
    const base = { visitas: [v('c1', '08:00', '09:00')], fila: [{ criado_em: em('06:00') }] };
    const quatro = agendaDeLembretes(entrada({ parametros: todas, ...base }, '09:20'));
    expect(quatro.map((x) => x.tipo)).toEqual(['parado_entre_visitas', 'envio_pendente', 'fim_almoco', 'rota_incompleta']);
    const dois = agendaDeLembretes(entrada({ parametros: { ...todas, teto_lembretes_dia: 2 }, ...base }, '09:20'));
    expect(dois.map((x) => x.tipo)).toEqual(['parado_entre_visitas', 'fim_almoco']); // fim do almoço e parado têm prioridade sobre rota e envio
    const jaSairam = agendaDeLembretes(entrada({ parametros: todas, visitas: [v('c1', '08:00', '09:00')], enviados: [1, 2, 3, 4].map((n) => ({ id: `x${n}`, em: em('08:30') })) }, '09:20'));
    expect(jaSairam).toEqual([]);
  });
  it('RN-CORE-26: nada de lembrete atrasado, fora do horário comercial ou repetido', () => {
    const p = so({ parado_entre_visitas: PADRAO.parado_entre_visitas });
    const visitas = [v('c1', '08:00', '09:00')];
    expect(agendaDeLembretes(entrada({ parametros: p, visitas }, '10:30'))).toEqual([]); // 10:00 já passou
    expect(agendaDeLembretes(entrada({ parametros: p, visitas: [v('c1', '16:30', '17:30')] }, '17:35'))).toEqual([]); // 18:30 depois do fechamento
    const antes = agendaDeLembretes(entrada({ parametros: so({ sem_checkin_inicio: { ...PADRAO.sem_checkin_inicio, ate_min: 7 * 60 } }) }, '05:00'));
    expect(hora(antes[0]!.em)).toBe('08:00'); // sobe para a abertura do expediente
    const id = `parado_entre_visitas:${em('09:00')}`;
    expect(agendaDeLembretes(entrada({ parametros: p, visitas, enviados: [{ id, em: em('10:00') }] }, '09:30'))).toEqual([]);
  });
});
