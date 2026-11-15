import { describe, expect, it } from 'vitest';
import { LIMITES_ZIP_TETO } from '@macuxi/platform-sdk';
import { BOM_CSV } from '@macuxi/comum/csv';
import { FOTO_LOTE_ZIP_MAX_BYTES } from '../contracts';
import { casarCodigo, codigosParaConsulta, conferirTamanhoZip, csvRelatorioFotos, interpretarNome, limitesFotoLote, listaComE, mensagemMotivoLote, resolverItem, textoMotivoItem, type ItemRelatorioFoto, type ProdutoParaCasar } from './fotos-lote';

const P = (sku: string, ean: string | null = null, ativo = true): ProdutoParaCasar => ({ id: `id-${sku}`, sku, ean, ativo });

describe('RN-CAT-14: nome do arquivo → código e ordem', () => {
  it('RN-CAT-14: "SKU.jpg" é o código SKU na ordem 1 e "SKU_2.jpg" é a 2ª foto de SKU (ou o código literal SKU_2)', () => {
    expect(interpretarNome('A1.jpg')).toEqual({ ok: true, interpretacoes: [{ codigo: 'A1', ordem: 1 }] });
    expect(interpretarNome('A1_2.jpg')).toEqual({ ok: true, interpretacoes: [{ codigo: 'A1_2', ordem: 1 }, { codigo: 'A1', ordem: 2 }] });
  });
  it('RN-CAT-14: "SKU_1" vale a ordem 1 e tira só a última extensão', () => {
    expect(interpretarNome('A1_1.webp')).toEqual({ ok: true, interpretacoes: [{ codigo: 'A1_1', ordem: 1 }, { codigo: 'A1', ordem: 1 }] });
    expect(interpretarNome('7891234567895.png')).toEqual({ ok: true, interpretacoes: [{ codigo: '7891234567895', ordem: 1 }] });
    expect(interpretarNome('A.B.jpg')).toEqual({ ok: true, interpretacoes: [{ codigo: 'A.B', ordem: 1 }] });
  });
  it('RN-CAT-14: sufixo _0, _100 ou sem número não é ordem; o código fica inteiro', () => {
    for (const nome of ['A1_0.jpg', 'A1_100.jpg', 'A1_x.jpg', 'A1_.jpg']) {
      const r = interpretarNome(nome);
      expect(r.ok && r.interpretacoes.length, nome).toBe(1);
    }
  });
  it('RN-CAT-14: "_2" sozinho (sem código antes) e nome vazio ou com mais de 100 caracteres são nome inválido', () => {
    expect(interpretarNome('.jpg')).toEqual({ ok: false, motivo: 'nome_invalido' });
    expect(interpretarNome('   .jpg')).toEqual({ ok: false, motivo: 'nome_invalido' });
    expect(interpretarNome(`${'A'.repeat(101)}.jpg`)).toEqual({ ok: false, motivo: 'nome_invalido' });
    expect(interpretarNome(`${'A'.repeat(100)}.jpg`).ok).toBe(true);
    const r = interpretarNome('_2.jpg');
    expect(r.ok && r.interpretacoes).toEqual([{ codigo: '_2', ordem: 1 }]);
  });
  it('RN-CAT-14: arquivo sem extensão usa o nome inteiro como código', () => {
    expect(interpretarNome('A1')).toEqual({ ok: true, interpretacoes: [{ codigo: 'A1', ordem: 1 }] });
  });
});

describe('RN-CAT-14: casamento do código (exato → sem diferenciar maiúsculas → EAN)', () => {
  it('RN-CAT-14: o código exato decide, mesmo existindo outro que só difere na caixa', () => {
    expect(casarCodigo('AB', [P('AB'), P('ab')])).toEqual({ tipo: 'casou', produto: P('AB') });
  });
  it('RN-CAT-14: sem exato, casa sem diferenciar maiúsculas; "a1_3" liga ao A1', () => {
    expect(casarCodigo('a1', [P('A1')])).toEqual({ tipo: 'casou', produto: P('A1') });
  });
  it('RN-CAT-14: dois produtos só sem diferenciar maiúsculas (ab e AB, arquivo Ab) = ambíguo com os dois códigos', () => {
    expect(casarCodigo('Ab', [P('ab'), P('AB')])).toEqual({ tipo: 'ambiguo', codigos: ['ab', 'AB'] });
  });
  it('RN-CAT-14: o EAN vem por último; mais de um produto com o mesmo EAN = ambíguo', () => {
    expect(casarCodigo('7891234567895', [P('A2', '7891234567895')])).toEqual({ tipo: 'casou', produto: P('A2', '7891234567895') });
    expect(casarCodigo('789', [P('X', '789'), P('Y', '789')])).toEqual({ tipo: 'ambiguo', codigos: ['X', 'Y'] });
  });
  it('RN-CAT-14: o código tem prioridade sobre o EAN de outro produto', () => {
    expect(casarCodigo('123', [P('123'), P('Z', '123')])).toEqual({ tipo: 'casou', produto: P('123') });
  });
  it('RN-CAT-14: nada casa = nenhum', () => {
    expect(casarCodigo('ZZ', [P('A1', '1')])).toEqual({ tipo: 'nenhum' });
  });
  it('RN-CAT-14: produto inativo também casa', () => {
    expect(casarCodigo('A1', [P('A1', null, false)])).toEqual({ tipo: 'casou', produto: P('A1', null, false) });
  });
});

