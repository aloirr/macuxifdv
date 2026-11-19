import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO, type AceiteTermoRastreamentoSync, type AusenciaUsuario, type TermoRastreamento } from '../../contracts';
import {
  diaAnteriorPermitido,
  deslocarDia,
  estadoDaLocalizacao,
  leituraDaLocalizacao,
  pausaVencida,
  resumoDoDia,
  rotuloDoDia,
  situacaoDoTermo,
  termoVigenteDe,
  type EntradaLocalizacao,
} from './rastreamento-local';

const T = '2026-11-01T12:00:00.000Z';
const termo = (versao: number): TermoRastreamento => ({ id: `0e400000-0000-4000-8000-00000000000${versao}`, versao, texto: `Termo ${versao}`, publicado_em: T, updated_at: T, deleted_at: null });
const aceiteSrv = (versao: number): AceiteTermoRastreamentoSync => ({ id: `0e400000-0000-4000-8000-0000000000a${versao}`, usuario_id: EU, termo_versao: versao, aceito_em: '2026-11-19T11:00:00.000Z', updated_at: T, deleted_at: null });
const EU = '0e400000-0000-4000-8000-0000000000f1';
// quinta-feira 19/11/2026, 10h de Manaus
const AGORA = '2026-11-19T14:00:00.000Z';
const base: EntradaLocalizacao = {
  parametros: { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true },
  termos: [termo(1), termo(2)],
  aceiteLocal: { id: 'a', versao: 2, aceito_em: '2026-11-19T11:00:00.000Z' },
  aceitesServidor: [],
  usuarioId: EU,
  cargo: 'vendedor',
  ausencias: [],
  feriados: [],
  pausa: null,
  agora: AGORA,
  fuso: 'America/Manaus',
};
const com = (o: Partial<EntradaLocalizacao>): EntradaLocalizacao => ({ ...base, ...o });

describe('RN-CORE-13: termo de ciência no Campo', () => {
  it('RN-CORE-13: vigente = a maior versão que não foi removida', () => {
    expect(termoVigenteDe([termo(1), termo(3), { ...termo(5), deleted_at: T }, termo(2)])?.versao).toBe(3);
    expect(termoVigenteDe([])).toBeNull();
  });
  it('RN-CORE-13: desligado, sem termo, pendente (volta a cada abertura) e aceito', () => {
    expect(situacaoDoTermo(com({ parametros: PARAMETROS_RASTREAMENTO_PADRAO }))).toBe('desligado');
    expect(situacaoDoTermo(com({ termos: [] }))).toBe('sem_termo');
    expect(situacaoDoTermo(com({ aceiteLocal: null }))).toBe('pendente');
    expect(situacaoDoTermo(com({ aceiteLocal: { id: 'a', versao: 1, aceito_em: AGORA } }))).toBe('pendente'); // versão nova publicada
    expect(situacaoDoTermo(base)).toBe('aceito');
  });
  it('RN-CORE-13: o aceite que veio do servidor vale (bancos do aparelho apagados) e só o do próprio usuário', () => {
    expect(situacaoDoTermo(com({ aceiteLocal: null, aceitesServidor: [aceiteSrv(2)] }))).toBe('aceito');
    expect(situacaoDoTermo(com({ aceiteLocal: null, aceitesServidor: [{ ...aceiteSrv(2), usuario_id: 'outro' }] }))).toBe('pendente');
    expect(situacaoDoTermo(com({ aceiteLocal: null, aceitesServidor: [{ ...aceiteSrv(2), deleted_at: T }] }))).toBe('pendente');
  });
  it('RN-CORE-13: gerente e quem não é de campo não vê o termo', () => {
    expect(situacaoDoTermo(com({ cargo: 'gerente', aceiteLocal: null }))).toBe('desligado');
  });
});

