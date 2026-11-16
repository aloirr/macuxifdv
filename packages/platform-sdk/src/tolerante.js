const ORIGEM = new WeakMap();
/** O schema com leitura tolerante (chave desconhecida descartada em qualquer nível). Mesmo tipo do original. */
export function tolerante(schema) {
    const t = converter(schema, new Map());
    if (t !== schema)
        ORIGEM.set(t, ORIGEM.get(schema) ?? schema);
    return t;
}
/** Schema oficial de onde `tolerante` partiu (ou o próprio schema, se não for derivado). */
export function schemaOficialDe(schema) {
    return ORIGEM.get(schema) ?? schema;
}
/** A definição oficial do evento (do `contracts` do dono) com o schema tolerante, para o consumidor. */
export function eventoTolerante(def) {
    return { ...def, schema: tolerante(def.schema) };
}
/** Lê um payload pelo contrato do dono, de forma tolerante. `null` = fora do contrato (o consumidor decide: aviso, nunca dado pessoal no log). */
export function lerPayloadTolerante(def, payload) {
    const r = tolerante(def.schema).safeParse(payload);
    return r.success ? r.data : null;
}
function ehDefinicaoEvento(v) {
    if (!v || typeof v !== 'object')
        return false;
    const d = v;
    return typeof d.nome === 'string' && typeof d.modulo === 'string' && typeof d.versao === 'number' && !!d.schema && typeof d.schema.safeParse === 'function';
}
/** Definições de evento exportadas por um `contracts` (valores do `import * as`), por nome. */
export function definicoesExportadas(contracts) {
    const r = new Map();
    for (const v of Object.values(contracts))
        if (ehDefinicaoEvento(v) && !r.has(v.nome))
            r.set(v.nome, v);
    return r;
}
/**
 * Confere o `publica` do manifesto contra o `contracts` do módulo (T-0024): todo evento publicado tem a
 * `DefinicaoEvento` exportada; nenhuma definição exportada é de evento de outro módulo (cópia de payload alheio).
 */
export function conferirEventosPublicados(manifesto, contracts) {
    const defs = definicoesExportadas(contracts);
    const problemas = [];
    for (const nome of manifesto.publica)
        if (!defs.has(nome))
            problemas.push(`${nome}: publicado por ${manifesto.id} sem DefinicaoEvento exportada no contracts`);
    for (const [nome, d] of defs)
        if (d.modulo !== manifesto.id)
            problemas.push(`${nome}: contracts de ${manifesto.id} exporta definição de evento de ${d.modulo} (importe do contracts do dono)`);
    return problemas;
}
function converter(s, vistos) {
    const pronto = vistos.get(s);
    if (pronto)
        return pronto;
    const def = s._def;
    const C = s.constructor;
    const c = (x) => converter(x, vistos);
    let r;
    switch (def.typeName) {
        case 'ZodObject': {
            const original = s.shape;
            let shape;
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
            r = new C({ ...def, options: def.options.map(c) });
            break;
        case 'ZodDiscriminatedUnion': {
            const options = def.options.map(c);
            const optionsMap = new Map([...def.optionsMap].map(([k, v]) => [k, c(v)]));
            r = new C({ ...def, options, optionsMap });
            break;
        }
        case 'ZodIntersection':
            r = new C({ ...def, left: c(def.left), right: c(def.right) });
            break;
        case 'ZodTuple':
            r = new C({ ...def, items: def.items.map(c), rest: def.rest ? c(def.rest) : def.rest });
            break;
        case 'ZodRecord':
        case 'ZodMap':
            r = new C({ ...def, valueType: c(def.valueType) });
            break;
        case 'ZodPipeline':
            r = new C({ ...def, in: c(def.in), out: c(def.out) });
            break;
        case 'ZodLazy': {
            const getter = def.getter;
            r = new C({ ...def, getter: () => c(getter()) });
            break;
        }
        default:
            r = s;
    }
    vistos.set(s, r);
    return r;
}
