/**
 * T-0145 (R-20261110-062232; RN-CORE-13 e RN-CORE-37): permissões obrigatórias do aparelho, conferidas a cada abertura,
 * ANTES do login e de qualquer sincronização. Sem todas, o app fica na tela "Permissões".
 * - Campo: notificações, localização "Permitir o tempo todo" (tracking da próxima semana), câmera e fotos/galeria.
 * - Gestão: só notificações.
 * Regras do desenho do designer-ux (`docs/design/permissoes-e-fotos-pdv.md` §1, imagem `telas/T-0145-permissoes.png`, aprovada
 * em R-20261110-093125): situação por linha (Permitida, Falta, Negada); UM botão, que pede a próxima que falta na ordem da tabela e vira
 * "Abrir configurações" quando o Android não pergunta mais (2 recusas) ou falta o passo 2 da localização. No Android 11+
 * (API 30) "o tempo todo" só existe nas configurações: 1º "durante o uso" (diálogo), 2º "Permitir o tempo todo".
 * Puro (roda em Node). Leitura e pedidos ao aparelho em `services/permissoes.ts`; a tela em `components/tela-permissoes.tsx`.
 */
import type { Variante } from './variante-tipo';

export type IdPermissao = 'notificacoes' | 'localizacao' | 'camera' | 'galeria';

/** Uma permissão do sistema: concedida e se o Android ainda mostra o diálogo. */
export interface EstadoPermissao {
  concedida: boolean;
  podePerguntar: boolean;
}

/** O que o aparelho respondeu (a localização tem os 2 níveis: durante o uso e o tempo todo). */
export interface EstadosPermissoes {
  notificacoes: EstadoPermissao;
  localizacao: { duranteUso: EstadoPermissao; tempoTodo: EstadoPermissao };
  camera: EstadoPermissao;
  galeria: EstadoPermissao;
}

/** Permissões exigidas por variante, na ordem da tela e do botão. */
export const PERMISSOES_DA_VARIANTE: Readonly<Record<Variante, readonly IdPermissao[]>> = {
  campo: ['notificacoes', 'localizacao', 'camera', 'galeria'],
  gestao: ['notificacoes'],
};

export type SituacaoPermissao = 'permitida' | 'falta' | 'negada';

/**
 * - `pedir`: diálogo do sistema;
 * - `pedir-tempo-todo`: passo 2 da localização (no Android 11+ o pedido leva à página de localização do app);
 * - `abrir-configuracoes`: o Android não pergunta mais (2 recusas): página do app nas configurações.
 */
export type AcaoPermissao = 'pedir' | 'pedir-tempo-todo' | 'abrir-configuracoes';

export interface LinhaPermissao {
  id: IdPermissao;
  nome: string;
  /** O motivo; na negada, o que fazer nas configurações. */
  texto: string;
  situacao: SituacaoPermissao;
}

export interface BotaoPermissoes {
  id: IdPermissao;
  acao: AcaoPermissao;
  rotulo: string;
}

/** Trecho de texto; `forte` = negrito (os nomes do Android que o vendedor procura nas configurações). */
export interface TrechoDeTexto {
  texto: string;
  forte?: boolean;
}

/** "Como usamos a localização" (só no Campo): o aviso curto da base LGPD do tracking (docs/desenho/T-0145-lgpd-tracking.md §6). */
export interface AvisoLocalizacao {
  link: string;
  titulo: string;
  texto: string;
}

export interface TelaDePermissoes {
  titulo: string;
  subtitulo: string;
  linhas: LinhaPermissao[];
  /** Cartão dos 2 passos (Android 11+, "durante o uso" já concedido e falta "o tempo todo"). */
  passosLocalizacao: { feito: string; falta: string; faltaTrechos: readonly TrechoDeTexto[] } | null;
  /** Link do aviso da localização: só na variante que pede a localização (Campo). */
  avisoLocalizacao: AvisoLocalizacao | null;
  /** Nulo = todas concedidas: o app segue sozinho. */
  botao: BotaoPermissoes | null;
}

// ---------- textos (os do desenho do designer-ux; valem os da imagem aprovada) ----------
export const TITULO_PERMISSOES = 'Permissões';
export const ROTULO_PERMITIR = 'Permitir';
export const ROTULO_ABRIR_CONFIGURACOES = 'Abrir configurações';
export const ROTULO_SITUACAO: Readonly<Record<SituacaoPermissao, string>> = {
  permitida: 'Permitida',
  falta: 'Falta',
  negada: 'Negada',
};
const NOMES: Readonly<Record<IdPermissao, string>> = {
  notificacoes: 'Notificações',
  localizacao: 'Localização o tempo todo',
  camera: 'Câmera',
  galeria: 'Fotos e galeria',
};
const MOTIVOS: Readonly<Record<IdPermissao, string>> = {
  notificacoes: 'Pedidos, aprovações e recados.',
  localizacao: 'Check-in e trajeto no horário de trabalho.',
  camera: 'Fotos do PDV e da gôndola.',
  galeria: 'Anexar fotos já tiradas.',
};
const MOTIVO_NOTIFICACOES_GESTAO = 'Pedidos para aprovar e recados.';
/** Na negada, o motivo vira a ação nas configurações. */
const NEGADA: Readonly<Record<IdPermissao, string>> = {
  notificacoes: 'Em Permissões › Notificações, marque Permitir.',
  localizacao: 'Em Permissões › Localização, marque Permitir o tempo todo.',
  camera: 'Em Permissões › Câmera, marque Permitir.',
  galeria: 'Em Permissões › Fotos e vídeos, marque Permitir.',
};
export const PASSO_FEITO_LOCALIZACAO = 'Durante o uso';
/** Passo 2, como na imagem aprovada: "Em **Permissões › Localização**, marque **Permitir o tempo todo**." */
export const PASSO_FALTA_TRECHOS: readonly TrechoDeTexto[] = [
  { texto: 'Em ' },
  { texto: 'Permissões › Localização', forte: true },
  { texto: ', marque ' },
  { texto: 'Permitir o tempo todo', forte: true },
  { texto: '.' },
];
export const PASSO_FALTA_LOCALIZACAO = PASSO_FALTA_TRECHOS.map((p) => p.texto).join('');
/** Texto curto do aviso (base LGPD §6, "prominent disclosure" do Google Play antes do pedido em segundo plano). */
export const AVISO_LOCALIZACAO: AvisoLocalizacao = {
  link: 'Como usamos a localização',
  titulo: 'Localização o tempo todo',
  texto:
    'Durante o expediente, o Macuxi registra o seu trajeto para comprovar as visitas e planejar a rota. Fora do expediente, nada é registrado.',
};

