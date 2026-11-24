/**
 * T-0195 (ADR 0070 §D8 a, RN-CORE-80): portão de "nada se perde" da tela de bloqueio e da folha "Baixar a versão X.Y.Z".
 * Puro (roda em Node nos testes); a tela (`components/tela-atualizacao.tsx`) só desenha o que sai daqui.
 *
 * Ao entrar, a tela envia a fila sozinha (`motor.enviar`, push e arquivos liberados no 426) e conta três coisas:
 * - pendentes: comandos e arquivos da fila ainda não enviados (pedido, orçamento, pré-cadastro, check-in, fotos…);
 * - "Não aceito": itens recusados pelo servidor (`falhou`) e os de módulo desativado (`modulo_inativo`), que não saem sozinhos;
 * - rascunhos do Vendedor (nunca enviados; `contarRascunhosParaAtualizar` do módulo, lido de forma opcional).
 * O botão "Baixar a versão X.Y.Z" só existe com as três em zero. Antes disso a única ação é enviar ou abrir SÓ a tela que
 * resolve (Rascunhos; pedido ou cliente "Não aceito"). Nada é apagado aqui: descartar é decisão do vendedor, na tela do item.
 * O link do APK é pedido a cada toque (`POST /v1/core/app/apk`) e só passa para o navegador; nunca é guardado.
 *
 * Textos e estados: docs/design/t0195-atualizacao-obrigatoria.md §2.1 e §3 (designer-ux), literais. Os estados "Entrar",
 * "Não aceito" e "Rascunhos" ficaram pendentes no §5 da especificação: os textos deles aqui seguem o mesmo padrão e aguardam
 * a revisão do designer-ux (`TEXTOS_ATUALIZACAO_APP.pendentesDoDesenho`).
 */
import type { EstadoMotorSync, ItemOutbox } from '@macuxi/platform-sdk';

// ---------- textos (literais da especificação) ----------

const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

export const TEXTOS_ATUALIZACAO_APP = {
  titulo: 'Versão desatualizada, reinstale para continuar.',
  textoEnviar: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
  textoBaixar: (versao: string) => `Baixe a versão ${versao} e instale por cima desta. Não desinstale o app.`,
  naFila: (n: number) => `${n} na fila`,
  enviando: (n: number) => `Enviando ${n}…`,
  erroEnvio: (n: number) => `Não deu para enviar ${itens(n)}. Tente de novo; se continuar, avise o suporte.`,
  semSinalEnvio: (n: number) => `Sem sinal. Conecte-se à internet para enviar ${itens(n)}.`,
  erroLink: 'Não deu para preparar o download. Tente de novo; se continuar, avise o suporte.',
  semSinalLink: (versao: string) => `Sem sinal. Conecte-se à internet para baixar a versão ${versao}.`,
  enviarAgora: 'Enviar agora',
  tentarDeNovo: 'Tentar de novo',
  baixar: (versao: string) => `Baixar a versão ${versao}`,
  suporte: 'Enviar o detalhe ao suporte',
  folha: (versao: string) => `Baixar a versão ${versao}`,
  fechar: 'Fechar',
  /** Estados do §5 da especificação (pendentes de desenho): mesmo padrão, aguardam o designer-ux. */
  pendentesDoDesenho: {
    textoEntrar: 'Antes de reinstalar, entre para enviar o que está neste aparelho. Não desinstale o app.',
    entrar: 'Entrar',
    naoAceitos: (n: number) => `${n} ${n === 1 ? 'não aceito' : 'não aceitos'}`,
    abrirNaoAceitos: (n: number) => (n === 1 ? 'Corrigir o não aceito' : 'Corrigir os não aceitos'),
    rascunhos: (n: number) => `${n} ${n === 1 ? 'rascunho' : 'rascunhos'}`,
    abrirRascunhos: (n: number) => (n === 1 ? 'Abrir o rascunho' : 'Abrir os rascunhos'),
  },
} as const;

// ---------- contagem ----------

