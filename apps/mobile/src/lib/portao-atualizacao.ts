/**
 * T-0195 (ADR 0070 §D8 a, RN-CORE-80): portão de "nada se perde" da tela de bloqueio e da folha "Versão X.Y.Z disponível".
 * Puro (roda em Node nos testes); a tela (`components/tela-atualizacao.tsx`) só desenha o que sai daqui.
 *
 * Ao entrar, a tela envia a fila sozinha (`motor.enviar`, push e arquivos liberados no 426) e conta três coisas:
 * - pendentes: comandos e arquivos da fila ainda não enviados (pedido, orçamento, pré-cadastro, check-in, fotos…);
 * - "Não aceito": itens recusados pelo servidor (`falhou`) e os de módulo desativado (`modulo_inativo`), que não saem sozinhos;
 * - pendências dos módulos (rascunhos do Vendedor), pelo gancho do SDK `visao.pendenciasParaAtualizar` (ADR 0070 §D8); gancho
 *   com erro ou pendência sem tela que a resolva = estado de erro do download (nunca "nada pendente" nem rascunho inventado).
 * O botão "Baixar a versão X.Y.Z" só existe com as três em zero, com sessão e com o modo sem sinal desligado. Antes disso a
 * única ação é a que zera a contagem da vez (desligar o modo sem sinal, entrar, enviar ou abrir SÓ a tela que resolve). Nada
 * é apagado aqui: descartar é decisão do vendedor, na tela do item. O link do APK é pedido a cada toque
 * (`POST /v1/core/app/apk`) e só passa para o navegador; nunca é guardado.
 *
 * Textos e estados: docs/design/t0195-atualizacao-obrigatoria.md §3.3 e §5.2 (designer-ux), literais.
 */
import type { EstadoMotorSync, ItemOutbox, PendenciaParaAtualizarVisivel } from '@macuxi/platform-sdk';

// ---------- textos (literais da especificação) ----------

const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

export const TEXTOS_ATUALIZACAO_APP = {
  titulo: 'Versão desatualizada, reinstale para continuar.',
  textoEnviar: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
  textoBaixar: 'Instale por cima desta versão, sem desinstalar o app.',
  textoNaoAceitos: (n: number) =>
    n === 1
      ? 'Antes de reinstalar, corrija ou descarte o item não aceito. Não desinstale o app.'
      : `Antes de reinstalar, corrija ou descarte ${n} itens não aceitos. Não desinstale o app.`,
  textoRascunhos: (n: number) =>
    n === 1
      ? 'Antes de reinstalar, envie ou descarte o rascunho. Não desinstale o app.'
      : `Antes de reinstalar, envie ou descarte ${n} rascunhos. Não desinstale o app.`,
  naFila: (n: number) => `${n} na fila`,
  erroEnvio: (n: number) => `Não deu para enviar ${itens(n)}.`,
  semSinalEnvio: (n: number) => `Sem sinal. Conecte-se à internet para enviar ${itens(n)}.`,
  erroLink: 'Não deu para preparar o download.',
  semSinalLink: 'Sem sinal. Conecte-se à internet.',
  enviarAgora: 'Enviar agora',
  tentarDeNovo: 'Tentar de novo',
  baixar: (versao: string) => `Baixar a versão ${versao}`,
  suporte: 'Enviar o detalhe ao suporte',
  desligarModoSemSinal: 'Desligar modo sem sinal',
  entrar: 'Entrar',
  abrirNaoAceitos: (n: number) => (n === 1 ? 'Abrir o não aceito' : 'Abrir os não aceitos'),
  abrirRascunhos: (n: number) => (n === 1 ? 'Abrir o rascunho' : 'Abrir os rascunhos'),
  fechar: 'Fechar',
} as const;

// ---------- contagem ----------

export interface ContagemAtualizacao {
  /** Comandos e arquivos `pendente` (saem sozinhos com sinal). */
  pendentes: number;
  /** `falhou` e `modulo_inativo` (comandos e arquivos): precisam de correção ou de descarte de propósito. */
  naoAceitos: number;
  /** Pendências dos módulos no aparelho (rascunhos do Vendedor), pelo gancho do SDK. */
  rascunhos: number;
  /** Tela do módulo que resolve as pendências (`href` do gancho, já conferido na visão); `null` = nenhuma navegável. */
  hrefRascunhos: string | null;
  /**
   * Detalhe técnico (para o suporte) quando não dá para saber o que falta: o gancho de algum módulo falhou ou há pendência sem
   * tela navegável que a resolva. Segura o link; `null` = contagem completa.
   */
  pendenciasComErro: string | null;
}

