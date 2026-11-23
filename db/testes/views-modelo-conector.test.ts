/**
 * Views-modelo do Conector (`db/conector/views-modelo.sql`, T-0089 fatia B2) contra o contrato canônico do Hub
 * (`SCHEMA_REGISTRO` de `modules/integracao/contracts`). Sem banco: roda no PC e no CI.
 * - uma view `vw_macuxi_<entidade>` por entidade do contrato, na ordem de carga (ORDEM_CARGA_ENTIDADES do contrato);
 * - cada view devolve TODAS as colunas obrigatórias do contrato (falha se o contrato ganhar um campo obrigatório sem a view
 *   acompanhar), nenhuma coluna fora dele (pega rename/remoção, que já seriam v2) e nenhuma repetida;
 * - campo OPCIONAL do contrato sem coluna na view NÃO falha (o contrato v1 cresce de forma aditiva e é de outro dono): vira
 *   aviso no console, e o modulo-integracao manda recado ao banco-dados para a view acompanhar;
 * - objeto aninhado vira `<objeto>_<campo>` (cliente: `endereco_cidade`); lista vira uma coluna JSON com o nome do campo;
 * - external_id nunca sai de CPF/CNPJ (docs/modulos/integracao/desenho.md §4);
 * - as formas alternativas comentadas (`-- [Oracle]`, `-- [SQL Server]`) usam aliases que existem na view.
 * Formato: docs/banco/integracao.md, "Views-modelo do Conector".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTIDADES, ORDEM_CARGA_ENTIDADES, SCHEMA_REGISTRO, type Entidade } from '../../modules/integracao/contracts';
import {
  COLUNAS_RETORNO,
  VIEWS_RETORNO,
  aliasesAlternativos,
  blocosDeView,
  colunasDoContrato,
  lerViews,
  obrigatoriasFaltando,
  opcionaisFaltando,
  semComentarios,
} from './leitor-views-conector';

const ARQUIVO = new URL('../conector/views-modelo.sql', import.meta.url);
const SQL = readFileSync(ARQUIVO, 'utf8');

const TODAS = lerViews(SQL);
const VIEWS = TODAS.filter((v) => !(VIEWS_RETORNO as readonly string[]).includes(v.entidade));
const porEntidade = new Map(TODAS.map((v) => [v.entidade, v]));
const EXEMPLO_CONECTOR = JSON.parse(readFileSync(new URL('../../apps/conector/exemplos/conector.exemplo.json', import.meta.url), 'utf8')) as {
  pedidos: { status: { consulta: string; consultaItensNota: string; mapaStatus: Record<string, string> } };
};

describe('views-modelo do Conector (db/conector/views-modelo.sql)', () => {
  it('uma view por entidade do contrato, sem sobra, na ordem de carga do contrato', () => {
    const nomes = VIEWS.map((v) => v.entidade);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect([...nomes].sort()).toEqual([...ENTIDADES].sort());
    expect(nomes).toEqual([...ORDEM_CARGA_ENTIDADES]);
  });

  describe.each([...ENTIDADES])('vw_macuxi_%s', (entidade) => {
    const view = porEntidade.get(entidade);
    const contrato = colunasDoContrato(SCHEMA_REGISTRO[entidade]);

    it('existe', () => {
      expect(view, `falta a view vw_macuxi_${entidade}`).toBeDefined();
    });

    it('cita todas as colunas obrigatórias do contrato', () => {
      expect(obrigatoriasFaltando(view!, SCHEMA_REGISTRO[entidade]), 'campo obrigatório do contrato sem coluna na view').toEqual([]);
      for (const c of ['external_id', 'alterado_em', 'ativo']) expect(view!.colunas.map((x) => x.alias)).toContain(c);
    });

    it('nada fora do contrato, sem coluna repetida', () => {
      const aliases = view!.colunas.map((c) => c.alias);
      expect(new Set(aliases).size, 'coluna repetida').toBe(aliases.length);
      const esperadas = contrato.map((c) => c.coluna);
      expect(aliases.filter((a) => !esperadas.includes(a)), 'coluna da view que não é campo do contrato').toEqual([]);
    });

    it('opcional do contrato sem coluna na view só avisa (contrato aditivo, outro dono)', () => {
      const faltando = opcionaisFaltando(view!, SCHEMA_REGISTRO[entidade]);
      if (faltando.length > 0) {
        console.warn(
          `vw_macuxi_${entidade}: campo(s) opcional(is) do contrato sem coluna na view (atualizar db/conector/views-modelo.sql): ${faltando.join(', ')}`,
        );
      }
    });

    it('external_id é chave interna do ERP, nunca CPF/CNPJ', () => {
      const ext = view!.colunas.find((c) => c.alias === 'external_id')!;
      expect(ext.expressao).not.toMatch(/cpf|cnpj|documento/i);
    });
  });

  it('as formas comentadas [Oracle]/[SQL Server] usam aliases da própria view', () => {
    let conferidas = 0;
    for (const { entidade, texto } of blocosDeView(SQL)) {
      const aliases = new Set(porEntidade.get(entidade)!.colunas.map((c) => c.alias));
      for (const a of aliasesAlternativos(texto)) {
        conferidas++;
        expect(aliases.has(a), `vw_macuxi_${entidade}: alternativa comentada com alias desconhecido "${a}"`).toBe(true);
      }
    }
    expect(conferidas).toBeGreaterThan(15);
  });

  it('os campos da T-0089 estão nas views (3 entidades novas e os 2 do cliente)', () => {
    const cols = (e: Entidade) => porEntidade.get(e)!.colunas.map((c) => c.alias);
    expect(cols('forma_pagamento')).toEqual(expect.arrayContaining(['codigo', 'nome', 'ordem']));
    expect(cols('prazo_pagamento')).toEqual(expect.arrayContaining(['forma_external_id', 'codigo', 'descricao', 'parcelas_dias', 'prazo_medio_dias', 'ordem']));
    expect(cols('tabela_escalonada')).toEqual(
      expect.arrayContaining(['produto_external_id', 'medida', 'quantidade_minima', 'preco_unidade_cents', 'vigencia_inicio', 'vigencia_fim', 'tabela_external_id']),
    );
    expect(cols('cliente')).toEqual(expect.arrayContaining(['prazo_medio_max_dias', 'formas_pagamento']));
  });

  it('T-0186 (0090): nota e título devolvem forma de pagamento e NF com os nomes e tamanhos da 0090, opcionais (NULL no modelo)', () => {
    const col = (e: Entidade, a: string) => porEntidade.get(e)!.colunas.find((c) => c.alias === a)?.expressao;
    for (const [e, a, n] of [
      ['titulo', 'forma_pagamento', 120], ['titulo', 'nf_numero', 40], ['titulo', 'nf_serie', 10],
      ['nota', 'forma_pagamento', 120], ['nota', 'nf_origem_numero', 40], ['nota', 'nf_origem_serie', 10],
    ] as const) {
      expect(col(e, a), `vw_macuxi_${e}.${a}`).toMatch(new RegExp(`^CAST\\(NULL AS VARCHAR\\(${n}\\)\\)\\s+AS ${a}$`));
    }
  });

  it('T-0115 (RN-PES-05): o cliente devolve canal, campo do ClientePayload', () => {
    expect(porEntidade.get('cliente')!.colunas.map((c) => c.alias)).toContain('canal');
    expect(colunasDoContrato(SCHEMA_REGISTRO.cliente).map((c) => c.coluna)).toContain('canal');
  });

  it('o guarda falha se o contrato ganhar um campo obrigatório sem a view acompanhar', () => {
    const forma = SCHEMA_REGISTRO.forma_pagamento;
    const comCampoNovo = forma.extend({ campo_novo_obrigatorio: forma.shape.codigo });
    expect(obrigatoriasFaltando(porEntidade.get('forma_pagamento')!, comCampoNovo)).toEqual(['campo_novo_obrigatorio']);
    // objeto aninhado obrigatório também conta, campo a campo
    const comObjeto = forma.extend({ banco: forma.pick({ codigo: true, nome: true }) });
    expect(obrigatoriasFaltando(porEntidade.get('forma_pagamento')!, comObjeto)).toEqual(['banco_codigo', 'banco_nome']);
  });

  it('campo opcional novo no contrato não reprova a view (vira aviso); obrigatório novo reprova', () => {
    const forma = SCHEMA_REGISTRO.forma_pagamento;
    const comOpcional = forma.extend({ campo_novo_opcional: forma.shape.codigo.optional() });
    const view = porEntidade.get('forma_pagamento')!;
    expect(obrigatoriasFaltando(view, comOpcional)).toEqual([]);
    expect(opcionaisFaltando(view, comOpcional)).toEqual(['campo_novo_opcional']);
    expect(opcionaisFaltando(view, forma)).toEqual([]);
  });

  it('T-0162: as 2 views do retorno do pedido trazem as colunas que o conector.exemplo.json consulta, nos códigos do mapaStatus', () => {
    const cols = (v: string) => porEntidade.get(v)?.colunas.map((c) => c.alias);
    expect(TODAS.slice(-2).map((v) => v.entidade), 'as views do retorno ficam no fim, depois das entidades').toEqual(VIEWS_RETORNO);
    const status = COLUNAS_RETORNO.pedido_status;
    const itens = COLUNAS_RETORNO.pedido_nota_item;
    expect(cols('pedido_status')).toEqual(status);
    expect(cols('pedido_nota_item')).toEqual(itens);
    const { consulta, consultaItensNota, mapaStatus } = EXEMPLO_CONECTOR.pedidos.status;
    expect(consulta).toContain('FROM dbo.vw_macuxi_pedido_status');
    expect(consultaItensNota).toContain('FROM dbo.vw_macuxi_pedido_nota_item');
    const temColuna = (sql: string, c: string) => new RegExp(`\\b${c}\\b`).test(sql);
    for (const c of status) expect(temColuna(consulta, c), `consulta de status sem a coluna ${c}`).toBe(true);
    for (const c of itens) expect(temColuna(consultaItensNota, c), `consulta dos itens da nota sem a coluna ${c}`).toBe(true);
    // os códigos que a view devolve (I, R, C no 1º SELECT; P, F no 2º) são todos traduzidos pelo mapaStatus
    expect(Object.keys(mapaStatus).sort()).toEqual(['C', 'F', 'I', 'P', 'R']);
  });

  it('T-0162: faturado só sai com nota e rejeitado sempre com motivo (o Hub recusa o retorno sem eles)', () => {
    const bloco = semComentarios(SQL.slice(SQL.search(/CREATE\s+VIEW\s+vw_macuxi_pedido_status/i), SQL.search(/CREATE\s+VIEW\s+vw_macuxi_pedido_nota_item/i)));
    const [situacao, notas] = bloco.split(/\bUNION\s+ALL\b/i);
    expect(notas, 'as notas saem num 2º SELECT').toBeDefined();
    expect(situacao).toMatch(/ELSE\s+'I'\s+END\s+AS\s+situacao/i);
    expect(situacao).not.toMatch(/THEN\s+'[PF]'/);
    expect(situacao).toMatch(/situacao\s*=\s*'R'\s+THEN\s+COALESCE\(/i);
    expect(notas).toMatch(/THEN\s+'F'\s+ELSE\s+'P'\s+END/i);
  });

  it('o leitor do SELECT recusa coluna sem alias e para no FROM de nível zero', () => {
    expect(() => lerViews('CREATE VIEW vw_macuxi_x AS SELECT a.b AS external_id, a.c FROM t a;')).toThrow(/sem "AS <campo>"/);
    const [v] = lerViews(
      "CREATE VIEW vw_macuxi_x AS SELECT (SELECT y AS z FROM u WHERE u.k = ',' FOR JSON PATH) AS lista, -- c AS comentado\n a AS external_id FROM t;",
    );
    expect(v!.colunas.map((c) => c.alias)).toEqual(['lista', 'external_id']);
  });
});
