/**
 * Licenças de módulo por usuário (RN-CORE-01, RN-CORE-03).
 *
 * A regra mora em `@macuxi/platform-sdk` (`modulosEfetivos`, ADR 0004), porque `packages/*` não pode importar
 * `modules/*` (fronteiras). O Core a consome aqui, com o vocabulário do módulo, e tem os testes de regra
 * (S0-040). A API chama esta função A CADA REQUISIÇÃO: o resultado nunca é gravado no JWT (S0-055).
 */
import { modulosEfetivos, verificarAcesso } from '@macuxi/platform-sdk';
/** RN-CORE-01/03: tenant ∩ perfil − exceções; core sempre; dependência inativa remove o dependente. */
export function calcularModulosEfetivos(e) {
    return modulosEfetivos(e);
}
/** O módulo está efetivo para o usuário? É o que a API checa por requisição (403 MODULO_INATIVO se não). */
export function moduloEstaAtivo(efetivos, modulo) {
    // Delega a checagem ao SDK (fonte única com a verificação de rota); o perfil não entra na decisão de módulo.
    return modulo === 'core' || verificarAcesso({ id: '-', tenant_id: '-', perfil: 'admin', modulos: efetivos }, { modulo, perfis: ['admin'] }).ok;
}
/** RN-CORE-01: o core não pode ser desativado em nenhum nível (tenant, perfil ou usuário). */
export function podeDesativarModulo(modulo) {
    return modulo !== 'core';
}
/** Módulos que saem entre duas listas de efetivos (RN-CORE-02: dados locais e fila precisam de tratamento). */
export function modulosRemovidos(antes, depois) {
    const d = new Set(depois);
    return [...antes].filter((m) => !d.has(m));
}
/**
 * RN-CORE-01/03 para a tela de licenças (que não tem os manifestos): mesma regra de `calcularModulosEfetivos`
 * com o mapa de dependências recebido da API. Core sempre; dependência fora derruba o dependente, em cascata.
 */
export function efetivosPelasDependencias(e) {
    const tenant = new Set(e.ativosNoTenant);
    const perfil = new Set(e.doPerfil);
    for (const r of e.removidosDoUsuario)
        perfil.delete(r);
    const efetivos = new Set(e.modulos.filter((m) => m === 'core' || (tenant.has(m) && perfil.has(m))));
    for (let mudou = true; mudou;) {
        mudou = false;
        for (const m of [...efetivos]) {
            if ((e.dependencias[m] ?? []).some((d) => d !== m && !efetivos.has(d))) {
                efetivos.delete(m);
                mudou = true;
            }
        }
    }
    return e.modulos.filter((m) => efetivos.has(m));
}
/** RN-CORE-03: módulos que também saem do ar quando `modulo` é desligado (dependentes diretos e indiretos). */
export function dependentesDe(modulo, modulos, dependencias) {
    const saem = new Set([modulo]);
    for (let mudou = true; mudou;) {
        mudou = false;
        for (const m of modulos) {
            if (!saem.has(m) && (dependencias[m] ?? []).some((d) => saem.has(d))) {
                saem.add(m);
                mudou = true;
            }
        }
    }
    saem.delete(modulo);
    return modulos.filter((m) => saem.has(m));
}