const NAO_ACEITO = new Set(['falhou', 'modulo_inativo']);

/** Detalhe ao suporte da pendência de módulo sem tela navegável (o gancho deu `href` nulo). */
const PENDENCIA_SEM_TELA = 'pendência de módulo sem tela que a resolva (href nulo)';

/**
 * As três contagens do portão sobre o estado do motor (nada é alterado) e as pendências dos módulos
 * (`visao.pendenciasParaAtualizar`). `{ erro }` = o gancho de algum módulo falhou.
 */
export function contarParaAtualizar(
  estado: Pick<EstadoMotorSync, 'fila' | 'arquivos'>,
  pendencias: readonly Pick<PendenciaParaAtualizarVisivel, 'total' | 'href'>[] | { erro: string },
): ContagemAtualizacao {
  let pendentes = 0;
  let naoAceitos = 0;
  for (const x of [...estado.fila, ...estado.arquivos]) {
    if (x.situacao === 'pendente') pendentes++;
    else if (NAO_ACEITO.has(x.situacao)) naoAceitos++;
  }
  if ('erro' in pendencias) return { pendentes, naoAceitos, rascunhos: 0, hrefRascunhos: null, pendenciasComErro: pendencias.erro };
  let rascunhos = 0;
  let hrefRascunhos: string | null = null;
  let pendenciasComErro: string | null = null;
  for (const p of pendencias) {
    const n = Number.isFinite(p.total) && p.total > 0 ? Math.floor(p.total) : 0;
    if (n === 0) continue;
    rascunhos += n;
    if (p.href === null) pendenciasComErro = PENDENCIA_SEM_TELA;
    else hrefRascunhos ??= p.href;
  }
  return { pendentes, naoAceitos, rascunhos, hrefRascunhos, pendenciasComErro };
}

/** O link só com nada digitado só no aparelho (ADR 0070 §D8 a). */
export function podeBaixar(c: ContagemAtualizacao): boolean {
  return c.pendentes === 0 && c.naoAceitos === 0 && c.rascunhos === 0 && c.pendenciasComErro === null;
}

// ---------- as telas que resolvem ----------

export interface DestinoQueResolve {
  abrir: string;
  /** Rotas em que a tela de bloqueio fica fora do caminho (fora delas, depois de chegar, ela volta). */
  liberadas: readonly string[];
}

/**
 * Telas de módulo (`/m/...`): a que resolve e as que ela abre (continuar o pedido do rascunho, corrigir o cliente). Com o app
 * bloqueado elas abrem sem abas, sem sino e sem menu, então só se chega a outra tela de módulo pelos links da própria tela.
 */
const TELAS_DE_MODULO = '/m';

/** Outro item "Não aceito" (módulo desativado, visita, foto, comando do Gestão): a fila do aparelho no Perfil, com o motivo e o Descartar. */
export const DESTINO_FILA_DO_APARELHO: DestinoQueResolve = { abrir: '/profile', liberadas: ['/profile'] };

/** Sem sessão: o login (e a troca de senha que ele pede); depois dele, a tela de bloqueio volta com a fila do usuário. */
export const DESTINO_LOGIN: DestinoQueResolve = { abrir: '/login', liberadas: ['/login', '/trocar-senha', '/esqueci-senha'] };

/**
 * Entidade da fila recusada (`falhou`) → página do módulo onde ela é corrigida (§5.2: pedido ou orçamento na lista de Pedidos,
 * pré-cadastro em Clientes). Vale só se a página estiver na visão do usuário; senão, a fila do aparelho.
 */
const PAGINA_DO_NAO_ACEITO: Readonly<Record<string, string>> = { pedido: 'pedidos', cliente_pre_cadastro: 'clientes' };

export interface ContextoDestino {
  fila: readonly Pick<ItemOutbox, 'entidade' | 'situacao'>[];
  arquivos: readonly { situacao: string }[];
  hrefRascunhos: string | null;
  /** A página `/m/<caminho>` está na visão do usuário (`visao.pagina`). */
  telaExiste: (caminho: string) => boolean;
}

/** A ação do principal que abre uma tela → a tela que resolve. */
export function destinoDaAcao(acao: 'entrar' | 'abrir_nao_aceitos' | 'abrir_rascunhos', ctx: ContextoDestino): DestinoQueResolve {
  if (acao === 'entrar') return DESTINO_LOGIN;
  if (acao === 'abrir_rascunhos')
    return ctx.hrefRascunhos ? { abrir: ctx.hrefRascunhos, liberadas: [TELAS_DE_MODULO] } : DESTINO_FILA_DO_APARELHO;
  return destinoDoNaoAceito(ctx);
}

