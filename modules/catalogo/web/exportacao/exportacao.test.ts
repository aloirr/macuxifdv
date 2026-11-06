import { describe, expect, it } from 'vitest';
import { csvDoCatalogo, protegerFormula } from './excel';
import { DADOS_EXEMPLO } from './exemplo';
import { DadosExportacao, ProdutoExportacao, type DadosExportacao as Dados } from './formato';
import { COLUNAS, montarCatalogo, sistemasDisponiveis, sumario } from './layout';
import { htmlDoCatalogo, nomeArquivoCatalogo } from './pdf';
import { podeExportarCatalogo } from './permissao';

const base = DADOS_EXEMPLO.produtos[1]!;
const com = (p: Partial<typeof base>): Dados => ({ marcas: DADOS_EXEMPLO.marcas, produtos: [{ ...base, ...p }] });

describe('RF-CAT-09: layout do catálogo', () => {
  it('RF-CAT-09: colunas Código · Aplicação · Oferece junto · Equivale a', () => {
    expect([...COLUNAS]).toEqual(['Código', 'Aplicação', 'Oferece junto', 'Equivale a']);
  });
  it('RF-CAT-09: agrupa por sistema › grupo › linha em ordem pt-BR, sem hierarquia no fim, itens por código', () => {
    const c = montarCatalogo(DADOS_EXEMPLO);
    expect(c.map((s) => `${s.sistema}>${s.grupo}>${s.linha}`)).toEqual(['Elétrico>Ignição>Linha Pesada', 'Freios>Discos>Linha Leve', 'Sem sistema>Sem grupo>Sem linha']);
    expect(c[1]!.itens.map((i) => i.codigo)).toEqual(['AB 1000', 'CB 3401']);
  });
  it('RF-CAT-09: oferece junto resolve ids, ignora desconhecido e o próprio; equivale a usa a marca ou só o código', () => {
    const i = montarCatalogo(DADOS_EXEMPLO)[1]!.itens[1]!;
    expect(i.oferece_junto).toEqual(['AB 1000']);
    expect(i.equivale_a).toEqual(['Marca Alfa A-100', 'Z-9']);
    expect(i.aplicacao).toBe('Dianteiro\nLado esquerdo');
  });
  it('RN-CAT-11: aplicação nula vira vazio e texto acima de 2.000 é cortado', () => {
    expect(montarCatalogo(com({ aplicacao: null }))[0]!.itens[0]!.aplicacao).toBe('');
    expect(montarCatalogo(com({ aplicacao: 'a'.repeat(2500) }))[0]!.itens[0]!.aplicacao).toHaveLength(2000);
  });
  it('RN-CAT-09: no máximo 3 referências e 5 oferece junto na saída', () => {
    const ids = Array.from({ length: 8 }, (_, n) => ({ ...base, id: `c${n}`, codigo: `C${n}` }));
    const dados: Dados = {
      marcas: DADOS_EXEMPLO.marcas,
      produtos: [{ ...base, id: 'x', codigo: 'X', oferece_junto: ids.map((p) => p.id), referencias: Array.from({ length: 5 }, (_, n) => ({ marca_id: 'm1', codigo: `R${n}` })) }, ...ids],
    };
    const i = montarCatalogo(dados)[0]!.itens.find((it) => it.codigo === 'X')!;
    expect(i.oferece_junto).toHaveLength(5);
    expect(i.equivale_a).toHaveLength(3);
  });
  it('RF-CAT-09: filtra por sistema e lista os sistemas disponíveis', () => {
    expect(sistemasDisponiveis(DADOS_EXEMPLO)).toEqual(['Elétrico', 'Freios', 'Sem sistema']);
    expect(montarCatalogo(DADOS_EXEMPLO, { sistema: 'Freios' })).toHaveLength(1);
  });
  it('RF-CAT-09: sumário conta itens por linha e o total', () => {
    expect(sumario(montarCatalogo(DADOS_EXEMPLO))).toEqual({
      linhas: [
        { sistema: 'Elétrico', grupo: 'Ignição', linha: 'Linha Pesada', itens: 1 },
        { sistema: 'Freios', grupo: 'Discos', linha: 'Linha Leve', itens: 2 },
        { sistema: 'Sem sistema', grupo: 'Sem grupo', linha: 'Sem linha', itens: 1 },
      ],
      total: 4,
    });
  });
});

