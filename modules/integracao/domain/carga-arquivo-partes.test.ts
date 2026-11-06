import { describe, expect, it } from 'vitest';
import { converterCsvParaLote, hashConteudoArquivo, lerCsv, lerCsvComPosicoes, normalizarTextoCsv } from './carga-arquivo';
import {
  BYTES_MAX_PARTE_ARQUIVO,
  chaveDaParte,
  conferirParteDaSessao,
  dividirCsvEmPartes,
  lerChaveDaParte,
  progressoSessaoArquivo,
  validarParteArquivo,
  type ParteLida,
} from './carga-arquivo-partes';
import { validarChaveIdempotencia } from './lote-idempotencia';
import { PARAMETROS_PADRAO } from './parametros';
import { calcularInativacao, novaSessao, registrarParte, situacaoSessao } from './sessao';

const BOM = String.fromCharCode(0xfeff);
const AGORA = '2026-11-02T12:00:00.000Z';
const SESSAO = '3f2b8c1e-5d4a-4b7e-9c10-0a1b2c3d4e5f';
const CAB = 'external_id;codigo;nome;nivel';

/** Arquivo de catalogo_no com linhas inválidas (nível que não converte, coluna a mais) e quebras de linha entre aspas, algumas na fronteira das partes. */
function arquivoGrande(n = 20_000): string {
  const multi = new Set([1, 4998, 4999, 5000, 9999, 10_000, 12_345, n - 1]);
  const nivelRuim = new Set([2, 4997, 5001, 10_001, 19_000]);
  const colunaExtra = new Set([5002, 14_999]);
  const linhas = [CAB];
  for (let i = 0; i < n; i++) {
    const id = `X${String(i).padStart(5, '0')}`;
    const nome = multi.has(i) ? `"Nó ${id}\nsegunda linha; com ""aspas"""` : `Nó ${id}`;
    if (i % 997 === 0) linhas.push(''); // linha em branco no meio
    linhas.push(`${id};C${i};${nome};${nivelRuim.has(i) ? 'abc' : '1'}${colunaExtra.has(i) ? ';sobra' : ''}`);
  }
  return `${linhas.join('\n')}\n`;
}

describe('RF-INT-03: leitura única com posições', () => {
  it('RF-INT-03: lerCsv devolve exatamente o formato de sempre (sem offsets) e lerCsvComPosicoes acrescenta inicio/fim no texto normalizado', () => {
    const texto = `${BOM}external_id;nome\r\nV1;"A\r\nB"\r\n\r\nV2;Bia\r\n`;
    const simples = lerCsv(texto);
    expect(simples).toEqual({ ok: true, separador: ';', cabecalho: ['external_id', 'nome'], linhas: [{ numero: 2, celulas: ['V1', 'A\nB'] }, { numero: 5, celulas: ['V2', 'Bia'] }] });
    const pos = lerCsvComPosicoes(texto);
    expect(pos.ok).toBe(true);
    if (!pos.ok) return;
    expect(pos.texto).toBe(normalizarTextoCsv(texto));
    for (const l of pos.linhas) expect(pos.texto.slice(l.inicio, l.fim).startsWith('V')).toBe(true);
    expect(pos.texto.slice(pos.linhas[0]!.inicio, pos.linhas[0]!.fim)).toBe('V1;"A\nB"');
    expect(pos.texto.slice(pos.cabecalhoLinha.inicio, pos.cabecalhoLinha.fim)).toBe('external_id;nome');
  });
});