/**
 * O primeiro "Não aceito" da fila decide: pedido ou pré-cadastro recusado (`falhou`) abre a página que o corrige; módulo
 * desativado (`modulo_inativo`), outra entidade, arquivo (foto) ou página fora da visão = a fila do aparelho no Perfil.
 */
function destinoDoNaoAceito(ctx: Pick<ContextoDestino, 'fila' | 'telaExiste'>): DestinoQueResolve {
  const item = ctx.fila.find((i) => NAO_ACEITO.has(i.situacao));
  const pagina = item?.situacao === 'falhou' ? PAGINA_DO_NAO_ACEITO[item.entidade] : undefined;
  if (pagina && ctx.telaExiste(pagina)) return { abrir: `${TELAS_DE_MODULO}/${pagina}`, liberadas: [TELAS_DE_MODULO] };
  return DESTINO_FILA_DO_APARELHO;
}

/** A rota atual está entre as liberadas da tela que resolve? (fora delas a tela de bloqueio volta). */
export function rotaLiberadaParaResolver(rota: string | null | undefined, destino: DestinoQueResolve | null): boolean {
  if (!rota || !destino) return false;
  const caminho = rota.split('?')[0]!.replace(/\/+$/, '');
  return destino.liberadas.some((l) => caminho === l || caminho.startsWith(`${l}/`));
}

// ---------- estado da tela ----------

type EnvioAtualizacao = 'parado' | 'enviando' | 'erro' | 'sem_sinal';
type LinkAtualizacao = 'parado' | 'gerando' | 'erro' | 'sem_sinal';

interface SituacaoDoPortao {
  /** Chave "Modo sem sinal" do Perfil (`fv:offline`) ligada. */
  modoSemSinal: boolean;
  /** Desligando o modo sem sinal (principal ocupado). */
  desligando?: boolean;
  temSessao: boolean;
  /** `null` = ainda contando (a primeira contagem da vez não terminou). */
  contagem: ContagemAtualizacao | null;
  envio: EnvioAtualizacao;
  link: LinkAtualizacao;
  /** X.Y.Z da versão publicada. */
  versao: string;
}

type EstadoTelaAtualizacao =
  | 'modo_sem_sinal'
  | 'sem_sessao'
  | 'contando'
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

type LinhaDeEstado =
  | { tipo: 'chip'; texto: string; icone: 'clock' | 'sync' }
  | { tipo: 'banner'; tom: 'warning' | 'danger'; icone: 'wifiOff' | 'alert'; texto: string; anunciar: boolean }
  | null;

type AcaoDaTelaAtualizacao = 'desligar_modo_sem_sinal' | 'entrar' | 'enviar' | 'abrir_nao_aceitos' | 'abrir_rascunhos' | 'baixar';
/** As ações que abrem outra tela (o resto o portão resolve no lugar). */
export type AcaoQueAbre = 'entrar' | 'abrir_nao_aceitos' | 'abrir_rascunhos';

