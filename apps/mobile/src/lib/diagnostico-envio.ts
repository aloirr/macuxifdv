/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §5): diagnóstico do aparelho enviado à plataforma (`POST /v1/diagnosticos`,
 * contrato `DiagnosticoEnvioSchema` do SDK). Puro (roda em Node): a leitura do aparelho, o armazenamento e o HTTP ficam em
 * `services/diagnostico.ts`.
 * - v1.0.4: o botão "Enviar diagnóstico" do Perfil monta o pacote técnico (versão, aparelho, Android, tela, horário, último erro,
 *   as 5 últimas saídas do Android e a fila do sync), com o "O que aconteceu?" e o print opcional. O pacote vai sempre, sem
 *   aviso na tela (R-20261110-192152: sem a linha "Vai junto"). Entra numa fila própria do aparelho
 *   (UUID gerado na hora, idempotente pelo `id`); com sinal vai na hora e mostra "Enviado · nº 0042"; sem sinal fica "Na fila".
 *   O print vai pela fila de arquivos (ADR 0010) só DEPOIS de o servidor aceitar o diagnóstico.
 * - v1.0.5 (atrás de `QUEDA_AUTOMATICA_LIGADA`): na abertura seguinte a uma queda, depois do login, a saída do Android vira
 *   `origem = 'queda'` e o "Último erro do app" vira `origem = 'erro_tela'`, sem toque, com id estável (UUID v5).
 * Nunca vai nome, e-mail, telefone, cliente ou valor: empresa e usuário vão pelo token (o `.strict()` do contrato recusa o resto)
 * e todo texto livre passa pela máscara única de dado pessoal aqui e de novo no servidor.
 */
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import {
  codigoDoMotivoAndroid,
  CODIGOS_DIAGNOSTICO,
  DiagnosticoEnvioSchema,
  DiagnosticoRespostaSchema,
  formatarProtocolo,
  MAX_SAIDAS_DIAGNOSTICO,
  ROTA_DIAGNOSTICOS,
  type DiagnosticoEnvio,
  type DiagnosticoResposta,
  type OrigemDiagnostico,
} from '@macuxi/platform-sdk';

import type { ErroRegistrado } from './erro-de-tela';
import type { HistoricoShell } from './historico-telas';
import { ehQueda, JANELA_PRIMEIRA_LEITURA_MS, MESMO_FECHAMENTO_MS, type SaidaAndroid } from './saida-android';

/**
 * v1.0.4: o botão "Enviar diagnóstico" e a fila. DESLIGADO até o corte da v1.0.3 (o lote de 10/11 sai sem nada disto, nem
 * chamada nova à API); a v1.0.4 troca para `true`. Para testar antes num build de desenvolvimento: `EXPO_PUBLIC_DIAGNOSTICO_NUVEM=1`.
 */
export const DIAGNOSTICO_NUVEM_LIGADO = false;

/**
 * v1.0.5: envio automático da queda na abertura seguinte (só vale com o de cima ligado). DESLIGADO na v1.0.4; a v1.0.5 troca
 * para `true` depois do teste da queda forçada no aparelho de teste (critério 6 da T-0158).
 */
export const QUEDA_AUTOMATICA_LIGADA = false;

/**
 * Chave remota (R-20261111-004711: ligar depois sem build novo): o `GET /v1/saude` do servidor diz `recursos.diagnosticos`
 * (o `MACUXI_DIAGNOSTICOS` da VM, que liga também o portal). `true`/`false` = o que o servidor disse; servidor sem o campo =
 * `false`; resposta que não é objeto = `null` (não sabe: fica o que estava guardado).
 */
export function diagnosticoNoServidor(saude: unknown): boolean | null {
  if (!saude || typeof saude !== 'object') return null;
  const recursos = (saude as { recursos?: unknown }).recursos;
  const v = recursos && typeof recursos === 'object' ? (recursos as { diagnosticos?: unknown }).diagnosticos : undefined;
  return v === true;
}

/** Chave remota guardada no aparelho (vale sem sinal até a próxima leitura do servidor). */
export const CHAVE_DIAGNOSTICO_REMOTO = 'fv:diagnostico:remoto';

/** Liga o diagnóstico na nuvem: a constante da versão ou a variável do build de teste. */
export function diagnosticoNuvemLigado(constante: boolean, variavel: string | undefined): boolean {
  return constante || variavel === '1';
}