export interface ContagemAtualizacao {
  /** Comandos e arquivos `pendente` (saem sozinhos com sinal). */
  pendentes: number;
  /** `falhou` e `modulo_inativo` (comandos e arquivos): precisam de correção ou de descarte de propósito. */
  naoAceitos: number;
  /** Rascunhos do Vendedor guardados no aparelho. */
  rascunhos: number;
}

const NAO_ACEITO = new Set(['falhou', 'modulo_inativo']);

/** As três contagens do portão sobre o estado do motor (nada é alterado) e o total de rascunhos. */
export function contarParaAtualizar(estado: Pick<EstadoMotorSync, 'fila' | 'arquivos'>, rascunhos: number): ContagemAtualizacao {
  let pendentes = 0;
  let naoAceitos = 0;
  for (const x of [...estado.fila, ...estado.arquivos]) {
    if (x.situacao === 'pendente') pendentes++;
    else if (NAO_ACEITO.has(x.situacao)) naoAceitos++;
  }
  return { pendentes, naoAceitos, rascunhos: Number.isFinite(rascunhos) && rascunhos > 0 ? Math.floor(rascunhos) : 0 };
}

/** O link só com nada digitado só no aparelho (ADR 0070 §D8 a). */
export function podeBaixar(c: ContagemAtualizacao): boolean {
  return c.pendentes === 0 && c.naoAceitos === 0 && c.rascunhos === 0;
}

// ---------- as telas que resolvem ----------

/** Rota do shell da folha "Baixar a versão X.Y.Z" (`app/atualizar-app.tsx`): a ação da notificação do sininho abre esta. */
export const ROTA_ATUALIZAR_APP = '/atualizar-app';

/** Rascunhos do Vendedor e as telas que o rascunho abre (continuar o pedido ou o orçamento). */
export const DESTINO_RASCUNHOS = { abrir: '/m/rascunhos', liberadas: ['/m/rascunhos', '/m/novo-pedido', '/m/adicionar-ao-orcamento', '/m/pedido'] } as const;
/** Pedido ou orçamento "Não aceito": a lista de pedidos (o item mostra "Não aceito" e abre a correção). */
export const DESTINO_PEDIDO_NAO_ACEITO = { abrir: '/m/pedidos', liberadas: ['/m/pedidos', '/m/pedido', '/m/novo-pedido', '/m/adicionar-ao-orcamento'] } as const;
/** Pré-cadastro "Não aceito": os clientes (a ficha reabre o cadastro para corrigir). */
export const DESTINO_CLIENTE_NAO_ACEITO = { abrir: '/m/clientes', liberadas: ['/m/clientes', '/m/cliente', '/m/novo-cliente'] } as const;
/** Outro item "Não aceito" (visita, foto, comando do Gestão): a fila do aparelho no Perfil, com o motivo e o Descartar. */
export const DESTINO_FILA_DO_APARELHO = { abrir: '/profile', liberadas: ['/profile'] } as const;

/** Sem sessão: o login (e a troca de senha que ele pede); depois dele, a tela de bloqueio volta com a fila do usuário. */
export const DESTINO_LOGIN = { abrir: '/login', liberadas: ['/login', '/trocar-senha', '/esqueci-senha'] } as const;

export interface DestinoQueResolve {
  abrir: string;
  liberadas: readonly string[];
}

/** A ação do principal que abre uma tela → a tela que resolve. */
export function destinoDaAcao(
  acao: 'entrar' | 'abrir_nao_aceitos' | 'abrir_rascunhos',
  fila: readonly Pick<ItemOutbox, 'entidade' | 'situacao'>[],
): DestinoQueResolve {
  if (acao === 'entrar') return DESTINO_LOGIN;
  if (acao === 'abrir_rascunhos') return DESTINO_RASCUNHOS;
  return destinoDoNaoAceito(fila);
}

/** Para o primeiro "Não aceito" da fila (comando), a tela que o corrige; arquivo recusado vai à fila do aparelho. */
export function destinoDoNaoAceito(fila: readonly Pick<ItemOutbox, 'entidade' | 'situacao'>[]): DestinoQueResolve {
  const item = fila.find((i) => NAO_ACEITO.has(i.situacao));
  if (item?.entidade === 'pedido') return DESTINO_PEDIDO_NAO_ACEITO;
  if (item?.entidade === 'cliente_pre_cadastro') return DESTINO_CLIENTE_NAO_ACEITO;
  return DESTINO_FILA_DO_APARELHO;
}

