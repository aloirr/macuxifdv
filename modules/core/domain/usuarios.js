/**
 * Usuários no BKO (RF-CORE-02, RF-CORE-01): regras puras da gestão de usuários pelo admin. A API revalida tudo.
 * - quem cria, edita, desativa e redefine senha é decidido pelo motor de permissões (ADR 0033: `usuario.criar|editar|desativar`,
 *   `senha.redefinir`; fábrica = só o admin), nunca por nome de perfil; supervisor/gerente leem a lista recortada
 *   pelo escopo (RN-CORE-04), reutilizando o conjunto de `usuariosVisiveis`;
 * - usuário nunca é apagado: desativar (`ativo = false`) corta o acesso na próxima requisição;
 * - toda alteração é auditada (RN-AUD-01) sem dado pessoal em claro e sem senha/hash.
 */
import { ehEmail } from '@macuxi/comum/email';
import { PERFIS, perfilDeFabrica, pode, validarAcessoDoTenant, } from '@macuxi/platform-sdk';
import { montarHierarquia } from './hierarquia';
import { podeVer } from './matriz';
import { faltasNaSenha, mensagemDaSenha } from './senha';
/** RD-0017: a frase ÚNICA de "usuário sem perfil" (RN-CORE-01); a API, o formulário do BKO e o seletor usam esta. */
export const ERRO_SEM_PERFIL = 'Escolha pelo menos um perfil.';
export const podeVerUsuarios = (perfil) => podeVer(perfil, 'usuario.ver');
export const normalizarEmail = (email) => email.trim().toLowerCase();
/** Mesmo formato da constraint `usuario_email_formato`. */
export const NOME_USUARIO_MAX = 200;
export const EXTERNAL_ID_MAX = 100;
export function validarDadosDeUsuario(d) {
    const erros = [];
    const nome = d.nome.trim();
    if (nome.length === 0)
        erros.push({ campo: 'nome', mensagem: 'Informe o nome do usuário.' });
    else if (nome.length > NOME_USUARIO_MAX)
        erros.push({ campo: 'nome', mensagem: `O nome pode ter até ${NOME_USUARIO_MAX} caracteres.` });
    const email = normalizarEmail(d.email);
    if (!ehEmail(email))
        erros.push({ campo: 'email', mensagem: 'Informe um e-mail válido, como nome@empresa.com.br.' });
    if (!PERFIS.includes(d.perfil))
        erros.push({ campo: 'perfil', mensagem: 'Escolha um perfil da lista.' });
    if (d.external_id !== null && (d.external_id.trim().length === 0 || d.external_id.trim().length > EXTERNAL_ID_MAX)) {
        erros.push({ campo: 'external_id', mensagem: `O código do ERP deve ter de 1 a ${EXTERNAL_ID_MAX} caracteres; deixe vazio se não houver.` });
    }
    return erros;
}
/**
 * Política da senha definida pelo admin (RN-CORE-32 + não ser o e-mail). Devolve a mensagem de erro ou `null` se a senha serve.
 */
export function validarSenhaInicial(senha, email) {
    const faltas = faltasNaSenha(senha);
    if (faltas.length > 0)
        return mensagemDaSenha(faltas, senha);
    if (senha.toLowerCase() === normalizarEmail(email))
        return 'A senha não pode ser igual ao e-mail.';
    return null;
}
const MENSAGENS = {
    USUARIO_SEM_PERMISSAO: 'Seu perfil não pode alterar usuários. Peça a quem administra a sua empresa.',
    USUARIO_AUTODESATIVACAO: 'Você não pode desativar o seu próprio usuário. Peça a outro administrador.',
};
const CODIGO_DA_VIOLACAO = { AUTOGESTAO: 'USUARIO_AUTORREBAIXA' };
export const mensagemDaRecusa = (c) => MENSAGENS[c];
const refDoUsuario = (perfil) => ({ codigo: perfil, base: perfil });
/**
 * Guarda da alteração de um usuário: a chave do motor (`usuario.desativar` ao desativar, `usuario.editar` no resto; nunca o próprio
 * ao desativar), e os limites do tenant por `validarAcessoDoTenant` (RN-CORE-01/33/35: último admin com a gestão do acesso, autogestão,
 * usuário sem perfil). Recusa 422 com `codigo` estável para a tela e `regra` da RN que explica.
 */