/** Fila e histórico dos diagnósticos (AsyncStorage do aparelho, fora do prefixo do usuário; cada item guarda o dono). */
export const CHAVE_FILA_DIAGNOSTICOS = 'fv:diagnostico:envios';
/** v1.0.5: até onde as quedas e o último erro já viraram diagnóstico automático. */
export const CHAVE_DIAGNOSTICO_AUTOMATICO = 'fv:diagnostico:automatico';
/** Envios com protocolo mostrados no Diagnóstico (os mais novos). */
export const HISTORICO_DIAGNOSTICOS = 10;
/** Teto de itens guardados (fila + histórico de todos os usuários do aparelho). */
export const MAX_REGISTROS_DIAGNOSTICO = 40;
/** "O que aconteceu?": limite do contrato. */
export const MAX_DESCRICAO_DIAGNOSTICO = 1000;
/** v1.0.5: quedas novas enviadas por abertura (as mais recentes; o servidor agrupa as repetidas). */
export const MAX_QUEDAS_POR_ABERTURA = 3;
/** Caminho da rota relativo ao endereço da API, que já termina em `/v1` (como `/arquivos/:id` no transporte). */
export const CAMINHO_DIAGNOSTICOS = ROTA_DIAGNOSTICOS.replace(/^\/v1(?=\/)/, '');

/** Textos finais (imagem `docs/design/telas/T-0158-diagnostico-app.png`, quadro 7, aprovada em R-20261110-192152 sem "Vai junto"). */
export const TEXTOS_DIAGNOSTICO = {
  botao: 'Enviar diagnóstico',
  titulo: 'Enviar diagnóstico',
  pergunta: 'O que aconteceu?',
  exemplo: 'Ex.: o app fechou ao salvar o pedido.',
  aviso: 'Não escreva nome de cliente, telefone ou valores.',
  anexar: 'Anexar print (opcional)',
  printAnexado: 'Print anexado',
  printQuemVe: 'Só a equipe Macuxi vê.',
  remover: 'Remover',
  enviar: 'Enviar',
  enviando: 'Enviando…',
  fechar: 'Fechar',
  enviado: 'Enviado',
  enviadoAjuda: 'Se falar com o suporte, diga este número.',
  naFila: 'Na fila',
  naFilaAjuda: 'Sem sinal. Não precisa enviar de novo.',
  naFilaServidorAjuda: 'Servidor indisponível. Não precisa enviar de novo.',
  naoEnviado: 'Não enviado',
  limiteAjuda: 'Muitos envios nesta hora. Tente mais tarde.',
  recusadoAjuda: 'Não deu para enviar. Tente de novo.',
  historico: 'Últimos envios',
  semSinal: 'sem sinal',
  servidorIndisponivel: 'servidor indisponível',
  limiteDaHora: 'limite da hora',
  recusado: 'recusado',
} as const;

// ---------- pacote técnico ----------

/** Dados do aparelho e do app lidos pelo shell (`services/diagnostico.ts`). */
export interface ContextoDiagnostico {
  app: 'campo' | 'gestao';
  versao_app: string;
  build: string | null;
  aparelho: { fabricante: string; modelo: string; android: string; api: number };
  /** Fila do sync (só contagem e data, sem conteúdo); `null` = motor ainda não aberto. */
  sync: { pendentes: number; ultimo_sync_em: string | null } | null;
}

export interface EntradaDiagnostico {
  id: string;
  origem: OrigemDiagnostico;
  ocorridoEm: Date | string;
  contexto: ContextoDiagnostico;
  tela: string | null;
  motivo: string | null;
  descricao: string | null;
  erro: ErroRegistrado | null;
  /** Saída do Android que motivou o envio (`origem = 'queda'` ou o fatal do mesmo fechamento); `null` no botão. */
  saida: SaidaAndroid | null;
  /** As saídas do Android lidas agora (mais nova primeiro); `null` = APK sem o `macuxi-saida`. */
  ultimasSaidas: readonly SaidaAndroid[] | null;
  printId: string | null;
}