/** A rota atual está entre as liberadas da tela que resolve? (fora delas a tela de bloqueio volta). */
export function rotaLiberadaParaResolver(rota: string | null | undefined, destino: DestinoQueResolve | null): boolean {
  if (!rota || !destino) return false;
  const caminho = rota.split('?')[0]!.replace(/\/+$/, '');
  return destino.liberadas.some((l) => caminho === l || caminho.startsWith(`${l}/`));
}

// ---------- estado da tela ----------

export type EnvioAtualizacao = 'parado' | 'enviando' | 'erro' | 'sem_sinal';
export type LinkAtualizacao = 'parado' | 'gerando' | 'erro' | 'sem_sinal';

export interface SituacaoDoPortao {
  temSessao: boolean;
  contagem: ContagemAtualizacao;
  envio: EnvioAtualizacao;
  link: LinkAtualizacao;
  /** X.Y.Z da versão publicada. */
  versao: string;
}

export type EstadoTelaAtualizacao =
  | 'sem_sessao'
  | 'fila'
  | 'enviando'
  | 'erro_envio'
  | 'sem_sinal_fila'
  | 'nao_aceitos'
  | 'rascunhos'
  | 'pronto'
  | 'gerando_link'
  | 'erro_link'
  | 'sem_sinal_link';

export type LinhaDeEstado =
  | { tipo: 'chip'; texto: string; icone: 'clock' | 'sync' | 'alert' }
  | { tipo: 'banner'; tom: 'warning' | 'danger'; icone: 'wifiOff' | 'alert'; texto: string; anunciar: boolean }
  | null;

export type AcaoDaTelaAtualizacao = 'entrar' | 'enviar' | 'abrir_nao_aceitos' | 'abrir_rascunhos' | 'baixar';

export interface TelaAtualizacao {
  estado: EstadoTelaAtualizacao;
  /** Linha 3 (o que fazer agora). */
  texto: string;
  /** Linha 4: `ChipEstado` ou `Banner`, nunca os dois; `null` = nada. */
  linha: LinhaDeEstado;
  /** Linha 5: o único principal. */
  principal: { rotulo: string; acao: AcaoDaTelaAtualizacao; ocupado: boolean };
  /** Linha 6: "Enviar o detalhe ao suporte", só nos dois estados de erro. */
  suporte: boolean;
}

