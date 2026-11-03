import { describe, expect, it } from 'vitest';
import { SCHEMA_REGISTRO } from '../contracts';
import {
  anotarLinhaDoArquivo,
  colunasDaEntidade,
  conteudoCanonicoArquivo,
  converterCsvParaLote,
  lerCsv,
  resolverConectorDoArquivo,
  sessaoDoArquivo,
  type ConectorDoArquivo,
} from './carga-arquivo';
import { validarLinhas } from './idempotencia';
import { validarEnvelope } from './envelope';

const AGORA = '2026-11-02T12:00:00.000Z';
const conv = (texto: string, extra: Partial<Parameters<typeof converterCsvParaLote>[0]> = {}) =>
  converterCsvParaLote({ entidade: 'vendedor', modo: 'delta', texto, agora: AGORA, ...extra });

describe('RF-INT-03: leitura do CSV (BOM, separador, aspas, linhas em branco)', () => {
  it('RF-INT-03: aceita UTF-8 com BOM e sem BOM; o cabeçalho é a linha 1 e os dados começam na linha 2', () => {
    const com = lerCsv('﻿external_id;nome\nV1;Ana\nV2;Bia\n');
    const sem = lerCsv('external_id;nome\nV1;Ana\nV2;Bia\n');
    for (const r of [com, sem]) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.cabecalho).toEqual(['external_id', 'nome']);
        expect(r.linhas.map((l) => l.numero)).toEqual([2, 3]);
        expect(r.linhas[0]?.celulas).toEqual(['V1', 'Ana']);
      }
    }
  });

  it('RF-INT-03: detecta o separador ";" (Excel pt-BR) e ","; sem separador no cabeçalho vale ";" (coluna única)', () => {
    const pv = lerCsv('external_id;nome\nV1;Ana');
    const v = lerCsv('external_id,nome\nV1,Ana');
    const um = lerCsv('external_id\nV1');
    expect(pv.ok && pv.separador).toBe(';');
    expect(v.ok && v.separador).toBe(',');
    expect(um.ok && um.separador).toBe(';');
    expect(v.ok && v.linhas[0]?.celulas).toEqual(['V1', 'Ana']);
  });

  it('RF-INT-03: separador dentro de aspas não separa; aspas duplas escapam aspas; campo com quebra de linha conta as linhas físicas', () => {
    const r = lerCsv('external_id;nome\nV1;"Silva; Souza"\nV2;"Ana ""Anita"""\nV3;"duas\nlinhas"\nV4;Dani');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.linhas.map((l) => l.celulas[1])).toEqual(['Silva; Souza', 'Ana "Anita"', 'duas\nlinhas', 'Dani']);
      // V4 está na linha física 6 (a anterior ocupa as linhas 4 e 5)
      expect(r.linhas.map((l) => l.numero)).toEqual([2, 3, 4, 6]);
    }
  });

  it('RF-INT-03: aceita CRLF e CR; ignora linhas em branco e linhas só de separadores (sobra do Excel), mantendo a numeração física', () => {
    const r = lerCsv('external_id;nome\r\nV1;Ana\r\n\r\n;\r\nV2;Bia\r\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.linhas.map((l) => [l.numero, l.celulas[0]])).toEqual([[2, 'V1'], [5, 'V2']]);
  });

  it('RF-INT-03: aspas abertas sem fechar são recusadas dizendo a linha onde abriram', () => {
    const r = lerCsv('external_id;nome\nV1;"Ana\nV2;Bia');
    expect(r).toMatchObject({ ok: false, codigo: 'csv_invalido' });
    if (!r.ok) expect(r.mensagem).toMatch(/linha 2/);
  });

  it('RF-INT-03: arquivo vazio ou só com espaços é recusado em português', () => {
    for (const t of ['', '   \n  \n', '﻿']) {
      const r = lerCsv(t);
      expect(r).toMatchObject({ ok: false, codigo: 'arquivo_vazio' });
    }
  });
});