/** Corta com reticências (o contrato recusa texto acima do limite). */
function cortar(t: string, max: number): string {
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const limpo = (t: string | null | undefined, max: number): string | null => {
  const v = (t ?? '').trim();
  return v ? cortar(mascararDadoPessoal(v), max) : null;
};

const inteiro = (n: number, min = 0): number => (Number.isFinite(n) ? Math.max(min, Math.round(n)) : min);

function iso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "Último erro do app" no formato do contrato (já mascarado no aparelho; mascara de novo por garantia). */
export function erroDoContrato(r: ErroRegistrado): NonNullable<DiagnosticoEnvio['erro']> {
  return {
    mensagem: limpo(r.mensagem, 300) ?? 'Erro sem mensagem',
    pilha: limpo(r.pilha, 2000),
    origem: cortar(r.origem, 40),
  };
}

/** Saída do processo (T-0144, `macuxi-saida`) no formato do contrato. */
export function saidaDoContrato(s: SaidaAndroid): NonNullable<DiagnosticoEnvio['saida_android']> {
  return {
    motivo: Math.round(s.motivo) || 0,
    status: Math.round(s.status) || 0,
    importancia: Math.round(s.importancia) || 0,
    pss_kb: inteiro(s.pss_kb),
    rss_kb: inteiro(s.rss_kb),
    descricao: limpo(s.descricao, 300) ?? '',
    pilha: limpo(s.pilha, 4000),
  };
}

/** Uma das últimas saídas no formato do contrato (com o horário e a pilha curta: o ponto da falha). */
export function saidaDaListaDoContrato(s: SaidaAndroid): NonNullable<DiagnosticoEnvio['ultimas_saidas']>[number] {
  // a pilha passa uma vez só pela máscara (sem a de 4000 da `saidaDoContrato`)
  const { pilha, ...semPilha } = s;
  return { ...saidaDoContrato(semPilha), quando: new Date(Number.isFinite(s.quando) ? s.quando : 0).toISOString(), pilha: limpo(pilha, 1000) };
}

/**
 * As 5 últimas saídas (R-20261110-192152: uma queda seguida de reaberturas aparece inteira), da mais nova à mais antiga. A
 * saída que motivou o envio fica sempre na lista: se for mais antiga que as 5, entra no lugar da última.
 */
export function ultimasSaidasDoEnvio(todas: readonly SaidaAndroid[], principal: SaidaAndroid | null): SaidaAndroid[] {
  const lista = [...todas].sort((a, b) => b.quando - a.quando).slice(0, MAX_SAIDAS_DIAGNOSTICO);
  if (principal && !lista.some((s) => s.quando === principal.quando && s.motivo === principal.motivo)) {
    lista.splice(MAX_SAIDAS_DIAGNOSTICO - 1, 1, principal);
    lista.sort((a, b) => b.quando - a.quando);
  }
  return lista;
}

/** Monta e confere o corpo do `POST /v1/diagnosticos` (lança se sair fora do contrato: erro de programação, nunca do usuário). */
export function montarEnvio(e: EntradaDiagnostico): DiagnosticoEnvio {
  const c = e.contexto;
  const corpo: DiagnosticoEnvio = {
    id: e.id.toLowerCase(),
    origem: e.origem,
    ocorrido_em: iso(e.ocorridoEm) ?? new Date(0).toISOString(),
    app: c.app,
    versao_app: cortar(c.versao_app.trim() || '?', 20),
    build: c.build ? cortar(c.build, 60) : null,
    aparelho: {
      fabricante: cortar(c.aparelho.fabricante, 60),
      modelo: cortar(c.aparelho.modelo, 80),
      android: cortar(c.aparelho.android, 20),
      api: Math.min(1000, inteiro(c.aparelho.api)),
    },
    // a rota sem a query (pode trazer o texto de uma busca); os ids da rota são UUID
    tela: e.tela ? cortar(e.tela.split('?')[0]!, 200) || null : null,
    motivo: e.motivo ? cortar(e.motivo, 60) : null,
    descricao: limpo(e.descricao, MAX_DESCRICAO_DIAGNOSTICO),
    erro: e.erro ? erroDoContrato(e.erro) : null,
    saida_android: e.saida ? saidaDoContrato(e.saida) : null,
    ultimas_saidas: e.ultimasSaidas ? ultimasSaidasDoEnvio(e.ultimasSaidas, e.saida).map(saidaDaListaDoContrato) : null,
    sync: c.sync ? { pendentes: inteiro(c.sync.pendentes), ultimo_sync_em: iso(c.sync.ultimo_sync_em) } : null,
    print_id: e.printId ? e.printId.toLowerCase() : null,
  };
  return DiagnosticoEnvioSchema.parse(corpo);
}

/** Tela de módulo em uso (a última da aba aberta), sem a query; `null` = nenhuma ainda. */
export function telaDoHistorico(h: HistoricoShell): string | null {
  const pilha = h.aba ? h.pilhas[h.aba] : undefined;
  const ultima = pilha?.[pilha.length - 1];
  return ultima ? ultima.href.split('?')[0]! || null : null;
}

// ---------- fila e histórico ----------

export type SituacaoDiagnostico = 'na_fila' | 'enviado' | 'falhou';

export interface RegistroDiagnostico {
  id: string;
  /** Dono do envio: só sai com a sessão deste usuário e desta empresa (o token diz quem enviou). */
  usuario_id: string;
  tenant_id: string | null;
  criado_em: string;
  envio: DiagnosticoEnvio;
  situacao: SituacaoDiagnostico;
  protocolo: number | null;
  enviado_em: string | null;
  tentativas: number;
  ultimo_erro: string;
  codigo: string | null;
  /** O print já entrou na fila de arquivos do motor (só depois do `POST` aceito). */
  print_na_fila: boolean;
}

export interface DonoDiagnostico {
  usuarioId: string;
  tenantId: string | null;
}

export function novoRegistro(envio: DiagnosticoEnvio, dono: DonoDiagnostico, agora: Date): RegistroDiagnostico {
  return {
    id: envio.id,
    usuario_id: dono.usuarioId,
    tenant_id: dono.tenantId,
    criado_em: agora.toISOString(),
    envio,
    situacao: 'na_fila',
    protocolo: null,
    enviado_em: null,
    tentativas: 0,
    ultimo_erro: '',
    codigo: null,
    print_na_fila: false,
  };
}

/** Lista lida do armazenamento: descarta o que não tem a forma de um registro (versão antiga, lixo). */
export function filaValida(bruto: unknown): RegistroDiagnostico[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(
    (r): r is RegistroDiagnostico =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as RegistroDiagnostico).id === 'string' &&
      typeof (r as RegistroDiagnostico).usuario_id === 'string' &&
      ['na_fila', 'enviado', 'falhou'].includes((r as RegistroDiagnostico).situacao) &&
      DiagnosticoEnvioSchema.safeParse((r as RegistroDiagnostico).envio).success,
  );
}

