/**
 * T-0181 (desenho docs/desenho/T-0181.md; spec docs/design/carga-aviso-frases/): frases da tela de carga (Campo e Gestão).
 * Cadastro da plataforma (vale para todos os tenants, sem `tenant_id`), mantido só pelo super-admin no portal `config.`;
 * o app recebe as ativas no sync e sorteia uma por carga, offline.
 *   GET   /v1/plataforma/frases-carga        lista do portal (ativas primeiro pelo Nº, inativas no fim)
 *   POST  /v1/plataforma/frases-carga        inclui (nasce ativa; Nº e ordem = o próximo)
 *   PATCH /v1/plataforma/frases-carga/:id    texto e/ou ativa (sem DELETE: desativar basta)
 *   GET   /v1/sync/frases-carga              o app: só as ativas e vivas `{ id, texto, ordem }`, pela ordem
 * A fonte de cada frase (spec §6) NÃO faz parte do contrato: nunca vai ao app nem à tela.
 *
 * IDS DAS 30 INICIAIS (fonte da fórmula; o desenho e o docs/banco apontam para cá):
 *   id do Nº n = plataforma.uuid_de_chave('plataforma:frase_carga:' || lpad(n::text, 2, '0')) (função da migração 0005).
 *   O teste `frase-carga.test.ts` recalcula os 30 ids de `INICIAIS` pela mesma fórmula.
 */
import { z } from 'zod';

export const ROTA_PORTAL_FRASES_CARGA = '/v1/plataforma/frases-carga';
export const ROTA_SYNC_FRASES_CARGA = '/v1/sync/frases-carga';

/** Máximo de caracteres da frase, depois do trim (contados por ponto de código, como o `char_length` do Postgres). */
export const FRASE_CARGA_MAX = 90;
/** Teto do texto cru (antes do trim) no corpo: acima disso nem chega à regra de negócio (400). */
const TEXTO_CRU_MAX = 1000;

export const CODIGOS_FRASE_CARGA = {
  vazia: 'FRASE_VAZIA',
  longa: 'FRASE_LONGA',
  duplicada: 'FRASE_DUPLICADA',
} as const;
export type CodigoFraseCarga = (typeof CODIGOS_FRASE_CARGA)[keyof typeof CODIGOS_FRASE_CARGA];

/** Textos dos erros (spec §3: na linha do campo). */
export const MENSAGENS_FRASE_CARGA: Readonly<Record<CodigoFraseCarga, string>> = {
  FRASE_VAZIA: 'Escreva a frase.',
  FRASE_LONGA: `Use até ${FRASE_CARGA_MAX} caracteres.`,
  FRASE_DUPLICADA: 'Essa frase já está na lista.',
};

/** Caracteres como o Postgres conta (ponto de código). */
export const tamanhoFrase = (texto: string): number => Array.from(texto).length;

/** Chave de duplicidade, a mesma do índice único do banco: `lower(btrim(texto))`. */
export const chaveFraseCarga = (texto: string): string => texto.trim().toLowerCase();

const Id = z.string().uuid();
const TextoFrase = z
  .string()
  .trim()
  .min(1)
  .refine((t) => tamanhoFrase(t) <= FRASE_CARGA_MAX, { message: `máximo de ${FRASE_CARGA_MAX} caracteres` });

/** Uma frase como o portal vê (retorno das `sa_*`). */
export const FraseCargaSchema = z.object({
  id: Id,
  numero: z.number().int().positive(),
  texto: TextoFrase,
  ativa: z.boolean(),
  ordem: z.number().int(),
});
export type FraseCarga = z.infer<typeof FraseCargaSchema>;

export const FrasesCargaListaSchema = z.object({ itens: z.array(FraseCargaSchema) });
export type FrasesCargaLista = z.infer<typeof FrasesCargaListaSchema>;

/**
 * Corpo do `POST`. O texto chega cru: a regra (`validarTextoFrase`) responde 422 com a frase da tela.
 * `id` opcional, gerado no cliente para o reenvio ser idempotente; sem ele, a API gera.
 */
export const FraseCargaEntradaSchema = z.object({ id: Id.optional(), texto: z.string().max(TEXTO_CRU_MAX) }).strict();
export type FraseCargaEntrada = z.infer<typeof FraseCargaEntradaSchema>;

