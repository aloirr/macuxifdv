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
 *  - `rota.parada_complemento` → 2ª linha da parada não iniciada na Rota, depois do horário (T-0187; só o Gestão registra)
 *  - `visita.etapas_checkout`  → folha de checkout (RN-CORE-12)
 *  - `inicio.cards`            → tela Início do shell
 *  - `menu.itens`              → menu/Perfil do shell
 */

/** O que as telas do Core entregam a quem registrou um item de cliente. */
export interface ContextoCliente {
  /** Id do cliente da ficha. */
  clienteId: string;
  /** Nome fantasia (para títulos e mensagens). */
  nomeCliente: string;
  /** Visita (check-in) aberta NESTE cliente, se houver — pedido e etapas se ligam a ela. */
  visitaId: string | null;
  /** Parada da rota de hoje que corresponde ao cliente, se houver. */
  paradaId: string | null;
}

/** Slot `cliente.abas`: seção/aba extra na ficha do cliente (ex.: "Sugestão de mix", "Últimos pedidos", "Loja"). */
export interface AbaCliente<C = unknown> {
  /** Título da seção. */
  rotulo: string;
  testID: string;
  /** Componente que recebe `{ contexto: ContextoCliente }`. */
  componente: C;
  /**
   * Opcional (aditivo): a seção mostra pedidos. O Core a esconde do promotor quando a opção `promotor_ve_pedidos` está
   * desligada (RN-PRO-01; T-0061). Itens com `acao` `pedido.*` já são filtrados sem esta marca.
   */
  mostraPedidos?: boolean;
}

/**
 * Slot `cliente.avisos` (aditivo, T-0102): aviso/Banner de módulo na ficha do cliente, abaixo do cabeçalho e acima das abas.
 * O componente decide sozinho se aparece (devolve `null` quando não há o que avisar); lê só o aparelho (offline-first).
 * Ex.: Gestor registra `AvisoEtapaEquipe` com `apps: ['gestao']` e `acao: 'painel_equipe.ver'`.
 */
export interface AvisoCliente<C = unknown> {
  testID: string;
  /** Componente que recebe `{ contexto: ContextoCliente }`. */
  componente: C;
}

/** Slot `cliente.acoes`: botão no rodapé da ficha (ex.: "Novo pedido"; o vendedor registra com `acao: 'pedido.criar'`). */
export interface AcaoCliente {
  /** Texto do botão; função para rótulo dinâmico (ex.: "Novo pedido · 3 itens"). */
  rotulo: string | ((ctx: ContextoCliente) => string);
  testID: string;
  /** Nome de ícone do kit `@macuxi/ui/mobile` (opcional). */
  icone?: string;
  /** Destaque visual (padrão: botão secundário). */
  destaque?: boolean;
  /** Opcional (aditivo): a ação abre/mostra pedidos; o Core a esconde do promotor com `promotor_ve_pedidos` desligada (T-0061). */
  mostraPedidos?: boolean;
  /** Executa a ação (navega, abre folha…). */
  abrir: (ctx: ContextoCliente) => void;
}

/** O que o checkout entrega a uma etapa registrada. */
export interface ContextoCheckout extends ContextoCliente {
  /** Id da visita sendo encerrada (sempre presente no checkout). */
  visitaId: string;
  /**
   * RN-CORE-14: o checkout é de cliente fechado (`loja_fechada` ou `acesso_negado`, com foto da fachada).
   * Quando `true`, TODAS as etapas obrigatórias estão dispensadas (pesquisa RN-PES-03, checklist RN-PRO-06):
   * a etapa deve se tratar como cumprida/oculta. Ausente = `false` (compatível com quem monta o contexto à mão).
   */
  clienteFechado?: boolean;
  /** Motivo de cliente fechado escolhido, ou `null`/ausente. */
  motivoClienteFechado?: 'loja_fechada' | 'acesso_negado' | null;
}

/**
 * Slot `visita.etapas_checkout`: etapa do checkout (ex.: pesquisa obrigatória, checklist da loja).
 * RN-CORE-12: com etapa `obrigatoria` pendente de módulo ativo, o botão "Concluir checkout" fica bloqueado.
 */
export interface EtapaCheckout<C = unknown> {
  rotulo: string;
  testID: string;
  obrigatoria: boolean;
  /** Já foi cumprida nesta visita? (lê o estado do próprio módulo; o Core só pergunta.) */
  concluida: (ctx: ContextoCheckout) => boolean;
  /** Componente exibido na folha de checkout (recebe `{ contexto: ContextoCheckout }`). */
  componente: C;
}

/**
 * Slot `rota.parada_complemento`: texto após o horário na parada não iniciada da Rota ("09:00 · Carla Lima").
 * Só no app Gestão; nenhum dado pessoal é gravado no aparelho. O Core usa a primeira contribuição (por ordem).
 */
export interface ComplementoParada {
  /** Hook React (chamado num subcomponente por parada): texto de até 60 caracteres, ou null. */
  usarTexto: (clienteId: string) => string | null;
}

/** Slot `inicio.cards`: card na tela Início (recebe `{}`; usa os hooks do SDK). */
export interface CardInicio<C = unknown> {
  testID: string;
  componente: C;
  /** T-0073 (aditivo): menor primeiro; ausente = 100. Ex.: o card "Pedidos para aprovar" do Gestor usa 10. */
  ordem?: number;
}

/** Slot `menu.itens`: item no menu do Perfil/BKO. */
export interface ItemMenu {
  rotulo: string;
  testID: string;
  /** Caminho de página registrada (app: `/m/<caminho>`; web: `/<caminho>`). */
  caminho: string;
}

/** Slot → tipo do payload (para `criarRegistroExtensoes<SlotsCore>()`). */
export interface SlotsCore<C = unknown> {
  'cliente.abas': AbaCliente<C>;
  'cliente.acoes': AcaoCliente;
  'cliente.avisos': AvisoCliente<C>;
  'rota.parada_complemento': ComplementoParada;
  'visita.etapas_checkout': EtapaCheckout<C>;
  'inicio.cards': CardInicio<C>;
  'menu.itens': ItemMenu;
}

export const SLOTS_CORE = ['cliente.abas', 'cliente.acoes', 'cliente.avisos', 'rota.parada_complemento', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'] as const;