describe('RN-CAT-14: resolução do item (uma ou mais interpretações do nome)', () => {
  it('RN-CAT-14: A1.jpg, A1_2.jpg e a1_3.jpg com só A1 existindo ligam ao A1 nas ordens 1, 2 e 3', () => {
    const produtos = [P('A1')];
    for (const [nome, ordem] of [['A1.jpg', 1], ['A1_2.jpg', 2], ['a1_3.jpg', 3]] as const) {
      const n = interpretarNome(nome);
      if (!n.ok) throw new Error('nome');
      expect(resolverItem(n.interpretacoes, produtos), nome).toEqual({ situacao: 'ligar', produto: P('A1'), ordem });
    }
  });
  it('RN-CAT-14: Ab.jpg com ab e AB existindo é ambíguo e nada liga', () => {
    const n = interpretarNome('Ab.jpg');
    if (!n.ok) throw new Error('nome');
    expect(resolverItem(n.interpretacoes, [P('ab'), P('AB')])).toEqual({ situacao: 'ambiguo', codigos: ['ab', 'AB'] });
  });
  it('RN-CAT-14: existindo CX e CX_12, o arquivo CX_12.jpg é ambíguo (as duas leituras casam)', () => {
    const n = interpretarNome('CX_12.jpg');
    if (!n.ok) throw new Error('nome');
    expect(resolverItem(n.interpretacoes, [P('CX'), P('CX_12')])).toEqual({ situacao: 'ambiguo', codigos: ['CX_12', 'CX'] });
  });
  it('RN-CAT-14: existindo só CX_12, o arquivo CX_12.jpg liga a ele na ordem 1', () => {
    const n = interpretarNome('CX_12.jpg');
    if (!n.ok) throw new Error('nome');
    expect(resolverItem(n.interpretacoes, [P('CX_12')])).toEqual({ situacao: 'ligar', produto: P('CX_12'), ordem: 1 });
  });
  it('RN-CAT-14: nenhum produto = sem produto', () => {
    expect(resolverItem([{ codigo: 'ZZ', ordem: 1 }], [P('A1')])).toEqual({ situacao: 'sem_produto' });
  });
  it('RN-CAT-14: no máximo 5 códigos candidatos no ambíguo (limite da coluna)', () => {
    const produtos = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => P(x.toUpperCase()));
    const r = resolverItem([{ codigo: 'x', ordem: 1 }], produtos.map((p) => ({ ...p, ean: 'x' })));
    expect(r.situacao === 'ambiguo' && r.codigos).toHaveLength(5);
  });
  it('RN-CAT-14: os códigos da consulta ao Core saem de todas as interpretações, sem repetir', () => {
    const a = interpretarNome('A1_2.jpg');
    const b = interpretarNome('A1.jpg');
    if (!a.ok || !b.ok) throw new Error('nome');
    expect(codigosParaConsulta([a.interpretacoes, b.interpretacoes])).toEqual(['A1_2', 'A1']);
  });
});

describe('RN-CAT-14: limites do lote (o tenant só baixa o teto)', () => {
  it('RN-CAT-14: sem parâmetros valem 500 MB, 10 mil arquivos e 8 MB por foto, com a razão e o total do SDK', () => {
    expect(limitesFotoLote({})).toEqual(LIMITES_ZIP_TETO);
  });
  it('RN-CAT-14: parâmetro menor baixa o teto; maior, zero, negativo ou texto é ignorado', () => {
    expect(limitesFotoLote({ foto_lote_zip_max: 1000, foto_lote_arquivos_max: 50, foto_lote_foto_max: 2000 })).toEqual({ ...LIMITES_ZIP_TETO, bytesZipMax: 1000, arquivosMax: 50, bytesEntradaMax: 2000 });
    expect(limitesFotoLote({ foto_lote_zip_max: 10 ** 12, foto_lote_arquivos_max: 0, foto_lote_foto_max: 'x' })).toEqual(LIMITES_ZIP_TETO);
    expect(limitesFotoLote({ foto_lote_arquivos_max: -3 })).toEqual(LIMITES_ZIP_TETO);
  });
  it('RN-CAT-14: ZIP acima do teto é recusado antes de qualquer byte, com mensagem; no teto passa', () => {
    expect(conferirTamanhoZip(FOTO_LOTE_ZIP_MAX_BYTES, LIMITES_ZIP_TETO)).toEqual({ ok: true });
    const r = conferirTamanhoZip(FOTO_LOTE_ZIP_MAX_BYTES + 1, LIMITES_ZIP_TETO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('zip_grande');
      expect(r.mensagem).toMatch(/500 MB/);
    }
  });
});

