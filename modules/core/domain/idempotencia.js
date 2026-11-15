/**
 * Idempotência do push (ADR 0009 §1): o `id` do item da fila é a chave. Quando o payload repete o `id`
 * (check-in/checkout), os dois têm de ser iguais; senão o item é inválido (`PAYLOAD_INVALIDO`) e nada é gravado.
 */
export function idDoPayloadConfere(itemId, payload) {
    return payload.id === undefined || payload.id === itemId;
}
