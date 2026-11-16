/** Status que o `autenticar` pode devolver: 400 cabeçalho malformado, 401 genérico, 403 negado, 503 falha fechada (sem pepper). */
export const STATUS_RECUSA_CONECTOR = [400, 401, 403, 503];
/** Status de sucesso de uma rota de Conector. */
export const STATUS_SUCESSO_CONECTOR = [200, 201, 202, 204];
/**
 * Resposta com status ou cabeçalhos diferentes dos declarados na rota, ex.: a repetição do lote (RN-INT-12):
 * `return new RespostaConector(lote, { status: 202, cabecalhos: { 'idempotent-replay': 'true' } })`.
 */
export class RespostaConector {
    corpo;
    opcoes;
    constructor(corpo, opcoes = {}) {
        this.corpo = corpo;
        this.opcoes = opcoes;
        if (opcoes.status !== undefined && !STATUS_SUCESSO_CONECTOR.includes(opcoes.status))
            throw new Error(`RespostaConector: status ${String(opcoes.status)} não é de sucesso (${STATUS_SUCESSO_CONECTOR.join(', ')})`);
    }
}
/** Ajuda de tipo: `definirApiConector<MeuConector>({ autenticar, antes, rotas })` tipa `ctx.conector` nas rotas. */
export function definirApiConector(api) {
    return api;
}
/** Status que uma rota de Conector pode devolver por erro próprio (ADR 0013 §5). */
export const STATUS_ERRO_CONECTOR = [400, 401, 403, 404, 409, 413, 422, 426, 429, 503];
/**
 * Erro de rota de Conector: a API responde `status` com o `corpo` e `requisicao_id`. 429 e 503 exigem `retry-after` (segundos
 * inteiros) em `cabecalhos`. `corpo` vai ao Conector: nunca coloque dado pessoal, valor de linha nem segredo.
 */
export class ErroConector extends Error {
    status;
    corpo;
    cabecalhos;
    constructor(status, corpo, cabecalhos = {}) {
        super(typeof corpo?.mensagem === 'string' ? corpo.mensagem : 'erro do Conector');
        this.status = status;
        this.corpo = corpo;
        this.name = 'ErroConector';
        if (!STATUS_ERRO_CONECTOR.includes(status))
            throw new Error(`ErroConector: status ${String(status)} não é de rota de Conector (${STATUS_ERRO_CONECTOR.join(', ')})`);
        if (typeof corpo?.codigo !== 'string' || !corpo.codigo || typeof corpo.mensagem !== 'string' || !corpo.mensagem)
            throw new Error('ErroConector: o corpo precisa de "codigo" e "mensagem" preenchidos (ErroApiSchema)');
        if (corpo.detalhes !== undefined && (corpo.detalhes === null || typeof corpo.detalhes !== 'object' || Array.isArray(corpo.detalhes)))
            throw new Error('ErroConector: "detalhes" precisa ser um objeto');
        if ('requisicao_id' in corpo)
            throw new Error('ErroConector: "requisicao_id" é da plataforma');
        this.cabecalhos = Object.fromEntries(Object.entries(cabecalhos).map(([k, v]) => [k.toLowerCase(), v]));
        if ((status === 429 || status === 503) && !/^[1-9]\d*$/.test(this.cabecalhos['retry-after'] ?? ''))
            throw new Error(`ErroConector ${status}: informe "retry-after" em segundos inteiros (> 0)`);
    }
}
/** Formato do caminho de rota de Conector: `/seg/{param}` (minúsculas, números, `_` e `-`). */
const CAMINHO_CONECTOR_RE = /^(?:\/(?:[a-z0-9_-]+|\{[a-z][a-z0-9_]*\}))+$/;
export const LIMITE_CORPO_CONECTOR_PADRAO = 1024 * 1024;
export const LIMITE_CORPO_CONECTOR_MAX = 32 * 1024 * 1024;
export const MAX_ELEMENTOS_CONECTOR_PADRAO = 50_000;
export const MAX_ELEMENTOS_CONECTOR_MAX = 2_000_000;
/** `/lotes/{id}` → `/lotes/:id` (formato do roteador). */
export function caminhoConectorParaRoteador(caminho) {
    return caminho.replace(/\{([a-z][a-z0-9_]*)\}/g, ':$1');
}
/** Problemas da declaração `conector` de um módulo (usado por `definirModuloApi`). Vazio = válida. */
export function problemasApiConector(manifesto, api) {
    if (!api)
        return [];
    const id = manifesto.id;
    const problemas = [];
    if (!manifesto.apps.conector)
        problemas.push(`conector: só módulo com apps.conector no manifesto declara rotas de Conector (${id} não tem)`);
    if (typeof api.autenticar !== 'function')
        problemas.push('conector: informe "autenticar"');
    if (!Array.isArray(api.rotas) || api.rotas.length === 0)
        problemas.push('conector: declare ao menos uma rota');
    const ids = new Set();
    const caminhos = new Set();
    for (const r of api.rotas ?? []) {
        const rotulo = `${r.metodo} /${id}/v1${r.caminho}`;
        if (!/^[a-z][a-z0-9_]*$/.test(r.id ?? ''))
            problemas.push(`${rotulo}: id da rota inválido (minúsculas, números e _)`);
        if (ids.has(r.id))
            problemas.push(`${rotulo}: id ${r.id} repetido`);
        ids.add(r.id);
        if (!CAMINHO_CONECTOR_RE.test(r.caminho ?? ''))
            problemas.push(`${rotulo}: caminho inválido (barra inicial, minúsculas, parâmetros {nome})`);
        const chave = `${r.metodo} ${(r.caminho ?? '').replace(/\{[^}]+\}/g, '{}')}`;
        if (caminhos.has(chave))
            problemas.push(`${rotulo}: método e caminho repetidos`);
        caminhos.add(chave);
        if (r.status !== undefined && !STATUS_SUCESSO_CONECTOR.includes(r.status))
            problemas.push(`${rotulo}: status ${String(r.status)} não é de sucesso`);
        if (r.limiteCorpoBytes !== undefined && !(Number.isInteger(r.limiteCorpoBytes) && r.limiteCorpoBytes > 0 && r.limiteCorpoBytes <= LIMITE_CORPO_CONECTOR_MAX))
            problemas.push(`${rotulo}: limiteCorpoBytes entre 1 e ${LIMITE_CORPO_CONECTOR_MAX}`);
        if (r.maxElementosCorpo !== undefined && !(Number.isInteger(r.maxElementosCorpo) && r.maxElementosCorpo > 0 && r.maxElementosCorpo <= MAX_ELEMENTOS_CONECTOR_MAX))
            problemas.push(`${rotulo}: maxElementosCorpo entre 1 e ${MAX_ELEMENTOS_CONECTOR_MAX}`);
        if (typeof r.executar !== 'function')
            problemas.push(`${rotulo}: informe "executar"`);
    }
    return problemas;
}
