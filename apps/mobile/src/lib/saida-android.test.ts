/**
 * T-0144 (R-20261110-062231): a queda do processo fora do React, vista pelo Android no próximo início, vai ao "Último erro
 * do app" do Diagnóstico, sem dado pessoal. Reproduz a sequência do teste de 10/11 (05h32–05h34): três quedas seguidas e a
 * abertura que deu certo.
 */
import { describe, expect, it } from 'vitest';

import {
  descricaoDaSaida,
  ehQueda,
  JANELA_PRIMEIRA_LEITURA_MS,
  lerErroJava,
  lerSaidas,
  linhasDasSaidas,
  registroDaSaida,
  saidaParaRegistrar,
  type SaidaAndroid,
} from './saida-android';
import { textoDoUltimoErro } from './erro-de-tela';

const AGORA = Date.parse('2026-11-10T09:34:30.000Z');
const s = (o: Partial<SaidaAndroid>): SaidaAndroid => ({
  motivo: 5,
  status: 11,
  importancia: 100,
  quando: AGORA - 60_000,
  pss_kb: 0,
  rss_kb: 0,
  descricao: '',
  processo: 'br.com.macuxi.campo',
  ...o,
});

describe('lerSaidas / lerErroJava', () => {
  it('JSON do módulo nativo → saídas da mais nova para a mais antiga; lixo vira lista vazia', () => {
    const json = JSON.stringify([
      { motivo: 3, status: 0, importancia: 100, quando: 1000, pss_kb: 420_000, rss_kb: 0, descricao: '', processo: 'p' },
      { motivo: 5, status: 11, importancia: 100, quando: 3000, pss_kb: 0, rss_kb: 0, descricao: null, processo: 'p' },
      { motivo: 6, quando: 'x' },
      'lixo',
    ]);
    const r = lerSaidas(json);
    expect(r.map((x) => x.quando)).toEqual([3000, 1000]);
    expect(r[0]!.descricao).toBe('');
    expect(lerSaidas('não é json')).toEqual([]);
    expect(lerSaidas('')).toEqual([]);
    expect(lerSaidas('{"a":1}')).toEqual([]);
  });

  it('erro Java: só com data e texto', () => {
    expect(lerErroJava(JSON.stringify({ quando: 5, texto: 'java.lang.OutOfMemoryError' }))).toEqual({ quando: 5, texto: 'java.lang.OutOfMemoryError' });
    expect(lerErroJava('')).toBeNull();
    expect(lerErroJava('{"quando":5}')).toBeNull();
  });
});

describe('ehQueda', () => {
  it('erro nativo, erro Java, memória, ANR e recursos são queda; usuário, atualização e o próprio app não', () => {
    for (const motivo of [3, 4, 5, 6, 7, 9, 12]) expect(ehQueda(s({ motivo }))).toBe(true);
    for (const motivo of [1, 8, 10, 11, 14, 15, 16]) expect(ehQueda(s({ motivo }))).toBe(false);
  });

  it('sinal ou motivo ambíguo só conta com o app visível (com o app em segundo plano é o Android liberando memória)', () => {
    expect(ehQueda(s({ motivo: 2, status: 9, importancia: 100 }))).toBe(true);
    expect(ehQueda(s({ motivo: 2, status: 9, importancia: 400 }))).toBe(false);
    expect(ehQueda(s({ motivo: 13, importancia: 200 }))).toBe(true);
    expect(ehQueda(s({ motivo: 0, importancia: 0 }))).toBe(false);
  });
});

describe('descricaoDaSaida e registroDaSaida', () => {
  it('erro nativo com o sinal; falta de memória com a memória do app; ANR com a pilha da linha principal', () => {
    expect(descricaoDaSaida(s({ motivo: 5, status: 11 }))).toBe('erro nativo · sinal 11 (SIGSEGV)');
    expect(descricaoDaSaida(s({ motivo: 3, status: 0, pss_kb: 420 * 1024 }))).toBe('falta de memória no aparelho · memória do app 420 MB');
    const anr = registroDaSaida(s({ motivo: 6, status: 0, descricao: 'Input dispatching timed out', pilha: 'at a.b.C.d(C.java:1)' }), null);
    expect(anr).toMatchObject({ origem: 'fatal', onde: 'Android', pilha: 'at a.b.C.d(C.java:1)' });
    expect(anr.mensagem).toBe('o app travou (ANR) · Input dispatching timed out');
  });

  it('RD-0072: o cabeçalho do Último erro diz "o app fechou · Android", sem "encerrado" repetindo "fechou"', () => {
    const r = registroDaSaida(s({ motivo: 5, status: 11 }), null);
    expect(textoDoUltimoErro(r, () => 'hoje 05:33').split('\n')[0]).toBe('Último erro do app: hoje 05:33 · o app fechou · Android');
  });

  it('erro Java do mesmo fechamento entra na mensagem e na pilha (sem a linha do nome da thread)', () => {
    const erro = { quando: AGORA - 59_000, texto: 'linha main\njava.lang.IllegalStateException: banco fechado\n  at x.Y.z(Y.kt:3)' };
    const r = registroDaSaida(s({ motivo: 4, status: 0 }), erro);
    expect(r.mensagem).toBe('erro Java não tratado\njava.lang.IllegalStateException: banco fechado');
    expect(r.pilha).toBe('  at x.Y.z(Y.kt:3)');
    // erro Java de outro fechamento (antigo) não se mistura
    expect(registroDaSaida(s({ motivo: 4, status: 0 }), { ...erro, quando: AGORA - 3_600_000 }).pilha).toBeNull();
  });

  it('sem dado pessoal: e-mail e CPF que vierem na descrição ou no erro Java saem mascarados', () => {
    const r = registroDaSaida(s({ motivo: 4, status: 0 }), { quando: AGORA - 60_000, texto: 'linha main\nErro: lucas@empresa.com.br 123.456.789-09' });
    expect(r.mensagem).not.toContain('lucas@empresa.com.br');
    expect(r.mensagem).not.toContain('123.456.789-09');
    expect(descricaoDaSaida(s({ motivo: 13, descricao: 'contato lucas@empresa.com.br' }))).not.toContain('lucas@empresa.com.br');
  });
});

