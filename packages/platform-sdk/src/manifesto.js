/**
 * Manifesto do módulo (`modules/<m>/manifest.ts`): o que o módulo é, de quem depende, para quem
 * aparece, o que sincroniza, que eventos publica/consome e que extensões oferece/usa.
 * O shell e a API leem só o manifesto para montar o módulo (docs/produto/04 "Manifesto").
 */
import { z } from 'zod';
import { ACAO_RE, CONSULTA_RE, ehAcaoDeEscritaDePedido, ENTIDADE_SYNC_RE, EVENTO_RE, EXTENSAO_RE, lerNomeConsulta, lerNomeEvento, MODULOS, PERFIS, } from './nomes';
import { ehChavePlataforma } from './permissoes-perfil';
const ModuloIdSchema = z.enum(MODULOS);
const PerfilSchema = z.enum(PERFIS);
const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'versão no formato semver (ex.: 1.0.0)');
const NomeEventoSchema = z.string().regex(EVENTO_RE, 'evento no formato <modulo>.<entidade>.<fato>@vN');
const SlotSchema = z.string().regex(EXTENSAO_RE, 'extensão no formato <entidade>.<ponto>');
const EntidadeSyncSchema = z.string().regex(ENTIDADE_SYNC_RE, 'entidade de sync em snake_case');
const Rotulo = z.string().trim().min(1);
const NomeAcaoSchema = z.string().regex(ACAO_RE, 'ação no formato <entidade>.<verbo> (ex.: pedido.criar)');
const NomeConsultaSchema = z.string().regex(CONSULTA_RE, 'consulta no formato <modulo>.<consulta>@vN (ex.: catalogo.precos_cliente@1)');
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
const semRepetidos = (item) => z
    .array(item)
    .default([])
    .refine((xs) => new Set(xs).size === xs.length, 'itens repetidos');
