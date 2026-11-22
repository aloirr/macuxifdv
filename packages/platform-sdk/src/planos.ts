/**
 * Planos e licenças (ADR 0047; desenho docs/desenho/planos-e-licencas.md; recado R-20261114-132600-alexandre, item 1).
 *
 * O catálogo de planos é DADO da plataforma (`plataforma.plano`, seed do banco-dados), nunca código fixo: preço em centavos,
 * licenças por tipo, módulos incluídos, adicionais e as condições comerciais (meses grátis no anual, dias de teste). Aqui ficam
 * só os contratos (Zod) das rotas do portal (`config.`) e as regras puras:
 * - `tipoDeLicencaDoUsuario` (RN-PLA-02): que licença um usuário ocupa, pelos perfis de base;
 * - `contarLicencasEmUso` (RN-PLA-02/03): vendedor, gestor, BKO e promotor; Pesquisa e Treinamento "por usuário" (RN-PLA-03);
 * - `conferirNovoUsuario` (RN-PLA-04): a trava do cadastro de usuários (o modulo-core aplica no BKO; a API sempre revalida);
 * - `conferirTrocaDePlano` (RN-PLA-05) e `valorDaAssinatura` (RN-PLA-06).
 * Nada aqui vai a log: não há dado pessoal.
 */
import { z } from 'zod';
import { MODULOS, MODULOS_SEMPRE, type ModuloId, type Perfil } from './nomes';
import { CriarEmpresaSchema, Dia } from './plataforma';

// ---------- rotas do portal (`/v1/plataforma/*`) ----------
/** `GET` catálogo de planos ativos (super-admin e admin do cliente). */
export const ROTA_PORTAL_PLANOS = '/v1/plataforma/planos';
/** `POST` cria a empresa já com o plano (só super-admin). */
export const ROTA_PORTAL_EMPRESA_COM_PLANO = '/v1/plataforma/empresas-com-plano';
/** `GET` ficha (licenças contratadas e em uso) e `PUT` troca de plano: `/v1/plataforma/empresas/:tenant_id/assinatura`. */
export const rotaPortalAssinatura = (tenantId: string): string => `/v1/plataforma/empresas/${tenantId}/assinatura`;

// ---------- tipos de licença ----------
/** Os quatro tipos de licença contados pelo plano (RN-PLA-02). */
export const TIPOS_LICENCA = ['vendedor', 'gestor', 'bko', 'promotor'] as const;
export type TipoLicenca = (typeof TIPOS_LICENCA)[number];

/** Perfil de base → tipo de licença (RN-PLA-02). Perfil de acesso personalizado conta pela base dele (ADR 0033). */
export const LICENCA_DO_PERFIL: Readonly<Record<Perfil, TipoLicenca>> = Object.freeze({
  vendedor: 'vendedor',
  promotor: 'promotor',
  supervisor: 'gestor',
  gerente: 'gestor',
  analista: 'bko',
  assistente: 'bko',
  admin: 'bko',
});

/**
 * Multiperfil (RN-CORE-35): o usuário ocupa UMA licença só, a do tipo mais alto nesta ordem (RN-PLA-02). Ex.: admin + vendedor
 * ocupa uma de vendedor; supervisor + promotor ocupa uma de gestor.
 */
export const PRIORIDADE_LICENCA: readonly TipoLicenca[] = ['vendedor', 'gestor', 'promotor', 'bko'];

/** Adicionais vendidos à parte (RN-PLA-01): Promotor conta licenças de promotor; Pesquisa e Treinamento contam por usuário. */
export const ADICIONAIS = ['promotor', 'pesquisa', 'treinamento'] as const satisfies readonly ModuloId[];
export type Adicional = (typeof ADICIONAIS)[number];
/** Adicionais cobrados por usuário com o módulo liberado (RN-PLA-03). */
export const ADICIONAIS_POR_USUARIO = ['pesquisa', 'treinamento'] as const satisfies readonly Adicional[];
export type AdicionalPorUsuario = (typeof ADICIONAIS_POR_USUARIO)[number];