describe('RF-CAT-09: PDF', () => {
  const opc = { empresa: 'Empresa <X>', tz: 'America/Manaus', gerado_em: '2026-11-07T02:30:00Z' };
  const html = htmlDoCatalogo(montarCatalogo(DADOS_EXEMPLO), opc);
  it('RF-CAT-09: tem sumário com total, 4 colunas e título por linha', () => {
    expect(html).toContain('Sumário');
    expect(html).toContain('<strong>4</strong>');
    for (const c of COLUNAS) expect(html).toContain(`<th>${c}</th>`);
    expect(html).toContain('Freios › Discos › Linha Leve');
    expect(html).toContain('size:A4');
  });
  it('RF-CAT-09: aplicação inteira, com quebras de linha preservadas', () => {
    expect(html).toContain('Dianteiro\nLado esquerdo');
    expect(html).toContain('white-space:pre-wrap');
  });
  it('RF-CAT-09: escapa HTML do cadastro', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Empresa &lt;X&gt;');
  });
  it('RF-CAT-09: data e hora no fuso do tenant a partir de UTC', () => {
    expect(html).toContain('06/11/2026 22:30');
    expect(nomeArquivoCatalogo({ tz: opc.tz, gerado_em: opc.gerado_em })).toBe('catalogo-completo-2026-11-06');
    expect(nomeArquivoCatalogo({ sistema: 'Elétrico Pesado', tz: 'UTC', gerado_em: opc.gerado_em })).toBe('catalogo-eletrico-pesado-2026-11-07');
  });
});

describe('RF-CAT-09: Excel (CSV)', () => {
  const csv = csvDoCatalogo(montarCatalogo(DADOS_EXEMPLO));
  it('RF-CAT-09: BOM, cabeçalho, CRLF e ponto e vírgula', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('"Sistema";"Grupo";"Linha";"Código";"Aplicação";"Oferece junto";"Equivale a"');
    expect(linhas).toHaveLength(6);
    expect(linhas[5]).toBe('');
  });
  it('RF-CAT-09: aspas duplicadas e quebra de linha ficam dentro da célula', () => {
    const c = csvDoCatalogo(montarCatalogo(com({ aplicacao: 'diz "oi"\nlinha 2' })));
    expect(c).toContain('"diz ""oi""\nlinha 2"');
  });
  it.each(['=1+1', '+1', '-1', '@soma', '\tx', '\rx'])('RF-CAT-09: protege fórmula que começa com %j', (v) => {
    expect(protegerFormula(v)).toBe(`'${v}`);
    expect(csvDoCatalogo(montarCatalogo(com({ aplicacao: v })))).toContain(`"'${v}"`);
  });
  it('RF-CAT-09: texto comum não é alterado', () => {
    expect(protegerFormula('Freio')).toBe('Freio');
  });
});

describe('RF-CAT-09: permissão da exportação', () => {
  const mods = ['core', 'catalogo'];
  it.each(['analista', 'admin'])('%s exporta', (perfil) => expect(podeExportarCatalogo({ perfil, modulosAtivos: mods })).toBe(true));
  it.each(['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'])('%s não exporta', (perfil) => expect(podeExportarCatalogo({ perfil, modulosAtivos: mods })).toBe(false));
  it('sem licença do catálogo ou sem perfil não exporta', () => {
    expect(podeExportarCatalogo({ perfil: 'admin', modulosAtivos: ['core'] })).toBe(false);
    expect(podeExportarCatalogo({ perfil: null, modulosAtivos: mods })).toBe(false);
  });
});

describe('RN-CAT-09: schema provisório', () => {
  it('aceita os dados de exemplo', () => expect(DadosExportacao.safeParse(DADOS_EXEMPLO).success).toBe(true));
  it('rejeita 4 referências', () => {
    const r = Array.from({ length: 4 }, (_, n) => ({ marca_id: 'm1', codigo: `R${n}` }));
    expect(ProdutoExportacao.safeParse({ ...base, referencias: r }).success).toBe(false);
  });
  it('rejeita 6 oferece junto', () => {
    expect(ProdutoExportacao.safeParse({ ...base, oferece_junto: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
  });
  it('rejeita código de referência com 31 caracteres e aceita 30', () => {
    expect(ProdutoExportacao.safeParse({ ...base, referencias: [{ marca_id: 'm1', codigo: 'a'.repeat(31) }] }).success).toBe(false);
    expect(ProdutoExportacao.safeParse({ ...base, referencias: [{ marca_id: 'm1', codigo: 'a'.repeat(30) }] }).success).toBe(true);
  });
});
