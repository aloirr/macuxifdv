export function criarLimiteDeFalhas(max = 10, janelaMs = 5 * 60_000) {
    const janelas = new Map();
    const vigente = (chave, t) => {
        const j = janelas.get(chave);
        if (!j)
            return null;
        if (t - j.inicio >= janelaMs) {
            janelas.delete(chave);
            return null;
        }
        return j;
    };
    return {
        bloqueadoPor(chave, agora) {
            const t = agora.getTime();
            const j = vigente(chave, t);
            return j && j.falhas >= max ? Math.max(1, Math.ceil((j.inicio + janelaMs - t) / 1000)) : 0;
        },
        registrarFalha(chave, agora) {
            const t = agora.getTime();
            if (janelas.size >= 10_000)
                for (const k of [...janelas.keys()])
                    vigente(k, t);
            const j = vigente(chave, t);
            if (j)
                j.falhas += 1;
            else
                janelas.set(chave, { inicio: t, falhas: 1 });
        },
        zerar: (chave) => void janelas.delete(chave),
    };
}
export const chaveDeLogin = (ip, codigo, email) => `${ip}|${codigo.toLowerCase()}|${email.toLowerCase()}`;