/** Estado da tela (§3.3): sessão, fila, "Não aceito", rascunhos e, só com os três em zero, o download. */
export function telaDaAtualizacao(s: SituacaoDoPortao): TelaAtualizacao {
  const T = TEXTOS_ATUALIZACAO_APP;
  const P = T.pendentesDoDesenho;
  const { pendentes, naoAceitos, rascunhos } = s.contagem;
  if (!s.temSessao) {
    return { estado: 'sem_sessao', texto: P.textoEntrar, linha: null, principal: { rotulo: P.entrar, acao: 'entrar', ocupado: false }, suporte: false };
  }
  if (pendentes > 0 || s.envio === 'enviando') {
    const enviar = (ocupado: boolean, rotulo: string = T.enviarAgora) => ({ rotulo, acao: 'enviar' as const, ocupado });
    if (s.envio === 'enviando')
      return { estado: 'enviando', texto: T.textoEnviar, linha: { tipo: 'chip', texto: T.enviando(Math.max(pendentes, 1)), icone: 'sync' }, principal: enviar(true), suporte: false };
    if (s.envio === 'erro')
      return { estado: 'erro_envio', texto: T.textoEnviar, linha: { tipo: 'banner', tom: 'danger', icone: 'alert', texto: T.erroEnvio(pendentes), anunciar: true }, principal: enviar(false, T.tentarDeNovo), suporte: true };
    if (s.envio === 'sem_sinal')
      return { estado: 'sem_sinal_fila', texto: T.textoEnviar, linha: { tipo: 'banner', tom: 'warning', icone: 'wifiOff', texto: T.semSinalEnvio(pendentes), anunciar: true }, principal: enviar(false), suporte: false };
    return { estado: 'fila', texto: T.textoEnviar, linha: { tipo: 'chip', texto: T.naFila(pendentes), icone: 'clock' }, principal: enviar(false), suporte: false };
  }
  if (naoAceitos > 0) {
    return { estado: 'nao_aceitos', texto: T.textoEnviar, linha: { tipo: 'chip', texto: P.naoAceitos(naoAceitos), icone: 'alert' }, principal: { rotulo: P.abrirNaoAceitos(naoAceitos), acao: 'abrir_nao_aceitos', ocupado: false }, suporte: false };
  }
  if (rascunhos > 0) {
    return { estado: 'rascunhos', texto: T.textoEnviar, linha: { tipo: 'chip', texto: P.rascunhos(rascunhos), icone: 'alert' }, principal: { rotulo: P.abrirRascunhos(rascunhos), acao: 'abrir_rascunhos', ocupado: false }, suporte: false };
  }
  const baixar = (ocupado: boolean, rotulo: string = T.baixar(s.versao)) => ({ rotulo, acao: 'baixar' as const, ocupado });
  const texto = T.textoBaixar(s.versao);
  if (s.link === 'gerando') return { estado: 'gerando_link', texto, linha: null, principal: baixar(true), suporte: false };
  if (s.link === 'erro')
    return { estado: 'erro_link', texto, linha: { tipo: 'banner', tom: 'danger', icone: 'alert', texto: T.erroLink, anunciar: true }, principal: baixar(false, T.tentarDeNovo), suporte: true };
  if (s.link === 'sem_sinal')
    return { estado: 'sem_sinal_link', texto, linha: { tipo: 'banner', tom: 'warning', icone: 'wifiOff', texto: T.semSinalLink(s.versao), anunciar: true }, principal: baixar(false), suporte: false };
  return { estado: 'pronto', texto, linha: null, principal: baixar(false), suporte: false };
}

// ---------- controle (tela e folha) ----------

export type ResultadoEnvioAtualizacao = 'ok' | 'sem_sinal' | 'erro';
export type ResultadoLinkAtualizacao = { tipo: 'ok'; url: string } | { tipo: 'sem_sinal' } | { tipo: 'erro' };

export interface DependenciasPortao {
  temSessao(): boolean;
  /** Contagem sobre o aparelho (motor e rascunhos); não altera nada. */
  contar(): Promise<ContagemAtualizacao>;
  /** `motor.enviar({ incluirFalhos: false })` com a leitura do sinal (o "Não aceito" não é reenviado sozinho). */
  enviar(): Promise<ResultadoEnvioAtualizacao>;
  /** `POST /v1/core/app/apk`: o link temporário, pedido a cada toque. */
  pedirLink(): Promise<ResultadoLinkAtualizacao>;
  /** Abre o download no navegador do sistema (o link não é guardado em lugar nenhum). */
  abrirNoNavegador(url: string): Promise<void>;
}

export interface EstadoPortao {
  contagem: ContagemAtualizacao;
  envio: EnvioAtualizacao;
  link: LinkAtualizacao;
  /** Detalhe técnico do último erro (envio ou link), só para o "Enviar o detalhe ao suporte". */
  detalhe: string | null;
}

export interface PortaoAtualizacao {
  estado(): EstadoPortao;
  /** Ao abrir a tela, ao voltar ao primeiro plano e ao voltar o sinal: conta e, com pendentes, envia sozinho. */
  entrar(): Promise<void>;
  /** "Enviar agora" / "Tentar de novo" do envio. */
  enviarAgora(): Promise<void>;
  /** Recontagem (a fila mudou por fora: envio do agendador, item corrigido). */
  recontar(): Promise<void>;
  /** "Baixar a versão X.Y.Z": reconta antes; só com as três contagens em zero pede o link e o abre. */
  baixar(): Promise<void>;
  assinar(ouvinte: (e: EstadoPortao) => void): () => void;
}