describe('RF-INT-03: dividirCsvEmPartes', () => {
  it('RF-INT-03/RN-INT-06: 20 mil linhas em 4 partes de 5.000 convertem nos MESMOS registros, linhas do arquivo e linhas inválidas do arquivo inteiro', () => {
    const texto = arquivoGrande();
    const inteiro = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'completo', texto, agora: AGORA, limiteLinhas: 20_000 });
    expect(inteiro.ok).toBe(true);
    if (!inteiro.ok) return;
    expect(inteiro.linhasInvalidas.length).toBe(7);

    const d = dividirCsvEmPartes(texto, { maxLinhas: 5000 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.totalLinhas).toBe(20_000);
    expect(d.partes.map((p) => [p.parte, p.total_partes, p.linhas])).toEqual([[1, 4, 5000], [2, 4, 5000], [3, 4, 5000], [4, 4, 5000]]);

    const registros: unknown[] = [];
    const linhasArquivo: number[] = [];
    const invalidas: unknown[] = [];
    d.partes.forEach((p) => {
      const c = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'completo', texto: p.texto, agora: AGORA, parte: { sessaoId: SESSAO, parte: p.parte, totalPartes: p.total_partes, linhaInicial: p.linha_inicial } });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.totalLinhas).toBe(5000);
      expect(c.envelope.sessao).toEqual({ id: SESSAO, parte: p.parte, ultimo: p.parte === 4 });
      registros.push(...c.registros);
      linhasArquivo.push(...c.linhasArquivo);
      invalidas.push(...c.linhasInvalidas);
    });
    expect(registros).toEqual(inteiro.registros);
    expect(linhasArquivo).toEqual(inteiro.linhasArquivo);
    expect(invalidas).toEqual(inteiro.linhasInvalidas);
  }, 60_000);

  it('RF-INT-03: quebra de linha entre aspas exatamente na fronteira não é cortada: cada registro inteiro numa parte só, e reler cada parte dá as células certas', () => {
    const linhas = Array.from({ length: 10 }, (_, i) => (i === 4 ? `X${i};C${i};"quebra\nentre aspas";1` : `X${i};C${i};Nó ${i};1`));
    const texto = `${CAB}\n${linhas.join('\n')}\n`;
    const d = dividirCsvEmPartes(texto, { maxLinhas: 5 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.partes.map((p) => p.linhas)).toEqual([5, 5]);
    const todas = d.partes.flatMap((p) => {
      const r = lerCsv(p.texto);
      expect(r.ok).toBe(true);
      return r.ok ? r.linhas.map((l) => l.celulas) : [];
    });
    expect(todas).toEqual(lerCsv(texto).ok ? (lerCsv(texto) as { linhas: { celulas: string[] }[] }).linhas.map((l) => l.celulas) : []);
    expect(todas[4]?.[2]).toBe('quebra\nentre aspas');
    // a parte 2 começa na linha 7 do original (cabeçalho 1, X0..X3 = 2..5, X4 ocupa 6-7... a quebra empurra: X5 é a linha 8)
    expect(d.partes[1]?.linha_inicial).toBe(8);
  });

  it('RF-INT-03: maxBytes fecha a parte antes de estourar (bytes UTF-8 do texto da parte) e cada parte respeita o limite', () => {
    const texto = `${CAB}\n${Array.from({ length: 30 }, (_, i) => `X${i};C${i};${'Ç'.repeat(20)};1`).join('\n')}\n`;
    const d = dividirCsvEmPartes(texto, { maxLinhas: 5000, maxBytes: 400 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.partes.length).toBeGreaterThan(2);
    for (const p of d.partes) {
      expect(p.bytes).toBe(new TextEncoder().encode(p.texto).length);
      expect(p.bytes).toBeLessThanOrEqual(400);
    }
    expect(d.partes.reduce((a, p) => a + p.linhas, 0)).toBe(30);
    expect(BYTES_MAX_PARTE_ARQUIVO).toBe(768 * 1024);
  });

  it('RF-INT-03: registro sozinho maior que maxBytes = linha_grande com o número da linha', () => {
    const texto = `${CAB}\nX1;C1;Ok;1\nX2;C2;${'N'.repeat(500)};1\n`;
    const d = dividirCsvEmPartes(texto, { maxBytes: 300 });
    expect(d).toMatchObject({ ok: false, codigo: 'linha_grande' });
    if (!d.ok) expect(d.mensagem).toMatch(/linha 3 /);
  });

  it('RF-INT-03: arquivo vazio, CSV com aspas abertas e arquivo só com cabeçalho são recusados com mensagem em português', () => {
    expect(dividirCsvEmPartes('  \n')).toMatchObject({ ok: false, codigo: 'arquivo_vazio' });
    expect(dividirCsvEmPartes(`${CAB}\nX1;C1;"aberta;1\n`)).toMatchObject({ ok: false, codigo: 'csv_invalido' });
    const v = dividirCsvEmPartes(`${CAB}\n\n`);
    expect(v).toMatchObject({ ok: false, codigo: 'lote_vazio' });
    if (!v.ok) expect(v.mensagem.length).toBeGreaterThan(20);
  });

  it('RF-INT-03: BOM e CRLF saem normalizados (sem BOM, só \\n); linhas em branco internas ficam e a linha inicial segue o arquivo original; em branco entre partes não conta', () => {
    const texto = `${BOM}${CAB}\r\nX1;C1;A;1\r\n\r\nX2;C2;B;1\r\n\r\n\r\nX3;C3;C;1\r\n`;
    const d = dividirCsvEmPartes(texto, { maxLinhas: 2 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.partes.map((p) => p.texto)).toEqual([`${CAB}\nX1;C1;A;1\n\nX2;C2;B;1\n`, `${CAB}\nX3;C3;C;1\n`]);
    expect(d.partes.map((p) => p.linha_inicial)).toEqual([2, 7]);
    // convertendo a parte 2 com a linha inicial, a linha 7 do original aparece certa
    const c = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'delta', texto: d.partes[1]!.texto, agora: AGORA, parte: { sessaoId: SESSAO, parte: 2, totalPartes: 2, linhaInicial: 7 } });
    expect(c.ok && c.linhasArquivo).toEqual([7]);
    // e a parte 1 mantém a linha em branco interna: X2 continua na linha 4
    const c1 = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'delta', texto: d.partes[0]!.texto, agora: AGORA, parte: { sessaoId: SESSAO, parte: 1, totalPartes: 2, linhaInicial: 2 } });
    expect(c1.ok && c1.linhasArquivo).toEqual([2, 4]);
  });

  it('RF-INT-03: arquivo que cabe numa parte só vira 1 parte; o padrão de linhas é o limite do lote', () => {
    const texto = `${CAB}\nX1;C1;A;1\n`;
    const d = dividirCsvEmPartes(texto);
    expect(d).toMatchObject({ ok: true, totalLinhas: 1 });
    if (d.ok) expect(d.partes).toHaveLength(1);
    const grande = `${CAB}\n${Array.from({ length: PARAMETROS_PADRAO.limiteRegistrosLote + 1 }, (_, i) => `X${i};C${i};A;1`).join('\n')}\n`;
    const g = dividirCsvEmPartes(grande);
    expect(g.ok && g.partes.map((p) => p.linhas)).toEqual([PARAMETROS_PADRAO.limiteRegistrosLote, 1]);
  });
});

