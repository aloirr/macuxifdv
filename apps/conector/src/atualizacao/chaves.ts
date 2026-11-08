/**
 * Chaves PÚBLICAS embutidas que verificam a assinatura dos pacotes do Conector (T-0116). Só chave pública (SPKI em PEM),
 * por id (`PacoteConector.chave_publica_id`); a chave privada fica offline com o Macuxi e NUNCA entra no repositório.
 *
 * Tipos aceitos: Ed25519 (recomendado para a v2) e RSA de 3072 bits ou mais com SHA-256 PKCS#1 v1.5 (o esquema do
 * pacote assinado manual da v1, `docs/modulos/integracao/conector.md` §7.4).
 *
 * VAZIO DE PROPÓSITO até o Alexandre gerar o par de chaves de produção: sem chave embutida, todo pacote é recusado
 * (`chave_desconhecida`) — a atualização automática falha FECHADA, nunca instala pacote sem conferir. Para incluir a
 * chave: `openssl pkey -in assinatura.key -pubout` (ou `openssl genpkey -algorithm ed25519` para um par novo) e cole o
 * PEM público aqui com um id estável (ex.: `macuxi-2026`). Rotação = nova entrada com outro id; a antiga sai depois que
 * todos os Conectores tiverem a nova.
 */
export const CHAVES_PUBLICAS_PACOTE: Readonly<Record<string, string>> = Object.freeze({});