describe('RN-CORE-13: estado da seção Localização do Perfil', () => {
  it('RN-CORE-13: ativa no expediente, com as faixas do dia e a ação Pausar', () => {
    expect(estadoDaLocalizacao(base)).toEqual({ estado: 'ativa', apoio: 'Hoje 08:00–18:00', acao: 'pausar' });
  });
  it('RN-CORE-13: duas faixas no dia aparecem juntas', () => {
    const exp = { ...PARAMETROS_RASTREAMENTO_PADRAO.expediente, '4': [{ inicio_min: 480, fim_min: 720 }, { inicio_min: 840, fim_min: 1080 }] };
    expect(estadoDaLocalizacao(com({ parametros: { ...base.parametros, expediente: exp } }))).toMatchObject({ apoio: 'Hoje 08:00–12:00 e 14:00–18:00' });
  });
  it('RN-CORE-13: pausada mostra quanto falta e a ação Retomar; abaixo de 1 min, "menos de 1 min"', () => {
    expect(estadoDaLocalizacao(com({ pausa: { id: 'p', inicio: '2026-11-19T13:42:00.000Z' } }))).toEqual({ estado: 'pausada', apoio: 'Volta em 42 min', acao: 'retomar' });
    expect(estadoDaLocalizacao(com({ pausa: { id: 'p', inicio: '2026-11-19T13:00:30.000Z' } }))).toMatchObject({ apoio: 'Volta em menos de 1 min' });
  });
  it('RN-CORE-13: a pausa termina no fim do expediente se ele chega antes', () => {
    const e = estadoDaLocalizacao(com({ agora: '2026-11-19T21:40:00.000Z', pausa: { id: 'p', inicio: '2026-11-19T21:30:00.000Z' } })); // 17h40 em Manaus; fim 18h
    expect(e).toEqual({ estado: 'pausada', apoio: 'Volta em 20 min', acao: 'retomar' });
  });
  it('RN-CORE-13: fora do expediente mantém as faixas e não tem ação; sem expediente hoje (domingo, feriado, ausência) some a linha de apoio', () => {
    expect(estadoDaLocalizacao(com({ agora: '2026-11-19T23:00:00.000Z' }))).toEqual({ estado: 'fora', apoio: 'Hoje 08:00–18:00', acao: null });
    expect(estadoDaLocalizacao(com({ agora: '2026-11-22T14:00:00.000Z' }))).toEqual({ estado: 'sem_expediente', apoio: null, acao: null });
    expect(estadoDaLocalizacao(com({ feriados: ['2026-11-19'] }))).toEqual({ estado: 'sem_expediente', apoio: null, acao: null });
    const ausencia: AusenciaUsuario = { id: 'x', usuario_id: EU, de: '2026-11-18', ate: '2026-11-20', updated_at: T, deleted_at: null };
    expect(estadoDaLocalizacao(com({ ausencias: [ausencia] }))).toEqual({ estado: 'sem_expediente', apoio: null, acao: null });
  });
  it('RN-CORE-13: sem aceite, desligado ou sem termo a seção não aparece', () => {
    expect(estadoDaLocalizacao(com({ aceiteLocal: null })).estado).toBe('oculta');
    expect(estadoDaLocalizacao(com({ parametros: PARAMETROS_RASTREAMENTO_PADRAO })).estado).toBe('oculta');
    expect(estadoDaLocalizacao(com({ termos: [] })).estado).toBe('oculta');
  });
  it('RN-CORE-13: pausa de mais de 60 min está vencida e vira registro com fim no prazo', () => {
    expect(pausaVencida({ id: 'p', inicio: '2026-11-19T12:00:00.000Z' }, AGORA)).toEqual({ id: 'p', inicio: '2026-11-19T12:00:00.000Z', fim: '2026-11-19T13:00:00.000Z' });
    expect(pausaVencida({ id: 'p', inicio: '2026-11-19T13:30:00.000Z' }, AGORA)).toBeNull();
  });
});