/** Corpo do `PATCH`: texto e/ou ativa (pelo menos um). */
export const FraseCargaAlteracaoSchema = z
  .object({ texto: z.string().max(TEXTO_CRU_MAX).optional(), ativa: z.boolean().optional() })
  .strict()
  .refine((a) => a.texto !== undefined || a.ativa !== undefined, { message: 'informe texto ou ativa' });
export type FraseCargaAlteracao = z.infer<typeof FraseCargaAlteracaoSchema>;

/** O que o app recebe (só as ativas e vivas). */
export const FraseCargaAppSchema = z.object({ id: Id, texto: TextoFrase, ordem: z.number().int() });
export type FraseCargaApp = z.infer<typeof FraseCargaAppSchema>;

export const FrasesCargaAppRespostaSchema = z.object({ frases: z.array(FraseCargaAppSchema) });
export type FrasesCargaAppResposta = z.infer<typeof FrasesCargaAppRespostaSchema>;

export type ResultadoTextoFrase = { ok: true; texto: string } | { ok: false; codigo: CodigoFraseCarga; mensagem: string };

/**
 * Regra do texto (spec §3), mensagens de `MENSAGENS_FRASE_CARGA`: trim; vazio; acima de `FRASE_CARGA_MAX`; igual a outra frase
 * da lista sem diferenciar maiúsculas (na edição, a própria não conta). O portal usa no formulário; a API revalida; na
 * duplicidade a palavra final é do índice único do banco.
 */
export function validarTextoFrase(
  texto: string,
  existentes: readonly { id: string; texto: string }[] = [],
  idProprio?: string,
): ResultadoTextoFrase {
  const limpo = texto.trim();
  const erro = (codigo: CodigoFraseCarga): ResultadoTextoFrase => ({ ok: false, codigo, mensagem: MENSAGENS_FRASE_CARGA[codigo] });
  if (limpo === '') return erro(CODIGOS_FRASE_CARGA.vazia);
  if (tamanhoFrase(limpo) > FRASE_CARGA_MAX) return erro(CODIGOS_FRASE_CARGA.longa);
  const chave = chaveFraseCarga(limpo);
  if (existentes.some((f) => f.id !== idProprio && chaveFraseCarga(f.texto) === chave)) return erro(CODIGOS_FRASE_CARGA.duplicada);
  return { ok: true, texto: limpo };
}

/** Ordem da tabela do portal (spec §3): ativas primeiro pelo Nº, inativas no fim (também pelo Nº). */
export function ordenarFrasesDoPortal<T extends Pick<FraseCarga, 'numero' | 'ativa'>>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.numero - b.numero);
}

