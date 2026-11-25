/**
 * Acesso ao portal de implantação como regras puras (T-0093; ADR 0031; RN-CORE-31/33 e desenho docs/desenho/T-0093.md §2 a §4).
 * Entrada só com e-mail e senha (sem TOTP nem convite):
 * - 5 falhas seguidas na chave do e-mail = 15 min de bloqueio, também para e-mail que não existe (sem oráculo);
 * - precedência: senha certa de super-admin vale sobre qualquer empresa; senão, só as empresas em que a senha conferiu;
 * - token de 15 min limitado ao teto de 8 h da sessão.
 * O relógio entra por parâmetro; nada aqui lê banco, ambiente nem grava log.
 */
export const MAX_FALHAS_SUPER_ADMIN = 5;
export const BLOQUEIO_SUPER_ADMIN_MIN = 15;
export const TOKEN_PLATAFORMA_MIN = 15;
export const MAX_EMPRESAS_LOGIN = 20;
/**
 * Quem entra, dado o que a senha conferiu. Super-admin com a senha certa tem precedência (já vê todas as empresas); senão, o
 * admin do cliente só recebe as empresas em que a senha conferiu (até 20). Nada conferiu = `null` (credenciais inválidas).
 */
export function decidirAcessoDoLogin(contas) {
    const sa = contas.find((c) => c.tipo === 'super_admin' && c.conferiu);
    if (sa)
        return { tipo: 'super_admin', conta_id: sa.conta_id };
    const certas = contas.filter((c) => c.tipo === 'admin_cliente' && c.conferiu && c.tenant_id !== null);
    // T-0094: conta com senha temporária (trocar_senha) não abre o portal; a lista só leva as definitivas
    const empresas = certas
        .filter((c) => !c.trocar_senha)
        .slice(0, MAX_EMPRESAS_LOGIN)
        .map((c) => ({ tenant_id: c.tenant_id, usuario_id: c.conta_id, codigo: c.tenant_codigo ?? '', nome: c.tenant_nome ?? '', sessao_versao: c.sessao_versao ?? 0 }));
    if (empresas.length > 0)
        return { tipo: 'admin_cliente', empresas };
    return certas.length > 0 ? { tipo: 'senha_a_trocar' } : null;
}
/** A chave do e-mail está bloqueada enquanto `bloqueadoAte` for futuro. */
export function chaveBloqueada(bloqueadoAte, agora) {
    return bloqueadoAte !== null && bloqueadoAte.getTime() > agora.getTime();
}
/**
 * Falha de senha (espelha `sa_tentativa_falha`): com bloqueio vivo nada muda (não conta nem estende); passado o bloqueio a
 * contagem recomeça; a 5ª falha seguida bloqueia por 15 min e zera o contador.
 */
export function decidirFalhaSuperAdmin(atual, agora) {
    if (chaveBloqueada(atual.bloqueadoAte, agora))
        return atual;
    const expirou = atual.bloqueadoAte !== null;
    const falhas = (expirou ? 0 : atual.falhas) + 1;
    if (falhas >= MAX_FALHAS_SUPER_ADMIN)
        return { falhas: 0, bloqueadoAte: new Date(agora.getTime() + BLOQUEIO_SUPER_ADMIN_MIN * 60_000) };
    return { falhas, bloqueadoAte: null };
}
/** Fim do token: 15 min, nunca depois do teto absoluto da sessão (8 h). */
export function expiracaoDoTokenPlataforma(agora, tetoDaSessao) {
    return new Date(Math.min(agora.getTime() + TOKEN_PLATAFORMA_MIN * 60_000, tetoDaSessao.getTime()));
}
