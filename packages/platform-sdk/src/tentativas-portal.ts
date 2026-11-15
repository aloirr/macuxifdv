/// <reference types="node" />
/**
 * Chave das tentativas de senha do portal (ADR 0052 §3.2; RD-0406): o HMAC-SHA256 de `portal.login:<e-mail normalizado>`,
 * em hex. Uma só para o login do portal (Core) e para a confirmação da exclusão da empresa (API), para a senha errada contar
 * no mesmo limite. Usa `node:crypto`: exportada SÓ pelo subcaminho `@macuxi/platform-sdk/tentativas-portal` (o web e o app
 * nunca a importam).
 */
import { createHmac } from 'node:crypto';

export const chaveDeTentativaDoPortal = (segredo: string, email: string): string =>
  createHmac('sha256', segredo).update(`portal.login:${email.trim().toLowerCase()}`).digest('hex');
