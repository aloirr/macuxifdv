/**
 * Primitivas de segurança do login do Core (sem dependência externa; `node:crypto`).
 * - Senha: argon2id no formato PHC (`$argon2id$v=19$m=…,t=…,p=…$sal$hash`), o mesmo gravado pelo banco-dados
 *   (`core.usuario.senha_hash`, constraint `usuario_senha_argon2id`). Precisa de Node >= 24.7.
 * - JWT de acesso: HS256, 15 min, só `sub`, `tid`, `perfil`, `iat`, `exp` (+ `did` e `sv`; licença nunca vai no token, RN-CORE-01).
 *   `sv` (T-0094, ADR 0032) = `core.usuario.sessao_versao` na emissão: troca/redefinição de senha sobe a versão e o token cai na hora.
 * - Refresh: opaco, `<tenant_id>.<segredo base64url>`; o banco guarda só o sha256 do segredo.
 * Nada daqui registra senha, token ou e-mail em log.
 */
import * as crypto from 'node:crypto';
import { PERFIS } from '@macuxi/platform-sdk';
const PADRAO_ARGON2 = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 }; // mínimo OWASP
function derivar(senha, sal, p) {
    const fn = crypto.argon2;
    if (!fn)
        return Promise.reject(new Error('Este Node não tem crypto.argon2 (precisa de Node >= 24.7).'));
    return new Promise((resolve, reject) => fn('argon2id', { message: senha, nonce: sal, ...p }, (e, tag) => (e ? reject(e) : resolve(tag))));
}
const b64 = (b) => b.toString('base64').replace(/=+$/, '');
const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
export async function hashSenha(senha, sal = crypto.randomBytes(16)) {
    const tag = await derivar(senha, sal, PADRAO_ARGON2);
    return `$argon2id$v=19$m=${PADRAO_ARGON2.memory},t=${PADRAO_ARGON2.passes},p=${PADRAO_ARGON2.parallelism}$${b64(sal)}$${b64(tag)}`;
}
export async function verificarSenha(senha, phc) {
    const m = PHC_RE.exec(phc);
    if (!m)
        return false;
    const [, mem, t, p, sal, hash] = m;
    const esperado = Buffer.from(hash, 'base64');
    const tag = await derivar(senha, Buffer.from(sal, 'base64'), { memory: Number(mem), passes: Number(t), parallelism: Number(p), tagLength: esperado.length });
    return tag.length === esperado.length && crypto.timingSafeEqual(tag, esperado);
}
let hashFalso = null;
/** Gasta o mesmo tempo de uma conferência real quando o usuário não existe (não revela e-mail/empresa por tempo de resposta). */
export async function gastarTempoDeSenha(senha) {
    hashFalso ??= hashSenha('senha-falsa-para-igualar-o-tempo');
    await verificarSenha(senha, await hashFalso);
}
// ---------- JWT HS256 ----------
const b64url = (b) => Buffer.from(b).toString('base64url');
const SEGREDO_MIN = 32;
export class SegredoInvalido extends Error {
    constructor() {
        super(`MACUXI_JWT_SEGREDO ausente ou curto (mínimo ${SEGREDO_MIN} caracteres).`);
        this.name = 'SegredoInvalido';
    }
}
export function exigirSegredo(segredo) {
    if (!segredo || segredo.length < SEGREDO_MIN)
        throw new SegredoInvalido();
    return segredo;
}
const assinar = (dados, segredo) => crypto.createHmac('sha256', segredo).update(dados).digest();
export function assinarAcesso(c, agora, expiraEm, segredo) {
    const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const corpo = b64url(JSON.stringify({ sub: c.sub, tid: c.tid, perfil: c.perfil, ...(c.did ? { did: c.did } : {}), ...(c.sv !== undefined ? { sv: c.sv } : {}), iat: Math.floor(agora.getTime() / 1000), exp: Math.floor(expiraEm.getTime() / 1000) }));
    return `${cab}.${corpo}.${b64url(assinar(`${cab}.${corpo}`, segredo))}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `null` para qualquer problema: assinatura, algoritmo, expirado, campos fora do formato. Nunca lança. */
export function verificarJwtAcesso(token, agora, segredo) {
    try {
        const partes = token.split('.');
        if (partes.length !== 3)
            return null;
        const [cab, corpo, assinatura] = partes;
        const cabecalho = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8'));
        if (cabecalho.alg !== 'HS256')
            return null;
        const esperada = assinar(`${cab}.${corpo}`, segredo);
        const recebida = Buffer.from(assinatura, 'base64url');
        if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada))
            return null;
        const c = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
        if (typeof c.sub !== 'string' || !UUID_RE.test(c.sub) || typeof c.tid !== 'string' || !UUID_RE.test(c.tid))
            return null;
        if (typeof c.perfil !== 'string' || !PERFIS.includes(c.perfil))
            return null;
        if (c.did !== undefined && (typeof c.did !== 'string' || !UUID_RE.test(c.did)))
            return null;
        if (c.sv !== undefined && (typeof c.sv !== 'number' || !Number.isInteger(c.sv) || c.sv < 0))
            return null;
        if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp * 1000 <= agora.getTime())
            return null;
        return c;
    }
    catch {
        return null;
    }
}
export function tokenDoCabecalho(autorizacao) {
    const m = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(autorizacao ?? '');
    return m ? m[1] : null;
}
// ---------- refresh ----------
export function novoRefresh(tenantId) {
    const segredo = crypto.randomBytes(32).toString('base64url');
    return { token: `${tenantId}.${segredo}`, hash: hashDoRefresh(segredo) };
}
export const hashDoRefresh = (segredo) => crypto.createHash('sha256').update(segredo).digest('hex');
/** `null` se o formato não é `<uuid>.<segredo>`. O tenant do refresh só localiza a linha; a validação é pelo hash. */
export function lerRefresh(token) {
    const i = token.indexOf('.');
    if (i !== 36)
        return null;
    const tenantId = token.slice(0, i);
    const segredo = token.slice(i + 1);
    if (!UUID_RE.test(tenantId) || !/^[A-Za-z0-9_-]{20,100}$/.test(segredo))
        return null;
    return { tenantId: tenantId.toLowerCase(), hash: hashDoRefresh(segredo) };
}
