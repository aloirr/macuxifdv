/**
 * T-0115 / RN-PES-05: "canal" do cliente (lista livre do tenant, vinda do ERP). A Pesquisa o usa como público-alvo.
 * O Core só guarda o texto; a comparação (sem caixa, sem acento) é de quem filtra.
 */
export const CANAL_MAX = 60;
/** Lê do payload do Hub só o que veio: ausente = não altera; `null` ou em branco = limpa; texto aparado, espaços colapsados, até `CANAL_MAX`. */
export function canalDoClienteDoErp(r) {
    if (r.canal === undefined)
        return {};
    if (r.canal === null)
        return { canal: null };
    const t = r.canal.trim().replace(/\s+/g, ' ').slice(0, CANAL_MAX).trim();
    return { canal: t === '' ? null : t };
}