/** Nº, id e texto das 30 iniciais (`frases.md`; R-20261115-071500 e R-20261115-075500): todas ativas, ordem = Nº. */
const INICIAIS: readonly (readonly [number, string, string])[] = [
  [1, '30db8593-800a-56dc-98dc-b8976806ace5', 'Os Macuxi se autodenominam Pemon e falam uma língua da família Karib.'],
  [2, 'a5d75b28-c383-5a66-b326-a704cf484336', 'O território Macuxi vai do lavrado, ao sul, às serras com floresta, ao norte.'],
  [3, 'd73af633-73ce-53b2-bcb5-562e1f6de8b7', 'Em 2020, o povo Macuxi somava 37.250 pessoas em Roraima.'],
  [4, 'c8195bdd-b434-5850-bbbf-50f243dcd52d', 'Os Macuxi chamam de tuma a damurida, caldo de pimenta com peixe ou carne.'],
  [5, '2c55f13b-9cd0-5599-83bc-73c2250c98a0', 'A Raposa Serra do Sol, terra dos Macuxi e vizinhos, foi homologada em 2005.'],
  [6, '81c93f34-9498-5342-85f6-f501e44c2b97', 'Em Bonfim, a Lei 211/2014 tornou cooficiais as línguas Macuxi e Wapichana.'],
  [7, 'a4dacccc-278c-533a-8dc2-3cbf26730011', 'A pintora Macuxi Carmézia Emiliano nasceu na Maloca do Japó.'],
  [8, 'd69b7df4-03f4-58a9-8efd-deebe12ad1aa', 'O artista Macuxi Jaider Esbell ilustrou Do Roraima ao Orinoco em português.'],
  [9, '0f487e68-9c50-5c63-9ec3-36d1a75d4ecd', 'Com 2.734,9 m, o Monte Roraima é o 7º ponto mais alto do Brasil.'],
  [10, '85c9ac09-8237-578b-96aa-dc04ce9ffa88', 'O Monte Roraima fica na fronteira do Brasil com a Venezuela e a Guiana.'],
  [11, '17a3aaf7-52f1-5301-b09c-3732667cf4b5', 'O Parque Nacional do Monte Roraima foi criado em 28 de junho de 1989.'],
  [12, '3898c988-4b4b-5bcf-b3e2-6ac2e61b30a5', 'As rochas que formam o Monte Roraima têm até 1,95 bilhão de anos.'],
  [13, 'bff9e2e8-d821-57b4-96d0-08d1da1fc203', 'Um mapa de 1654 chama o Monte Roraima de "montanha de cristais".'],
  [14, 'f26c7cf2-3b6c-5796-bd6b-15403e5fea83', 'Um relato de 1885 sobre o Monte Roraima influenciou O Mundo Perdido.'],
  [15, 'd0e0d95f-fb46-59d8-a65a-c8447ddc27cb', 'Em 2019, ICMBio e Ingarikó catalogaram novas espécies no parque do monte.'],
  [16, '7fb1341a-1937-5b2a-98a9-ed9bbe8f6df0', 'Ingarikó e Pemon formam um só mundo cultural em torno do Monte Roraima.'],
  [17, '12022c43-56fa-5b0e-8b0a-2b3517af0f28', 'Makunaimã, das narrativas Macuxi e Pemon, inspirou Mário de Andrade.'],
  [18, '71ce6a1b-325a-569d-8169-6a067a50cd15', 'Segundo a tradição Macuxi, Makunaimã e Enxikirang são irmãos, filhos do Sol.'],
  [19, '1ebf0175-82f5-5d4f-9d53-74a521b6ca82', 'Segundo a tradição Macuxi, o Monte Roraima é o tronco da árvore Wazacá.'],
  [20, '7434b90d-3abd-520b-bbe4-7370d1846769', 'Segundo a tradição Taurepang, Makunaimã fez gente e bichos de barro.'],
  [21, 'cc6b19c8-752b-5f4b-a4e7-89307b37942c', 'Segundo a tradição Ingarikó, o povo descende de Siikë, irmão de Makunaimã.'],
  [22, 'f4b0a58f-b18c-5330-be82-7ca5e2aa022f', 'Segundo a tradição Ingarikó, as plantas cultivadas vêm das sementes da Wayaka.'],
  [23, '90dedfe0-ed96-55ed-9fcf-be9260367fa7', 'Entre 1911 e 1913, Koch-Grünberg registrou narrativas de Makunaimã.'],
  [24, 'ff10980f-96ad-53b8-ac6d-ebc74a583286', 'A peça Makunaimã (2019) reúne autores Macuxi, Taurepang e Wapichana.'],
  [25, 'c6c3a979-6d9e-5f3d-bef2-8c0e04dbfac4', 'O Forte São Joaquim, de 1775, é o único bem tombado pelo Iphan em Roraima.'],
  [26, 'f69b4e0d-5249-5436-82c8-4d887d903d02', 'Na Pedra Pintada, em Pacaraima, há marcas humanas de cerca de 4.000 anos.'],
  [27, '90e05758-9ca2-5a63-8ca9-b7f038079099', 'Roraima nasceu em 1943 como Território do Rio Branco; o nome veio em 1962.'],
  [28, '6855bea6-8235-5d8c-b559-06418aff3141', 'O lavrado, a savana de Roraima, cobre cerca de 17% do estado.'],
  [29, '3f00af70-d164-566f-b759-1af584799fbc', 'O ponto mais ao norte do Brasil é a nascente do rio Ailã, em Uiramutã.'],
  [30, '97cdaffc-0cf1-5002-b7bb-703b0dbfe537', 'Uiramutã tem a maior proporção de indígenas do Brasil: 96,6% em 2022.'],
];

/** As 30 frases iniciais (bundle do app antes do 1º sync e conferência do seed). */
export const FRASES_CARGA_INICIAIS: readonly FraseCarga[] = INICIAIS.map(([numero, id, texto]) => ({ id, numero, texto, ativa: true, ordem: numero }));
