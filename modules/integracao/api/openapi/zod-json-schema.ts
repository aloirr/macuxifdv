/**
 * Conversor Zod (v3) -> JSON Schema 2020-12 (o dialeto do OpenAPI 3.1) para os contratos do Hub (T-0087).
 * Sem dependência nova: lê `_def` dos schemas. O que o contrato usa está coberto; qualquer outro tipo Zod LANÇA ERRO
 * (melhor quebrar o teste do que publicar um schema errado).
 *
 * - `modo: 'entrada'` (corpo, query, cabeçalho): campo com `.default()` é opcional e leva `default`.
 * - `modo: 'saida'` (respostas): campo com `.default()` sempre vem preenchido, então é obrigatório.
 * - Objetos do contrato NÃO são `strict` (RN-INT-09: campo desconhecido é ignorado): sem `additionalProperties: false`.
 * - `refine`/`superRefine`/`preprocess`: vale o schema de dentro (a API revalida com o Zod; regra cruzada fica na descrição).
 *   `transform` não tem equivalente e lança erro.
 * - `trim`/`toUpperCase`/`toLowerCase` são normalizações aplicadas ANTES das demais verificações: o JSON Schema as ignora
 *   (os limites valem sobre o texto já normalizado; o cliente deve enviar o valor limpo).
 * - Schemas registrados (`registrar`) viram `components.schemas` ($ref); o nome é o do export do contrato.
 * - `discriminatedUnion` vira `oneOf` (cada opção já carrega o literal do discriminador); sem `discriminator` do OpenAPI, que
 *   exigiria nomes de componente por opção.
 */
import type { z } from 'zod';

export type ModoSchema = 'entrada' | 'saida';
export type JsonSchema = Record<string, unknown>;

const REF_PROVISORIO = '#/__macuxi__/';
const REGEX_REF_PROVISORIO = /#\/__macuxi__\/([A-Za-z0-9_]+)\/(entrada|saida)/g;

interface DefZod {
  typeName: string;
  [k: string]: unknown;
}

const def = (s: z.ZodTypeAny): DefZod => s._def as DefZod;

const TIPOS_COMPONENTE = new Set(['ZodObject', 'ZodDiscriminatedUnion', 'ZodEnum', 'ZodEffects']);

export class ConversorZod {
  private readonly nomes = new Map<z.ZodTypeAny, string>();
  private readonly gerados = new Map<string, Partial<Record<ModoSchema, JsonSchema>>>();
  private readonly emAndamento = new Set<string>();
  private readonly descricoes = new Map<string, string>();

  /**
   * Registra como componente os exports que são objeto, enum, união discriminada ou efeito sobre objeto. `descricoes`: chave
   * `Nome` (o componente) ou `Nome.campo` (a propriedade). Chave de campo que não existe lança erro (pega erro de digitação).
   */
  registrar(exportados: Record<string, unknown>, descricoes: Record<string, string> = {}): void {
    for (const [nome, valor] of Object.entries(exportados)) {
      if (!ehZod(valor) || this.nomes.has(valor)) continue;
      if (!TIPOS_COMPONENTE.has(def(valor).typeName)) continue;
      if (def(valor).typeName === 'ZodEffects' && def(desembrulharEfeitos(valor)).typeName !== 'ZodObject') continue;
      this.nomes.set(valor, nome);
    }
    for (const [chave, d] of Object.entries(descricoes)) this.descricoes.set(chave, d);
  }

  /** Registra um schema anônimo (ex.: opção de união) com um nome de componente. */
  registrarComo(nome: string, schema: z.ZodTypeAny, descricao?: string): void {
    this.nomes.set(schema, nome);
    if (descricao) this.descricoes.set(nome, descricao);
  }

  nomeDe(s: z.ZodTypeAny): string | undefined {
    return this.nomes.get(s);
  }

  ref(s: z.ZodTypeAny, modo: ModoSchema): JsonSchema {
    const nome = this.nomes.get(s);
    if (!nome) throw new Error('ConversorZod.ref: schema não registrado como componente');
    const chave = `${nome}|${modo}`;
    if (!this.gerados.get(nome)?.[modo] && !this.emAndamento.has(chave)) {
      this.emAndamento.add(chave);
      const gerado = this.comDescricoes(nome, this.converterSemRef(s, modo));
      this.gerados.set(nome, { ...(this.gerados.get(nome) ?? {}), [modo]: gerado });
      this.emAndamento.delete(chave);
    }
    return { $ref: `${REF_PROVISORIO}${nome}/${modo}` };
  }

  converter(s: z.ZodTypeAny, modo: ModoSchema): JsonSchema {
    if (this.nomes.has(s)) return this.ref(s, modo);
    return this.converterSemRef(s, modo);
  }

  /** Ajusta um componente já gerado (ex.: `LoteEnvelope.registros` por entidade). */
  ajustarComponente(nome: string, modo: ModoSchema, ajuste: (s: JsonSchema) => JsonSchema): void {
    const atual = this.gerados.get(nome);
    if (!atual?.[modo]) throw new Error(`ConversorZod.ajustarComponente: ${nome} (${modo}) não foi gerado`);
    this.gerados.set(nome, { ...atual, [modo]: ajuste(atual[modo] as JsonSchema) });
  }

