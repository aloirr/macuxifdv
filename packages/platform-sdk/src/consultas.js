import { ErroHttpModulo } from './api';
import { semPosicao } from './ambiente';
import { consultasDeclaradas } from './manifesto';
import { lerNomeConsulta } from './nomes';
/**
 * Declara o contrato. Nome fora do padrão = erro no import do `contracts`. Limite as listas da entrada no schema (ex.: ≤ 500 ids).
 * `configuracaoDoTenant: true` (ADR 0025 §4.1): a resposta é configuração do tenant, igual para qualquer usuário; libera
 * `{ licenca: 'tenant' }` também em rota de escrita (executada só leitura). Só o dono declara, e a revisão final confere.
 */
export function definirConsulta(d) {
    const n = lerNomeConsulta(d.nome);
    if (!n)
        throw new Error(`Nome de consulta inválido: ${d.nome} (use <modulo>.<consulta>@vN)`);
    if (d.configuracaoDoTenant !== undefined && typeof d.configuracaoDoTenant !== 'boolean')
        throw new Error(`Consulta ${d.nome}: configuracaoDoTenant precisa ser booleano (ADR 0025 §4.1)`);
    return Object.freeze({
        nome: d.nome,
        modulo: n.modulo,
        versao: n.versao,
        entrada: d.entrada,
        saida: d.saida,
        ...(d.configuracaoDoTenant ? { configuracaoDoTenant: true } : {}),
    });
}
export const CODIGO_CONSULTA_INDISPONIVEL = 'CONSULTA_INDISPONIVEL';
/**
 * O dono da consulta não está ativo para o usuário (licença, RN-CORE-02/03), não está instalado (opcional) ou não
 * implementa a consulta neste canal (ex.: `core.cadastro_resumo@1` só existe na API). O consumidor trata; sem tratamento,
 * a API responde 503 (o motor do app tenta de novo depois).
 */
export class ConsultaIndisponivel extends ErroHttpModulo {
    consulta;
    modulo;
    status = 503;
    constructor(consulta, modulo, mensagem = 'Uma informação de outro módulo não está disponível agora. Tente de novo em instantes.') {
        super(503, CODIGO_CONSULTA_INDISPONIVEL, mensagem, { consulta, modulo });
        this.consulta = consulta;
        this.modulo = modulo;
        this.name = 'ConsultaIndisponivel';
    }
}
export function ehConsultaIndisponivel(e) {
    return e instanceof ConsultaIndisponivel || (e instanceof Error && e.name === 'ConsultaIndisponivel');
}
function resumoZod(e) {
    return e.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
        .join('; ');
}
/**
 * Executa a implementação validando a entrada (erro do CONSUMIDOR) e a saída (erro do DONO). As duas falhas são erro de
 * programação (500 na API), com a mensagem dizendo de quem é — sem os valores (podem ter dado pessoal).
 */
export async function executarConsulta(def, entrada, impl) {
    const e = def.entrada.safeParse(entrada);
    if (!e.success)
        throw new Error(`Consulta ${def.nome}: entrada inválida (erro de quem consulta) — ${resumoZod(e.error)}`);
    const bruta = await impl(e.data);
    const s = def.saida.safeParse(bruta);
    if (!s.success)
        throw new Error(`Consulta ${def.nome}: saída inválida (erro do módulo ${def.modulo}) — ${resumoZod(s.error)}`);
    return s.data;
}
/** Implementação no aparelho (`definirModuloShell({ consultas: [...] })` do dono). */
export function implementarConsultaAparelho(consulta, executar) {
    return { consulta, executar };
}
/**
 * Registro das consultas do aparelho (usado por `criarShell`). Problemas de montagem vão para `problemas`:
 * implementação fora de `ofereceConsultas` do módulo, de consulta de outro dono ou repetida.
 */