export const ManifestoSchema = z
    .object({
    id: ModuloIdSchema,
    versao: SemVer,
    depende: semRepetidos(ModuloIdSchema),
    opcionais: semRepetidos(ModuloIdSchema),
    perfis: semRepetidos(PerfilSchema).refine((p) => p.length > 0, 'informe ao menos um perfil'),
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
    /**
     * Consultas entre módulos (ADR 0012): leitura síncrona com contrato `<modulo>.<consulta>@vN` no `contracts` do dono.
     * `ofereceConsultas`: só `<este módulo>.*`, cada uma implementada em `ModuloApi.consultas` (API) e, se valer no
     * aparelho, em `ModuloShell.consultas`. `usaConsultas`: só de módulos em `depende` ou `opcionais`.
     */
    ofereceConsultas: semRepetidos(NomeConsultaSchema),
    usaConsultas: semRepetidos(NomeConsultaSchema),
    /**
     * ADR 0019: consultas OPCIONAIS, sem aresta de ordenação. O dono NÃO entra em `depende`/`opcionais` (não pesa em
     * `ordenarPorDependencia`, então não fecha ciclo, ex.: core → vendedor → core) e pode nem estar instalado. Dono
     * ausente, inativo para o usuário/tenant ou sem implementação no canal → `ConsultaIndisponivel` (o consumidor trata e
     * cai num plano B). Dono instalado que não oferece a consulta = a montagem recusa, como em `usaConsultas`.
     */
    usaConsultasOpcionais: semRepetidos(NomeConsultaSchema),
    /** Ações com permissão por perfil (ex.: 'pedido.criar'). Opcional; padrão: nenhuma. */
    acoes: z.record(NomeAcaoSchema, AcaoSchema).default({}),
    /** Versão mínima do app exigida por este módulo (RF: pede atualização só quando o módulo exige). */
    versaoMinimaApp: SemVer.optional(),
})
    .strict()
    .superRefine((m, ctx) => {
    const erro = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (m.id === 'core' && m.depende.length > 0)
        erro(['depende'], 'core não depende de nenhum módulo');
    if (m.id !== 'core' && !m.depende.includes('core'))
        erro(['depende'], 'todo módulo depende de core');
    if (m.depende.includes(m.id) || m.opcionais.includes(m.id))
        erro(['depende'], 'módulo não depende de si mesmo');
    if (m.opcionais.includes('core'))
        erro(['opcionais'], 'core é obrigatório, não opcional');
    for (const o of m.opcionais)
        if (m.depende.includes(o))
            erro(['opcionais'], `${o} está em depende e em opcionais`);
    m.publica.forEach((ev, i) => {
        if (lerNomeEvento(ev)?.modulo !== m.id)
            erro(['publica', i], `módulo ${m.id} só publica eventos ${m.id}.*`);
    });
    m.ofereceConsultas.forEach((c, i) => {
        if (lerNomeConsulta(c)?.modulo !== m.id)
            erro(['ofereceConsultas', i], `módulo ${m.id} só oferece consultas ${m.id}.*`);
    });
    m.usaConsultas.forEach((c, i) => {
        const dono = lerNomeConsulta(c)?.modulo;
        if (dono === m.id)
            erro(['usaConsultas', i], `${c} é do próprio módulo (consulta é entre módulos)`);
        else if (!dono || (!m.depende.includes(dono) && !m.opcionais.includes(dono)))
            erro(['usaConsultas', i], `${c}: o módulo ${dono ?? '?'} precisa estar em depende ou opcionais (ADR 0012); sem aresta de dependência, use usaConsultasOpcionais (ADR 0019)`);
    });
    m.usaConsultasOpcionais.forEach((c, i) => {
        const dono = lerNomeConsulta(c)?.modulo;
        if (dono === m.id)
            erro(['usaConsultasOpcionais', i], `${c} é do próprio módulo (consulta é entre módulos)`);
        else if (m.usaConsultas.includes(c))
            erro(['usaConsultasOpcionais', i], `${c} está em usaConsultas e em usaConsultasOpcionais`);
        else if (dono && m.depende.includes(dono))
            erro(['usaConsultasOpcionais', i], `${c}: ${dono} está em depende (sempre ativo); declare em usaConsultas (ADR 0019)`);
    });
    for (const [acao, def] of Object.entries(m.acoes)) {
        // RN-PRO-01 vale pelo perfil (doc 03, esclarecimentos de 2026-10-30 e O-3 de 2026-10-31): nenhum módulo concede ao
        // promotor ação de ESCRITA de pedido; a leitura (`pedido.ver`) pode ser concedida (matriz §2 "Ver pedidos": carteira).
        if (ehAcaoDeEscritaDePedido(acao) && def.perfis.includes('promotor'))
            erro(['acoes', acao], 'RN-PRO-01: promotor nunca recebe ação de escrita de pedido');
    }
    // consumir evento de módulo fora de depende/opcionais é permitido: se o publicador
    // estiver inativo, simplesmente não chegam eventos (desacoplamento por evento).
});
export class ErroManifesto extends Error {
    modulo;
    problemas;
    constructor(modulo, problemas) {
        super(`Manifesto inválido (${modulo}): ${problemas.join('; ')}`);
        this.modulo = modulo;
        this.problemas = problemas;
        this.name = 'ErroManifesto';
    }
}
function congelar(obj) {
    if (obj && typeof obj === 'object') {
        for (const v of Object.values(obj))
            congelar(v);
        Object.freeze(obj);
    }
    return obj;
}
/** Valida e congela o manifesto. Falha cedo (no import do módulo) se algo estiver fora do padrão. */
export function defineModule(entrada) {
    const r = ManifestoSchema.safeParse(entrada);
    if (!r.success) {
        const id = typeof entrada?.id === 'string' ? String(entrada.id) : '?';
        throw new ErroManifesto(id, r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`));
    }
    return congelar(r.data);
}
/**
 * Valida o conjunto de módulos instalados num shell/API: ids únicos, dependências presentes,
 * sem ciclo, extensões usadas oferecidas por alguém e consultas usadas oferecidas pelo dono instalado (ADR 0012). Devolve a lista de problemas (vazia = ok).
 */
export function validarConjunto(manifestos) {
    const problemas = [];
    const porId = new Map();
    for (const m of manifestos) {
        if (porId.has(m.id))
            problemas.push(`módulo ${m.id} registrado duas vezes`);
        porId.set(m.id, m);
    }
    for (const m of manifestos) {
        for (const d of m.depende)
            if (!porId.has(d))
                problemas.push(`${m.id} depende de ${d}, que não está instalado`);
    }
    const donoDaAcao = new Map();
    for (const m of manifestos) {
        for (const acao of Object.keys(m.acoes)) {
            const dono = donoDaAcao.get(acao);
            if (dono && dono !== m.id)
                problemas.push(`ação ${acao} declarada por ${dono} e por ${m.id}`);
            // ADR 0033: onde entra, escopo, usuários, senhas e perfis são chaves da plataforma (o SDK é o dono)
            if (ehChavePlataforma(acao))
                problemas.push(`ação ${acao} de ${m.id} é chave da plataforma (ADR 0033)`);
            donoDaAcao.set(acao, m.id);
        }
    }
    const ofertas = new Set(manifestos.flatMap((m) => m.ofereceExtensoes));
    for (const m of manifestos) {
        for (const s of m.usaExtensoes)
            if (!ofertas.has(s))
                problemas.push(`${m.id} usa a extensão ${s}, que nenhum módulo oferece`);
    }
    problemas.push(...problemasDasConsultas(manifestos));
    try {
        ordenarPorDependencia(manifestos);
    }
    catch (e) {
        problemas.push(e.message);
    }
    return problemas;
}
/**
 * Consultas entre módulos no conjunto instalado (ADR 0012): consulta usada (em `usaConsultas` ou `usaConsultasOpcionais`)
 * cujo dono está instalado precisa estar em `ofereceConsultas` dele. Dono ausente só acontece com módulo de `opcionais`
 * ou com consulta opcional (ADR 0019; o de `depende` já falha antes): a consulta fica indisponível em tempo de execução
 * (`ConsultaIndisponivel`, RN-CORE-03).
 */
export function problemasDasConsultas(manifestos) {
    const problemas = [];
    const porId = new Map(manifestos.map((m) => [m.id, m]));
    for (const m of manifestos) {
        for (const c of consultasDeclaradas(m)) {
            const dono = porId.get(lerNomeConsulta(c)?.modulo);
            if (dono && !dono.ofereceConsultas.includes(c))
                problemas.push(`${m.id} usa a consulta ${c}, que ${dono.id} não oferece`);
        }
    }
    return problemas;
}
/**
 * Todas as consultas que o módulo pode chamar: `usaConsultas` (dono em depende/opcionais) e `usaConsultasOpcionais`
 * (ADR 0019, sem aresta de ordenação). É o que `tx.consultar`/`ambiente.consultar` aceitam; fora disso = erro de programação.
 */
export function consultasDeclaradas(m) {
    return [...m.usaConsultas, ...(m.usaConsultasOpcionais ?? [])];
}
/**
 * Ordem de carga: dependências antes (obrigatórias e opcionais presentes). Erro em ciclo. `usaConsultasOpcionais` NÃO
 * entra aqui (ADR 0019): consulta é resolvida na chamada, pelo registro, então o dono pode subir depois do consumidor.
 */
export function ordenarPorDependencia(manifestos) {
    const porId = new Map(manifestos.map((m) => [m.id, m]));
    const estado = new Map();
    const saida = [];
    const visitar = (m, trilha) => {
        const st = estado.get(m.id);
        if (st === 'feito')
            return;
        if (st === 'visitando')
            throw new Error(`dependência circular entre módulos: ${[...trilha, m.id].join(' → ')}`);
        estado.set(m.id, 'visitando');
        for (const d of [...m.depende, ...m.opcionais]) {
            const dep = porId.get(d);
            if (dep)
                visitar(dep, [...trilha, m.id]);
        }
        estado.set(m.id, 'feito');
        saida.push(m);
    };
    for (const m of manifestos)
        visitar(m, []);
    return saida;
}