interface TelaAtualizacao {
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

/** Estado da tela (§3.3 e §5.1): modo sem sinal, sessão, fila, "Não aceito", rascunhos e, só com tudo em zero, o download. */
export function telaDaAtualizacao(s: SituacaoDoPortao): TelaAtualizacao {
  const T = TEXTOS_ATUALIZACAO_APP;
  const sem = (estado: EstadoTelaAtualizacao, texto: string, rotulo: string, acao: AcaoDaTelaAtualizacao, ocupado = false): TelaAtualizacao => ({
    estado,
    texto,
    linha: null,
    principal: { rotulo, acao, ocupado },
    suporte: false,
  });
  // §5.1: um estado por vez, um só principal; só a contagem do estado da vez aparece
  if (s.modoSemSinal) return sem('modo_sem_sinal', T.textoEnviar, T.desligarModoSemSinal, 'desligar_modo_sem_sinal', s.desligando === true);
  if (!s.temSessao) return sem('sem_sessao', T.textoEnviar, T.entrar, 'entrar');
  // até a primeira contagem: nenhum número (nem pendente fictício) e o principal ocupado
  if (!s.contagem) return sem('contando', T.textoEnviar, T.enviarAgora, 'enviar', true);
  const { pendentes, naoAceitos, rascunhos, pendenciasComErro } = s.contagem;
  if (pendentes > 0 || s.envio === 'enviando') {
    const enviar = (ocupado: boolean, rotulo: string = T.enviarAgora) => ({ rotulo, acao: 'enviar' as const, ocupado });
    if (s.envio === 'enviando')
      return { estado: 'enviando', texto: T.textoEnviar, linha: { tipo: 'chip', texto: T.naFila(Math.max(pendentes, 1)), icone: 'sync' }, principal: enviar(true), suporte: false };
    if (s.envio === 'erro')
      return { estado: 'erro_envio', texto: T.textoEnviar, linha: { tipo: 'banner', tom: 'danger', icone: 'alert', texto: T.erroEnvio(pendentes), anunciar: true }, principal: enviar(false, T.tentarDeNovo), suporte: true };
    if (s.envio === 'sem_sinal')
      return { estado: 'sem_sinal_fila', texto: T.textoEnviar, linha: { tipo: 'banner', tom: 'warning', icone: 'wifiOff', texto: T.semSinalEnvio(pendentes), anunciar: true }, principal: enviar(false), suporte: false };
    return { estado: 'fila', texto: T.textoEnviar, linha: { tipo: 'chip', texto: T.naFila(pendentes), icone: 'clock' }, principal: enviar(false), suporte: false };
  }
  // §5.3: sem chip nos estados de §5.2 (a contagem aparece uma vez, no texto)
  if (naoAceitos > 0) return sem('nao_aceitos', T.textoNaoAceitos(naoAceitos), T.abrirNaoAceitos(naoAceitos), 'abrir_nao_aceitos');
  const baixar = (ocupado: boolean, rotulo: string = T.baixar(s.versao)) => ({ rotulo, acao: 'baixar' as const, ocupado });
  const texto = T.textoBaixar;
  const erroLink: TelaAtualizacao = {
    estado: 'erro_link',
    texto,
    linha: { tipo: 'banner', tom: 'danger', icone: 'alert', texto: T.erroLink, anunciar: true },
    principal: baixar(false, T.tentarDeNovo),
    suporte: true,
  };
  // gancho com erro ou pendência sem tela que a resolva: o erro do download, e "Tentar de novo" reconta (nada de rascunho inventado)
  if (pendenciasComErro !== null) return erroLink;
  if (rascunhos > 0) return sem('rascunhos', T.textoRascunhos(rascunhos), T.abrirRascunhos(rascunhos), 'abrir_rascunhos');
  if (s.link === 'gerando') return { estado: 'gerando_link', texto, linha: null, principal: baixar(true), suporte: false };
  if (s.link === 'erro') return erroLink;
  if (s.link === 'sem_sinal')
    return { estado: 'sem_sinal_link', texto, linha: { tipo: 'banner', tom: 'warning', icone: 'wifiOff', texto: T.semSinalLink, anunciar: true }, principal: baixar(false), suporte: false };
  return { estado: 'pronto', texto, linha: null, principal: baixar(false), suporte: false };
}

// ---------- controle (tela e folha) ----------

export type ResultadoEnvioAtualizacao = 'ok' | 'sem_sinal' | 'erro';
type ResultadoLinkAtualizacao = { tipo: 'ok'; url: string } | { tipo: 'sem_sinal' } | { tipo: 'erro' };

interface DependenciasPortao {
  /** Sessão com o motor aberto (a mesma leitura na tela de bloqueio e na folha). */
  temSessao(): boolean;
  /** Chave "Modo sem sinal" (`fv:offline`) ligada. */
  modoSemSinal(): boolean;
  /** Desliga a chave (a plataforma já começa o envio da fila). */
  desligarModoSemSinal(): Promise<void>;
  /** Contagem sobre o aparelho (motor e pendências dos módulos); não altera nada. */
  contar(): Promise<ContagemAtualizacao>;
  /** `motor.enviar({ incluirFalhos: false })` com a leitura do sinal (o "Não aceito" não é reenviado sozinho). */
  enviar(): Promise<ResultadoEnvioAtualizacao>;
  /** `POST /v1/core/app/apk`: o link temporário, pedido a cada toque. */
  pedirLink(): Promise<ResultadoLinkAtualizacao>;
  /** Abre o download no navegador do sistema (o link não é guardado em lugar nenhum). */
  abrirNoNavegador(url: string): Promise<void>;
}

export interface EstadoPortao {
  temSessao: boolean;
  modoSemSinal: boolean;
  desligando: boolean;
  /** `null` = ainda contando. */
  contagem: ContagemAtualizacao | null;
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
  /** "Desligar modo sem sinal": desliga a chave e já envia (ou passa ao próximo estado da prioridade). */
  desligarModoSemSinal(): Promise<void>;
  /** Recontagem (a fila mudou por fora, a sessão ou a chave do modo sem sinal mudou). */
  recontar(): Promise<void>;
  /** "Baixar a versão X.Y.Z": reconta antes; só com sessão, sinal e as três contagens em zero pede o link e o abre. */
  baixar(): Promise<void>;
  assinar(ouvinte: (e: EstadoPortao) => void): () => void;
}

/** O estado da tela a partir do estado do portão e da versão publicada. */
export function telaDoPortao(e: EstadoPortao, versao: string): TelaAtualizacao {
  return telaDaAtualizacao({
    modoSemSinal: e.modoSemSinal,
    desligando: e.desligando,
    temSessao: e.temSessao,
    contagem: e.contagem,
    envio: e.envio,
    link: e.link,
    versao,
  });
}

export function criarPortaoAtualizacao(dep: DependenciasPortao): PortaoAtualizacao {
  // começa "contando": até a 1ª contagem, nenhum número e nenhum botão do link
  let estado: EstadoPortao = {
    temSessao: dep.temSessao(),
    modoSemSinal: dep.modoSemSinal(),
    desligando: false,
    contagem: null,
    envio: 'parado',
    link: 'parado',
    detalhe: null,
  };
  const ouvintes = new Set<(e: EstadoPortao) => void>();
  const mudar = (parcial: Partial<EstadoPortao>) => {
    estado = { ...estado, temSessao: dep.temSessao(), modoSemSinal: dep.modoSemSinal(), ...parcial };
    for (const o of ouvintes) o(estado);
  };
  let envioEmCurso: Promise<void> | null = null;
  let linkEmCurso = false;
  let desligandoEmCurso: Promise<void> | null = null;

  /** A contagem com o detalhe do erro das pendências (se houver) para o suporte. */
  const comContagem = (contagem: ContagemAtualizacao): Partial<EstadoPortao> =>
    contagem.pendenciasComErro === null ? { contagem } : { contagem, detalhe: contagem.pendenciasComErro };
  const recontar = async () => {
    mudar(comContagem(await dep.contar()));
  };

  const enviarAgora = (): Promise<void> => {
    if (envioEmCurso) return envioEmCurso;
    envioEmCurso = (async () => {
      // sem sessão nada sai; com o modo sem sinal ligado, a ação da vez é desligá-lo (nada é tentado por baixo)
      if (!dep.temSessao() || dep.modoSemSinal()) return mudar({});
      mudar({ envio: 'enviando', link: 'parado' });
      let r: ResultadoEnvioAtualizacao;
      try {
        r = await dep.enviar();
      } catch (e) {
        r = 'erro';
        mudar({ detalhe: e instanceof Error ? e.message : String(e) });
      }
      const contagem = await dep.contar();
      mudar({ ...comContagem(contagem), envio: contagem.pendentes === 0 ? 'parado' : r === 'ok' ? 'erro' : r });
    })().finally(() => {
      envioEmCurso = null;
    });
    return envioEmCurso;
  };

  const entrar = async () => {
    await recontar();
    if (estado.temSessao && !estado.modoSemSinal && (estado.contagem?.pendentes ?? 0) > 0) await enviarAgora();
  };

  return {
    estado: () => estado,
    entrar,
    enviarAgora,
    recontar,
    desligarModoSemSinal() {
      if (desligandoEmCurso) return desligandoEmCurso;
      desligandoEmCurso = (async () => {
        mudar({ desligando: true });
        try {
          await dep.desligarModoSemSinal();
        } finally {
          mudar({ desligando: false });
        }
        await entrar();
      })().finally(() => {
        desligandoEmCurso = null;
      });
      return desligandoEmCurso;
    },
    async baixar() {
      if (linkEmCurso || envioEmCurso) return;
      linkEmCurso = true;
      try {
        await recontar();
        // portão: com qualquer coisa só no aparelho, nada de link (o botão nem aparece; aqui é a segunda trava); com o erro das
        // pendências ainda lá, o erro do download continua
        const c = estado.contagem;
        if (c?.pendenciasComErro != null) return mudar({ link: 'erro' });
        if (!estado.temSessao || estado.modoSemSinal || !c || !podeBaixar(c)) return;
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