const doDono = (r: RegistroDiagnostico, d: DonoDiagnostico) => r.usuario_id === d.usuarioId && r.tenant_id === d.tenantId;
const maisNovoPrimeiro = (a: RegistroDiagnostico, b: RegistroDiagnostico) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0);

/**
 * Guarda tudo o que está na fila (ou com o print ainda por enfileirar) e só os `HISTORICO_DIAGNOSTICOS` mais novos de cada
 * usuário entre os encerrados; acima do teto geral saem os encerrados mais antigos.
 */
export function podarFila(lista: readonly RegistroDiagnostico[]): RegistroDiagnostico[] {
  const vivo = (r: RegistroDiagnostico) => r.situacao === 'na_fila' || (r.situacao === 'enviado' && r.envio.print_id !== null && !r.print_na_fila);
  const porUsuario = new Map<string, number>();
  const manter = new Set<string>();
  for (const r of [...lista].sort(maisNovoPrimeiro)) {
    if (vivo(r)) {
      manter.add(r.id);
      continue;
    }
    const chave = `${r.tenant_id ?? ''}:${r.usuario_id}`;
    const n = porUsuario.get(chave) ?? 0;
    if (n < HISTORICO_DIAGNOSTICOS) manter.add(r.id);
    porUsuario.set(chave, n + 1);
  }
  let resto = lista.filter((r) => manter.has(r.id));
  if (resto.length > MAX_REGISTROS_DIAGNOSTICO) {
    const sair = new Set(
      resto
        .filter((r) => !vivo(r))
        .sort(maisNovoPrimeiro)
        .slice(Math.max(0, MAX_REGISTROS_DIAGNOSTICO - resto.filter(vivo).length))
        .map((r) => r.id),
    );
    resto = resto.filter((r) => !sair.has(r.id));
  }
  return resto;
}

/** Entra na fila; o mesmo `id` não entra duas vezes (idempotente). */
export function adicionarNaFila(lista: readonly RegistroDiagnostico[], r: RegistroDiagnostico): RegistroDiagnostico[] {
  if (lista.some((x) => x.id === r.id)) return [...lista];
  return podarFila([...lista, r]);
}

/** O que sai agora com esta sessão: os da fila do mesmo usuário e empresa, do mais antigo ao mais novo. */
export function paraEnviar(lista: readonly RegistroDiagnostico[], dono: DonoDiagnostico): RegistroDiagnostico[] {
  return lista.filter((r) => r.situacao === 'na_fila' && doDono(r, dono)).sort((a, b) => -maisNovoPrimeiro(a, b));
}

