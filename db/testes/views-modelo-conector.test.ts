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

const ARQUIVO = new URL('../conector/views-modelo.sql', import.meta.url);
const SQL = readFileSync(ARQUIVO, 'utf8');

/** Forma mínima de um schema Zod que o teste usa (sem importar o zod no pacote db). */
interface EsquemaZod {
  safeParse(v: unknown): { success: boolean };
  _def: { typeName?: string; innerType?: EsquemaZod; schema?: EsquemaZod };
  shape?: Record<string, EsquemaZod>;
}

/** Tira optional/nullable/default/effects até o tipo de base. */
function desembrulhar(s: EsquemaZod): EsquemaZod {
  let atual = s;
  for (let i = 0; i < 10; i++) {
    const d = atual._def;
    if (d.schema) atual = d.schema;
    else if (d.innerType) atual = d.innerType;
    else break;
  }
  return atual;
}

interface CampoContrato {
  /** Coluna esperada na view. */
  coluna: string;
  obrigatorio: boolean;
}

/** Colunas que a view deve devolver para o schema do registro (objeto aninhado -> `<objeto>_<campo>`). */
function colunasDoContrato(schema: unknown): CampoContrato[] {
  const raiz = desembrulhar(schema as EsquemaZod);
  if (raiz._def.typeName !== 'ZodObject' || !raiz.shape) throw new Error('schema do registro não é um objeto');
  const out: CampoContrato[] = [];
  for (const [campo, s] of Object.entries(raiz.shape)) {
    const obrigatorio = !s.safeParse(undefined).success;
    const base = desembrulhar(s);
    if (base._def.typeName === 'ZodObject' && base.shape) {
      for (const [sub, ss] of Object.entries(base.shape)) {
        out.push({ coluna: `${campo}_${sub}`, obrigatorio: obrigatorio && !ss.safeParse(undefined).success });
      }
    } else {
      out.push({ coluna: campo, obrigatorio });
    }
  }
  return out;
}

/** Tira comentários `--` e `/* *\/` fora de literais. */
function semComentarios(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      const fim = sql.indexOf("'", i + 1);
      const j = fim < 0 ? sql.length : fim + 1;
      out += sql.slice(i, j);
      i = j;
    } else if (c === '-' && sql[i + 1] === '-') {
      const fim = sql.indexOf('\n', i);
      i = fim < 0 ? sql.length : fim;
    } else if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2);
      i = fim < 0 ? sql.length : fim + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface ColunaView {
  alias: string;
  expressao: string;
}
interface View {
  entidade: string;
  colunas: ColunaView[];
}

/** Lista do SELECT de nível zero, até o FROM de nível zero; cada item precisa terminar em `AS <alias>`. */
function colunasDoSelect(corpo: string, entidade: string): ColunaView[] {
  const itens: string[] = [];
  let atual = '';
  let topo = ''; // o mesmo texto com o conteúdo dos parênteses apagado (para achar o AS de nível zero)
  const topos: string[] = [];
  let prof = 0;
  let i = 0;
  while (i < corpo.length) {
    const c = corpo[i]!;
    if (c === "'") {
      const fim = corpo.indexOf("'", i + 1);
      const j = fim < 0 ? corpo.length : fim + 1;
      atual += corpo.slice(i, j);
      topo += prof === 0 ? "''" : ' ';
      i = j;
      continue;
    }
    if (prof === 0 && /^from\b/i.test(corpo.slice(i)) && /\s/.test(corpo[i - 1] ?? ' ')) break;
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ',' && prof === 0) {
      itens.push(atual);
      topos.push(topo);
      atual = '';
      topo = '';
    } else {
      atual += c;
      topo += prof === 0 || (c === '(' && prof === 1) || c === ')' ? c : ' ';
    }
    i++;
  }
  itens.push(atual);
  topos.push(topo);
  return itens.map((expr, k) => {
    const m = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(topos[k]!.trim());
    if (!m) throw new Error(`vw_macuxi_${entidade}: coluna sem "AS <campo>": ${expr.trim().slice(0, 80)}`);
    return { alias: m[1]!.toLowerCase(), expressao: expr.trim() };
  });
}

function lerViews(sql: string): View[] {
  const limpo = semComentarios(sql);
  const re = /CREATE\s+VIEW\s+vw_macuxi_([a-z_]+)\s+AS\s+SELECT\b/gi;
  const achados = [...limpo.matchAll(re)];
  return achados.map((m, k) => {
    const ini = m.index! + m[0].length;
    const fim = k + 1 < achados.length ? achados[k + 1]!.index! : limpo.length;
    return { entidade: m[1]!, colunas: colunasDoSelect(limpo.slice(ini, fim), m[1]!) };
  });
}

/** Colunas opcionais do contrato que faltam na view (só aviso, não falha). */
function opcionaisFaltando(view: View, schema: unknown): string[] {
  const tem = new Set(view.colunas.map((c) => c.alias));
  return colunasDoContrato(schema).filter((c) => !c.obrigatorio && !tem.has(c.coluna)).map((c) => c.coluna);
}

/** Colunas obrigatórias do contrato que faltam na view. */
function obrigatoriasFaltando(view: View, schema: unknown): string[] {
  const tem = new Set(view.colunas.map((c) => c.alias));
  return colunasDoContrato(schema).filter((c) => c.obrigatorio && !tem.has(c.coluna)).map((c) => c.coluna);
}

/** T-0162: views do RETORNO do pedido (não são entidades de carga); o Conector as lê em `pedidos.status` do conector.json. */
const VIEWS_RETORNO = ['pedido_status', 'pedido_nota_item'];
const TODAS = lerViews(SQL);
const VIEWS = TODAS.filter((v) => !VIEWS_RETORNO.includes(v.entidade));
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
    const blocos = SQL.split(/(?=CREATE\s+VIEW\s+vw_macuxi_)/i).slice(1);
    let conferidas = 0;
    for (const bloco of blocos) {
      const entidade = /vw_macuxi_([a-z_]+)/i.exec(bloco)![1]!;
      const aliases = new Set(porEntidade.get(entidade)!.colunas.map((c) => c.alias));
      for (const linha of bloco.split('\n')) {
        const m = /^\s*--\s*\[(?:Oracle|SQL Server)\].*\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/i.exec(linha);
        if (!m) continue;
        conferidas++;
        expect(aliases.has(m[1]!.toLowerCase()), `vw_macuxi_${entidade}: alternativa comentada com alias desconhecido "${m[1]}"`).toBe(true);
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
    const status = ['pedido_uuid', 'situacao', 'numero_pedido', 'motivo', 'nota_numero', 'nota_serie', 'nota_emitida_em', 'nota_total_cents', 'ocorrido_em'];
    const itens = ['pedido_uuid', 'nota_numero', 'nota_serie', 'sequencia', 'quantidade', 'valor_cents', 'produto_codigo'];
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
