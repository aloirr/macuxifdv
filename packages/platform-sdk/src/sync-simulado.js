import { codificarCursorNovidades, decodificarCursorNovidades, UUID_NIL } from './novidades';
import { codificarCursor, MENSAGEM_ENVIO_INDISPONIVEL, paginar, PushRequestSchema, rejeitarItensInvalidos, SYNC_NAO_IMPLEMENTADO, } from './sync';
export class ErroRedeSimulada extends Error {
    constructor() {
        super('Sem conexão com o servidor.');
        this.name = 'ErroRedeSimulada';
    }
}
/** 501 `SYNC_NAO_IMPLEMENTADO` da API real (o transporte do app lança o `HttpError` com o mesmo status e código). */
export class ErroSyncNaoImplementadoSimulado extends Error {
    status = 501;
    codigo = SYNC_NAO_IMPLEMENTADO;
    constructor(entidade) {
        super(`O pull de ${entidade} ainda não está disponível no servidor.`);
        this.name = 'ErroSyncNaoImplementadoSimulado';
    }
}
/**
 * ADR 0054: o que o gerador da API poria no pacote das `entidades` com o `horizonte`: só linhas vivas com `updated_at`
 * abaixo dele, `linhas` contadas, cursor `(horizonte, UUID nulo)` e a `versao_escopo` do servidor.
 */
export function conteudoDoPacoteSimulado(s, entidades, horizonte) {
    const limite = Date.parse(horizonte);
    const linhas = {};
    for (const e of entidades)
        linhas[e] = (s.linhas[e] ?? []).filter((l) => !l.deleted_at && Date.parse(l.updated_at) < limite);
    return {
        linhas,
        entidades: entidades.map((nome) => ({
            nome,
            linhas: linhas[nome].length,
            cursor: codificarCursor({ updated_at: horizonte, id: UUID_NIL }),
            ...(s.versoesEscopo[nome] === undefined ? {} : { versao_escopo: s.versoesEscopo[nome] }),
        })),
    };
}
/** Hash curto (djb2, hex) só para o cursor simulado: o SDK roda no aparelho, sem `node:crypto`. */
function hashCurto(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++)
        h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
}
export function criarServidorSyncSimulado(registro, inicial = {}) {
    const s = {
        online: true,
        modulosAtivos: inicial.modulosAtivos ?? [],
        linhas: inicial.linhas ?? {},
        recebidos: new Map(),
        rejeitar: new Map(),
        chamadas: {
            push: 0,
            pull: 0,
            ...(inicial.comNovidades ? { novidades: 0 } : {}),
            ...(inicial.comPacotes ? { pacotes: 0 } : {}),
        },
        tamanhoPagina: inicial.tamanhoPagina ?? 1000,
        versoesEscopo: {},
        semProvedor: new Set(),
        semReceptor: new Set(),
        relogio: null,
        margemHorizonteMs: 2_000,
        parametros: {},
        geracao_base: null,
        manifestoPacotes: { pacotes: [] },
        falhaPacotes: null,
        async push(itens) {
            s.chamadas.push++;
            if (!s.online)
                throw new ErroRedeSimulada();
            const req = PushRequestSchema.parse({ itens });
            const { validos, rejeitados } = rejeitarItensInvalidos(req, registro, s.modulosAtivos);
            const saida = [...rejeitados];
            for (const it of validos) {
                const forcado = s.rejeitar.get(it.id);
                if (s.semReceptor.has(it.entidade))
                    saida.push({
                        id: it.id,
                        status: 'rejeitado',
                        codigo: SYNC_NAO_IMPLEMENTADO,
                        mensagem: MENSAGEM_ENVIO_INDISPONIVEL,
                    });
                else if (forcado)
                    saida.push({ id: it.id, status: 'rejeitado', ...forcado });
                else {
                    s.recebidos.set(it.id, it);
                    saida.push(s.relogio ? { id: it.id, status: 'aceito', em: s.relogio().toISOString() } : { id: it.id, status: 'aceito' });
                }
            }
            return itens.map((i) => saida.find((r) => r.id === i.id)).filter(Boolean);
        },
        async pull(entidade, cursor) {
            s.chamadas.pull++;
            if (!s.online)
                throw new ErroRedeSimulada();
            if (s.semProvedor.has(entidade))
                throw new ErroSyncNaoImplementadoSimulado(entidade);
            const horizonte = s.relogio ? new Date(s.relogio().getTime() - s.margemHorizonteMs) : null;
            // como a API: só linhas abaixo do horizonte
            const visiveis = (s.linhas[entidade] ?? []).filter((l) => !horizonte || Date.parse(l.updated_at) < horizonte.getTime());
            const pagina = paginar(visiveis, cursor, s.tamanhoPagina);
            const versao = s.versoesEscopo[entidade];
            return {
                ...pagina,
                ...(versao === undefined ? {} : { versao_escopo: versao }),
                ...(horizonte ? { horizonte: horizonte.toISOString() } : {}),
                ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
            };
        },
    };
    if (inicial.comPacotes) {
        s.pacotes = async () => {
            s.chamadas.pacotes = (s.chamadas.pacotes ?? 0) + 1;
            if (!s.online)
                throw new ErroRedeSimulada();
            if (s.falhaPacotes)
                throw s.falhaPacotes;
            return {
                ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
                ...s.manifestoPacotes,
            };
        };
    }
    if (inicial.comNovidades) {
        s.novidades = async (desde) => {
            s.chamadas.novidades = (s.chamadas.novidades ?? 0) + 1;
            if (!s.online)
                throw new ErroRedeSimulada();
            const horizonte = new Date((s.relogio?.() ?? new Date()).getTime() - s.margemHorizonteMs).toISOString();
            const ativos = [...s.modulosAtivos].sort();
            const licencas = hashCurto(JSON.stringify(ativos.map((m) => [m, s.parametros[m] ?? {}])));
            const elegiveis = registro
                .entidadesAtivas(s.modulosAtivos, 'pull')
                .map((e) => e.nome)
                .filter((e) => !s.semProvedor.has(e));
            const escopo = hashCurto(JSON.stringify(elegiveis.map((e) => s.versoesEscopo[e] ?? '')));
            const c = decodificarCursorNovidades(desde);
            const modulosMudaram = !c || c.licencas !== licencas;
            const todas = modulosMudaram || c.escopo !== escopo;
            const limite = Date.parse(horizonte);
            const entidades = todas
                ? elegiveis
                : elegiveis.filter((e) => (s.linhas[e] ?? []).some((l) => {
                    const t = Date.parse(l.updated_at);
                    return t >= Date.parse(c.horizonte) && t < limite;
                }));
            return {
                entidades,
                cursor: codificarCursorNovidades({ horizonte, licencas, escopo }),
                horizonte,
                modulos_mudaram: modulosMudaram,
                ...(modulosMudaram
                    ? { modulos: { modulos: ativos.map((id) => ({ id, parametros: s.parametros[id] ?? {} })), versao_licencas: licencas } }
                    : {}),
                ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
            };
        };
    }
    return s;
}