/** Prints de diagnósticos já aceitos que ainda não entraram na fila de arquivos. */
export function printsParaEnfileirar(lista: readonly RegistroDiagnostico[], dono: DonoDiagnostico): RegistroDiagnostico[] {
  return lista.filter((r) => r.situacao === 'enviado' && r.envio.print_id !== null && !r.print_na_fila && doDono(r, dono));
}

/** Histórico do Diagnóstico: os envios deste usuário, do mais novo ao mais antigo. */
export function historicoDoUsuario(lista: readonly RegistroDiagnostico[], dono: DonoDiagnostico): RegistroDiagnostico[] {
  return lista.filter((r) => doDono(r, dono)).sort(maisNovoPrimeiro).slice(0, HISTORICO_DIAGNOSTICOS);
}

function atualizar(lista: readonly RegistroDiagnostico[], id: string, mudanca: Partial<RegistroDiagnostico>): RegistroDiagnostico[] {
  return podarFila(lista.map((r) => (r.id === id ? { ...r, ...mudanca } : r)));
}

export function marcarPrintNaFila(lista: readonly RegistroDiagnostico[], id: string): RegistroDiagnostico[] {
  return atualizar(lista, id, { print_na_fila: true });
}

/** Resultado de uma tentativa de envio. */
export type ResultadoTentativa =
  | { tipo: 'aceito'; resposta: DiagnosticoResposta }
  | { tipo: 'retentar'; codigo: string | null; mensagem: string }
  | { tipo: 'recusado'; codigo: string | null; mensagem: string };

export function aplicarResultado(
  lista: readonly RegistroDiagnostico[],
  id: string,
  r: ResultadoTentativa,
  agora: Date,
): RegistroDiagnostico[] {
  const atual = lista.find((x) => x.id === id);
  if (!atual) return [...lista];
  const tentativas = atual.tentativas + 1;
  if (r.tipo === 'aceito')
    return atualizar(lista, id, { situacao: 'enviado', protocolo: r.resposta.protocolo, enviado_em: agora.toISOString(), tentativas, ultimo_erro: '', codigo: null });
  return atualizar(lista, id, { situacao: r.tipo === 'recusado' ? 'falhou' : 'na_fila', tentativas, ultimo_erro: r.mensagem, codigo: r.codigo });
}

/** Erro do `ApiClient` (`HttpError`: `status` e `code`; `NetworkError`: sem `status`), lido sem importar o serviço. */
interface ErroLido {
  status?: unknown;
  code?: unknown;
  codigo?: unknown;
  message?: unknown;
}

/**
 * Sem rede, tempo esgotado, 5xx, 401 (a sessão renova e tenta depois) e 408: fica na fila. 429 (`DIAGNOSTICO_LIMITE`): "Não enviado".
 * 404, 405 e 501: a rota ainda não está no servidor (API anterior à v1.0.4 ou o servidor da demonstração): fica na fila.
 * Os outros 4xx (corpo recusado, 409 `DIAGNOSTICO_JA_EXISTE`): não adianta repetir, vira `falhou`.
 */
export function resultadoDoErro(e: unknown): ResultadoTentativa {
  const o = (e && typeof e === 'object' ? e : {}) as ErroLido;
  const status = typeof o.status === 'number' ? o.status : null;
  const codigo = typeof o.code === 'string' ? o.code : typeof o.codigo === 'string' ? o.codigo : null;
  if (status === null) return { tipo: 'retentar', codigo: null, mensagem: SEM_SINAL_COM_O_SERVIDOR };
  if (status === 404 || status === 405 || status === 501)
    return { tipo: 'retentar', codigo, mensagem: 'O servidor ainda não recebe diagnósticos. Fica na fila.' };
  // imagem T-0158 (quadro 7): acima de 20 por hora vira "Não enviado · limite da hora" (o vendedor tenta mais tarde)
  if (status === 429 || codigo === CODIGOS_DIAGNOSTICO.limite) return { tipo: 'recusado', codigo: CODIGOS_DIAGNOSTICO.limite, mensagem: TEXTOS_DIAGNOSTICO.limiteAjuda };
  if (status >= 500 || status === 401 || status === 408) return { tipo: 'retentar', codigo, mensagem: `O servidor não respondeu (${status}).` };
  if (codigo === CODIGOS_DIAGNOSTICO.jaExiste) return { tipo: 'recusado', codigo, mensagem: 'Este diagnóstico já foi registrado por outro usuário.' };
  return { tipo: 'recusado', codigo, mensagem: `O servidor recusou o diagnóstico (${codigo ?? status}).` };
}

