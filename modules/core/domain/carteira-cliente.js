import { linksDeContato } from './cliente360';
/** Perfis de gestão: única lista para rotas, API da Carteira e telas do Gestão. */
export const PERFIS_GESTAO = ['supervisor', 'gerente', 'analista', 'assistente', 'admin'];
/** Perfil de gestão (RN-CORE-04): vê a Carteira do cliente e o "Visitada por" da Performance; aceita perfil ausente. */
export function perfilDeGestao(perfil) {
    return perfil != null && PERFIS_GESTAO.includes(perfil);
}
export function rotuloColunaCarteira(pessoas) {
    return pessoas > 1 ? 'Pessoa' : 'Vendedora';
}
/** Uma linha por pessoa (a mesma pessoa em dois vínculos conta uma vez), em ordem alfabética. */
export function montarCarteiraDoCliente(vinculos) {
    const porPessoa = new Map();
    for (const v of vinculos)
        if (!porPessoa.has(v.usuario_id))
            porPessoa.set(v.usuario_id, v);
    const itens = [...porPessoa.values()]
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.usuario_id.localeCompare(b.usuario_id))
        .map((v) => {
        const l = linksDeContato({ telefone: v.telefone, whatsapp: v.telefone });
        return { usuario_id: v.usuario_id, nome: v.nome, tel: l.tel, whatsapp: l.whatsapp };
    });
    return { rotulo_coluna: rotuloColunaCarteira(itens.length), itens };
}
