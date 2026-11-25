export const aceito = (id) => ({ id, status: 'aceito' });
export const rejeitado = (id, codigo, mensagem) => ({ id, status: 'rejeitado', codigo, mensagem });
/** O id do item da fila não é o do payload (`idDoPayloadConfere`, domain). */
export const idDivergente = (id) => rejeitado(id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.');
/** RN-CORE-04: cliente fora da carteira do usuário. */
export const MENSAGEM_FORA_DA_CARTEIRA = 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.';
/** Cliente do item não existe (ou foi apagado) no tenant: visita e foto do PDV. */
export const MENSAGEM_CLIENTE_NAO_ENCONTRADO = 'Cliente não encontrado. Atualize os dados e tente de novo.';
