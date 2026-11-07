import { describe, expect, it } from 'vitest';
import { ENTIDADES, type LinhaErro } from '../contracts';
import { DEPENDENCIAS, ordenarCarga } from './ordem';
import { ENTIDADES_OPCIONAIS_CARGA, conferirRegistrosDoArquivo, errosParaCsv, nomeArquivoErros, ordemDeCargaDoPortal } from './portal-carga';

const erro = (o: Partial<LinhaErro>): LinhaErro => ({ indice: 0, external_id: 'C1', codigo: 'campo_obrigatorio', campo: 'nome', mensagem: 'Linha 2 do arquivo: o campo "nome" é obrigatório.', reprocessavel: false, ...o });

describe('RN-INT-04: ordem de carga do portal', () => {
  it('RN-INT-04: cobre todas as entidades uma vez e respeita as dependências do Hub', () => {
    const o = ordemDeCargaDoPortal();
    expect(o.map((x) => x.entidade).sort()).toEqual([...ENTIDADES].sort());
    const pos = new Map(o.map((x, i) => [x.entidade, i]));
    for (const [e, deps] of Object.entries(DEPENDENCIAS)) for (const d of deps) expect(pos.get(d as never)).toBeLessThan(pos.get(e as never) as number);
    expect(ordenarCarga(o.map((x) => x.entidade)).ok).toBe(true);
  });

  it('RN-INT-04: títulos e notas são opcionais; as demais são obrigatórias; cada item lista o que precisa vir antes', () => {
    const o = ordemDeCargaDoPortal();
    expect(o.filter((x) => x.opcional).map((x) => x.entidade).sort()).toEqual([...ENTIDADES_OPCIONAIS_CARGA].sort());
    expect(o.find((x) => x.entidade === 'cliente_endereco')?.depende_de).toEqual(['cliente']);
  });
});

describe('RF-INT-03: erros do lote em CSV', () => {
  it('RF-INT-03: cabeçalho fixo, separador ";", BOM para o Excel e uma linha por erro', () => {
    const csv = errosParaCsv([erro({}), erro({ indice: 3, external_id: null, campo: null, codigo: 'referencia_ausente', reprocessavel: true })]);
    const linhas = csv.split('\r\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(linhas[0]?.slice(1)).toBe('linha_do_lote;external_id;codigo;campo;reprocessavel;mensagem');
    expect(linhas[1]).toBe('1;C1;campo_obrigatorio;nome;nao;"Linha 2 do arquivo: o campo ""nome"" é obrigatório."');
    expect(linhas[2]).toBe('4;;referencia_ausente;;sim;"Linha 2 do arquivo: o campo ""nome"" é obrigatório."');
  });

  it('RF-INT-03: células que começam com = + - @ ganham apóstrofo (planilha não executa fórmula) e aspas são escapadas', () => {
    const csv = errosParaCsv([erro({ external_id: '=SOMA(A1)', mensagem: 'diz "oi"; fim' })]);
    expect(csv).toContain(";'=SOMA(A1);");
    expect(csv).toContain('"diz ""oi""; fim"');
  });

  it('RF-INT-03: lista vazia gera só o cabeçalho', () => {
    expect(errosParaCsv([]).split('\r\n').filter(Boolean)).toHaveLength(1);
  });

  it('RF-INT-03: nome do arquivo é erros-<id>.csv e sem nada além do id do lote', () => {
    expect(nomeArquivoErros('0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a1111')).toBe('erros-0b7e6c52-1c1c-4b43-9d1e-0a4f0f3a1111.csv');
  });
});

describe('RF-INT-03: conferir sem gravar', () => {
  it('RF-INT-03: a linha com tipo errado e a linha com campo faltando aparecem com a linha do arquivo; a boa conta como válida', () => {
    const r = conferirRegistrosDoArquivo({
      entidade: 'transportadora',
      registros: [
        { external_id: 'T1', nome: 'Rápido', alterado_em: '2026-11-06T10:00:00Z' },
        { external_id: 'T2', alterado_em: '2026-11-06T10:00:00Z' },
      ],
      linhasArquivo: [2, 3],
      linhasInvalidasLeitura: [{ external_id: 'T3', codigo: 'tipo_invalido', campo: 'ativo', mensagem: 'Linha 4 do arquivo: o campo "ativo" deve ser sim ou não.' }],
      totalLinhas: 3,
      limite: 100,
    });
    expect(r.linhas_lidas).toBe(3);
    expect(r.linhas_validas).toBe(1);
    expect(r.linhas_com_erro).toBe(2);
    expect(r.erros.map((e) => e.mensagem.slice(0, 19))).toEqual(['Linha 4 do arquivo:', 'Linha 3 do arquivo:']);
    expect(r.pode_gravar).toBe(false);
    expect(r.erros_omitidos).toBe(0);
  });

  it('RF-INT-03: respeita o limite de erros listados e informa o resto como omitido', () => {
    const r = conferirRegistrosDoArquivo({
      entidade: 'transportadora',
      registros: [{ external_id: 'T1', alterado_em: '2026-11-06T10:00:00Z' }, { external_id: 'T2', alterado_em: '2026-11-06T10:00:00Z' }],
      linhasArquivo: [2, 3],
      linhasInvalidasLeitura: [],
      totalLinhas: 2,
      limite: 1,
    });
    expect(r.erros).toHaveLength(1);
    expect(r.erros_omitidos).toBe(1);
  });

  it('RF-INT-03: sem erro nenhum pode gravar; a mensagem nunca traz o valor digitado', () => {
    const r = conferirRegistrosDoArquivo({
      entidade: 'transportadora',
      registros: [{ external_id: 'T1', nome: 'Rápido', alterado_em: '2026-11-06T10:00:00Z' }],
      linhasArquivo: [2],
      linhasInvalidasLeitura: [],
      totalLinhas: 1,
      limite: 100,
    });
    expect(r.pode_gravar).toBe(true);
    expect(r.erros).toEqual([]);
  });
});