/** O que é contado e travado: os 4 tipos de licença e os 2 adicionais por usuário. */
export const ITENS_CONTADOS = [...TIPOS_LICENCA, ...ADICIONAIS_POR_USUARIO] as const;
export type ItemContado = (typeof ITENS_CONTADOS)[number];

export const CICLOS = ['mensal', 'anual'] as const;
export type Ciclo = (typeof CICLOS)[number];

const Uuid = z.string().uuid();
const Instante = z.string().datetime({ offset: true });
const Centavos = z.number().int().min(0);
/** Quantidade contratada; `null` = sem limite. */
const Quantidade = z.number().int().min(0).nullable();
const ModuloIdZ = z.enum(MODULOS);
const CodigoPlano = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Código do plano: letras minúsculas, dígitos ou _.');

// ---------- catálogo (dado da plataforma) ----------
/** Preço de um adicional neste plano (RN-PLA-01). Adicional fora da lista = o plano não vende. */
export const AdicionalDoPlanoSchema = z.object({
  adicional: z.enum(ADICIONAIS),
  /** Preço por licença (Promotor) ou por usuário liberado (Pesquisa, Treinamento), por mês. */
  preco_unitario_centavos: Centavos,
  /** Já incluído no plano, sem cobrança, até esta quantidade (`null` = ilimitado incluso; 0 = nada incluso). */
  incluidos: Quantidade.default(0),
});
export type AdicionalDoPlano = z.output<typeof AdicionalDoPlanoSchema>;

/** Um plano do catálogo (`plataforma.plano`). Todo valor comercial vem daqui, nunca de constante no código. */
export const PlanoSchema = z.object({
  id: Uuid,
  codigo: CodigoPlano,
  nome: z.string().min(1).max(60),
  /** Ordem de exibição (e de "subir de plano"). */
  ordem: z.number().int().min(0),
  preco_mensal_centavos: Centavos,
  /** Licenças incluídas por tipo (RN-PLA-01); `null` = sem limite. */
  licencas: z.object({ vendedor: Quantidade, gestor: Quantidade, bko: Quantidade, promotor: Quantidade }),
  /** Módulos do plano (core e integracao sempre entram, mesmo fora da lista; RN-CORE-31). */
  modulos: z.array(ModuloIdZ),
  adicionais: z.array(AdicionalDoPlanoSchema),
  /** Condições (RN-PLA-06): no anual, paga-se 12 − `meses_gratis_anual` meses. */
  meses_gratis_anual: z.number().int().min(0).max(11),
  /** Dias de teste grátis na criação (0 = sem teste). */
  dias_teste: z.number().int().min(0).max(90),
  ativo: z.boolean(),
});
export type Plano = z.output<typeof PlanoSchema>;
export const ListaPlanosSchema = z.object({ itens: z.array(PlanoSchema) });

// ---------- assinatura da empresa ----------
/** Adicional contratado: quantidade de licenças (Promotor) ou de usuários liberados (Pesquisa, Treinamento). */
export const AdicionalContratadoSchema = z.object({ adicional: z.enum(ADICIONAIS), quantidade: z.number().int().min(1).max(100_000) });
export type AdicionalContratado = z.output<typeof AdicionalContratadoSchema>;

const ListaAdicionais = z
  .array(AdicionalContratadoSchema)
  .max(ADICIONAIS.length)
  .refine((l) => new Set(l.map((a) => a.adicional)).size === l.length, 'Adicional repetido.');

/** O que o portal escolhe: plano (pelo código), ciclo e adicionais. */
export const EscolhaDePlanoSchema = z
  .object({
    plano: CodigoPlano,
    ciclo: z.enum(CICLOS).default('mensal'),
    adicionais: ListaAdicionais.default([]),
  })
  .strict();
