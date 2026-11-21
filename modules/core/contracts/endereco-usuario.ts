/**
 * Endereço da casa e base do vendedor/promotor (T-0191; RN-CORE-75; spec docs/design/rotas-criar/spec.md §5 e §8).
 * Aditivo: nenhum contrato existente muda. A casa é do cadastro do usuário; a base é o ponto de partida das rotas (a Casa ou
 * Outro endereço). Nos dois, o ponto é marcado no mapa do BKO (não há geocodificação para a base).
 * Endereço é dado pessoal do trabalhador: nunca vai para log nem para mensagem de erro (só o nome do campo).
 *
 * - `GET  /v1/core/usuarios/:id/endereco` — a casa (`usuario.ver`) → `EnderecoCasaResposta`
 * - `PUT  /v1/core/usuarios/:id/endereco` — grava a casa; `{ endereco: null }` apaga (`usuario.editar`)
 * - `GET  /v1/core/usuarios/:id/base` — a casa e a base resolvida, para o diálogo "Endereço base" (`rota.editar`)
 * - `PUT  /v1/core/usuarios/:id/base` — troca a base (`rota.editar`, auditada, grava `base_alterada_em`)
 * Erros 422: `BASE_SEM_PONTO` (Casa escolhida sem a casa marcada no mapa), `USUARIO_SEM_ENDERECO` (perfil que não é vendedor nem promotor).
 */
import { UFS_BRASIL, normalizarCep } from '@macuxi/comum/endereco';
import { z } from 'zod';

const Texto = (max: number, nome: string) => z.string().trim().min(1, `Informe ${nome}.`).max(max);
const Cep = z
  .string()
  .transform((v) => normalizarCep(v))
  .refine((v) => /^\d{8}$/.test(v), 'CEP com 8 dígitos. Confira o número e tente de novo.');
const Uf = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => (UFS_BRASIL as readonly string[]).includes(v), 'Informe a sigla da UF com 2 letras.');
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

const camposDoEndereco = {
  cep: Cep,
  logradouro: Texto(120, 'a rua'),
  numero: Texto(20, 'o número (ou S/N)'),
  bairro: Texto(80, 'o bairro'),
  cidade: Texto(80, 'a cidade'),
  uf: Uf,
};

/** Endereço com o ponto do mapa: `lat` e `lng` juntos ou os dois nulos. */
export const EnderecoSchema = z
  .object({ ...camposDoEndereco, lat: Lat.nullable(), lng: Lng.nullable() })
  .strict()
  .refine((e) => (e.lat === null) === (e.lng === null), { message: 'Marque o ponto no mapa de novo.', path: ['lat'] });
export type Endereco = z.infer<typeof EnderecoSchema>;

/** Endereço com o ponto marcado (a base sempre tem). */
export const EnderecoComPontoSchema = z.object({ ...camposDoEndereco, lat: Lat, lng: Lng }).strict();
export type EnderecoComPonto = z.infer<typeof EnderecoComPontoSchema>;

export const TIPOS_BASE = ['casa', 'outro'] as const;
export const TipoBaseSchema = z.enum(TIPOS_BASE);
export type TipoBase = z.infer<typeof TipoBaseSchema>;

/** Base resolvida do vendedor (RN-CORE-75): `tipo` e o endereço com o ponto; `null` onde a base é opcional = sem base. */
export const EnderecoBaseSchema = EnderecoComPontoSchema.extend({ tipo: TipoBaseSchema });
export type EnderecoBase = z.infer<typeof EnderecoBaseSchema>;

/**
 * Base na lista de rotas (`GET rotas`): só o tipo (Casa ou Outro endereço) e o ponto do mapa. O endereço completo pode ser a casa
 * (dado pessoal) e só vem em `GET usuarios/:id/base`, com `rota.editar`.
 */
export const BaseNoMapaSchema = z.object({ tipo: TipoBaseSchema, lat: Lat, lng: Lng }).strict();
export type BaseNoMapa = z.infer<typeof BaseNoMapaSchema>;

export const EnderecoCasaRespostaSchema = z.object({ endereco: EnderecoSchema.nullable() });
export type EnderecoCasaResposta = z.infer<typeof EnderecoCasaRespostaSchema>;

export const SalvarEnderecoCasaSchema = z.object({ endereco: EnderecoSchema.nullable() }).strict();
export type SalvarEnderecoCasa = z.infer<typeof SalvarEnderecoCasaSchema>;

/** `PUT usuarios/:id/base`: Casa (usa o ponto do cadastro) ou Outro endereço (com o ponto marcado). */
export const SalvarBaseSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('casa') }).strict(),
  z.object({ tipo: z.literal('outro'), endereco: EnderecoComPontoSchema }).strict(),
]);
export type SalvarBase = z.infer<typeof SalvarBaseSchema>;

export const BaseDoUsuarioRespostaSchema = z.object({ casa: EnderecoSchema.nullable(), base: EnderecoBaseSchema.nullable() });
export type BaseDoUsuarioResposta = z.infer<typeof BaseDoUsuarioRespostaSchema>;