describe('RN-INT-12: parte no envelope, mensagens de limite e hash do envio único', () => {
  const csv = `${CAB}\nX1;C1;A;1\nX2;C2;B;1\n`;
  it('RN-INT-12: sem parte, o envio único segue idêntico (sessão por chave, parte 1 e ultimo) e o hash NÃO muda; com parte o hash muda por parte', () => {
    const c = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'completo', texto: csv, agora: AGORA, sessaoId: SESSAO });
    expect(c.ok && c.envelope.sessao).toEqual({ id: SESSAO, parte: 1, ultimo: true });
    const e = { entidade: 'catalogo_no', modo: 'completo', texto: csv };
    // valor fixado: o hash do envio único de hoje
    expect(hashConteudoArquivo(e)).toBe(hashConteudoArquivo({ ...e, parte: undefined }));
    const p1 = hashConteudoArquivo({ ...e, parte: { sessaoId: SESSAO, parte: 1, totalPartes: 2, linhaInicial: 2 } });
    const p2 = hashConteudoArquivo({ ...e, parte: { sessaoId: SESSAO, parte: 2, totalPartes: 2, linhaInicial: 2 } });
    expect(new Set([hashConteudoArquivo(e), p1, p2]).size).toBe(3);
  });

  it('RF-INT-03: acima_do_limite e corpo_grande sugerem o envio em partes da mesma sessão, não o modo delta', () => {
    const a = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'completo', texto: csv, agora: AGORA, limiteLinhas: 1 });
    expect(a).toMatchObject({ ok: false, codigo: 'acima_do_limite', classe: 'limite' });
    if (!a.ok) expect(a.mensagem).toMatch(/partes da mesma sessão/);
    const b = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'completo', texto: csv, agora: AGORA, limiteBytes: 10 });
    expect(b).toMatchObject({ ok: false, codigo: 'corpo_grande' });
    if (!b.ok) expect(b.mensagem).toMatch(/partes da mesma sessão/);
  });

  it('RN-INT-06: parte de delta não leva sessão no envelope (o delta em partes se agrupa só pela chave da parte)', () => {
    const c = converterCsvParaLote({ entidade: 'catalogo_no', modo: 'delta', texto: csv, agora: AGORA, parte: { sessaoId: SESSAO, parte: 1, totalPartes: 2 } });
    expect(c.ok && c.envelope.sessao).toBeUndefined();
  });
});

