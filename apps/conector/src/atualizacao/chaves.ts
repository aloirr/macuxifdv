/**
 * Chaves PÚBLICAS embutidas que verificam a assinatura dos pacotes do Conector (T-0116). Só chave pública (SPKI em PEM),
 * por id (`PacoteConector.chave_publica_id`); a chave privada fica offline com o Macuxi e NUNCA entra no repositório.
 *
 * Tipos aceitos: Ed25519 (recomendado para a v2) e RSA de 3072 bits ou mais com SHA-256 PKCS#1 v1.5 (o esquema do
 * pacote assinado manual da v1, `docs/modulos/integracao/conector.md` §7.4).
 *
 * A chave de produção (RSA 3072, id `macuxi-2026`) está embutida abaixo. Id desconhecido continua recusado
 * (`chave_desconhecida`): a atualização automática falha FECHADA, nunca instala pacote sem conferir. Rotação = nova
 * entrada com outro id (`openssl pkey -in assinatura.key -pubout` ou `openssl genpkey -algorithm ed25519` para um par
 * novo); a antiga sai depois que todos os Conectores tiverem a nova.
 */
export const CHAVES_PUBLICAS_PACOTE: Readonly<Record<string, string>> = Object.freeze({
  'macuxi-2026': `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAnPgQgcg0wTu4CxJefOHY
edhR11/XRiW4x5k+wxJXn6+MLnLAyRQGNP8jPoJaDXpiy8zSISI3hw3Vo9shBuk4
486fLmTHt/v/CMbRbP8sX5UFsjCHYc/fU88/23lYIOBz2ctsTefDJPkjhFhioKeK
OELPqqNlXtMK6yoa2dQpAdhHnKkujDLiNnTTnVhFsXYctmdBcX5nCFGDp4L6NECm
T75w/d1sZI/hQ02gQ7EyW/q4s5vw6Ui0aB8RyM4Fe2GyXMYsZeciiy55yjW87JLG
ah0tGkTxw4N0V7LPgjaJLCYGG9Jd2ZslbWwfgw50O3TRJeY5MgIgULKnwpAEuzvz
QHr5HTPma3l+RlvBe5FMV9N1aNQnAvzpDaNy5JTi3hR7Ohh//kNgT1nizlkNzuiz
oegGOSFsrvlQBN6mJZynMNuNTBZh60VSbEOoDRNohtF+BPUyj/xPdX+f8/qLJGTK
x29jp5jgRM5N2z+GC38Jna4jDfHUJsgaws4jwLYqzSavAgMBAAE=
-----END PUBLIC KEY-----\n`,
});
