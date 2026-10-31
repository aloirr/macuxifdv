/**
 * LEGADO DA FASE M — o antigo `@fv/contracts` agora é a soma dos contracts do core e do vendedor
 * (desenho T-0001 §4). Só o mock-api usa esta ponte; código novo importa direto do contracts do módulo dono.
 */
export * from '@macuxi/core/contracts';
export * from '@macuxi/vendedor/contracts';
