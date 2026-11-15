/**
 * RN-CORE-48 (pedido do dono do produto, 14/11: "1 de 5, 2 de 5, 3 de 5..."): ordem da carga do motor de sync pela etapa da
 * tela de entrada. Puro (roda em Node nos testes); quem monta o motor é `services/motor-do-usuario.ts`.
 */
import { chaveDeOrdemDaCarga, essencialDaEntrada } from '@macuxi/core/app';
import type { ItemDaCarga } from '@macuxi/platform-sdk';

/**
 * A carga roda na ordem das etapas da tela de entrada (1, 2, 3... de N), pelo perfil e pelos módulos efetivos lidos na hora
 * de cada carga. A chave do Core é refeita só quando eles mudam.
 */
export function ordemDaCargaDoUsuario(
  perfil: () => string | null | undefined,
  modulos: () => readonly string[],
): (item: ItemDaCarga) => number {
  let feita: { de: string; chave: ReturnType<typeof chaveDeOrdemDaCarga> } | null = null;
  return (item) => {
    const p = perfil() ?? null;
    const ms = modulos();
    const de = `${p ?? ''}|${ms.join(',')}`;
    if (feita?.de !== de) feita = { de, chave: chaveDeOrdemDaCarga(p, ms) };
    return feita.chave({ entidade: item.chave, modulo: item.modulo });
  };
}

/**
 * ADR 0054 (solução 5, entrada enquanto carrega): itens da carga inicial que liberam a entrada (`OpcoesMotorSync.essenciais`):
 * o envio e a etapa "Clientes e rota" (Campo) ou "Equipe" (Gestão), pela regra do Core (`essencialDaEntrada`), com perfil e
 * módulos lidos na hora. O predicado do Core é refeito só quando eles mudam.
 */
export function essenciaisDoUsuario(
  perfil: () => string | null | undefined,
  modulos: () => readonly string[],
): (item: ItemDaCarga) => boolean {
  let feito: { de: string; essencial: ReturnType<typeof essencialDaEntrada> } | null = null;
  return (item) => {
    const p = perfil() ?? null;
    const ms = modulos();
    const de = `${p ?? ''}|${ms.join(',')}`;
    if (feito?.de !== de) feito = { de, essencial: essencialDaEntrada(p, ms) };
    return feito.essencial({ entidade: item.chave, modulo: item.modulo });
  };
}
