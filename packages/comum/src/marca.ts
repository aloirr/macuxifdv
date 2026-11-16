/**
 * RD-0704 (T-0182): FONTE ÚNICA do texto de acessibilidade da logo do cliente (spec `docs/design/telas/logo-cliente.md` §1).
 * Puro, sem dependência: o `@macuxi/platform-sdk` (`empresa-logo.ts`, para o portal) reexporta e o kit `@macuxi/ui` (placa
 * da logo, TalkBack) importa daqui; o kit não depende do SDK.
 */

/** "Logo da <nome>": rótulo do TalkBack na placa e `alt` da imagem no portal. */
export const rotuloDaLogo = (nome: string): string => `Logo da ${nome}`;