const VAZIA: ContagemAtualizacao = { pendentes: 0, naoAceitos: 0, rascunhos: 0 };

export function criarPortaoAtualizacao(dep: DependenciasPortao): PortaoAtualizacao {
  // começa como "contando": até a 1ª contagem, o botão do link não aparece (pendente fictício)
  let estado: EstadoPortao = { contagem: { ...VAZIA, pendentes: 1 }, envio: 'parado', link: 'parado', detalhe: null };
  const ouvintes = new Set<(e: EstadoPortao) => void>();
  const mudar = (parcial: Partial<EstadoPortao>) => {
    estado = { ...estado, ...parcial };
    for (const o of ouvintes) o(estado);
  };
  let envioEmCurso: Promise<void> | null = null;
  let linkEmCurso = false;

  const recontar = async () => {
    mudar({ contagem: await dep.contar() });
  };

  const enviarAgora = (): Promise<void> => {
    if (envioEmCurso) return envioEmCurso;
    envioEmCurso = (async () => {
      if (!dep.temSessao()) return;
      mudar({ envio: 'enviando', link: 'parado' });
      let r: ResultadoEnvioAtualizacao;
      try {
        r = await dep.enviar();
      } catch (e) {
        r = 'erro';
        mudar({ detalhe: e instanceof Error ? e.message : String(e) });
      }
      const contagem = await dep.contar();
      mudar({ contagem, envio: contagem.pendentes === 0 ? 'parado' : r === 'ok' ? 'erro' : r });
    })().finally(() => {
      envioEmCurso = null;
    });
    return envioEmCurso;
  };

  return {
    estado: () => estado,
    async entrar() {
      await recontar();
      if (dep.temSessao() && estado.contagem.pendentes > 0) await enviarAgora();
    },
    enviarAgora,
    recontar,
    async baixar() {
      if (linkEmCurso || envioEmCurso) return;
      linkEmCurso = true;
      try {
        await recontar();
        // portão: com qualquer coisa só no aparelho, nada de link (o botão nem aparece; aqui é a segunda trava)
        if (!dep.temSessao() || !podeBaixar(estado.contagem)) return;
        mudar({ link: 'gerando' });
        let r: ResultadoLinkAtualizacao;
        try {
          r = await dep.pedirLink();
        } catch (e) {
          r = { tipo: 'erro' };
          mudar({ detalhe: e instanceof Error ? e.message : String(e) });
        }
        if (r.tipo !== 'ok') {
          mudar({ link: r.tipo });
          return;
        }
        try {
          await dep.abrirNoNavegador(r.url);
          mudar({ link: 'parado' });
        } catch (e) {
          mudar({ link: 'erro', detalhe: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        linkEmCurso = false;
      }
    },
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
  };
}

// ---------- leitura opcional dos rascunhos do Vendedor ----------

/** Assinatura esperada de `contarRascunhosParaAtualizar` do `@macuxi/vendedor/app` (T-0195, branch do modulo-vendedor). */
export type ContarRascunhos = (armazenamentoDoVendedor: unknown, agora: Date) => number | Promise<number>;

/**
 * Lê `contarRascunhosParaAtualizar` do módulo de forma opcional (como o shell faz com `moduloApp`). Sem a função exportada,
 * a reserva conta as chaves guardadas em `rascunhos` (inclusive as vencidas: na dúvida, segura o link). Falha na leitura =
 * 1 (segura o link; nada se perde por erro de leitura).
 */
export function contadorDeRascunhos(
  exportado: unknown,
  ler: (chave: string) => Promise<unknown>,
): (armazenamentoDoVendedor: unknown, agora: Date) => Promise<number> {
  const f = (exportado as { contarRascunhosParaAtualizar?: ContarRascunhos } | null | undefined)?.contarRascunhosParaAtualizar;
  return async (arm, agora) => {
    try {
      if (typeof f === 'function') return Number(await f(arm, agora)) || 0;
      const r = await ler('rascunhos');
      return r && typeof r === 'object' ? Object.keys(r).length : 0;
    } catch {
      return 1;
    }
  };
}
