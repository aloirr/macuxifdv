/**
 * Onde o perfil entra, para a lista da demonstração do login (RN-CORE-33; ADR 0033). RD-0016: a decisão (`entraEm`,
 * `perfisDaSessao`, `perfisDeFabricaQueEntram`) e os nomes dos apps (`NOME_DO_APP`, o mesmo termo das mensagens do login)
 * vêm do SDK (`acesso-sessao.ts` e `perfis.ts`). Aqui fica só a frase, que só o login do app usa.
 */
import { entraEm, NOME_DO_APP, type LugarDeAcesso, type Perfil } from '@macuxi/platform-sdk';

/** Lugar do motor → chave do `NOME_DO_APP` (o BKO se chama `web` nas mensagens do login). */
const NOME_DO_LUGAR: readonly (readonly [Exclude<LugarDeAcesso, 'portal'>, keyof typeof NOME_DO_APP])[] = [
  ['campo', 'campo'],
  ['gestao', 'gestao'],
  ['bko', 'web'],
];

/** "o app Macuxi Gestão ou o backoffice (web)": onde o perfil entra de fábrica (lista da demonstração). Nenhum lugar = `null`. */
export function ondeOPerfilEntra(perfil: Perfil | null | undefined): string | null {
  const nomes = NOME_DO_LUGAR.filter(([lugar]) => entraEm(lugar, perfil)).map(([, app]) => NOME_DO_APP[app]);
  return nomes.length > 0 ? nomes.join(' ou ') : null;
}
