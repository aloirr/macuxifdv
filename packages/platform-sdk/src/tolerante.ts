/**
 * Leitura TOLERANTE de contrato @vN (T-0024; mesma lição do C1 da T-0076): "saída strict, leitura tolerante".
 *
 * O publicador valida com o schema oficial (`.strict()` ou não) no `contracts` do dono. O consumidor lê com
 * `tolerante(schema)`: chave desconhecida some (`.strict()` vira `.strip()`, em qualquer profundidade) e todo o resto
 * continua validado como no contrato (tipos, enums, mínimos, `default`, refinamentos). Assim, um campo novo e
 * opcional no @1 não derruba quem roda uma versão anterior (worker antigo durante o deploy, app antigo no aparelho).
 * Vocabulário novo (valor de enum), campo novo obrigatório ou tipo mudado continuam recusados: isso é `@2` + ADR.
 *
 * - `tolerante(schema)`: o mesmo schema, só que tolerante a chave a mais. Não altera o original. Mesmo tipo de saída.
 * - `eventoTolerante(def)`: a `DefinicaoEvento` oficial do dono com o schema tolerante, pronta para o
 *   `definirConsumidor({ evento: eventoTolerante(EVENTO_X), executar })`.
 * - `schemaOficialDe(schema)`: de onde o tolerante saiu (o teste de contrato da API confere que o consumidor usa o
 *   schema do dono e não uma cópia).
 * - `conferirEventosPublicados(manifesto, contracts)`: problemas entre o `publica` do manifesto e as definições
 *   exportadas pelo `contracts` do módulo (vazio = ok). Cada dono chama no próprio teste.
 *
 * Por `typeName` e pelo construtor do próprio schema (não `instanceof` nem `z.object` daqui): o contrato pode ter
 * sido criado por outra cópia do zod no monorepo.
 */
import type { z } from 'zod';
import type { DefinicaoEvento } from './eventos';
import type { Manifesto } from './manifesto';

type Qualquer = z.ZodTypeAny;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = Record<string, any> & { typeName?: string };
type Construtor = new (def: Def) => Qualquer;

const ORIGEM = new WeakMap<Qualquer, Qualquer>();

/** O schema com leitura tolerante (chave desconhecida descartada em qualquer nível). Mesmo tipo do original. */
export function tolerante<S extends Qualquer>(schema: S): S {
  const t = converter(schema, new Map());
  if (t !== schema) ORIGEM.set(t, ORIGEM.get(schema) ?? schema);
  return t as S;
}

/** Schema oficial de onde `tolerante` partiu (ou o próprio schema, se não for derivado). */
export function schemaOficialDe(schema: Qualquer): Qualquer {
  return ORIGEM.get(schema) ?? schema;
}

/** A definição oficial do evento (do `contracts` do dono) com o schema tolerante, para o consumidor. */
export function eventoTolerante<S extends Qualquer>(def: DefinicaoEvento<S>): DefinicaoEvento<S> {
  return { ...def, schema: tolerante(def.schema) };
}

/** Lê um payload pelo contrato do dono, de forma tolerante. `null` = fora do contrato (o consumidor decide: aviso, nunca dado pessoal no log). */
export function lerPayloadTolerante<S extends Qualquer>(def: DefinicaoEvento<S>, payload: unknown): z.output<S> | null {
  const r = tolerante(def.schema).safeParse(payload);
  return r.success ? (r.data as z.output<S>) : null;
}

function ehDefinicaoEvento(v: unknown): v is DefinicaoEvento {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<DefinicaoEvento>;
  return typeof d.nome === 'string' && typeof d.modulo === 'string' && typeof d.versao === 'number' && !!d.schema && typeof (d.schema as Qualquer).safeParse === 'function';
}

/** Definições de evento exportadas por um `contracts` (valores do `import * as`), por nome. */
export function definicoesExportadas(contracts: Record<string, unknown>): Map<string, DefinicaoEvento> {
  const r = new Map<string, DefinicaoEvento>();
  for (const v of Object.values(contracts)) if (ehDefinicaoEvento(v) && !r.has(v.nome)) r.set(v.nome, v);
  return r;
}

/**
 * Confere o `publica` do manifesto contra o `contracts` do módulo (T-0024): todo evento publicado tem a
 * `DefinicaoEvento` exportada; nenhuma definição exportada é de evento de outro módulo (cópia de payload alheio).
 */
export function conferirEventosPublicados(manifesto: Pick<Manifesto, 'id' | 'publica'>, contracts: Record<string, unknown>): string[] {
  const defs = definicoesExportadas(contracts);
  const problemas: string[] = [];
  for (const nome of manifesto.publica) if (!defs.has(nome)) problemas.push(`${nome}: publicado por ${manifesto.id} sem DefinicaoEvento exportada no contracts`);
  for (const [nome, d] of defs) if (d.modulo !== manifesto.id) problemas.push(`${nome}: contracts de ${manifesto.id} exporta definição de evento de ${d.modulo} (importe do contracts do dono)`);
  return problemas;
}

function converter(s: Qualquer, vistos: Map<Qualquer, Qualquer>): Qualquer {
  const pronto = vistos.get(s);
  if (pronto) return pronto;
  const def = s._def as Def;
  const C = s.constructor as Construtor;
  const c = (x: Qualquer) => converter(x, vistos);
  let r: Qualquer;
  switch (def.typeName) {
    case 'ZodObject': {
      const original = (s as z.AnyZodObject).shape as Record<string, Qualquer>;
      let shape: Record<string, Qualquer> | undefined;
      r = new C({
        ...def,
        shape: () => (shape ??= Object.fromEntries(Object.entries(original).map(([k, v]) => [k, c(v)]))),
        unknownKeys: def.unknownKeys === 'strict' ? 'strip' : def.unknownKeys,
        catchall: c(def.catchall),
      });
      break;
    }
    case 'ZodArray':
    case 'ZodSet':
    case 'ZodPromise':
      r = def.typeName === 'ZodSet' ? new C({ ...def, valueType: c(def.valueType) }) : new C({ ...def, type: c(def.type) });
      break;
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      r = new C({ ...def, innerType: c(def.innerType) });
      break;
    case 'ZodBranded':
      r = new C({ ...def, type: c(def.type) });
      break;
    case 'ZodEffects':
      r = new C({ ...def, schema: c(def.schema) });
      break;
    case 'ZodUnion':
      r = new C({ ...def, options: (def.options as Qualquer[]).map(c) });
      break;
    case 'ZodDiscriminatedUnion': {
      const options = (def.options as Qualquer[]).map(c);
      const optionsMap = new Map([...(def.optionsMap as Map<unknown, Qualquer>)].map(([k, v]) => [k, c(v)]));
      r = new C({ ...def, options, optionsMap });
      break;
    }
    case 'ZodIntersection':
      r = new C({ ...def, left: c(def.left), right: c(def.right) });
      break;
    case 'ZodTuple':
      r = new C({ ...def, items: (def.items as Qualquer[]).map(c), rest: def.rest ? c(def.rest) : def.rest });
      break;
    case 'ZodRecord':
    case 'ZodMap':
      r = new C({ ...def, valueType: c(def.valueType) });
      break;
    case 'ZodPipeline':
      r = new C({ ...def, in: c(def.in), out: c(def.out) });
      break;
    case 'ZodLazy': {
      const getter = def.getter as () => Qualquer;
      r = new C({ ...def, getter: () => c(getter()) });
      break;
    }
    default:
      r = s;
  }
  vistos.set(s, r);
  return r;
}