describe('RF-INT-03: colunas do contrato canônico', () => {
  it('RF-INT-03: as colunas vêm do schema da entidade (campos simples, aninhados com ponto, listas à parte); alterado_em não é obrigatório no arquivo', () => {
    const cliente = colunasDaEntidade('cliente');
    const nomes = cliente.colunas.map((c) => c.caminho);
    expect(nomes).toEqual(expect.arrayContaining(['external_id', 'razao_social', 'documento', 'endereco.cidade', 'endereco.uf', 'limite_credito_cents', 'bloqueado']));
    expect(cliente.listas).toContain('contatos');
    expect(cliente.colunas.find((c) => c.caminho === 'razao_social')).toMatchObject({ tipo: 'texto', obrigatoria: true });
    expect(cliente.colunas.find((c) => c.caminho === 'limite_credito_cents')).toMatchObject({ tipo: 'numero', obrigatoria: false });
    expect(cliente.colunas.find((c) => c.caminho === 'bloqueado')).toMatchObject({ tipo: 'booleano', obrigatoria: false });
    expect(cliente.colunas.find((c) => c.caminho === 'endereco.cidade')?.obrigatoria).toBe(false);
    expect(cliente.colunas.find((c) => c.caminho === 'alterado_em')?.obrigatoria).toBe(false);
    expect(cliente.colunas.find((c) => c.caminho === 'external_id')?.obrigatoria).toBe(true);
  });

  it('RF-INT-03: toda entidade do contrato tem colunas e external_id; preço (com superRefine) também é lido', () => {
    for (const e of Object.keys(SCHEMA_REGISTRO) as (keyof typeof SCHEMA_REGISTRO)[]) {
      const c = colunasDaEntidade(e);
      expect(c.colunas.length, e).toBeGreaterThan(2);
      expect(c.colunas.some((x) => x.caminho === 'external_id'), e).toBe(true);
    }
    expect(colunasDaEntidade('preco').colunas.find((c) => c.caminho === 'preco_cents')).toMatchObject({ tipo: 'numero', obrigatoria: true });
  });
});

