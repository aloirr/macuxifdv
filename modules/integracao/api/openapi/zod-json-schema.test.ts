import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConversorZod, campoObrigatorio } from './zod-json-schema';

const novo = (exportados: Record<string, unknown> = {}, descricoes: Record<string, string> = {}) => {
  const c = new ConversorZod();
  c.registrar(exportados, descricoes);
  return c;
};

describe('conversor Zod -> JSON Schema (OpenAPI 3.1)', () => {
  it('tipo Zod sem equivalente lança erro em vez de publicar schema errado', () => {
    const c = novo();
    expect(() => c.converter(z.string().transform((s) => s.length), 'entrada')).toThrow(/transform/);
    expect(() => c.converter(z.date(), 'entrada')).toThrow(/ZodDate/);
    expect(() => c.converter(z.bigint(), 'entrada')).toThrow(/ZodBigInt/);
    expect(() => c.converter(z.lazy(() => z.string()), 'entrada')).toThrow(/ZodLazy/);
    expect(() => c.converter(z.string().cuid(), 'entrada')).toThrow(/cuid/);
    expect(() => c.converter(z.number().step(2), 'entrada')).not.toThrow(); // multipleOf é suportado
    expect(() => c.ref(z.string(), 'entrada')).toThrow(/não registrado/);
  });

  it('default: opcional e com valor padrão na entrada; obrigatório na saída (o servidor sempre preenche)', () => {
    const Obj = z.object({ a: z.string(), b: z.number().int().default(7), c: z.array(z.string()).default([]) });
    const c = novo();
    const entrada = c.converter(Obj, 'entrada');
    const saida = c.converter(Obj, 'saida');
    expect(entrada.required).toEqual(['a']);
    expect(saida.required).toEqual(['a', 'b', 'c']);
    expect((entrada.properties as Record<string, unknown>).b).toEqual({ type: 'integer', default: 7 });
    expect((entrada.properties as Record<string, unknown>).c).toMatchObject({ type: 'array', default: [] });
    expect(campoObrigatorio(Obj.shape.b, 'entrada')).toBe(false);
    expect(campoObrigatorio(Obj.shape.b, 'saida')).toBe(true);
  });

  it('nullish: aceita null e ausência (anyOf com null, fora de required); nullable: aceita null mas continua obrigatório', () => {
    const Obj = z.object({ a: z.string().nullish(), b: z.string().nullable(), c: z.string().optional() });
    const j = novo().converter(Obj, 'entrada');
    const p = j.properties as Record<string, unknown>;
    expect(p.a).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(p.b).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(p.c).toEqual({ type: 'string' });
    expect(j.required).toEqual(['b']);
  });

  it('RN-INT-09: objeto não é strict (campo desconhecido é ignorado); .strict() vira additionalProperties: false', () => {
    const c = novo();
    expect(c.converter(z.object({ a: z.string() }), 'entrada')).not.toHaveProperty('additionalProperties');
    expect(c.converter(z.object({ a: z.string() }).strict(), 'entrada')).toHaveProperty('additionalProperties', false);
  });

  it('texto: limites, formato, regex e normalização (trim/maiúsculas não viram verificação)', () => {
    const c = novo();
    expect(c.converter(z.string().trim().min(1).max(5), 'entrada')).toEqual({ type: 'string', minLength: 1, maxLength: 5 });
    expect(c.converter(z.string().length(2).toUpperCase(), 'entrada')).toEqual({ type: 'string', minLength: 2, maxLength: 2 });
    expect(c.converter(z.string().uuid(), 'entrada')).toEqual({ type: 'string', format: 'uuid' });
    expect(c.converter(z.string().datetime(), 'entrada')).toEqual({ type: 'string', format: 'date-time', pattern: 'Z$' });
    expect(c.converter(z.string().datetime({ offset: true }), 'entrada')).toEqual({ type: 'string', format: 'date-time' });
    expect(c.converter(z.string().url(), 'entrada')).toEqual({ type: 'string', format: 'uri' });
    expect(c.converter(z.string().regex(/^a+$/).regex(/b$/), 'entrada')).toEqual({ type: 'string', pattern: '^a+$', allOf: [{ pattern: 'b$' }] });
  });

  it('número: inteiro, finito, limites inclusivos e exclusivos', () => {
    const c = novo();
    expect(c.converter(z.number().int().nonnegative(), 'entrada')).toEqual({ type: 'integer', minimum: 0 });
    expect(c.converter(z.number().int().positive(), 'entrada')).toEqual({ type: 'integer', exclusiveMinimum: 0 });
    expect(c.converter(z.number().finite().min(-90).max(90), 'entrada')).toEqual({ type: 'number', minimum: -90, maximum: 90 });
    expect(c.converter(z.coerce.number().int().min(1).max(100).default(50), 'entrada')).toEqual({ type: 'integer', minimum: 1, maximum: 100, default: 50 });
  });

  it('literal, enum, array com limites, record, união e discriminatedUnion', () => {
    const c = novo();
    expect(c.converter(z.literal('v1'), 'entrada')).toEqual({ const: 'v1', type: 'string' });
    expect(c.converter(z.literal(3), 'entrada')).toEqual({ const: 3, type: 'integer' });
    expect(c.converter(z.enum(['a', 'b']), 'entrada')).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(c.converter(z.array(z.string()).min(1).max(3), 'entrada')).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 });
    expect(c.converter(z.record(z.unknown()), 'entrada')).toEqual({ type: 'object', additionalProperties: {} });
    expect(c.converter(z.union([z.string(), z.number()]), 'entrada')).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
    const Du = z.discriminatedUnion('t', [z.object({ t: z.literal('x'), a: z.string() }), z.object({ t: z.literal('y') })]);
    const j = c.converter(Du, 'entrada');
    expect(j.oneOf).toHaveLength(2);
    expect((j.oneOf as { required: string[] }[])[0]?.required).toEqual(['t', 'a']);
  });

  it('refine, superRefine e preprocess valem pelo schema de dentro; objeto com superRefine é registrado como componente', () => {
    const Com = z.object({ a: z.string() }).superRefine(() => undefined);
    const c = novo({ Com });
    expect(c.converter(z.number().refine((n) => n > 0), 'entrada')).toEqual({ type: 'number' });
    expect(c.converter(z.preprocess((v) => v, z.string()), 'entrada')).toEqual({ type: 'string' });
    expect(c.nomeDe(Com)).toBe('Com');
    expect(c.converter(Com, 'entrada')).toEqual({ $ref: '#/__macuxi__/Com/entrada' });
  });

  it('só objeto, enum, união discriminada e efeito sobre objeto viram componente; primitiva fica em linha', () => {
    const Prim = z.string();
    const Efeito = z.number().refine(() => true);
    const Obj = z.object({ a: z.string() });
    const c = novo({ Prim, Efeito, Obj, naoZod: { x: 1 } });
    expect(c.nomeDe(Prim)).toBeUndefined();
    expect(c.nomeDe(Efeito)).toBeUndefined();
    expect(c.nomeDe(Obj)).toBe('Obj');
  });

  it('finalizar: componente igual nos dois modos tem um nome só; com default vira X (entrada) e XResposta (saída), e o que aponta para ele também', () => {
    const Igual = z.object({ a: z.string() });
    const ComDefault = z.object({ n: z.number().default(1) });
    const Pai = z.object({ filho: ComDefault, igual: Igual });
    const PaiNoMeio = z.object({ pai: Pai });
    const c = novo({ Igual, ComDefault, Pai, PaiNoMeio });
    const docEntrada = c.converter(PaiNoMeio, 'entrada');
    const docSaida = c.converter(PaiNoMeio, 'saida');
    const { documento, schemas } = c.finalizar({ docEntrada, docSaida });
    expect(Object.keys(schemas).sort()).toEqual(['ComDefault', 'ComDefaultResposta', 'Igual', 'Pai', 'PaiNoMeio', 'PaiNoMeioResposta', 'PaiResposta']);
    expect(documento.docEntrada).toEqual({ $ref: '#/components/schemas/PaiNoMeio' });
    expect(documento.docSaida).toEqual({ $ref: '#/components/schemas/PaiNoMeioResposta' });
    expect((schemas.PaiResposta?.properties as Record<string, unknown>).filho).toEqual({ $ref: '#/components/schemas/ComDefaultResposta' });
    expect((schemas.PaiResposta?.properties as Record<string, unknown>).igual).toEqual({ $ref: '#/components/schemas/Igual' });
    expect((schemas.Pai?.properties as Record<string, unknown>).filho).toEqual({ $ref: '#/components/schemas/ComDefault' });
  });

  it('finalizar: componente gerado só num modo mantém o nome; $ref sem componente lança erro', () => {
    const So = z.object({ n: z.number().default(1) });
    const c = novo({ So });
    const { schemas } = c.finalizar({ x: c.converter(So, 'saida') });
    expect(Object.keys(schemas)).toEqual(['So']);
    expect(() => c.finalizar({ $ref: '#/__macuxi__/Fantasma/saida' })).toThrow(/sem componente/);
  });

  it('default sobre componente usa allOf + default (sibling de $ref não vale em todo validador)', () => {
    const Enum = z.enum(['a', 'b']);
    const c = novo({ Enum });
    expect(c.converter(Enum.default('a'), 'entrada')).toEqual({ allOf: [{ $ref: '#/__macuxi__/Enum/entrada' }], default: 'a' });
  });

  it('descrições: do componente e de campo; campo inexistente lança erro', () => {
    const Obj = z.object({ a: z.string() });
    const c = novo({ Obj }, { Obj: 'Texto do objeto', 'Obj.a': 'Texto do campo' });
    c.converter(Obj, 'entrada');
    const { schemas } = c.finalizar({});
    expect(schemas.Obj).toMatchObject({ description: 'Texto do objeto', properties: { a: { type: 'string', description: 'Texto do campo' } } });
    const ruim = novo({ Obj }, { 'Obj.b': 'não existe' });
    expect(() => ruim.converter(Obj, 'entrada')).toThrow(/campo inexistente/);
  });

  it('registrarComo nomeia schema anônimo; ajustarComponente exige componente gerado', () => {
    const Anonimo = z.object({ a: z.string() });
    const c = novo();
    c.registrarComo('Anonimo', Anonimo, 'Descrição');
    expect(() => c.ajustarComponente('Anonimo', 'entrada', (s) => s)).toThrow(/não foi gerado/);
    c.converter(Anonimo, 'entrada');
    c.ajustarComponente('Anonimo', 'entrada', (s) => ({ ...s, 'x-teste': true }));
    expect(c.finalizar({}).schemas.Anonimo).toMatchObject({ description: 'Descrição', 'x-teste': true });
  });
});