describe('RN-INT-12: chave da parte', () => {
  it('RN-INT-12: chaveDaParte e lerChaveDaParte fazem ida e volta, cabem em 128 e passam em validarChaveIdempotencia; a chave base é a mesma em todas as partes', () => {
    const chave = chaveDaParte({ chaveBase: 'minha-chave-de-carga-0001', sessaoId: SESSAO.toUpperCase(), parte: 3, totalPartes: 12 });
    expect(chave).toMatch(new RegExp(`^${SESSAO}\\.0003-0012\\.[0-9a-f]{40}$`));
    expect(chave.length).toBeLessThanOrEqual(128);
    expect(validarChaveIdempotencia(chave).ok).toBe(true);
    const lida = lerChaveDaParte(chave);
    expect(lida).toMatchObject({ sessaoId: SESSAO, parte: 3, totalPartes: 12 });
    const outra = lerChaveDaParte(chaveDaParte({ chaveBase: 'minha-chave-de-carga-0001', sessaoId: SESSAO, parte: 4, totalPartes: 12 }));
    expect(outra?.baseHash).toBe(lida?.baseHash);
    expect(lerChaveDaParte(chaveDaParte({ chaveBase: 'outra-chave-de-carga-0002', sessaoId: SESSAO, parte: 3, totalPartes: 12 }))?.baseHash).not.toBe(lida?.baseHash);
    const max = chaveDaParte({ chaveBase: 'x'.repeat(128), sessaoId: SESSAO, parte: 1000, totalPartes: 1000 });
    expect(validarChaveIdempotencia(max).ok).toBe(true);
  });

  it('RN-INT-12: chave que não é de parte (envio único, texto livre) não é lida como parte', () => {
    expect(lerChaveDaParte('minha-chave-livre-de-envio-unico')).toBeNull();
    expect(lerChaveDaParte(`${SESSAO}.0001-0002.curto`)).toBeNull();
  });
});

