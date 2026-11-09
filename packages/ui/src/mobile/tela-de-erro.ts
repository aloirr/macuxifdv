/**
 * T-0140 (relato de 08/11: o Novo pedido fechava o app): textos PUROS da tela de erro do shell e da linha "Último erro" do
 * Diagnóstico do Perfil. Spec: docs/design/tela-de-erro.md. Componente: `TelaDeErro` (tela-de-erro-rn.tsx).
 * Padrão de texto do app (componentes.md §7): diz o que houve e o que fazer, nunca culpa a pessoa, sem jargão
 * ("render", "exception", "fatal" ficam fora da tela). Mesma frase de abertura da tela de erro do armazenamento
 * ("O que você registrou continua guardado neste aparelho") e o mesmo fecho do login ("Tente de novo; se continuar, avise o
 * suporte").
 * Sem react-native: roda em Node e é reexportado por `@macuxi/ui/mobile/puro`.
 */

/** `tela`: erro numa tela de módulo (a barra de abas continua). `app`: erro fora das telas de módulo (raiz do shell). */
export type AlcanceDoErro = 'tela' | 'app';

export interface TextosTelaDeErro {
  titulo: string;
  texto: string;
  /** Botão principal (único da tela). */
  tentar: string;
  /** Botão secundário de saída; `null` na raiz (lá não há para onde ir dentro do app). */
  inicio: string | null;
  /** Botão neutro opcional (Share do sistema com o detalhe técnico). */
  suporte: string;
  /** Linha pequena no fim: onde o detalhe fica depois. */
  nota: string;
}

const GUARDADO = 'O que você registrou continua guardado neste aparelho.';

export const TEXTOS_TELA_DE_ERRO: Readonly<Record<AlcanceDoErro, TextosTelaDeErro>> = {
  tela: {
    titulo: 'Não foi possível mostrar esta tela',
    texto: `${GUARDADO} Tente de novo; se continuar, avise o suporte.`,
    tentar: 'Tentar de novo',
    inicio: 'Ir para o Início',
    suporte: 'Enviar o detalhe ao suporte',
    nota: 'O detalhe do erro fica em Perfil › Diagnóstico.',
  },
  app: {
    titulo: 'Não foi possível mostrar o app',
    texto: `${GUARDADO} Tente de novo; se continuar, feche e abra o app e avise o suporte.`,
    tentar: 'Tentar de novo',
    inicio: null,
    suporte: 'Enviar o detalhe ao suporte',
    nota: 'O detalhe do erro fica em Perfil › Diagnóstico.',
  },
};

/** O que o leitor de tela anuncia quando a tela de erro aparece (título e o que fazer). */
export function leituraDaTelaDeErro(t: { titulo: string; texto: string }): string {
  return `${t.titulo}. ${t.texto}`;
}

// ---------- linha "Último erro" do Diagnóstico do Perfil ----------

/** Mesmas origens do registro do shell (`apps/mobile/src/lib/erro-de-tela.ts`). */
export type OrigemDoErroRegistrado = 'tela' | 'raiz' | 'fatal' | 'nao-fatal';

/** Sem registro (o par de "Nenhuma falha de sincronização registrada neste aparelho."). */
export const TEXTO_SEM_ERRO_REGISTRADO = 'Nenhum erro do app registrado neste aparelho.';

/** O efeito que o suporte precisa saber: o app mostrou a tela de erro, fechou ou seguiu aberto. */
export const EFEITO_DO_ERRO: Readonly<Record<OrigemDoErroRegistrado, string>> = {
  tela: 'mostrou a tela de erro',
  raiz: 'mostrou a tela de erro do app',
  fatal: 'o app fechou',
  'nao-fatal': 'o app seguiu aberto',
};

/**
 * 1ª linha do "Último erro" no Diagnóstico: "Último erro do app: hoje 17:15 · o app fechou · /m/novo-pedido".
 * `quando` chega já formatado no fuso do tenant; a mensagem técnica e a pilha vão nas linhas de baixo, como estão.
 */
export function cabecalhoDoUltimoErro(origem: OrigemDoErroRegistrado, quando: string, onde: string | null = null): string {
  return `Último erro do app: ${quando} · ${EFEITO_DO_ERRO[origem]}${onde ? ` · ${onde}` : ''}`;
}
