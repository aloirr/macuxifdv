/**
 * Pontos de extensão de UI que o Core OFERECE (registro em .coord/contratos/extensoes.md; ADR 0003).
 *
 * Como funciona: o Core declara o slot em `manifest.ofereceExtensoes`; outro módulo registra itens em
 * `moduloApp.extensoes` / `moduloWeb.extensoes` (e lista o slot em `manifest.usaExtensoes`); as telas do Core
 * leem os itens com `useExtensoes('<slot>')` (`@macuxi/platform-sdk/react`). O shell já filtra por módulo
 * efetivo, perfil e ação (`acao` → ADR 0004): módulo desativado ou perfil sem permissão = item some, sem
 * erro (RN-CORE-03). O tipo do `payload` de cada slot é o definido aqui; `C` é o tipo de componente do
 * shell (React no web, React Native no app) — `contracts` não depende de React.
 *
 * Tela dona de cada slot (app Campo/Gestão):
 *  - `cliente.abas`            → ficha do cliente (caminho `cliente`)
 *  - `cliente.acoes`           → rodapé da ficha do cliente; só a ação com `destaque: true` (o "+ Novo pedido") entra, ao lado do Visitado (T-0076)
 *  - `cliente.avisos`          → logo abaixo do cabeçalho da ficha e acima das abas/ações; Banners de módulos (T-0102: etapa pendente da equipe, Gestor)
 *  - `visita.etapas_checkout`  → folha de checkout (RN-CORE-12)
 *  - `inicio.cards`            → tela Início do shell
 *  - `menu.itens`              → menu/Perfil do shell
 */
export const SLOTS_CORE = ['cliente.abas', 'cliente.acoes', 'cliente.avisos', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'];