export type EscolhaDePlano = z.output<typeof EscolhaDePlanoSchema>;

/**
 * Escolha na criação da empresa: `com_teste` = começa no teste grátis do plano (padrão), sem cobrança até `teste_ate`.
 * `pedido_id` = chave de idempotência gerada no portal (a `sa_gravar_assinatura` grava uma vez só por tenant).
 */
export const EscolhaNaCriacaoSchema = EscolhaDePlanoSchema.extend({ com_teste: z.boolean().default(true), pedido_id: Uuid }).strict();
export type EscolhaNaCriacao = z.output<typeof EscolhaNaCriacaoSchema>;

/**
 * Corpo de `POST /v1/plataforma/empresas-com-plano` (só super-admin): o passo Empresa (`CriarEmpresaSchema`) sem `modulos`, que
 * saem do plano (`modulosDaAssinatura`), mais a `assinatura`. O resto (admin inicial, parâmetros, `simular`) é igual.
 */
export const CriarEmpresaComPlanoSchema = CriarEmpresaSchema.omit({ modulos: true }).extend({ assinatura: EscolhaNaCriacaoSchema });
export type CriarEmpresaComPlano = z.output<typeof CriarEmpresaComPlanoSchema>;

/** `PUT /v1/plataforma/empresas/:tenant_id/assinatura` (só super-admin): troca de plano, ciclo ou adicionais (RN-PLA-05). */
export const TrocarPlanoSchema = EscolhaDePlanoSchema.extend({
  /** Chave de idempotência gerada no portal (repetir = mesma resposta, nada muda). */
  pedido_id: Uuid,
}).strict();
export type TrocarPlano = z.output<typeof TrocarPlanoSchema>;

/** Contagem de um item: contratadas (`null` = sem limite) e em uso agora. */
export const UsoDeLicencaSchema = z.object({ item: z.enum(ITENS_CONTADOS), contratadas: Quantidade, em_uso: z.number().int().min(0) });
export type UsoDeLicenca = z.output<typeof UsoDeLicencaSchema>;

/** Valor da assinatura (RN-PLA-06), calculado pela API com `valorDaAssinatura`. */
export const ValorAssinaturaSchema = z.object({
  mensal_centavos: Centavos,
  /** O que se paga por ciclo: o mensal no mensal; 12 − meses grátis vezes o mensal no anual. */
  por_ciclo_centavos: Centavos,
  ciclo: z.enum(CICLOS),
});
export type ValorAssinatura = z.output<typeof ValorAssinaturaSchema>;

/** `GET /v1/plataforma/empresas/:tenant_id/assinatura`: a ficha da empresa (super-admin; admin do cliente só a própria). */
export const FichaAssinaturaSchema = z.object({
  tenant_id: Uuid,
  plano: PlanoSchema,
  ciclo: z.enum(CICLOS),
  adicionais: z.array(AdicionalContratadoSchema),
  /** Fim do teste grátis (dia civil no fuso do tenant, inclusive); `null` = sem teste. */
  teste_ate: Dia.nullable(),
  /** Pago = o teste terminou com contratação (ou começou sem teste). */
  paga: z.boolean(),
  /** Os 6 itens contados, sempre na ordem de `ITENS_CONTADOS`. */
  licencas: z.array(UsoDeLicencaSchema).length(ITENS_CONTADOS.length),
  valor: ValorAssinaturaSchema,
  desde: Instante,
  atualizada_em: Instante,
});
export type FichaAssinatura = z.output<typeof FichaAssinaturaSchema>;

export const CriarEmpresaComPlanoRespostaSchema = z.object({
  tenant_id: Uuid.nullable(),
  codigo: z.string(),
  resultado: z.enum(['criado', 'atualizado', 'sem_mudanca']),
  /** A assinatura foi gravada agora, já existia (idempotente pelo código), ou não foi gravada (`simular`). */
  assinatura: z.enum(['criada', 'existente', 'simulada']),
  teste_ate: Dia.nullable(),
  valor: ValorAssinaturaSchema,
  avisos: z.array(z.string()),
  admin: z.enum(['criado', 'existente']).nullable(),
  simulado: z.boolean(),
});
export type CriarEmpresaComPlanoResposta = z.output<typeof CriarEmpresaComPlanoRespostaSchema>;