export function criarRegistroConsultasAparelho(modulos) {
    const problemas = [];
    const impls = new Map();
    const usadas = new Set(modulos.flatMap((m) => consultasDeclaradas(m.manifesto)));
    /** Dono da consulta → módulos cujas entidades a implementação lê: ele e os de `depende` (nunca os `opcionais`). */
    const legiveis = new Map(modulos.map((m) => [m.manifesto.id, [m.manifesto.id, ...m.manifesto.depende]]));
    for (const m of modulos) {
        const id = m.manifesto.id;
        for (const i of m.consultas ?? []) {
            const nome = i.consulta.nome;
            if (i.consulta.modulo !== id)
                problemas.push(`${id}: implementa a consulta ${nome}, que é de ${i.consulta.modulo}`);
            else if (!m.manifesto.ofereceConsultas.includes(nome))
                problemas.push(`${id}: consulta ${nome} não está em ofereceConsultas do manifesto`);
            if (impls.has(nome))
                problemas.push(`consulta ${nome} implementada duas vezes`);
            impls.set(nome, i);
        }
    }
    const registro = {
        nomes: [...impls.keys()],
        async consultar(def, entrada, f) {
            if (!usadas.has(def.nome))
                throw new Error(`Consulta ${def.nome}: nenhum módulo instalado a declara em usaConsultas/usaConsultasOpcionais`);
            const impl = impls.get(def.nome);
            if (!impl || !f.modulosAtivos().includes(def.modulo))
                throw new ConsultaIndisponivel(def.nome, def.modulo);
            const dono = def.modulo;
            const permitidos = legiveis.get(dono) ?? [dono];
            /** Só leitura das entidades do dono e dos módulos de `depende` dele que estejam efetivos para o usuário. */
            const legivel = (entidade) => {
                const de = f.donoDaEntidade(entidade);
                if (!de || !permitidos.includes(de))
                    throw new Error(`Consulta ${def.nome}: só lê entidades de ${permitidos.join(', ')} (pediu ${entidade}${de ? `, de ${de}` : ''})`);
                if (de !== dono && !f.modulosAtivos().includes(de))
                    throw new ConsultaIndisponivel(def.nome, dono);
            };
            const ctx = {
                linhas: async (entidade) => {
                    legivel(entidade);
                    return f.linhas(entidade);
                },
                linhasPorIds: async (entidade, ids) => {
                    legivel(entidade);
                    return f.linhasPorIds(entidade, ids);
                },
                linhasPorCampo: async (entidade, campo, valores) => {
                    legivel(entidade);
                    return f.linhasPorCampo(entidade, campo, valores);
                },
                versaoLinhas: (entidade) => {
                    legivel(entidade);
                    return f.versaoLinhas(entidade);
                },
                buscarComDesfecho: async (indice, consulta) => {
                    // ids de índice são `<modulo>.<nome>` (definirIndiceBusca): só os do dono da consulta
                    if (!indice.startsWith(`${dono}.`))
                        throw new Error(`Consulta ${def.nome}: só busca nos índices de ${dono} (pediu ${indice})`);
                    return f.buscarComDesfecho ? f.buscarComDesfecho(indice, consulta) : { buscou: false, motivo: 'sem_busca' };
                },
                agora: () => f.agora(),
                usuario: () => f.usuario(),
                parametros: () => f.parametros(dono),
            };
            return executarConsulta(def, entrada, (e) => impl.executar(e, ctx));
        },
    };
    return { registro, problemas };
}
const SEM_PARAMETROS = Object.freeze({});
/**
 * Completa o ambiente do shell (`AmbienteAparelho` → `AmbienteModulo`): `extra` (o do motor) vale sobre o do shell; sem
 * nenhum dos dois, `consultar` lança `ConsultaIndisponivel` e `parametros` devolve `{}` (ex.: BKO, que lê tudo pela API).
 */
export function completarAmbiente(base, extra = {}) {
    return {
        ...base,
        consultar: extra.consultar ??
            base.consultar ??
            (async (def) => {
                throw new ConsultaIndisponivel(def.nome, def.modulo);
            }),
        parametros: extra.parametros ?? base.parametros ?? (() => SEM_PARAMETROS),
        posicaoAgora: base.posicaoAgora ?? semPosicao,
    };
}
