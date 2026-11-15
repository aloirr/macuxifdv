let resolvedor = null;
export function definirResolvedorMiniatura(r) {
    resolvedor = r;
}
export const ehHttp = (u) => /^https?:\/\//i.test(u);
export const ehArquivoLocal = (u) => /^file:\/\//i.test(u);
export async function urlBaixavel(m) {
    if (ehHttp(m.url))
        return m.url;
    return resolvedor ? resolvedor(m.url, m) : null;
}
export async function baixarMiniatura(m, portas) {
    try {
        const uri = await urlBaixavel(m);
        if (!uri)
            return 'falhou';
        if (ehArquivoLocal(uri))
            return 'ok';
        if (!ehHttp(uri))
            return 'falhou';
        const cabecalho = await portas.fetch(uri, { method: 'HEAD' });
        if (!cabecalho.ok)
            return 'falhou';
        const tamanho = Number(cabecalho.headers.get('content-length'));
        if (!Number.isFinite(tamanho) || tamanho <= 0)
            return 'falhou';
        if (tamanho > m.bytes_max)
            return 'grande';
        return (await portas.prefetch(uri)) ? 'ok' : 'falhou';
    }
    catch {
        return 'falhou';
    }
}
