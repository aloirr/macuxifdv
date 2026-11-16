/**
 * Nome do banco SQLite do usuário no aparelho (desenho T-0088 §1.1; ADR 0003, adendo de 2026-11-06): um arquivo por
 * usuário e tenant, `macuxi-u-<usuario>-t-<tenant|demo>.db`. O tenant entra porque uma base recriada (demo, ensaio)
 * pode repetir o UUID do usuário num tenant novo: a fila de um tenant nunca cai no arquivo de outro.
 * Função pura, a mesma no shell (abrir e, no bloqueio do aparelho, apagar) e no teste do banco (`db/testes`).
 *
 * Cada id vira um segmento seguro de nome de arquivo (revisão da T-0088, 2026-11-07: a demonstração tem ids fora do
 * formato de UUID e precisa do SQLite também):
 * - id no formato de UUID: o próprio id em minúsculas (36 caracteres de `[0-9a-f-]`; o UUID não diferencia caixa);
 * - qualquer outro id: `h` + 32 hex do SHA-256 do id exato (128 bits). O id nunca entra cru no nome (nada de `/`, `..`,
 *   espaço ou acento), e o `h` fora do alfabeto do UUID impede que um id com hash caia no nome de um UUID;
 * - sem tenant (demonstração no mock-api): `demo`. Um tenant cujo id é a palavra `demo` vira hash, não o `demo`.
 */
/** Arquivos de usuário na pasta do SQLite (com os anexos do WAL). Casa só nomes montados por `arquivoDoUsuario`. */
export const ARQUIVO_DE_USUARIO_RE = /^macuxi-u-([0-9a-f-]{36}|h[0-9a-f]{32})-t-([0-9a-f-]{36}|h[0-9a-f]{32}|demo)\.db(-wal|-shm|-journal)?$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Tenant da demonstração (mock-api, sem tenant na sessão). */
export const TENANT_DEMO = 'demo';
/** Segmento do nome para um id: UUID em minúsculas, ou `h` + 32 hex do SHA-256 do id exato. */
export function segmentoDoId(id) {
    return UUID_RE.test(id) ? id.toLowerCase() : `h${sha256Hex(id).slice(0, 32)}`;
}
/**
 * Nome do arquivo do usuário. Aceita qualquer id (UUID fica legível; o resto vira hash, sem colisão prática entre
 * usuários e tenants). `null` só sem id de usuário (vazio ou só espaços): a sessão fica no AsyncStorage (reserva, §4).
 * Sem tenant, ou tenant vazio, = `demo`.
 */
export function arquivoDoUsuario(ids) {
    const u = ids.usuarioId ?? '';
    if (!u.trim())
        return null;
    const t = ids.tenantId ?? '';
    return `macuxi-u-${segmentoDoId(u)}-t-${t.trim() ? segmentoDoId(t) : TENANT_DEMO}.db`;
}
/**
 * Bancos de usuário entre os nomes da pasta do SQLite (sem os anexos `-wal`/`-shm`/`-journal`, sem repetição): o que o
 * bloqueio do aparelho (RN-CORE-15) apaga. Nome fora do padrão (ex.: `macuxi-diagnostico-carga.db`) fica de fora.
 */
export function bancosDeUsuario(nomes) {
    const bancos = new Set();
    for (const n of nomes)
        if (ARQUIVO_DE_USUARIO_RE.test(n))
            bancos.add(n.replace(/-(wal|shm|journal)$/, ''));
    return [...bancos].sort();
}
// ---------- SHA-256 (FIPS 180-4) em TS puro: o SDK roda no Hermes, sem `node:crypto` nem `crypto.subtle` síncrono ----------
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** UTF-8 do texto (par substituto vira 4 bytes; substituto solto vira U+FFFD, como o TextEncoder). */
function utf8(s) {
    const b = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) {
                c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
                i++;
            }
        }
        if (c >= 0xd800 && c <= 0xdfff)
            c = 0xfffd;
        if (c < 0x80)
            b.push(c);
        else if (c < 0x800)
            b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000)
            b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else
            b.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return b;
}
/** SHA-256 do texto (UTF-8) em hexadecimal minúsculo. */
function sha256Hex(texto) {
    const m = utf8(texto);
    const bits = m.length * 8;
    m.push(0x80);
    while (m.length % 64 !== 56)
        m.push(0);
    // comprimento em 64 bits big-endian (ids curtos: os 32 bits altos vêm de Math.floor)
    const alto = Math.floor(bits / 0x100000000);
    m.push((alto >>> 24) & 255, (alto >>> 16) & 255, (alto >>> 8) & 255, alto & 255);
    m.push((bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < m.length; o += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15];
            const b = w[i - 2];
            const s0 = rot(a, 7) ^ rot(a, 18) ^ (a >>> 3);
            const s1 = rot(b, 17) ^ rot(b, 19) ^ (b >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
            const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0;
        h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0;
        h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0;
        h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0;
        h[7] = (h[7] + hh) >>> 0;
    }
    return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}