describe('RF-INT-03: CSV vira o envelope canônico do lote', () => {
  it('RF-INT-03: cada linha vira um registro tipado; célula vazia = campo ausente; alterado_em ausente vira o instante do envio; número aceita vírgula decimal', () => {
    const r = conv('external_id;nome;email;telefone\nV1;Ana;ana@x.com;\nV2;Bia;;', { entidade: 'vendedor' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registros).toEqual([
      { external_id: 'V1', nome: 'Ana', email: 'ana@x.com', alterado_em: AGORA },
      { external_id: 'V2', nome: 'Bia', alterado_em: AGORA },
    ]);
    expect(r.linhasArquivo).toEqual([2, 3]);
    expect(r.linhasInvalidas).toEqual([]);

    const e = conv('external_id;deposito_external_id;produto_external_id;saldo;alterado_em\nE1;D1;P1;12,5;2026-11-01T10:00:00Z', { entidade: 'estoque' });
    expect(e.ok && e.registros[0]).toMatchObject({ saldo: 12.5, alterado_em: '2026-11-01T10:00:00Z' });
  });

  it('RF-INT-03: colunas aninhadas com ponto viram objeto; boolean aceita sim/não/true/false/1/0; centavos inteiros', () => {
    const r = conv('external_id;razao_social;endereco.cidade;endereco.uf;bloqueado;limite_credito_cents\nC1;Mercado Sol;Boa Vista;rr;sim;150000', { entidade: 'cliente' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registros[0]).toMatchObject({ endereco: { cidade: 'Boa Vista', uf: 'rr' }, bloqueado: true, limite_credito_cents: 150000 });
    for (const [txt, esperado] of [['não', false], ['NAO', false], ['true', true], ['0', false], ['1', true], ['Falso', false]] as const) {
      const b = conv(`external_id;razao_social;bloqueado\nC1;X;${txt}`, { entidade: 'cliente' });
      expect(b.ok && b.registros[0]?.bloqueado, txt).toBe(esperado);
    }
  });

  it('RF-INT-03: o registro convertido passa no MESMO schema do Hub (validarLinhas) — UF vira maiúscula, texto é aparado', () => {
    const r = conv('external_id;razao_social;endereco.uf\n C1 ; Mercado Sol ;rr', { entidade: 'cliente' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = validarLinhas('cliente', r.registros);
    expect(v.erros).toEqual([]);
    expect(v.validas[0]?.registro).toMatchObject({ external_id: 'C1', razao_social: 'Mercado Sol', endereco: { uf: 'RR' } });
  });

  it('RF-INT-03: o envelope montado é aceito por validarEnvelope; modo completo leva sessão de uma parte (ultimo = true) derivada da chave', () => {
    const r = conv('external_id;nome\nV1;Ana', { modo: 'completo', sessaoId: sessaoDoArquivo('chave-abc-0123456789') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelope).toMatchObject({ versao_contrato: 'v1', entidade: 'vendedor', modo: 'completo', sessao: { parte: 1, ultimo: true } });
    expect(validarEnvelope(r.envelope).ok).toBe(true);
    const d = conv('external_id;nome\nV1;Ana');
    expect(d.ok && d.envelope.sessao).toBeUndefined();
    expect(validarEnvelope((d as { envelope: unknown } & { ok: true }).envelope).ok).toBe(true);
  });

  it('RF-INT-03 / RN-INT-01: linha com valor que não converte (número, booleano) vira linha inválida COM o número da linha do arquivo, o external_id e sem o valor digitado', () => {
    const r = conv('external_id;razao_social;limite_credito_cents;bloqueado\nC1;A;abc;sim\nC2;B;100;talvez\nC3;C;200;nao', { entidade: 'cliente' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registros.map((x) => x.external_id)).toEqual(['C3']);
    expect(r.linhasArquivo).toEqual([4]);
    expect(r.linhasInvalidas).toHaveLength(2);
    expect(r.linhasInvalidas[0]).toMatchObject({ external_id: 'C1', codigo: 'tipo_invalido', campo: 'limite_credito_cents' });
    expect(r.linhasInvalidas[0]?.mensagem).toMatch(/^Linha 2 do arquivo:/);
    expect(r.linhasInvalidas[1]).toMatchObject({ external_id: 'C2', campo: 'bloqueado' });
    expect(r.linhasInvalidas[1]?.mensagem).toMatch(/^Linha 3 do arquivo:/);
    for (const l of r.linhasInvalidas) {
      expect(l.mensagem).not.toMatch(/abc|talvez/);
      expect(l.mensagem.length).toBeLessThanOrEqual(300);
    }
    // o envelope só leva o que converteu; as inválidas vão em linhas_invalidas (RN-INT-01: lote inteiro só de inválidas também é aceito)
    expect(r.envelope.linhas_invalidas).toHaveLength(2);
  });

  it('RF-INT-03 / RN-INT-06: linha inválida sem external_id legível não protege nenhum registro (external_id nulo)', () => {
    const r = conv('external_id;razao_social;limite_credito_cents\n;A;abc', { entidade: 'cliente' });
    expect(r.ok && r.linhasInvalidas[0]).toMatchObject({ external_id: null, codigo: 'tipo_invalido' });
  });

  it('RN-INT-06: linha com colunas a mais está deslocada: external_id nulo (nunca o pedaço errado do texto); valor que não converte, com colunas certas, preserva o external_id', () => {
    const r = conv('nome;external_id\nFoo; Ltda;T01\nBar;T02', { entidade: 'vendedor' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linhasInvalidas).toHaveLength(1);
    expect(r.linhasInvalidas[0]).toMatchObject({ external_id: null, codigo: 'registro_invalido' });
    expect(r.linhasInvalidas.map((l) => l.external_id)).not.toContain('Ltda');
    expect(r.registros.map((x) => x.external_id)).toEqual(['T02']);
    const t = conv('external_id;razao_social;limite_credito_cents\nC1;A;abc', { entidade: 'cliente' });
    expect(t.ok && t.linhasInvalidas[0]).toMatchObject({ external_id: 'C1', codigo: 'tipo_invalido' });
  });

  it('RF-INT-03: número com separador seguido de exatamente 3 dígitos ("1.500", "1,500") é ambíguo e recusado na linha, sem o valor digitado; 1500, 1,5 e 1.500,00 não', () => {
    const q = conv('external_id;deposito_external_id;produto_external_id;saldo\nE1;D;P;1.500\nE2;D;P;1,500\nE3;D;P;1500\nE4;D;P;1,5\nE5;D;P;12,25', { entidade: 'estoque' });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.linhasInvalidas.map((l) => [l.external_id, l.codigo, l.campo])).toEqual([['E1', 'tipo_invalido', 'saldo'], ['E2', 'tipo_invalido', 'saldo']]);
    expect(q.linhasInvalidas[0]?.mensagem).toMatch(/^Linha 2 do arquivo: .*milhar ou decimal/);
    expect(q.linhasInvalidas[0]?.mensagem).not.toMatch(/1\.500|1,500/);
    expect(q.registros.map((x) => x.saldo)).toEqual([1500, 1.5, 12.25]);
  });

  it('RF-INT-03: colunas a mais que o cabeçalho com conteúdo = linha inválida (registro_invalido); a mais vazias (sobra do Excel) são ignoradas; a menos completam vazio', () => {
    const r = conv('external_id;nome\nV1;Ana;lixo\nV2;Bia;;\nV3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linhasInvalidas).toHaveLength(1);
    expect(r.linhasInvalidas[0]).toMatchObject({ external_id: null, codigo: 'registro_invalido' });
    expect(r.linhasInvalidas[0]?.mensagem).toMatch(/Linha 2 do arquivo: .*3 colunas.*2/);
    expect(r.registros.map((x) => x.external_id)).toEqual(['V2', 'V3']);
  });

  it('RF-INT-03: external_id repetido NÃO é tratado aqui — vai ao Hub, que avisa duplicado_no_lote e vale a última (RN-INT-02)', () => {
    const r = conv('external_id;nome\nV1;Ana\nV1;Ana B');
    expect(r.ok && r.registros).toHaveLength(2);
  });

  it('RF-INT-03: cabeçalho com coluna fora do contrato recusa o arquivo inteiro e lista as colunas aceitas', () => {
    const r = conv('external_id;nom\nV1;Ana');
    expect(r).toMatchObject({ ok: false, codigo: 'colunas_desconhecidas', classe: 'arquivo_invalido' });
    if (!r.ok) {
      expect(r.mensagem).toMatch(/nom/);
      expect(r.mensagem).toMatch(/external_id/);
      expect(r.mensagem).toMatch(/nome/);
    }
  });

  it('RF-INT-03: falta de coluna obrigatória (ou external_id) recusa o arquivo — evita milhares de erros iguais linha a linha', () => {
    const semNome = conv('external_id;email\nV1;a@x.com');
    expect(semNome).toMatchObject({ ok: false, codigo: 'colunas_obrigatorias_ausentes' });
    if (!semNome.ok) expect(semNome.mensagem).toMatch(/nome/);
    const semId = conv('nome\nAna');
    expect(semId).toMatchObject({ ok: false, codigo: 'colunas_obrigatorias_ausentes' });
    if (!semId.ok) expect(semId.mensagem).toMatch(/external_id/);
  });

  it('RF-INT-03: coluna repetida e coluna de lista (contatos, paradas) são recusadas com a ação seguinte', () => {
    expect(conv('external_id;nome;nome\nV1;A;B')).toMatchObject({ ok: false, codigo: 'colunas_repetidas' });
    const lista = conv('external_id;razao_social;contatos\nC1;A;x', { entidade: 'cliente' });
    expect(lista).toMatchObject({ ok: false, codigo: 'coluna_nao_suportada' });
    if (!lista.ok) expect(lista.mensagem).toMatch(/Conector/);
  });

  it('RF-INT-03: cabeçalho é lido sem diferenciar maiúsculas/minúsculas nem espaços nas pontas', () => {
    const r = conv(' External_ID ; NOME \nV1;Ana');
    expect(r.ok && r.registros[0]).toMatchObject({ external_id: 'V1', nome: 'Ana' });
  });

  it('RF-INT-03: só o cabeçalho, sem dados, é lote vazio (422, RN-INT-01)', () => {
    expect(conv('external_id;nome\n\n')).toMatchObject({ ok: false, codigo: 'lote_vazio', classe: 'arquivo_invalido' });
  });

  it('RF-INT-03 / limites: acima do limite de linhas do lote (5000 por padrão, parâmetro do tenant) é recusado como "limite", dizendo quantas linhas tem', () => {
    const linhas = Array.from({ length: 6 }, (_, i) => `V${i};Nome ${i}`).join('\n');
    const r = conv(`external_id;nome\n${linhas}`, { limiteLinhas: 5 });
    expect(r).toMatchObject({ ok: false, codigo: 'acima_do_limite', classe: 'limite' });
    if (!r.ok) expect(r.mensagem).toMatch(/6 linhas.*5/);
    expect(conv(`external_id;nome\n${linhas}`, { limiteLinhas: 6 }).ok).toBe(true);
    // linhas inválidas também contam para o limite do lote
    const todas = conv(`external_id;razao_social;limite_credito_cents\nC1;A;x\nC2;B;y\nC3;C;1`, { entidade: 'cliente', limiteLinhas: 2 });
    expect(todas).toMatchObject({ ok: false, codigo: 'acima_do_limite' });
  });

  it('RF-INT-03 / limites: acima do limite de bytes é recusado antes de ler (classe limite)', () => {
    const r = conv('external_id;nome\nV1;Ana', { limiteBytes: 10 });
    expect(r).toMatchObject({ ok: false, codigo: 'corpo_grande', classe: 'limite' });
    if (!r.ok) expect(r.mensagem).toMatch(/limite/);
  });

  it('RF-INT-03: dado pessoal (CPF/e-mail) digitado numa célula inválida nunca aparece na mensagem de erro', () => {
    const r = conv('external_id;razao_social;limite_credito_cents\nC1;A;123.456.789-00', { entidade: 'cliente' });
    expect(r.ok && r.linhasInvalidas[0]?.mensagem).not.toMatch(/123\.456/);
  });
});

describe('RF-INT-03 / RN-INT-12: idempotência do arquivo', () => {
  it('RN-INT-12: o conteúdo canônico ignora BOM, CRLF e linhas em branco no fim — o mesmo arquivo salvo de outro jeito tem o mesmo hash', () => {
    const a = conteudoCanonicoArquivo({ entidade: 'vendedor', modo: 'delta', texto: '﻿external_id;nome\r\nV1;Ana\r\n\r\n' });
    const b = conteudoCanonicoArquivo({ entidade: 'vendedor', modo: 'delta', texto: 'external_id;nome\nV1;Ana' });
    expect(a).toBe(b);
  });

  it('RN-INT-12: entidade, modo ou qualquer célula diferente muda o conteúdo canônico (conteúdo diferente com a mesma chave = 409)', () => {
    const base = conteudoCanonicoArquivo({ entidade: 'vendedor', modo: 'delta', texto: 'external_id;nome\nV1;Ana' });
    expect(conteudoCanonicoArquivo({ entidade: 'vendedor', modo: 'completo', texto: 'external_id;nome\nV1;Ana' })).not.toBe(base);
    expect(conteudoCanonicoArquivo({ entidade: 'cliente', modo: 'delta', texto: 'external_id;nome\nV1;Ana' })).not.toBe(base);
    expect(conteudoCanonicoArquivo({ entidade: 'vendedor', modo: 'delta', texto: 'external_id;nome\nV1;Ana B' })).not.toBe(base);
  });

  it('RN-INT-06: a sessão do arquivo depende da CHAVE (arquivo igual reenviado com chave nova é outra sessão, que inativa de novo) e é um UUID estável', () => {
    const a = sessaoDoArquivo('chave-abc-0123456789');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessaoDoArquivo('chave-abc-0123456789')).toBe(a);
    expect(sessaoDoArquivo('chave-abc-9876543210')).not.toBe(a);
  });
});

describe('RF-INT-03: erros com o número da linha do arquivo', () => {
  it('RF-INT-03: erro do Hub (índice no lote) ganha o prefixo "Linha N do arquivo:" com a linha física do arquivo; índice sem mapa fica como está', () => {
    const r = anotarLinhaDoArquivo([{ indice: 0, mensagem: 'razão social é obrigatória' }, { indice: 1, mensagem: 'x' }, { indice: 9, mensagem: 'sem mapa' }], [2, 7]);
    expect(r.map((x) => x.mensagem)).toEqual(['Linha 2 do arquivo: razão social é obrigatória', 'Linha 7 do arquivo: x', 'sem mapa']);
  });

  it('RF-INT-03: mensagem que já tem o prefixo não é anotada duas vezes (reprocessar o lote)', () => {
    const r = anotarLinhaDoArquivo([{ indice: 0, mensagem: 'Linha 2 do arquivo: erro' }], [2]);
    expect(r[0]?.mensagem).toBe('Linha 2 do arquivo: erro');
  });

  it('RF-INT-03: sem mapa de linhas (lote do Conector) nada muda', () => {
    const itens = [{ indice: 0, mensagem: 'a' }];
    expect(anotarLinhaDoArquivo(itens, undefined)).toEqual(itens);
  });
});

describe('RN-INT-13: Conector do tipo arquivo que recebe a entidade', () => {
  const c = (extra: Partial<ConectorDoArquivo> = {}): ConectorDoArquivo => ({ id: 'u1', identificador: 'planilha-01', tipo: 'arquivo', ativo: true, entidades: ['vendedor', 'cliente'], ...extra });
  const erp: ConectorDoArquivo = { id: 'u2', identificador: 'matriz-01', tipo: 'conector', ativo: true, entidades: ['vendedor', 'produto'] };

  it('RN-INT-13: usa o único Conector arquivo ativo que recebe a entidade', () => {
    expect(resolverConectorDoArquivo('cliente', [c(), erp], null)).toEqual({ ok: true, conector: c() });
  });

  it('RN-INT-13: entidade que é de um Conector de ERP (outro tipo) é recusada dizendo QUEM a recebe e o que fazer', () => {
    const r = resolverConectorDoArquivo('produto', [c(), erp], null);
    expect(r).toMatchObject({ ok: false, codigo: 'entidade_de_outro_conector' });
    if (!r.ok) {
      expect(r.mensagem).toMatch(/matriz-01/);
      expect(r.mensagem).toMatch(/produto/);
    }
  });

  it('RN-INT-13: se o Conector arquivo também lista a entidade, ele só vale quando for o dono (o outro Conector ativo a recebe = recusa)', () => {
    const r = resolverConectorDoArquivo('vendedor', [c(), erp], null);
    // topologia inconsistente (dois ativos com vendedor): a carga não escolhe no escuro
    expect(r).toMatchObject({ ok: false, codigo: 'entidade_de_outro_conector' });
  });

  it('RN-INT-13: sem nenhum Conector de arquivo para a entidade, a mensagem manda cadastrar um (tipo arquivo, com a entidade)', () => {
    const r = resolverConectorDoArquivo('titulo', [c(), erp], null);
    expect(r).toMatchObject({ ok: false, codigo: 'sem_conector_arquivo' });
    if (!r.ok) expect(r.mensagem).toMatch(/Integração ERP > Conectores/);
    expect(resolverConectorDoArquivo('cliente', [], null)).toMatchObject({ ok: false, codigo: 'sem_conector_arquivo' });
  });

  it('RN-INT-13: Conector inativo não conta; conector escolhido que não existe, não é do tipo arquivo ou não recebe a entidade é recusado', () => {
    expect(resolverConectorDoArquivo('cliente', [c({ ativo: false })], null)).toMatchObject({ ok: false, codigo: 'sem_conector_arquivo' });
    expect(resolverConectorDoArquivo('cliente', [c()], 'nao-existe')).toMatchObject({ ok: false, codigo: 'conector_nao_encontrado' });
    expect(resolverConectorDoArquivo('vendedor', [c(), erp], 'matriz-01')).toMatchObject({ ok: false, codigo: 'conector_nao_e_arquivo' });
    expect(resolverConectorDoArquivo('produto', [c()], 'planilha-01')).toMatchObject({ ok: false, codigo: 'entidade_de_outro_conector' });
  });

  it('RN-INT-13: dois Conectores arquivo para a mesma entidade (topologia quebrada) pedem o identificador explícito', () => {
    const outro = c({ id: 'u3', identificador: 'planilha-02' });
    expect(resolverConectorDoArquivo('cliente', [c(), outro], null)).toMatchObject({ ok: false, codigo: 'conector_ambiguo' });
    expect(resolverConectorDoArquivo('cliente', [c(), outro], 'planilha-02')).toMatchObject({ ok: true });
  });
});