describe('saidaParaRegistrar — sequência do teste de 10/11', () => {
  // três quedas (05h33: abertura dos dados, tela de abertura, 98% da carga) e a saída normal da atualização antes delas
  const historico = [
    s({ motivo: 16, status: 0, importancia: 400, quando: AGORA - 150_000 }),
    s({ motivo: 5, status: 11, quando: AGORA - 70_000 }),
    s({ motivo: 5, status: 11, quando: AGORA - 50_000 }),
    s({ motivo: 3, status: 0, pss_kb: 512 * 1024, quando: AGORA - 20_000 }),
  ].sort((a, b) => b.quando - a.quando);

  it('1ª leitura (APK novo): a queda mais recente dos últimos 7 dias vira o Último erro do app', () => {
    const d = saidaParaRegistrar(historico, null, null, null, AGORA);
    expect(d.registro).toMatchObject({ origem: 'fatal', onde: 'Android' });
    expect(d.registro!.mensagem).toBe('falta de memória no aparelho · memória do app 512 MB');
    expect(d.vistaAte).toBe(AGORA - 20_000);
  });

  it('a mesma saída não é registrada de novo no início seguinte', () => {
    const d = saidaParaRegistrar(historico, AGORA - 20_000, null, null, AGORA + 5_000);
    expect(d).toEqual({ registro: null, vistaAte: AGORA - 20_000 });
  });

  it('só saídas normais (usuário fechou, atualização): nada registrado, mas a marca anda', () => {
    const d = saidaParaRegistrar([s({ motivo: 10, quando: AGORA - 1_000 })], AGORA - 20_000, null, null, AGORA);
    expect(d).toEqual({ registro: null, vistaAte: AGORA - 1_000 });
  });

  it('fatal do JS do mesmo fechamento já gravado: fica o do JS (com a pilha do código)', () => {
    const jsFatal = { origem: 'fatal' as const, quando: new Date(AGORA - 21_000).toISOString() };
    expect(saidaParaRegistrar(historico, null, null, jsFatal, AGORA).registro).toBeNull();
    // fatal antigo (outro fechamento) não impede
    const antigo = { origem: 'fatal' as const, quando: new Date(AGORA - 3_600_000).toISOString() };
    expect(saidaParaRegistrar(historico, null, null, antigo, AGORA).registro).not.toBeNull();
  });

  it('1ª leitura ignora quedas com mais de 7 dias', () => {
    const velha = s({ quando: AGORA - JANELA_PRIMEIRA_LEITURA_MS - 1 });
    expect(saidaParaRegistrar([velha], null, null, null, AGORA)).toEqual({ registro: null, vistaAte: AGORA - JANELA_PRIMEIRA_LEITURA_MS });
  });
});

describe('linhasDasSaidas (Diagnóstico)', () => {
  const quando = (iso: string) => `[${iso.slice(11, 16)}]`;
  it('as 3 últimas, com "(normal)" no que não é queda', () => {
    const linhas = linhasDasSaidas(
      [s({ quando: Date.parse('2026-11-10T09:33:40Z') }), s({ motivo: 10, quando: Date.parse('2026-11-10T09:33:00Z') })],
      quando,
    );
    expect(linhas).toEqual([
      'Saídas do app (Android):',
      '  [09:33] · erro nativo · sinal 11 (SIGSEGV)',
      '  [09:33] · fechado pelo usuário (normal)',
    ]);
  });
  it('sem o módulo no APK ou sem saídas', () => {
    expect(linhasDasSaidas(null, quando)).toEqual(['Saídas do app (Android): indisponível nesta versão']);
    expect(linhasDasSaidas([], quando)).toEqual(['Saídas do app (Android): nenhuma registrada']);
  });
});
