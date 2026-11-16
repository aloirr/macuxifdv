/**
 * RN-CORE-48 (pedido do dono do produto, 14/11: "1 de 5, 2 de 5, 3 de 5..."): ordem da carga do motor de sync pela etapa da
 * tela de entrada. Puro (roda em Node nos testes); quem monta o motor é `services/motor-do-usuario.ts`.
 */
import { chaveDeOrdemDaCarga, essencialDaEntrada } from '@macuxi/core/app';
import type { ItemDaCarga } from '@macuxi/platform-sdk';

/** Item como o Core o lê (entidade e módulo). */
type ItemDoCore = Parameters<ReturnType<typeof chaveDeOrdemDaCarga>>[0];

/**
 * Função do Core por perfil e módulos efetivos, lidos na hora de cada chamada; a do Core é refeita só quando eles mudam.
 * Serve à ordem da carga e aos essenciais.
 */
function porPerfilEModulos<R>(
  fabrica: (perfil: string | null, modulos: readonly string[]) => (item: ItemDoCore) => R,
  perfil: () => string | null | undefined,
  modulos: () => readonly string[],
): (item: ItemDaCarga) => R {
  let feita: { de: string; fn: (item: ItemDoCore) => R } | null = null;
  return (item) => {
    const p = perfil() ?? null;
    const ms = modulos();
    const de = `${p ?? ''}|${ms.join(',')}`;
    if (feita?.de !== de) feita = { de, fn: fabrica(p, ms) };
    return feita.fn({ entidade: item.chave, modulo: item.modulo });
  };
}

/** A carga roda na ordem das etapas da tela de entrada (1, 2, 3... de N), pelo perfil e pelos módulos efetivos. */
export function ordemDaCargaDoUsuario(
  perfil: () => string | null | undefined,
  modulos: () => readonly string[],
): (item: ItemDaCarga) => number {
  return porPerfilEModulos(chaveDeOrdemDaCarga, perfil, modulos);
}

/**
 * ADR 0054 (solução 5, entrada enquanto carrega): itens da carga inicial que liberam a entrada (`OpcoesMotorSync.essenciais`),
 * pela regra do Core (`essencialDaEntrada`).
 */
export function essenciaisDoUsuario(
  perfil: () => string | null | undefined,
  modulos: () => readonly string[],
): (item: ItemDaCarga) => boolean {
  return porPerfilEModulos(essencialDaEntrada, perfil, modulos);
}