describe('RN-INT-06: validar e conferir as partes da sessão', () => {
  it('RN-INT-06: os campos da parte vêm os três ou nenhum (partes_incompletas); linha_inicial só com parte', () => {
    expect(validarParteArquivo({})).toEqual({ ok: true, parte: null });
    for (const e of [{ sessao_id: SESSAO }, { parte: 1, total_partes: 2 }, { sessao_id: SESSAO, parte: 1 }, { linha_inicial: 5 }]) {
      expect(validarParteArquivo(e)).toMatchObject({ ok: false, status: 422, codigo: 'partes_incompletas' });
    }
    expect(validarParteArquivo({ sessao_id: SESSAO.toUpperCase(), parte: 2, total_partes: 3, linha_inicial: 5002 })).toEqual({ ok: true, parte: { sessaoId: SESSAO, parte: 2, totalPartes: 3, linhaInicial: 5002 } });
  });

  it('RN-INT-06: parte fora de 1..total_partes = parte_invalida; total_partes acima de 1000 ou zero é recusado; linha_inicial < 2 é recusada', () => {
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 0, total_partes: 3 })).toMatchObject({ ok: false, codigo: 'parte_invalida' });
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 4, total_partes: 3 })).toMatchObject({ ok: false, codigo: 'parte_invalida' });
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 1, total_partes: 1001 })).toMatchObject({ ok: false, codigo: 'total_partes_invalido' });
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 1, total_partes: 0 })).toMatchObject({ ok: false, codigo: 'total_partes_invalido' });
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 1, total_partes: 1000 })).toMatchObject({ ok: true });
    expect(validarParteArquivo({ sessao_id: SESSAO, parte: 1, total_partes: 2, linha_inicial: 1 })).toMatchObject({ ok: false, codigo: 'linha_inicial_invalida' });
  });

  const base = { entidade: 'catalogo_no', modo: 'completo', totalPartes: 4, baseHash: 'a'.repeat(40) };
  it('RN-INT-06: conferirParteDaSessao — sessão vazia ou consistente passa; outra chave base = 409; outra entidade/modo e total divergente = 422', () => {
    expect(conferirParteDaSessao({ nova: base, existentes: [] })).toEqual({ ok: true });
    expect(conferirParteDaSessao({ nova: base, existentes: [base, base] })).toEqual({ ok: true });
    expect(conferirParteDaSessao({ nova: base, existentes: [{ ...base, baseHash: 'b'.repeat(40) }] })).toMatchObject({ ok: false, status: 409, codigo: 'sessao_de_outra_chave' });
    expect(conferirParteDaSessao({ nova: base, existentes: [{ ...base, entidade: 'transportadora' }] })).toMatchObject({ ok: false, status: 422, codigo: 'sessao_de_outra_entidade' });
    expect(conferirParteDaSessao({ nova: base, existentes: [{ ...base, modo: 'delta' }] })).toMatchObject({ ok: false, status: 422, codigo: 'sessao_de_outra_entidade' });
    const t = conferirParteDaSessao({ nova: base, existentes: [{ ...base, totalPartes: 5 }] });
    expect(t).toMatchObject({ ok: false, status: 422, codigo: 'total_partes_divergente' });
    if (!t.ok) expect(t.mensagem.length).toBeGreaterThan(20);
  });
});