// ---------- regras puras ----------
/** RN-PLA-02: tipo de licença ocupado por quem tem estes perfis de base; sem perfil = nenhuma (`null`). */
export function tipoDeLicencaDoUsuario(bases: readonly Perfil[]): TipoLicenca | null {
  const tipos = new Set(bases.map((b) => LICENCA_DO_PERFIL[b]));
  return PRIORIDADE_LICENCA.find((t) => tipos.has(t)) ?? null;
}

/** Usuário como a contagem o vê (sem nome nem e-mail). */
export interface UsuarioParaLicenca {
  /** RN-PLA-02: inativo ou excluído não ocupa licença (bloqueado por senha continua ocupando). */
  ativo: boolean;
  /** Perfis de base dos perfis de acesso vivos e ativos dele. */
  bases: readonly Perfil[];
  /** Módulos efetivos dele (perfis − exceções, RN-CORE-01), para Pesquisa e Treinamento (RN-PLA-03). */
  modulos: readonly ModuloId[];
}

/** RN-PLA-02/03: em uso por item. Pesquisa/Treinamento: usuário ativo com o módulo liberado (efetivo), de qualquer tipo. */
export function contarLicencasEmUso(usuarios: readonly UsuarioParaLicenca[]): Record<ItemContado, number> {
  const uso = Object.fromEntries(ITENS_CONTADOS.map((i) => [i, 0])) as Record<ItemContado, number>;
  for (const u of usuarios) {
    if (!u.ativo) continue;
    const tipo = tipoDeLicencaDoUsuario(u.bases);
    if (tipo) uso[tipo] += 1;
    for (const a of ADICIONAIS_POR_USUARIO) if (u.modulos.includes(a)) uso[a] += 1;
  }
  return uso;
}

/**
 * RN-PLA-01: licenças contratadas por item = as do plano + as do adicional. Promotor: plano + adicional `promotor`. Pesquisa e
 * Treinamento: incluídos no plano + adicional; plano sem o adicional no catálogo e sem o módulo = 0; com o módulo = sem limite.
 */
export function licencasContratadas(plano: Plano, adicionais: readonly AdicionalContratado[]): Record<ItemContado, number | null> {
  const qtd = (a: Adicional): number => adicionais.find((x) => x.adicional === a)?.quantidade ?? 0;
  const soma = (base: number | null, extra: number): number | null => (base === null ? null : base + extra);
  const incluidos = (a: AdicionalPorUsuario): number | null => {
    const doPlano = plano.adicionais.find((x) => x.adicional === a);
    if (doPlano) return doPlano.incluidos;
    return plano.modulos.includes(a) ? null : 0;
  };
  return {
    vendedor: plano.licencas.vendedor,
    gestor: plano.licencas.gestor,
    bko: plano.licencas.bko,
    promotor: soma(plano.licencas.promotor, qtd('promotor')),
    pesquisa: soma(incluidos('pesquisa'), qtd('pesquisa')),
    treinamento: soma(incluidos('treinamento'), qtd('treinamento')),
  };
}

/** Módulos que a assinatura liga no tenant: core e integracao sempre, os do plano e os adicionais contratados (RN-PLA-01). */
export function modulosDaAssinatura(plano: Plano, adicionais: readonly AdicionalContratado[]): ModuloId[] {
  const ligados = new Set<ModuloId>([...MODULOS_SEMPRE, ...plano.modulos, ...adicionais.map((a) => a.adicional)]);
  return MODULOS.filter((m) => ligados.has(m));
}