export function avaliarAlteracaoDeUsuario(e) {
    const sem = (codigo) => ({ ok: false, codigo, regra: 'RN-CORE-35', mensagem: MENSAGENS[codigo] });
    const proprio = e.ator.id === e.alvo.id;
    const desativando = e.alvo.ativo && !e.depois.ativo;
    const chave = desativando ? 'usuario.desativar' : 'usuario.editar';
    if (!pode(e.ator.perfis, chave))
        return sem('USUARIO_SEM_PERMISSAO');
    if (proprio && desativando)
        return sem('USUARIO_AUTODESATIVACAO');
    const refsDoAlvo = e.alvo.perfis && e.alvo.perfis.length > 0 ? e.alvo.perfis : [refDoUsuario(e.alvo.perfil)];
    if (!pode(e.ator.perfis, chave, { proprio, perfis: refsDoAlvo }))
        return sem('USUARIO_SEM_PERMISSAO');
    if (e.estado) {
        const atuais = e.estado.usuarios.find((u) => u.id === e.alvo.id)?.perfis ?? [];
        const codigosDepois = e.depois.perfis ?? (e.depois.perfil !== e.alvo.perfil || atuais.length === 0 ? [e.depois.perfil] : atuais);
        const depoisReal = { perfis: e.estado.perfis, usuarios: e.estado.usuarios.map((u) => (u.id === e.alvo.id ? { ...u, ativo: e.depois.ativo, perfis: codigosDepois } : u)) };
        const vr = validarAcessoDoTenant({ antes: e.estado, depois: depoisReal, atorId: e.ator.id, matriz: e.matriz, catalogo: e.catalogo })[0];
        if (vr)
            return { ok: false, codigo: CODIGO_DA_VIOLACAO[vr.codigo] ?? vr.codigo, regra: vr.regra, mensagem: vr.mensagem };
        return { ok: true };
    }
    const paraEstado = (us) => ({
        perfis: PERFIS.map(perfilDeFabrica),
        usuarios: us.map((u) => ({ id: u.id, ativo: u.ativo, perfis: [u.perfil] })),
    });
    const antes = paraEstado(e.usuarios);
    const depois = paraEstado(e.usuarios.map((u) => (u.id === e.alvo.id ? { ...u, perfil: e.depois.perfil, ativo: e.depois.ativo } : u)));
    const v = validarAcessoDoTenant({ antes, depois, atorId: e.ator.id, matriz: e.matriz, catalogo: e.catalogo })[0];
    if (v)
        return { ok: false, codigo: CODIGO_DA_VIOLACAO[v.codigo] ?? v.codigo, regra: v.regra, mensagem: v.mensagem };
    return { ok: true };
}
/** RN-CORE-04: recorta a lista pelo conjunto de usuários visíveis (`usuariosVisiveis`); `'tenant'` = sem recorte. */
export function recortarUsuarios(itens, visiveis) {
    if (visiveis === 'tenant')
        return [...itens];
    return itens.filter((i) => visiveis.has(i.id));
}
/** Campos pessoais: a auditoria diz que mudaram, mas não guarda o valor (nome, nome curto, e-mail). */
const PESSOAIS = ['nome', 'nome_curto', 'email'];
const NAO_PESSOAIS = ['perfil', 'equipe_id', 'ativo', 'external_id', 'desconto_limita_item', 'desconto_limita_pedido', 'desconto_maximo_pedido_permil', 'almoco_inicio_min', 'almoco_fim_min'];
/** RN-AUD-01: antes/depois só do que mudou. Valores só dos campos não pessoais; senha e hash nunca entram. */
export function diffAuditavelDeUsuario(antes, depois) {
    const a = {};
    const d = {};
    const campos = [];
    for (const c of PESSOAIS)
        if (antes[c] !== depois[c])
            campos.push(c);
    for (const c of NAO_PESSOAIS) {
        if (antes[c] === depois[c])
            continue;
        campos.push(c);
        a[c] = antes[c];
        d[c] = depois[c];
    }
    return { campos_alterados: campos, antes: a, depois: d };
}
/** Superior imediato de um usuário que está (ou entra) na equipe: reaproveita `montarHierarquia` (mesma regra da API de hierarquia). */
export function superiorImediatoNaEquipe(equipes, equipeId) {
    if (!equipeId)
        return null;
    const candidato = { id: '00000000-0000-0000-0000-000000000000', nome: 'x', perfil: 'vendedor', equipe_id: equipeId, ativo: true };
    return montarHierarquia(equipes, [candidato])[0]?.superior_id ?? null;
}
