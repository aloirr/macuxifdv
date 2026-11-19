/**
 * T-0145 (R-20261110-062232; RN-CORE-13 e RN-CORE-37): permissões obrigatórias do aparelho, conferidas a cada abertura,
 * ANTES do login e de qualquer sincronização. Sem todas, o app fica na tela "Permissões".
 * - Campo: notificações, localização "Permitir o tempo todo" (tracking da próxima semana), câmera e fotos/galeria.
 * - Gestão: notificações; o cargo rastreado no Gestão (o supervisor, T-0187 §1.2) também a localização "o tempo todo". Antes
 *   do login o cargo não é conhecido: a localização entra na tela depois do login (`permissoesExigidas`).
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

/** App rastreado de cada cargo (o `APP_RASTREADO_DO_CARGO` do Core, T-0187 §1.2); cargo fora do mapa não é rastreado. */
export type AppDoCargo = Readonly<Partial<Record<string, string>>>;

/**
 * T-0187 (RN-CORE-37): permissões exigidas da variante e do cargo da sessão. O Campo exige as 4 para todos. No Gestão, a
 * localização "o tempo todo" entra só para o cargo rastreado nele (o supervisor; o gerente não). Sem cargo (antes do login)
 * ou sem o mapa do Core, as da variante.
 */
export function permissoesExigidas(variante: Variante, cargo: string | null = null, appDoCargo: AppDoCargo = {}): readonly IdPermissao[] {
  const daVariante = PERMISSOES_DA_VARIANTE[variante];
  if (daVariante.includes('localizacao') || !cargo || appDoCargo[cargo] !== variante) return daVariante;
  return [...daVariante, 'localizacao'];
}

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

/** "Como usamos a localização" (onde a localização é exigida): o aviso curto da base LGPD do tracking (docs/desenho/T-0145-lgpd-tracking.md §6). */
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
  /** Link do aviso da localização: só quando a localização é exigida (Campo e o supervisor no Gestão). */
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

/**
 * Tudo o que a tela mostra, para a variante, o estado lido do aparelho e as permissões exigidas (`permissoesExigidas`; sem
 * elas, as da variante). `apiAndroid` nulo fora do Android.
 */
export function telaDePermissoes(
  variante: Variante,
  e: EstadosPermissoes,
  apiAndroid: number | null,
  toquesSemEfeito = 0,
  ids: readonly IdPermissao[] = PERMISSOES_DA_VARIANTE[variante],
): TelaDePermissoes {
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
    // o desenho: "Sem elas" com mais de uma permissão e "Sem ela" no Gestão só com notificações
    subtitulo: ids.length > 1 ? 'Sem elas o app não funciona.' : 'Sem ela o app não funciona.',
    linhas,
    passosLocalizacao: passos,
    avisoLocalizacao: ids.includes('localizacao') ? AVISO_LOCALIZACAO : null,
    botao: botaoDepoisDeToquesSemEfeito(proxima && acao ? { id: proxima.id, acao, rotulo: rotuloDa(acao, apiAndroid) } : null, toquesSemEfeito),
  };
}

/**
 * 🟡 1 da revisão T-0145 (R-20261110-105815/105914): a galeria nunca prende o app.
 * - Acesso parcial ("Permitir acesso limitado", Android 14+ e iOS): conta como concedida — o seletor de fotos do sistema
 *   funciona com qualquer nível e o app não lê a galeria inteira.
 * - Android 11 e 12 (API 30 a 32): o expo-image-picker pede WRITE_EXTERNAL_STORAGE junto com o READ; com targetSdk 36 o WRITE
 *   não dá acesso nenhum, pode voltar negado sem nada a marcar nas configurações. Conta como concedida com o READ concedido
 *   (lido à parte, `leituraAndroid`) ou com a câmera concedida (o seletor do sistema não depende do WRITE).
 */
export interface LeituraGaleria {
  estado: EstadoPermissao;
  /** O sistema respondeu acesso parcial (`accessPrivileges: 'limited'`). */
  limitada: boolean;
  /** READ_EXTERNAL_STORAGE concedido, lido sem diálogo (API ≤ 32); `null` quando não se aplica ou não foi lido. */
  leituraAndroid: boolean | null;
}

export const API_GALERIA_COM_WRITE_INUTIL = { de: 30, ate: 32 } as const;

export function galeriaEfetiva(g: LeituraGaleria, camera: EstadoPermissao, apiAndroid: number | null): EstadoPermissao {
  if (g.estado.concedida) return g.estado;
  const concedida: EstadoPermissao = { concedida: true, podePerguntar: true };
  if (g.limitada || g.leituraAndroid === true) return concedida;
  const writeInutil =
    apiAndroid !== null && apiAndroid >= API_GALERIA_COM_WRITE_INUTIL.de && apiAndroid <= API_GALERIA_COM_WRITE_INUTIL.ate;
  return writeInutil && camera.concedida ? concedida : g.estado;
}

/** Toques no "Permitir" sem nenhuma mudança no estado lido, a partir dos quais o botão passa a abrir as configurações. */
export const TOQUES_SEM_EFEITO_PARA_CONFIGURACOES = 2;

/**
 * 🟡 2 da revisão T-0145: se o diálogo não aparece (módulo nativo ausente, fabricante que engole o pedido) o estado não muda
 * e o "Permitir" ficaria em laço. Depois de {@link TOQUES_SEM_EFEITO_PARA_CONFIGURACOES} toques sem mudança, o botão vira
 * "Abrir configurações" (lá o vendedor marca à mão). O "Abrir configurações" já é a saída: não muda.
 */
export function botaoDepoisDeToquesSemEfeito(botao: BotaoPermissoes | null, toquesSemEfeito: number): BotaoPermissoes | null {
  if (!botao || botao.acao === 'abrir-configuracoes' || toquesSemEfeito < TOQUES_SEM_EFEITO_PARA_CONFIGURACOES) return botao;
  return { id: botao.id, acao: 'abrir-configuracoes', rotulo: ROTULO_ABRIR_CONFIGURACOES };
}

/** O toque no botão não mudou nada do que o aparelho responde (mesmas concessões e mesmo "pode perguntar"). */
export function mesmoEstadoDePermissoes(a: EstadosPermissoes, b: EstadosPermissoes): boolean {
  const igual = (x: EstadoPermissao, y: EstadoPermissao) => x.concedida === y.concedida && x.podePerguntar === y.podePerguntar;
  return (
    igual(a.notificacoes, b.notificacoes) &&
    igual(a.localizacao.duranteUso, b.localizacao.duranteUso) &&
    igual(a.localizacao.tempoTodo, b.localizacao.tempoTodo) &&
    igual(a.camera, b.camera) &&
    igual(a.galeria, b.galeria)
  );
}

/** Todas as permissões exigidas concedidas (sem a lista, as da variante): o app segue (login, carga e sincronização). */
export function permissoesLiberadas(
  variante: Variante,
  e: EstadosPermissoes,
  ids: readonly IdPermissao[] = PERMISSOES_DA_VARIANTE[variante],
): boolean {
  return ids.every((id) => situacaoDaPermissao(id, e) === 'permitida');
}

/** Estado "tudo concedido" (fora do Android, no navegador da demonstração, nada a pedir). */
export const TUDO_CONCEDIDO: EstadosPermissoes = (() => {
  const ok: EstadoPermissao = { concedida: true, podePerguntar: true };
  return { notificacoes: ok, localizacao: { duranteUso: ok, tempoTodo: ok }, camera: ok, galeria: ok };
})();