/** Por que a escolha não vale (o portal mostra a `mensagem`; o `codigo` vai no 422). */
export interface ProblemaDePlano {
  codigo: 'PLANO_INATIVO' | 'ADICIONAL_FORA_DO_PLANO' | 'PLANO_ABAIXO_DO_USO';
  mensagem: string;
  item?: ItemContado;
}

/**
 * Rótulo de cada item contado (plural), usado nas mensagens do SDK (RN-PLA-01, RN-PLA-04 e RN-PLA-05). Pesquisa e
 * Treinamento são o nome do adicional (contam usuários com o módulo).
 */
const ROTULO_ITEM: Readonly<Record<ItemContado, string>> = Object.freeze({
  vendedor: 'Vendedores',
  gestor: 'Gestores',
  bko: 'BKO',
  promotor: 'Promotores',
  pesquisa: 'Pesquisa',
  treinamento: 'Treinamento',
});

/** RN-PLA-01: o plano está ativo e vende cada adicional pedido. Vale na criação e na troca. */
export function conferirEscolhaDePlano(plano: Plano, adicionais: readonly AdicionalContratado[]): ProblemaDePlano[] {
  const problemas: ProblemaDePlano[] = [];
  if (!plano.ativo) problemas.push({ codigo: 'PLANO_INATIVO', mensagem: `O plano ${plano.nome} não está mais à venda.` });
  for (const a of adicionais) {
    if (!plano.adicionais.some((x) => x.adicional === a.adicional))
      problemas.push({ codigo: 'ADICIONAL_FORA_DO_PLANO', mensagem: `O plano ${plano.nome} não tem o adicional ${ROTULO_ITEM[a.adicional]}.`, item: a.adicional });
  }
  return problemas;
}

/**
 * RN-PLA-05: troca de plano (para cima ou para baixo) só se o novo cobre o que está em uso, item a item. Abaixo do uso, a
 * troca é recusada: primeiro inativa os usuários ou tira o módulo deles. A troca nunca desativa usuário sozinha.
 * Mensagem: `<Rótulo>: <em uso> em uso. Inative <excesso> antes de trocar.` (ex.: "Vendedores: 14 em uso. Inative 4 antes de
 * trocar."; mesmo formato para Pesquisa e Treinamento).
 */
export function conferirTrocaDePlano(
  novo: Plano,
  adicionais: readonly AdicionalContratado[],
  emUso: Readonly<Record<ItemContado, number>>,
): ProblemaDePlano[] {
  const problemas = conferirEscolhaDePlano(novo, adicionais);
  const contratadas = licencasContratadas(novo, adicionais);
  for (const item of ITENS_CONTADOS) {
    const limite = contratadas[item];
    if (limite !== null && emUso[item] > limite)
      problemas.push({
        codigo: 'PLANO_ABAIXO_DO_USO',
        item,
        mensagem: `${ROTULO_ITEM[item]}: ${emUso[item]} em uso. Inative ${emUso[item] - limite} antes de trocar.`,
      });
  }
  return problemas;
}

/** Resultado da trava (RN-PLA-04). */
export type ResultadoTrava =
  | { pode: true }
  | { pode: false; codigo: 'LICENCAS_ESGOTADAS' | 'TESTE_VENCIDO'; item?: ItemContado; mensagem: string };

/** Situação do tenant que a trava lê (a função `plataforma.licencas_do_tenant()` devolve; ADR 0047 §5). */
export interface SituacaoDeLicencas {
  /** `null` = empresa sem assinatura (legado anterior aos planos): a trava não se aplica (RN-PLA-04). */
  contratadas: Readonly<Record<ItemContado, number | null>> | null;
  emUso: Readonly<Record<ItemContado, number>>;
  /** Último dia do teste (AAAA-MM-DD, fuso do tenant); `null` = sem teste. */
  testeAte: string | null;
  /** Assinatura paga (o teste terminou com contratação, ou começou sem teste). */
  paga: boolean;
}