/** Resposta 200/201: confere pelo contrato; fora dele (ou de outro id) fica na fila para tentar de novo. */
export function resultadoDaResposta(id: string, dados: unknown): ResultadoTentativa {
  const r = DiagnosticoRespostaSchema.safeParse(dados);
  if (!r.success || r.data.id.toLowerCase() !== id.toLowerCase())
    return { tipo: 'retentar', codigo: null, mensagem: 'Resposta inesperada do servidor. Fica na fila.' };
  return { tipo: 'aceito', resposta: r.data };
}

/** Na fila por falta de sinal (nunca tentou, ou a tentativa não chegou ao servidor) × o servidor respondeu e não aceitou ainda. */
export const SEM_SINAL_COM_O_SERVIDOR = 'Sem sinal com o servidor.';
const naFilaSemSinal = (r: Pick<RegistroDiagnostico, 'ultimo_erro'>) => !r.ultimo_erro || r.ultimo_erro === SEM_SINAL_COM_O_SERVIDOR;

/** Título da confirmação na folha: "Enviado · nº 0042", "Na fila" ou "Não enviado". */
export function tituloDaSituacao(r: Pick<RegistroDiagnostico, 'situacao' | 'protocolo'>): string {
  if (r.situacao === 'enviado' && r.protocolo) return `${TEXTOS_DIAGNOSTICO.enviado} · nº ${formatarProtocolo(r.protocolo)}`;
  return r.situacao === 'falhou' ? TEXTOS_DIAGNOSTICO.naoEnviado : TEXTOS_DIAGNOSTICO.naFila;
}

/** Ajuda embaixo do título da confirmação. */
export function ajudaDaSituacao(r: Pick<RegistroDiagnostico, 'situacao' | 'codigo' | 'ultimo_erro'>): string {
  if (r.situacao === 'enviado') return TEXTOS_DIAGNOSTICO.enviadoAjuda;
  if (r.situacao === 'falhou') return r.codigo === CODIGOS_DIAGNOSTICO.limite ? TEXTOS_DIAGNOSTICO.limiteAjuda : TEXTOS_DIAGNOSTICO.recusadoAjuda;
  return naFilaSemSinal(r) ? TEXTOS_DIAGNOSTICO.naFilaAjuda : TEXTOS_DIAGNOSTICO.naFilaServidorAjuda;
}

/** Ícone do selo da confirmação: o `wifiOff` só na fila por falta de sinal; servidor indisponível é `clock`. */
export function iconeDaSituacao(r: Pick<RegistroDiagnostico, 'situacao' | 'ultimo_erro'>): 'check' | 'alert' | 'wifiOff' | 'clock' {
  if (r.situacao === 'enviado') return 'check';
  if (r.situacao === 'falhou') return 'alert';
  return naFilaSemSinal(r) ? 'wifiOff' : 'clock';
}

export interface LinhaDoHistorico {
  /** Selo com texto: "Enviado", "Na fila", "Não enviado". */
  selo: string;
  tom: 'success' | 'warning' | 'danger';
  /** "nº 0042" (enviado, em destaque) ou o porquê curto ("sem sinal", "limite da hora"). */
  principal: string;
  destaque: boolean;
  /** 2ª linha só no automático: "Queda do app · automático" / "Erro de tela · automático". */
  automatico: string | null;
  data: string;
  /** Leitura do leitor de tela: "Enviado, número 0042, Hoje, 14:32". */
  leitura: string;
}

type RegistroDaLinha = Pick<RegistroDiagnostico, 'situacao' | 'protocolo' | 'codigo' | 'criado_em' | 'ultimo_erro'> & { envio: Pick<DiagnosticoEnvio, 'origem'> };

