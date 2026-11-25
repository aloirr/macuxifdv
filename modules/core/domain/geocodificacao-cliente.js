/** O mesmo texto da API e da tela quando o endereço não localiza (e quando já foi tentado). */
export const MENSAGEM_NAO_LOCALIZADO_CADASTRO = 'Endereço não localizado. Corrija o endereço ou o CEP no cadastro.';
export const MENSAGENS_RECUSA_GERACAO = {
    JA_TEM_COORDENADA: 'Este cliente já tem coordenada. Atualize a lista.',
    JA_TENTADO: MENSAGEM_NAO_LOCALIZADO_CADASTRO,
    NAO_LOCALIZADO: MENSAGEM_NAO_LOCALIZADO_CADASTRO,
};
/** Cliente que não dá para localizar (cadastro sem rua nem CEP válido): o mesmo texto na API e na tela. */
export const MENSAGEM_SEM_ENDERECO_CADASTRO = 'Sem rua nem CEP no cadastro.';
/** RN-CORE-77: pode gerar? `chaveAtual` é a chave do endereço de agora; `chaveTentada`, a da última tentativa. */
export function decidirGeracaoDeCoordenada(c) {
    if (c.latitude !== null || c.longitude !== null)
        return { ok: false, codigo: 'JA_TEM_COORDENADA' };
    if (c.chaveTentada !== null && c.chaveTentada === c.chaveAtual)
        return { ok: false, codigo: 'JA_TENTADO' };
    return { ok: true };
}
/** RN-CORE-77: a aprovação do check-in grava em cliente sem coordenada ou com a gerada pelo endereço; as demais origens ficam. */
export function checkinPodeSubstituirCoordenada(c) {
    return (c.latitude === null && c.longitude === null) || c.coordenada_origem === 'geocodificacao';
}
/** O serviço devolve 7 casas; `numeric(9,6)` guarda 6. */
export const arredondarCoordenada = (v) => Math.round(v * 1e6) / 1e6;
/** RN-CORE-77 (a única regra "rua ou CEP", usada pela API e pela web): só a cidade não localiza (o serviço devolve o centro da cidade e vira "não localizado"); sem rua nem CEP o botão não se oferece. */
export function enderecoPermiteGerar(c) {
    const rua = (c.logradouro ?? '').trim();
    const cep = (c.cep ?? '').replace(/\D/g, '');
    return rua.length > 0 || cep.length === 8;
}
