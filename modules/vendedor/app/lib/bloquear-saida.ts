/**
 * RN-VEN-38 (T-0128): o shell intercepta a barra inferior e o Voltar do Android; o hook vem do SDK.
 * Mantido como re-export para os imports da tela não mudarem.
 */
export { useBloquearSaida, type AoTentarSair } from '@macuxi/platform-sdk/react';