  /**
   * Resolve os $ref provisórios. Componente igual nos dois modos = um nome só; diferente (ou que aponta para um componente que
   * difere) = `<Nome>` (entrada) e `<Nome>Resposta` (saída).
   */
  finalizar<T>(documento: T): { documento: T; schemas: Record<string, JsonSchema> } {
    const normalizar = (s: unknown): string => JSON.stringify(s).replace(REGEX_REF_PROVISORIO, '#/__macuxi__/$1');
    const difere = new Set<string>();
    for (const [nome, { entrada, saida }] of this.gerados) {
      if (entrada && saida && normalizar(entrada) !== normalizar(saida)) difere.add(nome);
    }
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const [nome, { entrada, saida }] of this.gerados) {
        if (difere.has(nome) || !entrada || !saida) continue;
        const refs = [...JSON.stringify(saida).matchAll(REGEX_REF_PROVISORIO)].filter((m) => m[2] === 'saida').map((m) => m[1] as string);
        if (refs.some((r) => difere.has(r))) {
          difere.add(nome);
          mudou = true;
        }
      }
    }

    const nomeFinal = new Map<string, string>();
    for (const nome of this.gerados.keys()) {
      nomeFinal.set(`${nome}/entrada`, nome);
      const comSufixo = `${nome}Resposta`;
      if (difere.has(nome) && this.gerados.has(comSufixo)) throw new Error(`ConversorZod.finalizar: o nome ${comSufixo} já existe`);
      nomeFinal.set(`${nome}/saida`, difere.has(nome) ? comSufixo : nome);
    }
    const bruto: Record<string, JsonSchema> = {};
    for (const [nome, modos] of this.gerados) {
      for (const modo of ['entrada', 'saida'] as const) {
        const s = modos[modo];
        if (s) bruto[nomeFinal.get(`${nome}/${modo}`) as string] = s;
      }
    }

    const resolver = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(resolver);
      if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
          if (k === '$ref' && typeof x === 'string' && x.startsWith(REF_PROVISORIO)) {
            const final = nomeFinal.get(x.slice(REF_PROVISORIO.length));
            if (!final) throw new Error(`ConversorZod.finalizar: $ref sem componente (${x})`);
            o[k] = `#/components/schemas/${final}`;
          } else o[k] = resolver(x);
        }
        return o;
      }
      return v;
    };
    const resolvidos = resolver(bruto) as Record<string, JsonSchema>;
    const schemas = Object.fromEntries(Object.entries(resolvidos).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return { documento: resolver(documento) as T, schemas };
  }

  private comDescricoes(nome: string, gerado: JsonSchema): JsonSchema {
    let saida = gerado;
    const descricao = this.descricoes.get(nome);
    if (descricao) saida = { description: descricao, ...saida };
    const prefixo = `${nome}.`;
    for (const [chave, texto] of this.descricoes) {
      if (!chave.startsWith(prefixo)) continue;
      const campo = chave.slice(prefixo.length);
      const props = saida.properties as Record<string, JsonSchema> | undefined;
      if (!props?.[campo]) throw new Error(`ConversorZod: descrição para campo inexistente (${chave})`);
      saida = { ...saida, properties: { ...props, [campo]: { ...props[campo], description: texto } } };
    }
    return saida;
  }

  private converterSemRef(s: z.ZodTypeAny, modo: ModoSchema): JsonSchema {
    const d = def(s);
    switch (d.typeName) {
      case 'ZodString':
        return stringParaJson(d);
      case 'ZodNumber':
        return numeroParaJson(d);
      case 'ZodBoolean':
        return { type: 'boolean' };
      case 'ZodNull':
        return { type: 'null' };
      case 'ZodUnknown':
      case 'ZodAny':
        return {};
      case 'ZodLiteral': {
        const v = d.value as unknown;
        return { const: v, type: tipoDoValor(v) };
      }
      case 'ZodEnum':
        return { type: 'string', enum: [...(d.values as string[])] };
      case 'ZodArray': {
        const o: JsonSchema = { type: 'array', items: this.converter(d.type as z.ZodTypeAny, modo) };
        const exato = d.exactLength as { value: number } | null;
        const min = d.minLength as { value: number } | null;
        const max = d.maxLength as { value: number } | null;
        if (exato) Object.assign(o, { minItems: exato.value, maxItems: exato.value });
        if (min) o.minItems = min.value;
        if (max) o.maxItems = max.value;
        return o;
      }
      case 'ZodObject':
        return this.objetoParaJson(s as z.AnyZodObject, modo);
      case 'ZodRecord':
        return { type: 'object', additionalProperties: this.converter(d.valueType as z.ZodTypeAny, modo) };
      case 'ZodOptional':
        return this.converter(d.innerType as z.ZodTypeAny, modo);
      case 'ZodNullable':
        return { anyOf: [this.converter(d.innerType as z.ZodTypeAny, modo), { type: 'null' }] };
      case 'ZodDefault': {
        const interno = this.converter(d.innerType as z.ZodTypeAny, modo);
        const padrao = (d.defaultValue as () => unknown)();
        return '$ref' in interno ? { allOf: [interno], default: padrao } : { ...interno, default: padrao };
      }
      case 'ZodEffects': {
        const efeito = d.effect as { type: string };
        if (efeito.type !== 'refinement' && efeito.type !== 'preprocess') {
          throw new Error(`ConversorZod: efeito "${efeito.type}" não tem equivalente em JSON Schema`);
        }
        return this.converter(d.schema as z.ZodTypeAny, modo);
      }
      case 'ZodDiscriminatedUnion':
        return { oneOf: ((d.options as z.ZodTypeAny[]) ?? []).map((o) => this.converter(o, modo)) };
      case 'ZodUnion':
        return { anyOf: (d.options as z.ZodTypeAny[]).map((o) => this.converter(o, modo)) };
      default:
        throw new Error(`ConversorZod: tipo ${d.typeName} não suportado`);
    }
  }

  private objetoParaJson(s: z.AnyZodObject, modo: ModoSchema): JsonSchema {
    const forma = s.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [campo, schema] of Object.entries(forma)) {
      properties[campo] = this.converter(schema, modo);
      if (campoObrigatorio(schema, modo)) required.push(campo);
    }
    const o: JsonSchema = { type: 'object', properties };
    if (required.length) o.required = required;
    if (def(s).unknownKeys === 'strict') o.additionalProperties = false;
    return o;
  }
}

