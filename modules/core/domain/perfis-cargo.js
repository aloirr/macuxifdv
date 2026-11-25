/**
 * Perfis sem base, pelo cargo (ADR 0073 §4; RN-CORE-35, RN-CORE-34, RN-CORE-33, RN-PRO-01): funções puras que a API (E4b) chama
 * em toda escrita. As regras (travas pelo cargo, último admin, autogestão, senha) são do SDK (`validarAcessoPeloCargo`,
 * `protegidoDaSenha`, `temGestaoDoAcesso`); aqui só se monta o catálogo, a cópia e a trava otimista.
 * ADITIVO: o `perfis.ts` antigo sai na E6.
 */
import { AREAS_PERMISSAO, resolverPerfilPeloCargo, } from '@macuxi/platform-sdk';
import { CODIGOS_ERRO_PERFIL_V2, MOTIVO_MODULO_SEM_LICENCA, STATUS_PERFIL_ALTERADO } from '../contracts/perfis';
/** Rótulo de cada área na tabela de permissões. */
export const ROTULO_AREA = {
    acesso: 'Acesso',
    dados: 'Dados',
    usuarios: 'Usuários',
    clientes: 'Clientes',
    pedidos: 'Pedidos',
    catalogo: 'Catálogo',
    trade: 'Trade marketing',
    pesquisa: 'Pesquisas',
    treinamento: 'Treinamento',
    metas: 'Metas',
    gestao: 'Gestão',
    integracao: 'Integração',
    administracao: 'Administração',
};
/**
 * `GET /v1/core/permissoes/catalogo`: chaves por área (ordem das áreas, depois da chave) com `disponivel` pela licença do tenant
 * (RN-CORE-02): módulo sem licença → `disponivel: false`, `motivo: MODULO_SEM_LICENCA`. O Core é sempre licenciado.
 */
export function montarCatalogoPorArea(catalogo, licencas, versao) {
    const areas = AREAS_PERMISSAO.map((area) => ({
        area: area,
        rotulo: ROTULO_AREA[area],
        chaves: catalogo
            .filter((d) => d.area === area)
            .sort((a, b) => a.chave.localeCompare(b.chave))
            .map((d) => {
            const disponivel = d.modulo === 'core' || licencas.has(d.modulo);
            return {
                chave: d.chave,
                descricao: d.descricao,
                modulo: d.modulo,
                nivel: d.nivel ?? null,
                alvos: !!d.alvos,
                disponivel,
                motivo: disponivel ? null : MOTIVO_MODULO_SEM_LICENCA,
            };
        }),
    })).filter((a) => a.chaves.length > 0);
    return { versao, areas };
}
/**
 * "Copiar de" (RN-CORE-35): cópia única, sem vínculo; de um modelo ou de um perfil do tenant. A cópia já sai do tamanho do cargo
 * do perfil novo: deixa de fora as chaves que o cargo trava (RN-PRO-01, RN-CORE-33) e desce `dados.escopo` ao teto do cargo
 * (RN-CORE-04), pelo `resolverPerfilPeloCargo` do SDK. A API revalida na gravação (defesa em profundidade).
 */
export function aplicarCopiarDe(origem, cargo, fontes) {
    let base;
    if ('modelo' in origem)
        base = fontes.modelos[origem.modelo].permissoes;
    else {
        const p = fontes.perfis.find((x) => x.codigo === origem.perfil);
        if (!p)
            return { ok: false, codigo: 'PERFIL_NAO_ENCONTRADO' };
        base = p.permissoes;
    }
    return { ok: true, permissoes: resolverPerfilPeloCargo({ codigo: '', cargo, permissoes: base }).permissoes };
}
/** Trava otimista do PUT (ADR 0073 §4.2): compara instantes, não texto. Diferente = 409 `PERFIL_ALTERADO`. */
export function conferirTravaOtimista(gravado, enviado) {
    const a = Date.parse(gravado);
    const b = Date.parse(enviado);
    return a === b ? { ok: true } : { ok: false, status: STATUS_PERFIL_ALTERADO, codigo: CODIGOS_ERRO_PERFIL_V2.alterado };
}
