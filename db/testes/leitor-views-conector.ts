/**
 * Leitor das views do Conector (`vw_macuxi_<entidade>`) e das colunas do contrato canônico (`SCHEMA_REGISTRO`), sem banco.
 * Usado pelo teste das views-modelo genéricas (`views-modelo-conector.test.ts`) e pelo dos modelos por ERP
 * (`modelos-erp-conector.test.ts`, F4b do desenho docs/desenho/integracao-modelos-erp.md).
 * Formato das views: docs/banco/integracao.md, "Views-modelo do Conector".
 */

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

export interface CampoContrato {
  /** Coluna esperada na view. */
  coluna: string;
  obrigatorio: boolean;
}

/** Colunas que a view deve devolver para o schema do registro (objeto aninhado -> `<objeto>_<campo>`). */
export function colunasDoContrato(schema: unknown): CampoContrato[] {
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
export function semComentarios(sql: string): string {
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

export interface ColunaView {
  alias: string;
  expressao: string;
}
export interface View {
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

/** Views `CREATE [OR REPLACE] VIEW vw_macuxi_<entidade> AS SELECT ...`, na ordem do arquivo, com as colunas do 1º SELECT. */
export function lerViews(sql: string): View[] {
  const limpo = semComentarios(sql);
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+vw_macuxi_([a-z_]+)\s+AS\s+SELECT\b/gi;
  const achados = [...limpo.matchAll(re)];
  return achados.map((m, k) => {
    const ini = m.index! + m[0].length;
    const fim = k + 1 < achados.length ? achados[k + 1]!.index! : limpo.length;
    return { entidade: m[1]!, colunas: colunasDoSelect(limpo.slice(ini, fim), m[1]!) };
  });
}

/** Colunas opcionais do contrato que faltam na view (só aviso, não falha). */
export function opcionaisFaltando(view: View, schema: unknown): string[] {
  const tem = new Set(view.colunas.map((c) => c.alias));
  return colunasDoContrato(schema).filter((c) => !c.obrigatorio && !tem.has(c.coluna)).map((c) => c.coluna);
}

/** Colunas obrigatórias do contrato que faltam na view. */
export function obrigatoriasFaltando(view: View, schema: unknown): string[] {
  const tem = new Set(view.colunas.map((c) => c.alias));
  return colunasDoContrato(schema).filter((c) => c.obrigatorio && !tem.has(c.coluna)).map((c) => c.coluna);
}

/** Blocos do texto ORIGINAL (com comentários), um por `CREATE [OR REPLACE] VIEW vw_macuxi_*`, até o próximo. */
export function blocosDeView(sql: string): { entidade: string; texto: string }[] {
  return sql
    .split(/(?=CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+vw_macuxi_)/i)
    .slice(1)
    .map((texto) => ({ entidade: /vw_macuxi_([a-z_]+)/i.exec(texto)![1]!, texto }));
}

/** Aliases citados nas formas alternativas comentadas (`-- [Oracle] ... AS x` / `-- [SQL Server] ... AS x`) de um bloco. */
export function aliasesAlternativos(bloco: string): string[] {
  const out: string[] = [];
  for (const linha of bloco.split('\n')) {
    const m = /^\s*--\s*\[(?:Oracle|SQL Server)\].*\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/i.exec(linha);
    if (m) out.push(m[1]!.toLowerCase());
  }
  return out;
}

/** T-0162: colunas das 2 views do RETORNO do pedido (não são entidades de carga), na ordem que o Conector consulta. */
export const COLUNAS_RETORNO = {
  pedido_status: ['pedido_uuid', 'situacao', 'numero_pedido', 'motivo', 'nota_numero', 'nota_serie', 'nota_emitida_em', 'nota_total_cents', 'ocorrido_em'],
  pedido_nota_item: ['pedido_uuid', 'nota_numero', 'nota_serie', 'sequencia', 'quantidade', 'valor_cents', 'produto_codigo'],
} as const;
export const VIEWS_RETORNO = Object.keys(COLUNAS_RETORNO) as (keyof typeof COLUNAS_RETORNO)[];