describe('RN-CAT-14: relatório CSV protegido contra fórmula', () => {
  const base: ItemRelatorioFoto = { arquivo: 'A1.jpg', situacao: 'ligado', motivo: null, codigo: 'A1', produto_codigo: 'A1', ordem: 1, codigos_candidatos: null };
  it('RN-CAT-14: começa com BOM, usa ; e CRLF e traz o cabeçalho e uma linha por arquivo', () => {
    const csv = csvRelatorioFotos([base]);
    expect(csv.startsWith(BOM_CSV)).toBe(true);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('"Arquivo";"Situação";"Motivo";"Código no nome";"Produto";"Ordem"');
    expect(linhas[1]).toBe('"A1.jpg";"Ligada";"";"A1";"A1";"1"');
    expect(linhas[2]).toBe('');
  });
  it('RN-CAT-14: célula que começa com =, +, -, @, tab ou CR sai com apóstrofo na frente', () => {
    const csv = csvRelatorioFotos(['=1+1', '+x', '-x', '@x', '\tx', '\rx'].map((arquivo) => ({ ...base, arquivo, codigo: arquivo })));
    for (const c of ['=1+1', '+x', '-x', '@x', '\tx', '\rx']) expect(csv).toContain(`"'${c}"`);
    expect(csv).not.toMatch(/;"[=+\-@]/);
  });
  it('RN-CAT-14: ambíguo lista os códigos candidatos e recusado traz o motivo em português', () => {
    const csv = csvRelatorioFotos([
      { ...base, arquivo: 'Ab.jpg', situacao: 'ambiguo', codigo: 'Ab', produto_codigo: null, ordem: null, codigos_candidatos: ['ab', 'AB'] },
      { ...base, arquivo: 'x.gif', situacao: 'recusado', motivo: 'tipo_nao_aceito', produto_codigo: null, ordem: null },
    ]);
    expect(csv).toContain('"Ab.jpg";"Ambígua";"Serve para ab e AB";"Ab";"";""');
    expect(csv).toContain('"x.gif";"Recusada";"Não é JPEG, PNG nem WEBP"');
  });
  it('RN-CAT-14: aspas dentro do nome são dobradas', () => {
    expect(csvRelatorioFotos([{ ...base, arquivo: 'a"b.jpg' }])).toContain('"a""b.jpg"');
  });
});

describe('RN-CAT-14: textos do relatório e do lote recusado (spec do designer)', () => {
  it('RN-CAT-14: lista com "e" no fim', () => {
    expect(listaComE([])).toBe('');
    expect(listaComE(['AB'])).toBe('AB');
    expect(listaComE(['AB', 'ab'])).toBe('AB e ab');
    expect(listaComE(['A', 'B', 'C'])).toBe('A, B e C');
  });
  it('RN-CAT-14: coluna Motivo vazia em ligada, repetida e sem produto; ambígua lista os candidatos; recusada traz o motivo', () => {
    const base = { situacao: 'ligado', motivo: null, codigos_candidatos: null } as const;
    expect(textoMotivoItem(base)).toBe('');
    expect(textoMotivoItem({ ...base, situacao: 'repetido' })).toBe('');
    expect(textoMotivoItem({ ...base, situacao: 'sem_produto' })).toBe('');
    expect(textoMotivoItem({ ...base, situacao: 'ambiguo', codigos_candidatos: ['AB', 'ab'] })).toBe('Serve para AB e ab');
    expect(textoMotivoItem({ ...base, situacao: 'recusado', motivo: 'criptografado' })).toBe('Arquivo com senha');
  });
  it('RN-CAT-14: o aviso do lote recusado usa o limite efetivo do tenant', () => {
    expect(mensagemMotivoLote('zip_grande', { bytesZipMax: 200 * 1024 * 1024 })).toBe('O ZIP passa de 200 MB. Divida as fotos em mais de um ZIP.');
    expect(mensagemMotivoLote('muitos_arquivos', { arquivosMax: 5000 })).toBe('O ZIP passa de 5.000 arquivos. Divida as fotos em mais de um ZIP.');
    expect(mensagemMotivoLote('zip_invalido')).toBe('O arquivo não abre como ZIP. Compacte as fotos de novo.');
  });
});
