/**
 * Manifesto do módulo (`modules/<m>/manifest.ts`): o que o módulo é, de quem depende, para quem
 * aparece, o que sincroniza, que eventos publica/consome e que extensões oferece/usa.
 * O shell e a API leem só o manifesto para montar o módulo (docs/produto/04 "Manifesto").
 */
import { z } from 'zod';
import { ACAO_RE, ehAcaoDePedido, ENTIDADE_SYNC_RE, EVENTO_RE, EXTENSAO_RE, lerNomeEvento, MODULOS, PERFIS } from './nomes';

const ModuloIdSchema = z.enum(MODULOS);
const PerfilSchema = z.enum(PERFIS);
const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'versão no formato semver (ex.: 1.0.0)');
const NomeEventoSchema = z.string().regex(EVENTO_RE, 'evento no formato <modulo>.<entidade>.<fato>@vN');
const SlotSchema = z.string().regex(EXTENSAO_RE, 'extensão no formato <entidade>.<ponto>');
const EntidadeSyncSchema = z.string().regex(ENTIDADE_SYNC_RE, 'entidade de sync em snake_case');
const Rotulo = z.string().trim().min(1);
const NomeAcaoSchema = z.string().regex(ACAO_RE, 'ação no formato <entidade>.<verbo> (ex.: pedido.criar)');

/**
 * Permissão por ação (ADR 0004): quem pode executar cada ação que o módulo expõe na UI e na API.
 * O shell esconde a ação para quem não pode; a API revalida com a mesma declaração (regraDaAcao).
 * Escopo (próprio/equipe/tenant) continua no domain + verificarCarteira (RN-CORE-04).
 */
const AcaoSchema = z
  .object({
    perfis: z.array(PerfilSchema).min(1, 'informe ao menos um perfil').refine((xs) => new Set(xs).size === xs.length, 'perfis repetidos'),
    descricao: z.string().trim().min(1).optional(),
  })
  .strict();

const AppMobileSchema = z.object({ abas: z.array(Rotulo).default([]) }).strict();
const AppWebSchema = z.object({ menus: z.array(Rotulo).default([]) }).strict();

const semRepetidos = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .default([])
    .refine((xs: unknown[]) => new Set(xs).size === xs.length, 'itens repetidos');

export const ManifestoSchema = z
  .object({
    id: ModuloIdSchema,
    versao: SemVer,
    depende: semRepetidos(ModuloIdSchema),
    opcionais: semRepetidos(ModuloIdSchema),
    perfis: semRepetidos(PerfilSchema).refine((p: unknown[]) => p.length > 0, 'informe ao menos um perfil'),
    apps: z
      .object({
        campo: AppMobileSchema.optional(),
        gestao: AppMobileSchema.optional(),
        web: AppWebSchema.optional(),
        conector: z.object({}).strict().optional(),
      })
      .strict()
      .default({}),
    sync: semRepetidos(EntidadeSyncSchema),
    publica: semRepetidos(NomeEventoSchema),
    consome: semRepetidos(NomeEventoSchema),
    ofereceExtensoes: semRepetidos(SlotSchema),
    usaExtensoes: semRepetidos(SlotSchema),
    /** Ações com permissão por perfil (ex.: 'pedido.criar'). Opcional; padrão: nenhuma. */
    acoes: z.record(NomeAcaoSchema, AcaoSchema).default({}),
    /** Versão mínima do app exigida por este módulo (RF: pede atualização só quando o módulo exige). */
    versaoMinimaApp: SemVer.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const erro = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (m.id === 'core' && m.depende.length > 0) erro(['depende'], 'core não depende de nenhum módulo');
    if (m.id !== 'core' && !m.depende.includes('core')) erro(['depende'], 'todo módulo depende de core');
    if (m.depende.includes(m.id) || m.opcionais.includes(m.id)) erro(['depende'], 'módulo não depende de si mesmo');
    if (m.opcionais.includes('core')) erro(['opcionais'], 'core é obrigatório, não opcional');
    for (const o of m.opcionais) if (m.depende.includes(o)) erro(['opcionais'], `${o} está em depende e em opcionais`);
    m.publica.forEach((ev, i) => {
      if (lerNomeEvento(ev)?.modulo !== m.id) erro(['publica', i], `módulo ${m.id} só publica eventos ${m.id}.*`);
    });
    for (const [acao, def] of Object.entries(m.acoes)) {
      // RN-PRO-01 vale pelo perfil (doc 03, esclarecimento de 2026-10-30): nenhum módulo concede ação de pedido ao promotor.
      if (ehAcaoDePedido(acao) && def.perfis.includes('promotor')) erro(['acoes', acao], 'RN-PRO-01: promotor nunca recebe ação de pedido');
    }
    // consumir evento de módulo fora de depende/opcionais é permitido: se o publicador
    // estiver inativo, simplesmente não chegam eventos (desacoplamento por evento).
  });