/**
 * RN-PLA-04 — a trava do cadastro de usuários: dá para criar (ou reativar, ou dar perfil/módulo a) um usuário que vai ocupar
 * `novo`? `hoje` = dia civil no fuso do tenant (AAAA-MM-DD).
 * Na edição, quem chama passa em `novo` só o que o usuário ainda NÃO ocupa (ex.: liberar Pesquisa a um vendedor = `bases` vazio
 * e `modulos: ['pesquisa']`); o que ele já ocupa já está em `emUso`.
 * - empresa sem assinatura: pode (legado; a trava começa quando o plano é gravado);
 * - teste vencido sem pagamento: não pode (`TESTE_VENCIDO`);
 * - item sem vaga: não pode (`LICENCAS_ESGOTADAS`, com o item).
 */
export function conferirNovoUsuario(
  situacao: SituacaoDeLicencas,
  novo: { bases: readonly Perfil[]; modulos: readonly ModuloId[] },
  hoje: string,
): ResultadoTrava {
  if (!situacao.contratadas) return { pode: true };
  if (!situacao.paga && situacao.testeAte !== null && hoje > situacao.testeAte)
    return { pode: false, codigo: 'TESTE_VENCIDO', mensagem: 'O teste grátis terminou. Contrate o plano para cadastrar usuários.' };
  const itens: ItemContado[] = [];
  const tipo = tipoDeLicencaDoUsuario(novo.bases);
  if (tipo) itens.push(tipo);
  for (const a of ADICIONAIS_POR_USUARIO) if (novo.modulos.includes(a)) itens.push(a);
  for (const item of itens) {
    const limite = situacao.contratadas[item];
    if (limite !== null && situacao.emUso[item] + 1 > limite)
      return {
        pode: false,
        codigo: 'LICENCAS_ESGOTADAS',
        item,
        mensagem: `${ROTULO_ITEM[item]}: ${limite} em uso, o limite do plano. Inative um usuário ou troque de plano.`,
      };
  }
  return { pode: true };
}

/** RN-PLA-06: valor mensal (plano + adicionais contratados) e por ciclo (anual = (12 − meses grátis) vezes o mensal). */
export function valorDaAssinatura(plano: Plano, adicionais: readonly AdicionalContratado[], ciclo: Ciclo): ValorAssinatura {
  let mensal = plano.preco_mensal_centavos;
  for (const a of adicionais) {
    const doPlano = plano.adicionais.find((x) => x.adicional === a.adicional);
    if (doPlano) mensal += a.quantidade * doPlano.preco_unitario_centavos;
  }
  const porCiclo = ciclo === 'anual' ? mensal * (12 - plano.meses_gratis_anual) : mensal;
  return { mensal_centavos: mensal, por_ciclo_centavos: porCiclo, ciclo };
}

/** RN-PLA-06: último dia do teste a partir de `hoje` (AAAA-MM-DD no fuso do tenant) = hoje + dias − 1; 0 dias = sem teste. */
export function fimDoTeste(hoje: string, dias: number): string | null {
  if (dias <= 0) return null;
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias - 1);
  return d.toISOString().slice(0, 10);
}

/** Linhas por item (`plataforma.licencas_do_tenant()`) → registros; item ausente = sem limite e 0 em uso. */
export function usoPorItem(linhas: readonly UsoDeLicenca[]): { contratadas: Record<ItemContado, number | null>; emUso: Record<ItemContado, number> } {
  const contratadas = Object.fromEntries(ITENS_CONTADOS.map((i) => [i, null])) as Record<ItemContado, number | null>;
  const emUso = Object.fromEntries(ITENS_CONTADOS.map((i) => [i, 0])) as Record<ItemContado, number>;
  for (const l of linhas) {
    contratadas[l.item] = l.contratadas;
    emUso[l.item] = l.em_uso;
  }
  return { contratadas, emUso };
}
