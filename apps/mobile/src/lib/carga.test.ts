/**
 * T-0059 (R-20261102-091336 e R-20261102-090919 item 2): quando a tela de carga deixa entrar e quando o shell sincroniza.
 */
import { describe, expect, it } from 'vitest';

import { deveSincronizar, INTERVALO_SYNC_MS, JANELA_TENTATIVA_RECENTE_MS, percentualDaCarga, situacaoDaCarga, type ContextoDecisaoSync } from './carga';

const AGORA = Date.parse('2026-11-02T13:00:00.000Z');
const ha = (ms: number) => new Date(AGORA - ms).toISOString();
const base = { sincronizando: false, sincronizado_em: null, erro: null, progresso: 0 };

describe('situacaoDaCarga — a navegação depende do estado, não da promessa', () => {
  it('carga a 100% (sincronizado_em gravado, nada em andamento) → entrar', () => {
    expect(situacaoDaCarga({ ...base, sincronizado_em: ha(0), progresso: 1 }, { tinhaCarga: false })).toBe('entrar');
  });

  it('primeira carga em andamento → carregando (mesmo com o rótulo do motor em 100%)', () => {
    expect(situacaoDaCarga({ ...base, sincronizando: true, progresso: 0.4 }, { tinhaCarga: false })).toBe('carregando');
  });

  it('carga já gravada quando a tela abriu → entrar na hora, com a sincronização em segundo plano', () => {
    expect(situacaoDaCarga({ ...base, sincronizando: true, sincronizado_em: ha(3_600_000) }, { tinhaCarga: true })).toBe('entrar');
  });

  it('parou sem carga → erro; parou com carga gravada → entrar (o erro vai para o Perfil)', () => {
    expect(situacaoDaCarga({ ...base, erro: 'HTTP 500' }, { tinhaCarga: false })).toBe('erro');
    expect(situacaoDaCarga({ ...base, erro: 'HTTP 500', sincronizado_em: ha(60_000) }, { tinhaCarga: true })).toBe('entrar');
  });

  it('percentual: 100 com a carga pronta; arredondado e limitado no resto (carregando nunca mostra 100)', () => {
    expect(percentualDaCarga({ ...base, progresso: 0.2 }, 'entrar')).toBe(100);
    expect(percentualDaCarga({ ...base, progresso: 0.456 }, 'carregando')).toBe(46);
    expect(percentualDaCarga({ ...base, progresso: 1.4 }, 'carregando')).toBe(99);
    expect(percentualDaCarga({ ...base, progresso: 1.4 }, 'erro')).toBe(100);
  });

  it('percentual proporcional: as páginas gravadas da entidade em andamento fazem a barra andar, sem passar da fatia dela', () => {
    const carga = { entidade: 'cliente', concluidas: 2, total: 10, paginas: 0, retomada: false };
    const em = (paginas: number) =>
      percentualDaCarga({ ...base, sincronizando: true, progresso: 0.3, carga: { ...carga, paginas } }, 'carregando');
    expect(em(0)).toBe(30);
    expect(em(3)).toBe(35);
    expect(em(1000)).toBe(39);
    // a próxima entidade começa acima de onde a anterior parou (nunca anda para trás)
    expect(percentualDaCarga({ ...base, sincronizando: true, progresso: 0.4, carga: { ...carga, concluidas: 3 } }, 'carregando')).toBeGreaterThanOrEqual(em(1000));
    // sem posição do motor (estado antigo), vale só o progresso
    expect(percentualDaCarga({ ...base, sincronizando: true, progresso: 0.3 }, 'carregando')).toBe(30);
  });
});

describe('deveSincronizar — voltar do segundo plano não reinicia a carga', () => {
  const ctx = (c: Omit<Partial<ContextoDecisaoSync>, 'estado'> & { estado?: Partial<ContextoDecisaoSync['estado']> } = {}): ContextoDecisaoSync => ({
    emCurso: false,
    ultimoInicio: null,
    agora: AGORA,
    ...c,
    estado: { sincronizando: false, sincronizado_em: null, ...c.estado },
  });

  it('carga em andamento (motor ou shell) → não dispara outra, por motivo nenhum', () => {
    for (const motivo of ['abertura', 'periodico', 'volta', 'tela-carga'] as const) {
      expect(deveSincronizar(motivo, ctx({ estado: { sincronizando: true } }))).toBe(false);
      expect(deveSincronizar(motivo, ctx({ emCurso: true }))).toBe(false);
    }
  });

  it('voltar com a carga terminada há pouco → não sincroniza; terminada há mais de 15 min → sincroniza', () => {
    expect(deveSincronizar('volta', ctx({ estado: { sincronizado_em: ha(2 * 60_000) } }))).toBe(false);
    expect(deveSincronizar('volta', ctx({ estado: { sincronizado_em: ha(INTERVALO_SYNC_MS + 1) } }))).toBe(true);
  });

  it('carga incompleta e parada (processo encerrado ou erro antigo) → sincroniza: o motor retoma de onde parou', () => {
    expect(deveSincronizar('volta', ctx())).toBe(true);
    expect(deveSincronizar('tela-carga', ctx({ ultimoInicio: AGORA - JANELA_TENTATIVA_RECENTE_MS - 1 }))).toBe(true);
  });

  it('tela remontada logo depois de uma tentativa → não repete sozinha (fica o "Tentar de novo")', () => {
    expect(deveSincronizar('tela-carga', ctx({ ultimoInicio: AGORA - 5_000 }))).toBe(false);
  });

  it('abrir o app com carga gravada → sincroniza em segundo plano', () => {
    expect(deveSincronizar('abertura', ctx({ estado: { sincronizado_em: ha(60_000) } }))).toBe(true);
  });
});