/** Campo obrigatório no JSON? `optional` não; `default` só na saída; `nullable` ainda é obrigatório (aceita `null`). */
export function campoObrigatorio(s: z.ZodTypeAny, modo: ModoSchema): boolean {
  const d = def(s);
  switch (d.typeName) {
    case 'ZodOptional':
      return false;
    case 'ZodDefault':
      return modo === 'saida';
    case 'ZodNullable':
    case 'ZodEffects':
      return campoObrigatorio((d.innerType ?? d.schema) as z.ZodTypeAny, modo);
    default:
      return d.typeName !== 'ZodUnknown' && d.typeName !== 'ZodAny';
  }
}

export function desembrulharEfeitos(s: z.ZodTypeAny): z.ZodTypeAny {
  let atual = s;
  while (def(atual).typeName === 'ZodEffects') atual = def(atual).schema as z.ZodTypeAny;
  return atual;
}

function ehZod(v: unknown): v is z.ZodTypeAny {
  return !!v && typeof v === 'object' && '_def' in v && typeof (v as { safeParse?: unknown }).safeParse === 'function';
}

function tipoDoValor(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

interface CheckTexto {
  kind: string;
  value?: number;
  regex?: RegExp;
  offset?: boolean;
  local?: boolean;
}

function stringParaJson(d: DefZod): JsonSchema {
  const o: JsonSchema = { type: 'string' };
  for (const c of (d.checks as CheckTexto[] | undefined) ?? []) {
    switch (c.kind) {
      case 'min':
        o.minLength = c.value;
        break;
      case 'max':
        o.maxLength = c.value;
        break;
      case 'length':
        o.minLength = c.value;
        o.maxLength = c.value;
        break;
      case 'regex': {
        const pattern = (c.regex as RegExp).source;
        if (o.pattern === undefined) o.pattern = pattern;
        else o.allOf = [...((o.allOf as JsonSchema[] | undefined) ?? []), { pattern }];
        break;
      }
      case 'uuid':
        o.format = 'uuid';
        break;
      case 'datetime':
        o.format = 'date-time';
        // o contrato exige UTC com `Z` (sem deslocamento): o format sozinho aceitaria `-03:00`
        if (!c.offset && !c.local) o.pattern = o.pattern ?? 'Z$';
        break;
      case 'url':
        o.format = 'uri';
        break;
      case 'email':
        o.format = 'email';
        break;
      case 'trim':
      case 'toLowerCase':
      case 'toUpperCase':
        break;
      default:
        throw new Error(`ConversorZod: verificação de texto "${c.kind}" não suportada`);
    }
  }
  return o;
}

interface CheckNumero {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

function numeroParaJson(d: DefZod): JsonSchema {
  const checks = (d.checks as CheckNumero[] | undefined) ?? [];
  const o: JsonSchema = { type: checks.some((c) => c.kind === 'int') ? 'integer' : 'number' };
  for (const c of checks) {
    switch (c.kind) {
      case 'int':
      case 'finite':
        break;
      case 'min':
        if (c.inclusive) o.minimum = c.value;
        else o.exclusiveMinimum = c.value;
        break;
      case 'max':
        if (c.inclusive) o.maximum = c.value;
        else o.exclusiveMaximum = c.value;
        break;
      case 'multipleOf':
        o.multipleOf = c.value;
        break;
      default:
        throw new Error(`ConversorZod: verificação numérica "${c.kind}" não suportada`);
    }
  }
  return o;
}
