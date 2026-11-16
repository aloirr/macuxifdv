/** Sem rede, timeout, modo sem sinal ou shell sem servidor configurado. Justifica guardar e tentar depois. */
export class ErroSemConexao extends Error {
    constructor(mensagem = 'Sem conexão com o servidor.') {
        super(mensagem);
        this.name = 'ErroSemConexao';
    }
}
/** Resposta de erro da API (`{ codigo, mensagem, detalhes }` na v1; `{ code, message, details }` na Fase M). */
export class ErroHttp extends Error {
    status;
    codigo;
    detalhes;
    constructor(status, codigo, mensagem, detalhes) {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
        this.detalhes = detalhes;
        this.name = 'ErroHttp';
    }
}
export function ehSemConexao(e) {
    return e instanceof ErroSemConexao || (e instanceof Error && e.name === 'ErroSemConexao');
}
/** 4xx da API (ex.: sem rota hoje, sem metas): a carga pode seguir com "vazio". */
export function ehErroDeCliente(e) {
    const s = e?.status;
    return typeof s === 'number' && s >= 400 && s < 500;
}
/** Sem GPS (testes, navegador, shell que não forneceu): sempre `null`. */
export const semPosicao = async () => null;
export const MENSAGEM_SEM_SINAL = 'Modo sem sinal ligado: nada sai do aparelho até a conexão voltar.';
/** Monta o `ClienteHttp` sobre a função de transporte do shell, respeitando o modo sem sinal. */
export function criarClienteHttp(requisitar, opcoes = {}) {
    const online = opcoes.online ?? (() => true);
    const cliente = {
        async requisitar(metodo, caminho, op = {}) {
            if (!caminho.startsWith('/'))
                throw new Error(`Caminho HTTP precisa começar com "/": ${caminho}`);
            if (!online())
                throw new ErroSemConexao(MENSAGEM_SEM_SINAL);
            return requisitar(metodo, caminho, op);
        },
        get(caminho, query) {
            return cliente.requisitar('GET', caminho, query ? { query } : {});
        },
    };
    return cliente;
}
/** UUID v4 pelo `crypto` da plataforma (Node 20+, navegador seguro, Hermes com polyfill do shell). */
export function uuidPadrao() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID();
    throw new Error('Este ambiente não gera UUID: o shell precisa fornecer novoId().');
}
/**
 * Ambiente "ainda sem servidor" (antes do login, testes, shell que não forneceu): offline, `http` sempre
 * lança `ErroSemConexao` com a mensagem dada. Telas e etapas tratam como "sem sinal".
 */
export function ambienteIndisponivel(mensagem = 'O aplicativo ainda não está conectado ao servidor. Entre de novo e tente outra vez.') {
    return {
        http: criarClienteHttp(async () => {
            throw new ErroSemConexao(mensagem);
        }),
        online: () => false,
        novoId: uuidPadrao,
        posicaoAgora: semPosicao,
        usuario: () => null,
    };
}