/** O que o autor escreve em `manifest.ts` (campos com padrão são opcionais). */
export type ManifestoEntrada = z.input<typeof ManifestoSchema>;
/** Manifesto normalizado (padrões preenchidos), congelado. */
export type Manifesto = Readonly<z.output<typeof ManifestoSchema>>;

export class ErroManifesto extends Error {
  constructor(
    readonly modulo: string,
    readonly problemas: string[],
  ) {
    super(`Manifesto inválido (${modulo}): ${problemas.join('; ')}`);
    this.name = 'ErroManifesto';
  }
}

function congelar<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) congelar(v);
    Object.freeze(obj);
  }
  return obj;
}

/** Valida e congela o manifesto. Falha cedo (no import do módulo) se algo estiver fora do padrão. */
export function defineModule(entrada: ManifestoEntrada): Manifesto {
  const r = ManifestoSchema.safeParse(entrada);
  if (!r.success) {
    const id = typeof (entrada as { id?: unknown })?.id === 'string' ? String((entrada as { id: string }).id) : '?';
    throw new ErroManifesto(
      id,
      r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    );
  }
  return congelar(r.data);
}

/**
 * Valida o conjunto de módulos instalados num shell/API: ids únicos, dependências presentes,
 * sem ciclo e extensões usadas oferecidas por alguém. Devolve a lista de problemas (vazia = ok).
 */
export function validarConjunto(manifestos: readonly Manifesto[]): string[] {
  const problemas: string[] = [];
  const porId = new Map<string, Manifesto>();
  for (const m of manifestos) {
    if (porId.has(m.id)) problemas.push(`módulo ${m.id} registrado duas vezes`);
    porId.set(m.id, m);
  }
  for (const m of manifestos) {
    for (const d of m.depende) if (!porId.has(d)) problemas.push(`${m.id} depende de ${d}, que não está instalado`);
  }
  const donoDaAcao = new Map<string, string>();
  for (const m of manifestos) {
    for (const acao of Object.keys(m.acoes)) {
      const dono = donoDaAcao.get(acao);
      if (dono && dono !== m.id) problemas.push(`ação ${acao} declarada por ${dono} e por ${m.id}`);
      donoDaAcao.set(acao, m.id);
    }
  }
  const ofertas = new Set(manifestos.flatMap((m) => m.ofereceExtensoes));
  for (const m of manifestos) {
    for (const s of m.usaExtensoes) if (!ofertas.has(s)) problemas.push(`${m.id} usa a extensão ${s}, que nenhum módulo oferece`);
  }
  try {
    ordenarPorDependencia(manifestos);
  } catch (e) {
    problemas.push((e as Error).message);
  }
  return problemas;
}

/** Ordem de carga: dependências antes (obrigatórias e opcionais presentes). Erro em ciclo. */
export function ordenarPorDependencia<M extends Pick<Manifesto, 'id' | 'depende' | 'opcionais'>>(manifestos: readonly M[]): M[] {
  const porId = new Map(manifestos.map((m) => [m.id, m] as const));
  const estado = new Map<string, 'visitando' | 'feito'>();
  const saida: M[] = [];
  const visitar = (m: M, trilha: string[]) => {
    const st = estado.get(m.id);
    if (st === 'feito') return;
    if (st === 'visitando') throw new Error(`dependência circular entre módulos: ${[...trilha, m.id].join(' → ')}`);
    estado.set(m.id, 'visitando');
    for (const d of [...m.depende, ...m.opcionais]) {
      const dep = porId.get(d);
      if (dep) visitar(dep, [...trilha, m.id]);
    }
    estado.set(m.id, 'feito');
    saida.push(m);
  };
  for (const m of manifestos) visitar(m, []);
  return saida;
}