/** Linha de "Últimos envios" (imagem T-0158, quadro 6). `data` formata no fuso do tenant ("Hoje, 14:32"). */
export function linhaDoHistorico(r: RegistroDaLinha, data: (iso: string) => string): LinhaDoHistorico {
  const quando = data(r.criado_em);
  const automatico = r.envio.origem === 'queda' ? 'Queda do app · automático' : r.envio.origem === 'erro_tela' ? 'Erro de tela · automático' : null;
  const linha = (selo: string, tom: LinhaDoHistorico['tom'], principal: string, destaque: boolean, lido: string): LinhaDoHistorico => ({
    selo,
    tom,
    principal,
    destaque,
    automatico,
    data: quando,
    leitura: [selo, lido, automatico, quando].filter(Boolean).join(', '),
  });
  if (r.situacao === 'enviado' && r.protocolo) {
    const n = formatarProtocolo(r.protocolo);
    return linha(TEXTOS_DIAGNOSTICO.enviado, 'success', `nº ${n}`, true, `número ${n}`);
  }
  if (r.situacao === 'falhou') {
    const porque = r.codigo === CODIGOS_DIAGNOSTICO.limite ? TEXTOS_DIAGNOSTICO.limiteDaHora : TEXTOS_DIAGNOSTICO.recusado;
    return linha(TEXTOS_DIAGNOSTICO.naoEnviado, 'danger', porque, false, porque);
  }
  // "sem sinal" só quando falta sinal; a rota ausente (404) ou o servidor fora (5xx) é "servidor indisponível"
  const porque = naFilaSemSinal(r) ? TEXTOS_DIAGNOSTICO.semSinal : TEXTOS_DIAGNOSTICO.servidorIndisponivel;
  return linha(TEXTOS_DIAGNOSTICO.naFila, 'warning', porque, false, porque);
}

// ---------- envio da fila (o serviço injeta armazenamento, HTTP e motor) ----------

export interface PortasDrenagem {
  ler(): Promise<readonly RegistroDiagnostico[]>;
  /** Aplica a mudança sobre a lista atual e grava (em série). */
  mudar(f: (atual: readonly RegistroDiagnostico[]) => RegistroDiagnostico[]): Promise<void>;
  dono(): DonoDiagnostico | null;
  online(): boolean;
  /** `POST /v1/diagnosticos`; erro HTTP sobe como exceção (`HttpError`/`NetworkError`). */
  postar(envio: DiagnosticoEnvio): Promise<{ status: number; data: unknown }>;
  /** Põe o print na fila de arquivos (ADR 0010); `false` = motor indisponível, tenta na próxima. */
  enfileirarPrint(printId: string): Promise<boolean>;
  agora(): Date;
}

/**
 * Uma passada: envia em ordem os diagnósticos da fila desta sessão e, para os aceitos com print, põe o print na fila de
 * arquivos. Parou na primeira falha de transporte (os próximos também falhariam). Devolve quantos foram aceitos.
 */
export async function drenarFila(p: PortasDrenagem): Promise<number> {
  const dono = p.dono();
  if (!dono) return 0;
  let aceitos = 0;
  if (p.online()) {
    for (const r of paraEnviar(await p.ler(), dono)) {
      if (!p.online()) break;
      let resultado: ResultadoTentativa;
      try {
        const resp = await p.postar(r.envio);
        resultado = resultadoDaResposta(r.id, resp.data);
      } catch (e) {
        resultado = resultadoDoErro(e);
      }
      // a sessão trocou durante o envio: o resultado ainda é deste registro (o id é do aparelho), então grava
      await p.mudar((atual) => aplicarResultado(atual, r.id, resultado, p.agora()));
      if (resultado.tipo === 'aceito') aceitos++;
      else if (resultado.tipo === 'retentar') break;
    }
  }
  for (const r of printsParaEnfileirar(await p.ler(), dono)) {
    const ok = await p.enfileirarPrint(r.envio.print_id!).catch(() => false);
    if (ok) await p.mudar((atual) => marcarPrintNaFila(atual, r.id));
  }
  return aceitos;
}

// ---------- v1.0.5: queda automática na abertura seguinte ----------

/** Namespace fixo do app para o UUID v5 dos diagnósticos automáticos (nunca mudar: é o que torna o id estável). */
export const NAMESPACE_DIAGNOSTICO = '6d1f3c2a-8b4e-4f7a-9c0d-2e5b7a9f1c34';

