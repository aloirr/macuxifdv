/**
 * Só para o Vitest (alias em vitest.config.ts): `@macuxi/ui/mobile` inteiro puxa react-native/expo-router,
 * que não rodam em Node. As libs puras do app só precisam de tempo e texto. Provisório até o packages/ui
 * exportar um subcaminho puro (pedido ao engenheiro-software, T-0001/B2).
 */
export * from '../../../../packages/ui/src/mobile/time';
export * from '../../../../packages/ui/src/mobile/text';