describe('RN-CORE-46: "Meu trajeto"', () => {
  it('rótulo do dia: Hoje, Ontem e os demais com dia da semana', () => {
    expect(rotuloDoDia('2026-11-19', '2026-11-19')).toBe('Hoje · qui 19/11');
    expect(rotuloDoDia('2026-11-18', '2026-11-19')).toBe('Ontem · qua 18/11');
    expect(rotuloDoDia('2026-11-16', '2026-11-19')).toBe('seg 16/11');
  });
  it('RN-CORE-13: o dia anterior vai até 90 dias atrás; o próximo, até hoje', () => {
    expect(deslocarDia('2026-11-19', -1)).toBe('2026-11-18');
    expect(deslocarDia('2026-03-01', -1)).toBe('2026-02-28');
    expect(diaAnteriorPermitido('2026-08-21', '2026-11-19')).toBe(false);
    expect(diaAnteriorPermitido('2026-08-22', '2026-11-19')).toBe(true);
  });
  const pontos = [
    { capturado_em: '2026-11-19T12:04:00.000Z', latitude: -3.1, longitude: -60.0, precisao_m: 10 },
    { capturado_em: '2026-11-19T13:12:00.000Z', latitude: -3.11, longitude: -60.01, precisao_m: 10 },
    { capturado_em: '2026-11-19T13:41:00.000Z', latitude: -3.12, longitude: -60.02, precisao_m: 10 },
    { capturado_em: '2026-11-19T14:12:00.000Z', latitude: -3.13, longitude: -60.03, precisao_m: 10 },
  ];
  it('RN-CORE-46: hoje mostra início, pausa e último ponto, no fuso do tenant; km pelo metrosDoTrajeto', () => {
    const r = resumoDoDia({ pontos, pausas: [{ inicio: '2026-11-19T13:12:00.000Z', fim: '2026-11-19T13:40:00.000Z' }], hoje: true, agora: AGORA, fuso: 'America/Manaus' });
    expect(r.titulo).toBe('Até agora');
    expect(r.hoje).toBe(true);
    expect(r.km).toMatch(/^\d+,\d km$/);
    expect(r.linhas).toEqual([
      { tipo: 'inicio', rotulo: 'Início', hora: '08:04' },
      { tipo: 'pausa', rotulo: 'Pausa', hora: '09:12–09:40' },
      { tipo: 'fim', rotulo: 'Último ponto', hora: '10:12' },
    ]);
  });
  it('RN-CORE-46: dia anterior usa "Km do dia" e "Fim"; pausa em curso hoje mostra "agora"', () => {
    const r = resumoDoDia({ pontos, pausas: [], hoje: false, agora: AGORA, fuso: 'America/Manaus' });
    expect(r.titulo).toBe('Distância');
    expect(r.hoje).toBe(false);
    expect(r.linhas.at(-1)).toEqual({ tipo: 'fim', rotulo: 'Fim', hora: '10:12' });
    const hoje = resumoDoDia({ pontos, pausas: [{ inicio: '2026-11-19T13:59:00.000Z', fim: null }], hoje: true, agora: AGORA, fuso: 'America/Manaus' });
    expect(hoje.linhas.find((l) => l.tipo === 'pausa')).toMatchObject({ rotulo: 'Pausa', hora: '09:59–agora' });
  });
  it('RN-CORE-13: o leitor de tela lê o estado inteiro', () => {
    expect(leituraDaLocalizacao({ estado: 'ativa', apoio: 'Hoje 08:00–18:00', acao: 'pausar' })).toBe('Localização, ativa, hoje das 8 às 18');
    expect(leituraDaLocalizacao({ estado: 'pausada', apoio: 'Volta em 42 min', acao: 'retomar' })).toBe('Localização, pausada, volta em 42 min');
    expect(leituraDaLocalizacao({ estado: 'sem_expediente', apoio: null, acao: null })).toBe('Localização, sem expediente hoje');
    expect(leituraDaLocalizacao({ estado: 'ativa', apoio: 'Hoje 08:30–12:00 e 14:00–18:00', acao: 'pausar' })).toBe('Localização, ativa, hoje das 8:30 às 12 e das 14 às 18');
  });
});