/** SHA-1 (RFC 3174) em JS puro, só para o UUID v5 (sem dependência nova; o `expo-crypto` é assíncrono e nativo). */
export function sha1(dados: Uint8Array): Uint8Array {
  const total = Math.ceil((dados.length + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(dados);
  m[dados.length] = 0x80;
  const dv = new DataView(m.buffer);
  const bits = dados.length * 8;
  dv.setUint32(total - 8, Math.floor(bits / 0x1_0000_0000));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const dvo = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => dvo.setUint32(i * 4, h));
  return out;
}

/** UUID v5 (RFC 4122 §4.3): SHA-1 do namespace + nome. */
export function uuidV5(nome: string, namespace: string): string {
  const hex = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('uuidV5: namespace inválido');
  const ns = new Uint8Array(16);
  for (let i = 0; i < 16; i++) ns[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const texto = new TextEncoder().encode(nome);
  const junto = new Uint8Array(16 + texto.length);
  junto.set(ns);
  junto.set(texto, 16);
  const h = sha1(junto).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const s = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Id estável da queda: o mesmo `quando` + `motivo` dá o mesmo id (o app cair de novo antes de enviar não duplica). */
export const idDaQueda = (s: Pick<SaidaAndroid, 'quando' | 'motivo'>) => uuidV5(`queda:${s.quando}:${s.motivo}`, NAMESPACE_DIAGNOSTICO);
/** Id estável do "Último erro do app". */
export const idDoErro = (r: Pick<ErroRegistrado, 'quando' | 'origem'>) => uuidV5(`erro:${r.quando}:${r.origem}`, NAMESPACE_DIAGNOSTICO);

/** Até onde as quedas (epoch ms) e o último erro (ISO) já viraram diagnóstico automático. */
export interface MarcadorAutomatico {
  saida_ate: number | null;
  erro_ate: string | null;
}

export interface EnvioAutomatico {
  id: string;
  origem: 'queda' | 'erro_tela';
  ocorridoEm: string;
  motivo: string;
  tela: string | null;
  erro: ErroRegistrado | null;
  saida: SaidaAndroid | null;
}

/**
 * v1.0.5: o que vira diagnóstico automático nesta abertura (depois do login) e o novo marcador.
 * - Quedas do Android (`ehQueda`) mais novas que o marcador (1ª vez: os últimos 7 dias), no máximo 3, mais nova primeiro.
 * - O "Último erro do app" de tela, raiz ou fatal do JS mais novo que o marcador vira `erro_tela`; o não fatal fica de fora e o
 *   registro que veio do Android (`onde = 'Android'`) já é a própria queda.
 * - Erro fatal do JS e queda do mesmo fechamento (até 20 s): vai um só, o `erro_tela`, com a pilha do JS e a saída junto.
 */
export function planoAutomatico(
  saidas: readonly SaidaAndroid[] | null,
  ultimoErro: ErroRegistrado | null,
  marcador: MarcadorAutomatico | null,
  agora: number,
): { envios: EnvioAutomatico[]; marcador: MarcadorAutomatico } {
  const desde = marcador?.saida_ate ?? agora - JANELA_PRIMEIRA_LEITURA_MS;
  const novas = (saidas ?? []).filter((s) => s.quando > desde);
  const saidaAte = Math.max(desde, ...novas.map((s) => s.quando));
  const quedas = novas.filter(ehQueda).sort((a, b) => b.quando - a.quando).slice(0, MAX_QUEDAS_POR_ABERTURA);

  const erroAteMs = marcador?.erro_ate ? Date.parse(marcador.erro_ate) : agora - JANELA_PRIMEIRA_LEITURA_MS;
  const erroMs = ultimoErro ? Date.parse(ultimoErro.quando) : NaN;
  const erroNovo =
    ultimoErro && Number.isFinite(erroMs) && erroMs > erroAteMs && ultimoErro.origem !== 'nao-fatal' && ultimoErro.onde !== 'Android'
      ? ultimoErro
      : null;

  const envios: EnvioAutomatico[] = [];
  let saidaDoErro: SaidaAndroid | null = null;
  if (erroNovo?.origem === 'fatal') saidaDoErro = quedas.find((s) => Math.abs(s.quando - erroMs) <= MESMO_FECHAMENTO_MS) ?? null;
  for (const s of quedas) {
    if (s === saidaDoErro) continue;
    envios.push({ id: idDaQueda(s), origem: 'queda', ocorridoEm: new Date(s.quando).toISOString(), motivo: codigoDoMotivoAndroid(s.motivo), tela: null, erro: null, saida: s });
  }
  if (erroNovo)
    envios.push({ id: idDoErro(erroNovo), origem: 'erro_tela', ocorridoEm: new Date(erroMs).toISOString(), motivo: erroNovo.origem, tela: erroNovo.onde, erro: erroNovo, saida: saidaDoErro });

  return {
    envios,
    marcador: {
      saida_ate: saidaAte,
      erro_ate: erroNovo ? new Date(erroMs).toISOString() : (marcador?.erro_ate ?? null),
    },
  };
}