/** API do Android a partir da qual "o tempo todo" sai do diálogo e fica só nas configurações. */
export const API_LOCALIZACAO_EM_2_PASSOS = 30;

function situacaoDe(e: EstadoPermissao): SituacaoPermissao {
  return e.concedida ? 'permitida' : e.podePerguntar ? 'falta' : 'negada';
}

function situacaoDaLocalizacao(l: EstadosPermissoes['localizacao']): SituacaoPermissao {
  if (l.duranteUso.concedida && l.tempoTodo.concedida) return 'permitida';
  if (!l.duranteUso.concedida) return situacaoDe(l.duranteUso);
  return situacaoDe(l.tempoTodo);
}

function situacaoDaPermissao(id: IdPermissao, e: EstadosPermissoes): SituacaoPermissao {
  return id === 'localizacao' ? situacaoDaLocalizacao(e.localizacao) : situacaoDe(e[id]);
}

/** Ação do botão para a permissão que falta. */
function acaoDa(id: IdPermissao, e: EstadosPermissoes): AcaoPermissao {
  if (situacaoDaPermissao(id, e) === 'negada') return 'abrir-configuracoes';
  if (id === 'localizacao' && e.localizacao.duranteUso.concedida) return 'pedir-tempo-todo';
  return 'pedir';
}

/** Rótulo do botão: o passo 2 da localização no Android 11+ também é "Abrir configurações" (o sistema leva lá). */
function rotuloDa(acao: AcaoPermissao, apiAndroid: number | null): string {
  if (acao === 'abrir-configuracoes') return ROTULO_ABRIR_CONFIGURACOES;
  if (acao === 'pedir-tempo-todo' && apiAndroid !== null && apiAndroid >= API_LOCALIZACAO_EM_2_PASSOS) return ROTULO_ABRIR_CONFIGURACOES;
  return ROTULO_PERMITIR;
}

/** Tudo o que a tela mostra, para a variante e o estado lido do aparelho. `apiAndroid` nulo fora do Android. */
export function telaDePermissoes(variante: Variante, e: EstadosPermissoes, apiAndroid: number | null): TelaDePermissoes {
  const ids = PERMISSOES_DA_VARIANTE[variante];
  const l = e.localizacao;
  const passos =
    ids.includes('localizacao') &&
    apiAndroid !== null &&
    apiAndroid >= API_LOCALIZACAO_EM_2_PASSOS &&
    l.duranteUso.concedida &&
    !l.tempoTodo.concedida
      ? { feito: PASSO_FEITO_LOCALIZACAO, falta: PASSO_FALTA_LOCALIZACAO, faltaTrechos: PASSO_FALTA_TRECHOS }
      : null;
  const linhas = ids.map((id): LinhaPermissao => {
    const situacao = situacaoDaPermissao(id, e);
    const motivo = id === 'notificacoes' && variante === 'gestao' ? MOTIVO_NOTIFICACOES_GESTAO : MOTIVOS[id];
    // RD-0073: com o cartão dos 2 passos na tela, o caminho das configurações fica só nele; a linha mantém o motivo
    const caminhoNoCartao = id === 'localizacao' && passos !== null;
    return { id, nome: NOMES[id], texto: situacao === 'negada' && !caminhoNoCartao ? NEGADA[id] : motivo, situacao };
  });
  const proxima = linhas.find((linha) => linha.situacao !== 'permitida');
  const acao = proxima ? acaoDa(proxima.id, e) : null;
  return {
    titulo: TITULO_PERMISSOES,
    // o desenho: "Sem elas" no Campo (4 permissões) e "Sem ela" no Gestão (só notificações)
    subtitulo: ids.length > 1 ? 'Sem elas o app não funciona.' : 'Sem ela o app não funciona.',
    linhas,
    passosLocalizacao: passos,
    avisoLocalizacao: ids.includes('localizacao') ? AVISO_LOCALIZACAO : null,
    botao: proxima && acao ? { id: proxima.id, acao, rotulo: rotuloDa(acao, apiAndroid) } : null,
  };
}

/** Todas as permissões da variante concedidas: o app segue (login, carga e sincronização). */
export function permissoesLiberadas(variante: Variante, e: EstadosPermissoes): boolean {
  return PERMISSOES_DA_VARIANTE[variante].every((id) => situacaoDaPermissao(id, e) === 'permitida');
}

/** Estado "tudo concedido" (fora do Android, no navegador da demonstração, nada a pedir). */
export const TUDO_CONCEDIDO: EstadosPermissoes = (() => {
  const ok: EstadoPermissao = { concedida: true, podePerguntar: true };
  return { notificacoes: ok, localizacao: { duranteUso: ok, tempoTodo: ok }, camera: ok, galeria: ok };
})();