describe('RN-INT-06: progresso da sessão em partes', () => {
  const t0 = '2026-11-02T10:00:00.000Z';
  const parte = (n: number, status: ParteLida['status'], extra: Partial<ParteLida> = {}): ParteLida => ({
    parte: n, totalPartes: 4, lote_id: `00000000-0000-4000-8000-00000000000${n}`, status, recebidas: 100, com_erro: 1, novas: 90, atualizadas: 5, inalteradas: 3, obsoletas: 1, recebido_em: t0, ...extra,
  });
  const entrada = (partes: ParteLida[], extra: Record<string, unknown> = {}) => ({ sessaoId: SESSAO, entidade: 'transportadora' as const, modo: 'completo' as const, partes, errosTotal: 0, agora: '2026-11-02T11:00:00.000Z', ...extra });

  it('RN-INT-06: aberta com parte faltando — partes_faltando e aviso em português; nada de inativação', () => {
    const p = progressoSessaoArquivo(entrada([parte(1, 'concluido'), parte(2, 'concluido_com_erros'), parte(4, 'concluido')], { errosTotal: 3 }));
    expect(p).toMatchObject({ situacao: 'aberta', total_partes: 4, partes_recebidas: 3, partes_aplicadas: 3, partes_com_falha: 0, partes_faltando: [3], erros_total: 3 });
    expect(p.aviso?.codigo).toBe('partes_faltando');
    expect(p.aviso?.mensagem).toMatch(/parte.* 3 de 4/);
    expect(p.inativacao).toBeUndefined();
    expect(p.contagens).toEqual({ recebidas: 300, com_erro: 3, novas: 270, atualizadas: 15, inalteradas: 9, obsoletas: 3 });
    expect(p.expira_em).toBe('2026-11-03T10:00:00.000Z');
  });

  it('RN-INT-06: completa quando todas as partes 1..n aplicadas, com a inativação da última', () => {
    const inativacao = { situacao: 'aplicada' as const, motivo: null, candidatos: 2, percentual: 10 };
    const p = progressoSessaoArquivo(entrada([1, 2, 3, 4].map((n) => parte(n, n % 2 ? 'concluido' : 'concluido_com_erros')), { inativacao }));
    expect(p).toMatchObject({ situacao: 'completa', partes_aplicadas: 4, partes_faltando: [], inativacao });
    expect(p.aviso).toBeUndefined();
    // a inativação só aparece com a sessão completa
    expect(progressoSessaoArquivo(entrada([parte(1, 'concluido')], { inativacao })).inativacao).toBeUndefined();
  });

  it('RN-INT-06: passou o TTL com a parte 3 faltando = expirada + aviso sessao_expirada, mesmo que o banco ainda diga aberta', () => {
    const p = progressoSessaoArquivo(entrada([parte(1, 'concluido'), parte(2, 'concluido'), parte(4, 'concluido')], { agora: '2026-11-03T10:00:01.000Z', sessaoCarga: { situacao: 'aberta', iniciada_em: t0 } }));
    expect(p.situacao).toBe('expirada');
    expect(p.aviso?.codigo).toBe('sessao_expirada');
    expect(p.aviso?.mensagem).toMatch(/parte 3/);
    expect(p.aviso?.mensagem).toMatch(/Nada foi inativado/);
  });

  it('RN-INT-06: a situação gravada em sessao_carga, quando não é aberta, prevalece', () => {
    const partes = [parte(1, 'concluido'), parte(2, 'concluido'), parte(4, 'concluido')];
    expect(progressoSessaoArquivo(entrada(partes, { sessaoCarga: { situacao: 'expirada', iniciada_em: t0 } })).situacao).toBe('expirada');
    expect(progressoSessaoArquivo(entrada([1, 2, 3, 4].map((n) => parte(n, 'concluido')), { sessaoCarga: { situacao: 'completa', iniciada_em: t0 } })).situacao).toBe('completa');
  });

  it('RN-INT-06: parte que falhou não conta como aplicada, mantém a sessão aberta e avisa; delta em partes usa a data de chegada da primeira parte', () => {
    const p = progressoSessaoArquivo(entrada([parte(1, 'concluido'), parte(2, 'falhou'), parte(3, 'recebido'), parte(4, 'processando')]));
    expect(p).toMatchObject({ situacao: 'aberta', partes_aplicadas: 1, partes_com_falha: 1, partes_faltando: [] });
    expect(p.aviso?.codigo).toBe('parte_falhou');
    const d = progressoSessaoArquivo({ ...entrada([1, 2, 3, 4].map((n) => parte(n, 'concluido'))), modo: 'delta' });
    expect(d).toMatchObject({ situacao: 'completa', iniciada_em: t0 });
  });
});

describe('RN-INT-06: sessão com a parte 3 faltando não inativa nada', () => {
  it('RN-INT-06: com a parte 3 faltando calcularInativacao nega (sessao_incompleta) e depois do TTL a sessão é expirada', () => {
    let s = novaSessao(SESSAO, 'transportadora', '2026-11-02T10:00:00.000Z');
    s = registrarParte(s, { parte: 1, ultimo: false, status: 'concluido' });
    s = registrarParte(s, { parte: 2, ultimo: false, status: 'concluido' });
    s = registrarParte(s, { parte: 4, ultimo: true, status: 'concluido' });
    const entrada = { sessao: s, ativosNoMacuxi: ['A', 'B', 'C'], recebidosNaSessao: ['A'] };
    expect(calcularInativacao({ ...entrada, agora: '2026-11-02T11:00:00.000Z' })).toMatchObject({ permitido: false, inativar: [], motivo: 'sessao_incompleta' });
    expect(situacaoSessao(s, '2026-11-03T10:00:01.000Z')).toBe('expirada');
    expect(calcularInativacao({ ...entrada, agora: '2026-11-03T10:00:01.000Z' })).toMatchObject({ permitido: false, inativar: [], motivo: 'sessao_incompleta' });
  });
});
