/**
 * Estado de PLATAFORMA do app (substitui o `app-store.tsx` monolítico da Fase M — ADR 0003, desenho
 * T-0001 §13): sessão, servidor, modo sem sinal, módulos efetivos e o motor de sync do platform-sdk.
 *
 * O que era de pedido, visita, rascunho e carteira NÃO mora mais aqui: cada módulo registra entidades
 * e etapas de sync em `modules/<m>/app` (`moduloApp`) e guarda o próprio estado no armazenamento do
 * módulo (`motor.armazenamentoDoModulo`), apagado junto se o módulo for desativado (RN-CORE-02).
 *
 * Telas de módulo acessam isto por `@macuxi/platform-sdk/react` (`useMotorSync`, `usePode`,
 * `useVisaoShell`, `useAmbiente`/`useHttp`) — o shell monta o `ShellProvider` em app/_layout.tsx.
 * O AMBIENTE do aparelho (HTTP com a sessão, sinal, UUID, usuário — `services/ambiente.ts`) vai ao motor
 * (etapas recebem `ctx.http`) e ao `ShellProvider` (telas). Nenhum módulo recebe ambiente por outra via.
 *
 * Sessão (T-0003 F2): na API real (padrão) o login é o do Core (`entrarComSenha`: código da empresa + e-mail + senha),
 * os tokens ficam no armazenamento seguro (`services/credenciais.ts`), um 401 troca o acesso pelo refresh e o
 * perfil precisa ser da variante (Campo: vendedor/promotor; Gestão: supervisor/gerente). Na demonstração
 * (`EXPO_PUBLIC_API_MODO=demo`, mock-api) segue o login fake da Fase M (`loginDemo`).
 *
 * Armazenamento (T-0088, desenho docs/desenho/T-0088.md): o motor roda sobre o SQLite do usuário e tenant da sessão
 * (`services/armazenamento.ts`), aberto ANTES do motor (passagem do AsyncStorage na 1ª abertura, com a tela de preparo);
 * a tarefa em segundo plano usa a mesma instância; sair fecha sem apagar; aparelho bloqueado apaga os bancos
 * de todos os usuários.
 */
import {
  ehAparelhoBloqueado,
  entrarComSenha,
  pedirSenhaTemporaria,
  trocarMinhaSenha,
  trocarSenhaPeloApp,
  tratarAparelhoBloqueado,
  type CamposEsqueci,
  type CamposLogin,
  type DadosDaTroca,
} from '@macuxi/core/app';
import type { FakeUser, Me } from '@macuxi/core/contracts';
import {
  CODIGO_USUARIO_SEM_FILIAL,
  ErroHttp,
  MENSAGEM_USUARIO_SEM_FILIAL,
  mensagemPerfilForaDoApp,
  perfilDaFaseM,
  type AberturaArmazenamento,
  empresaDosParametros,
  logoQueSubstituiAMarca,
  ocultarMarcaMacuxiDosParametros,
  proporcaoDaLogo,
  type AmbienteAparelho,
  type ArmazenamentoSync,
  type EtapaSync,
  type ModuloId,
  type MotorSync,
  type Perfil,
  type ProgressoPassagem,
  type VisaoShell,
} from '@macuxi/platform-sdk';
import {
  criarAgendadorSync,
  intervaloSyncAutoMs,
  PARAMETRO_SYNC_AUTO,
  type AgendadorSync,
  type EstadoAgendadorSync,
  type MotivoSync as MotivoAgendador,
} from '@macuxi/ui/mobile';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { criarTratadorAparelhoBloqueado } from '@/lib/aparelho-bloqueado';
import { criarTratadorSemFilial } from '@/lib/sem-filial';
import {
  agendarSemPressa,
  ESPERA_TELA_PREPARO_MS,
  resumoDaAbertura,
  type ResumoArmazenamento,
} from '@/lib/armazenamento-aparelho';
import { limparHistoricoDoShell } from '@/lib/historico-telas';
import { atualizarLogoDaEmpresa, logoDoTenant, type LogoGuardada } from '@/lib/logo-empresa';
import { deveSincronizar, type MotivoSync } from '@/lib/carga';
import { proximaEsperaFila } from '@/lib/fila-reenvio';
import {
  decidirPedidoSync,
  pedidoDoAgendador,
  rodarSync,
  type PedidoSync,
  type TipoSync,
} from '@/lib/sync-completa';
import {
  mesmoEstadoDePermissoes,
  permissoesExigidas,
  permissoesLiberadas,
  telaDePermissoes,
  type EstadosPermissoes,
  type TelaDePermissoes,
} from '@/lib/permissoes';
import { observarFalhasDeSync, type FalhaSync } from '@/lib/diagnostico-sync';
import { efetivosSemServidor } from '@/lib/efetivos-locais';
import { shellDaVariante, type ComponenteTela } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { normalizeApiUrl } from '@/lib/api-url';
import { enderecoSalvoValido, erroDaVerificacao, servidorEditavel } from '@/lib/endereco-do-build';
import { rotaDeSaude, type ModoApi } from '@/lib/modo-api';
import type { ResultadoSegundoPlano } from '@/lib/segundo-plano';
import { testarServidor } from '@/lib/servidor';
import { contaDaSessao, sessaoDepoisDaTroca } from '@/lib/trocar-senha-shell';
import { criarAmbienteDoAparelho, traduzirErro } from '@/services/ambiente';
import { ApiClient, HttpError, NetworkError } from '@/services/api';
import {
  abrirArmazenamentoDoUsuario,
  apagarBancosDoAparelho,
  driverDoArquivo,
  fecharArmazenamentoDoUsuario,
} from '@/services/armazenamento';
import { gravarSaidasPendentes, gravarTokens, lerSaidasPendentes, lerTokens } from '@/services/credenciais';
import { modoApi, perfilBuildAtual, platformDefaultApiUrl } from '@/services/device';
import {
  consultarModulosEfetivos,
  criarMotorDoUsuario,
  dispositivoId,
  trocarRefresh,
} from '@/services/motor-do-usuario';
import {
  desligarSyncEmSegundoPlano,
  ligarSyncEmSegundoPlano,
  lerUltimoSegundoPlano,
  marcarBuildAberto,
  registrarAppAberto,
  travaSync,
} from '@/services/segundo-plano';
import { atualizarTrajeto, pararTrajeto } from '@/services/trajeto';
import { gravarErro } from '@/services/erros';
import { atualizarFrasesDaCarga } from '@/services/frase-carga';
import {
  atualizarDiagnosticoRemoto,
  ligarEnvioDeDiagnosticos,
  useDiagnosticoNuvem,
} from '@/services/diagnostico';
import { registrarSaidaAnterior } from '@/services/saida-android';
import { apiDoAndroid, executarAcaoDePermissao, lerPermissoes } from '@/services/permissoes';
import { keys, readJson, writeJson } from '@/services/storage';
import { apagarFotosLocais } from '@/services/arquivos';
import { dataUriDaLogoGuardada, portaLogoEmpresa, uriDaLogo } from '@/services/logo-empresa';
import { ligarFonteFotoPdv } from '@/services/foto-pdv';
import { abrirFoto } from '@/services/visor-foto';
import { limparPdfsTemporarios } from '@/services/visor-pdf';
import { ligarResolvedorMiniatura } from '@/services/miniaturas';
import { esquecerRegistroPush } from '@/services/push';
import { filaDeSaidas, reenviarSaidas, sairNoServidor, type ResultadoChamada } from '@/lib/saida-push';

/** Usuário da sessão no shell: o do login real (Core) ou o fictício da Fase M (`role`, `team_name`...). */
export interface UsuarioSessao extends Partial<Omit<FakeUser, 'id' | 'name' | 'email'>> {
  id: string;
  name: string;
  email: string;
  /** Perfil do doc 03 (na demonstração, convertido do papel da Fase M no login). */
  perfil: Perfil | null;
}

export interface TenantSessao {
  id: string;
  codigo: string;
  nome: string;
  fuso: string;
}

/** Sessão em memória. No AsyncStorage vai SEM o token (tokens só no armazenamento seguro). */
export interface Sessao {
  token: string;
  user: UsuarioSessao;
  tenant?: TenantSessao | null;
  modo?: ModoApi;
}

type SessaoGuardada = Omit<Sessao, 'token'> & { token?: string };

/** Código da empresa lembrado no aparelho depois do primeiro login (doc 03, esclarecimentos). */
const CHAVE_CODIGO_EMPRESA = 'fv:codigo_empresa';
/** T-0059: última falha da sincronização (etapa técnica e mensagem), só para o Diagnóstico do Perfil. */
const CHAVE_FALHA_SYNC = 'fv:diagnostico:falha_sync';

/** Fora do desenvolvimento só https (R-20261101-023742-alexandre). */
const EXIGIR_HTTPS = !__DEV__;

/** Resultado de uma chamada do logout: sem sinal (rede, tempo, 5xx, 408, 429) volta para a fila; outro 4xx é recusa. */
async function resultadoDe(p: Promise<unknown>): Promise<ResultadoChamada> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof NetworkError) return 'sem_sinal';
    if (e instanceof HttpError)
      return e.status >= 500 || e.status === 408 || e.status === 429 ? 'sem_sinal' : 'recusado';
    return 'sem_sinal';
  }
}

/** Reenvia o `/auth/logout` das saídas feitas sem sinal (o servidor revoga a sessão e limpa o push do aparelho). */
async function reenviarSaidasPendentes(url: string): Promise<void> {
  const fila = filaDeSaidas(await lerSaidasPendentes(), Date.now());
  if (!fila.length) return;
  const restam = await reenviarSaidas(fila, (x) =>
    resultadoDe(
      new ApiClient(url, null).request('POST', '/auth/logout', {
        body: { refresh_token: x.refresh },
        timeoutMs: 5000,
      }),
    ),
  );
  await gravarSaidasPendentes(restam);
}

export function usuarioDaFaseM(u: FakeUser): UsuarioSessao & FakeUser {
  return { ...u, perfil: perfilDaFaseM(u.role) };
}

function usePlataformaValor() {
  const modo = useMemo(() => modoApi(), []);
  const variante = useMemo(() => varianteAtual(), []);
  const shell = useMemo(() => shellDaVariante(variante), [variante]);
  /** T-0038: producao usa sempre o endereço do build (sem campo Servidor); só o desenvolvimento edita. */
  const perfilBuild = useMemo(() => perfilBuildAtual(), []);
  const editavel = servidorEditavel(perfilBuild);
  const [ready, setReady] = useState(false);
  const defaultApiUrl = useMemo(() => platformDefaultApiUrl(), []);
  const [apiOverride, setApiOverride] = useState<string | null>(null);
  const apiUrl = apiOverride || defaultApiUrl;
  const apiUrlRef = useRef(apiUrl);
  apiUrlRef.current = apiUrl;

  const [sessao, setSessao] = useState<Sessao | null>(null);
  const sessaoRef = useRef<Sessao | null>(null);
  const [offline, setOfflineState] = useState(false);
  const offlineRef = useRef(false);
  const [me, setMe] = useState<Me | null>(null);
  const [motor, setMotor] = useState<MotorSync | null>(null);
  const motorRef = useRef<MotorSync | null>(null);
  const desassinarRef = useRef<(() => void) | null>(null);
  const [modulosAtivos, setModulosAtivos] = useState<readonly ModuloId[]>(['core']);
  const [codigoSalvo, setCodigoSalvo] = useState<string | null>(null);
  /**
   * T-0182: nome (fantasia; vazio = razão social) e logo da empresa da sessão, dos parâmetros do Core guardados (valem offline).
   * A logo é a cópia do aparelho, só a do tenant da sessão (`logoDoTenant`).
   */
  const [nomeEmpresa, setNomeEmpresa] = useState<string | null>(null);
  const [logoEmpresa, setLogoEmpresa] = useState<LogoGuardada | null>(null);
  /** Item 15 (v1.0.17): a empresa oculta a logomarca do Macuxi (`empresa_ocultar_marca_macuxi`; vale com a logo guardada). */
  const [ocultarMarcaMacuxi, setOcultarMarcaMacuxi] = useState(false);
  const logoEmpresaRef = useRef<LogoGuardada | null>(null);
  logoEmpresaRef.current = logoEmpresa;
  const renovarRef = useRef<(() => Promise<string | null>) | null>(null);
  /** RN-CORE-15: aviso de aparelho bloqueado (dados apagados) que fica visível na tela de login. */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);
  const aparelhoBloqueadoRef = useRef<((erro: unknown) => Promise<boolean>) | null>(null);
  /**
   * T-0176 (RN-CORE-39, tela 13): usuário sem filial de cadastro. O login fica aberto com o aviso no lugar do erro; `email` =
   * de quem saiu da sessão pelo 403, para o login reabrir preenchido. Nada é apagado do aparelho.
   */
  const [semFilial, setSemFilial] = useState<{ email: string | null } | null>(null);
  const semFilialRef = useRef<((erro: unknown) => Promise<boolean>) | null>(null);
  /** T-0059: sincronização do shell em curso (inclui a consulta dos módulos antes do motor) e quando começou. */
  const syncEmCursoRef = useRef<Promise<boolean> | null>(null);
  /** Tipo da sincronização em curso (R-20261115-100000: a completa pedida durante a parcial não se junta a ela). */
  const tipoEmCursoRef = useRef<TipoSync | null>(null);
  const ultimoInicioRef = useRef<number | null>(null);
  /** Abriu o app com sessão e carga gravada: vai direto ao Início e sincroniza em segundo plano (R-20261102-091336). */
  const sincronizarAoAbrirRef = useRef(false);
  const [falhaSync, setFalhaSync] = useState<FalhaSync | null>(null);
  /** ADR 0017: última execução da tarefa em segundo plano (Diagnóstico do Perfil). */
  const [segundoPlano, setSegundoPlano] = useState<ResultadoSegundoPlano | null>(null);
  /** RN-CORE-23: agendador único do app (abrir, voltar depois de 30 min, `sync_auto_min`, push, puxar/botão). */
  const [agendador, setAgendador] = useState<AgendadorSync | null>(null);
  const [estadoAgendador, setEstadoAgendador] = useState<EstadoAgendadorSync>({ puxando: false });
  /**
   * T-0088: armazenamento aberto da sessão (SQLite do usuário e tenant ou o AsyncStorage de reserva). O motor e a
   * tarefa em segundo plano usam a MESMA instância; o logout fecha sem apagar.
   */
  const armazenamentoRef = useRef<{
    usuarioId: string;
    arquivo: string | null;
    armazenamento: ArmazenamentoSync;
  } | null>(null);
  /** Diagnóstico do Perfil: SQLite (arquivo e marcador da passagem) ou AsyncStorage (reserva) e o motivo. */
  const [armazenamento, setArmazenamento] = useState<ResumoArmazenamento | null>(null);
  /** Tela "Atualizando os dados do aparelho…" (passagem do AsyncStorage na 1ª abertura depois da atualização). */
  const [preparo, setPreparo] = useState<{ progresso: ProgressoPassagem | null } | null>(null);
  /**
   * Dados já no SQLite e o arquivo não abriu: tela de erro com "Tentar de novo" (nunca volta ao AsyncStorage).
   * `falhouDeNovo`: a nova tentativa também falhou (a tela mostra "Ainda não abriu…").
   */
  const [erroArmazenamento, setErroArmazenamento] = useState<{
    detalhe: string;
    falhouDeNovo: boolean;
  } | null>(null);
  /** "Tentar de novo" em andamento: a tela de erro fica, com o botão carregando (sem toque duplo). */
  const [tentandoAbrir, setTentandoAbrir] = useState(false);
  const tentandoAbrirRef = useRef(false);
  /**
   * T-0145 (RN-CORE-37): permissões obrigatórias do aparelho, lidas a cada abertura e na volta das configurações. `null` =
   * ainda não lidas (a tela de abertura fica). Sem todas, nada sincroniza (`executarSync`, agendador) e o Gate mostra a tela.
   */
  const [estadosPermissoes, setEstadosPermissoes] = useState<EstadosPermissoes | null>(null);
  /**
   * T-0187 (RN-CORE-37): permissões exigidas pela variante e pelo cargo da sessão, calculadas só aqui; no Gestão, o supervisor
   * que entra passa a precisar da localização "o tempo todo" e a tela de permissões volta por cima do app, depois do login.
   */
  const perfilDaSessao = sessao?.user.perfil ?? null;
  const permissoesDoUsuario = useMemo(() => permissoesExigidas(variante, perfilDaSessao), [variante, perfilDaSessao]);
  const permissoesDoUsuarioRef = useRef(permissoesDoUsuario);
  permissoesDoUsuarioRef.current = permissoesDoUsuario;
  /**
   * Todas as exigidas concedidas, calculado uma vez por render (RD-2443): sem leitura do aparelho, nada fica liberado. O ref
   * (sync, agendador, volta ao primeiro plano) e a tela de permissões leem este mesmo valor.
   */
  const permissoesOk = estadosPermissoes !== null && permissoesLiberadas(variante, estadosPermissoes, permissoesDoUsuario);
  const permissoesOkRef = useRef(false);
  permissoesOkRef.current = permissoesOk;
  const [pedindoPermissao, setPedindoPermissao] = useState(false);
  /** 🟡 2 da revisão T-0145: toques no "Permitir" sem mudança no estado; com 2, o botão abre as configurações (sem laço). */
  const [toquesSemEfeito, setToquesSemEfeito] = useState(0);
  const estadosPermissoesRef = useRef<EstadosPermissoes | null>(null);
  /** Lê e guarda; devolve se mudou algo desde a última leitura (qualquer mudança zera os toques sem efeito). */
  const lerEGuardarPermissoes = useCallback(async () => {
    const e = await lerPermissoes();
    const antes = estadosPermissoesRef.current;
    const mudou = antes === null || !mesmoEstadoDePermissoes(antes, e);
    estadosPermissoesRef.current = e;
    setEstadosPermissoes(e);
    if (mudou) setToquesSemEfeito(0);
    return mudou;
  }, []);
  /** Lê o aparelho e diz se as exigidas (as do ref, sem recalcular) estão todas concedidas. */
  const conferirPermissoes = useCallback(async () => {
    await lerEGuardarPermissoes();
    const e = estadosPermissoesRef.current;
    return e !== null && permissoesLiberadas(variante, e, permissoesDoUsuarioRef.current);
  }, [lerEGuardarPermissoes, variante]);

  const api = useCallback(
    () =>
      new ApiClient(
        apiUrlRef.current,
        sessaoRef.current?.token ?? null,
        modo === 'v1' ? () => renovarRef.current?.() ?? Promise.resolve(null) : undefined,
        // qualquer chamada (fila, pull, etapas, telas) que receba 423 DISPOSITIVO_BLOQUEADO limpa o aparelho
        (e) => {
          void aparelhoBloqueadoRef.current?.(e).catch(() => undefined);
          // T-0176: 403 USUARIO_SEM_FILIAL em qualquer chamada (rota, módulos, sync) volta ao login sem apagar nada
          void semFilialRef.current?.(e).catch(() => undefined);
        },
      ),
    [modo],
  );

  /** Ambiente do aparelho para módulos: um só por instância do app (lê sessão, servidor e sinal por ref). */
  const ambiente = useMemo<AmbienteAparelho>(
    () =>
      criarAmbienteDoAparelho({
        api,
        // RD-0088: o visor de foto comum para os módulos (`ambiente.abrirFoto`)
        abrirFoto,
        // T-0182: a logo da empresa para o PDF, da cópia guardada (vale sem sinal)
        logoDaEmpresa: () => dataUriDaLogoGuardada(logoEmpresaRef.current),
        online: () => !offlineRef.current && sessaoRef.current !== null,
        usuario: () => {
          const s = sessaoRef.current;
          const u = s?.user;
          if (!u) return null;
          // fuso do tenant do login v1 (RN-CORE-11: virada do dia); a demonstração não tem
          return {
            id: u.id,
            nome: u.name,
            perfil: u.perfil,
            ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}),
          };
        },
      }),
    [api],
  );

  // T-0097 (a): a miniatura do catálogo que está no armazenamento da plataforma (`/v1/arquivos/<id>`) é baixada pelo shell com
  // o token da sessão (lê a sessão e o sinal por ref) e aberta do cache do app; sem sessão ou sem sinal fica vazia
  useEffect(
    () => ligarResolvedorMiniatura(api, () => !offlineRef.current && sessaoRef.current !== null),
    [api],
  );
  // T-0147: o visualizador da foto do PDV baixa com o mesmo token e o mesmo sinal (só em memória)
  useEffect(() => ligarFonteFotoPdv(api, () => !offlineRef.current && sessaoRef.current !== null), [api]);

  /** Etapa de plataforma: perfil/tenant do usuário (`GET /v1/me`), guardado no armazenamento do core. */
  const etapaMe = useMemo<EtapaSync>(
    () => ({
      id: 'me',
      rotulo: 'Seu perfil',
      modulo: 'core',
      executar: async (ctx) => {
        const dados = await ctx.http.get<Me>('/me');
        await ctx.armazenamento.gravar('me', dados);
        setMe(dados);
      },
    }),
    [],
  );

  const abrirMotor = useCallback(
    async (s: Sessao, opcoes: { abertura?: boolean; novaTentativa?: boolean } = {}) => {
      // na nova tentativa a tela de erro fica até o resultado (revisão de UX da T-0088, 🟡 5): o erro só sai no sucesso
      if (!opcoes.novaTentativa) setErroArmazenamento(null);
      // T-0088: o armazenamento abre ANTES do motor (escolha, passagem do AsyncStorage, espelho). A tela de preparo só
      // aparece se a abertura demorar (passagem com dados): quem já passou, ou a instalação nova, não vê a tela piscar
      let ultimo: ProgressoPassagem | null = null;
      let mostrando = false;
      const espera = setTimeout(() => {
        mostrando = true;
        setPreparo({ progresso: ultimo });
      }, ESPERA_TELA_PREPARO_MS);
      let abertura: AberturaArmazenamento;
      try {
        abertura = await abrirArmazenamentoDoUsuario({
          usuarioId: s.user.id,
          tenantId: s.tenant?.id ?? null,
          ...(s.tenant?.fuso ? { fuso: s.tenant.fuso } : {}),
          aoProgredir: (p) => {
            ultimo = p;
            if (mostrando) setPreparo({ progresso: p });
          },
        });
      } catch (e) {
        abertura = { tipo: 'erro', arquivo: null, detalhe: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(espera);
        setPreparo(null);
      }
      // saiu (ou trocou de usuário ou de tenant) enquanto abria: não monta o motor de quem saiu e fecha o arquivo aberto
      // agora (ainda fora do armazenamentoRef, o logout não o fecharia); o `fechar` esquece a instância na hora
      const atual = sessaoRef.current;
      if (atual?.user.id !== s.user.id || (atual.tenant?.id ?? null) !== (s.tenant?.id ?? null)) {
        if (abertura.tipo === 'sqlite')
          void fecharArmazenamentoDoUsuario(abertura.arquivo).catch(() => undefined);
        return;
      }
      setArmazenamento(resumoDaAbertura(abertura));
      if (abertura.tipo === 'erro') {
        console.warn(`[armazenamento] o banco local não abriu: ${abertura.detalhe}`);
        setErroArmazenamento({ detalhe: abertura.detalhe, falhouDeNovo: Boolean(opcoes.novaTentativa) });
        return;
      }
      setErroArmazenamento(null);
      armazenamentoRef.current = {
        usuarioId: s.user.id,
        arquivo: abertura.tipo === 'sqlite' ? abertura.arquivo : null,
        armazenamento: abertura.armazenamento,
      };
      const m = criarMotorDoUsuario({
        usuarioId: s.user.id,
        armazenamento: abertura.armazenamento,
        shell,
        modo,
        api,
        online: () => !offlineRef.current,
        ambiente,
        // `GET /v1/me` é do mock-api; na API real o perfil e o tenant vêm do login
        etapasExtras: modo === 'demo' ? [etapaMe] : [],
        // RN-CORE-48: ordem da carga pelo perfil de quem está logado agora
        perfil: () => sessaoRef.current?.user.perfil ?? s.user.perfil,
        // T-0156: o banco em que a tarefa `macuxi-trajeto` grava os pontos (eles vão ao servidor depois de cada envio)
        bancoDoTrajeto: () => (abertura.tipo === 'sqlite' ? driverDoArquivo(abertura.arquivo) : null),
      });
      await m.carregar();
      setMe(await m.armazenamentoDoModulo('core').ler<Me>('me'));
      const ativos = m.estado().modulosAtivos;
      // T-0034: sem resposta de /me/modulos guardada, na API real só o Core (nenhuma aba sem licença)
      setModulosAtivos(ativos.length > 0 ? ativos : efetivosSemServidor(modo, s.user.perfil));
      desassinarRef.current?.();
      const semModulos = m.assinar((e) =>
        setModulosAtivos(e.modulosAtivos.length > 0 ? e.modulosAtivos : ['core']),
      );
      // T-0059: o detalhe técnico da falha vai para o log e para o Diagnóstico do Perfil, nunca para a tela de carga
      const semFalhas = m.assinar(
        observarFalhasDeSync((f) => {
          console.warn(`[sync] parou${f.etapa ? ` em ${f.etapa}` : ''}: ${f.mensagem}`);
          setFalhaSync(f);
          void writeJson(CHAVE_FALHA_SYNC, f);
        }),
      );
      desassinarRef.current = () => {
        semModulos();
        semFalhas();
      };
      motorRef.current = m;
      sincronizarAoAbrirRef.current = Boolean(opcoes.abertura && m.estado().sincronizado_em);
      setMotor(m);
      // desenho T-0088 §5: o `rebuild` e a reindexação pendentes (L-1, versão) andam quando a tela fica livre, antes da 1ª
      // busca, sem segurar a 1ª tela (até lá a busca responde `indexando` e o Catálogo varre)
      // T-0144: na carga inicial (sem `sincronizado_em`) não: o motor faz o `finalizar` no fim da carga, e as duas reindexações
      // juntas com a carga só somavam trabalho pesado no banco logo na abertura do app
      if (abertura.tipo === 'sqlite' && m.estado().sincronizado_em) {
        const busca = abertura.armazenamento.busca;
        agendarSemPressa(() => {
          void Promise.resolve(busca.finalizar?.()).catch((e: unknown) =>
            console.warn(`[armazenamento] índice de busca: ${e instanceof Error ? e.message : String(e)}`),
          );
        });
      }
    },
    [shell, api, ambiente, etapaMe, modo],
  );

  // T-0186: o app encerrado com o visor de PDF aberto deixou o temporário no cache; a abertura do app apaga as sobras
  useEffect(() => limparPdfsTemporarios(), []);

  useEffect(() => {
    let vivo = true;
    // T-0140: enquanto o app abre (sessão, armazenamento, motor), a tarefa sem tela não começa neste processo
    travaSync.entrar('abertura');
    // T-0144: o processo anterior caiu fora do React (erro nativo, memória, travamento)? O motivo do Android vai ao Diagnóstico
    void registrarSaidaAnterior();
    (async () => {
      const [, settings, guardada, off, tokens, codigo, falha, ultimoSegundoPlano] = await Promise.all([
        // T-0145: as permissões são conferidas a cada abertura, antes do login e da sincronização
        conferirPermissoes().catch(() => false),
        readJson<{ apiUrl?: string | null }>(keys.settings),
        readJson<SessaoGuardada>(keys.session),
        readJson<boolean>(keys.offline),
        lerTokens(),
        readJson<string>(CHAVE_CODIGO_EMPRESA),
        readJson<FalhaSync>(CHAVE_FALHA_SYNC),
        lerUltimoSegundoPlano(),
      ]);
      if (!vivo) return;
      setCodigoSalvo(codigo);
      setFalhaSync(falha);
      setSegundoPlano(ultimoSegundoPlano);
      // sessão de outro modo (build demo x real) não vale; a sessão antiga da demo trazia o token junto
      const token = tokens?.access ?? (modo === 'demo' ? guardada?.token : undefined);
      const sess: Sessao | null =
        guardada && token && (guardada.modo ?? 'demo') === modo ? { ...guardada, token, modo } : null;
      // endereço salvo por versão antiga do app: ignorado nos builds de endereço fixo (T-0038)
      const salvo = enderecoSalvoValido(perfilBuild, settings?.apiUrl);
      if (salvo) {
        setApiOverride(salvo);
        apiUrlRef.current = salvo;
      }
      offlineRef.current = Boolean(off);
      setOfflineState(Boolean(off));
      // saídas feitas sem sinal (logout offline): tenta de novo agora, sem segurar a abertura
      if (modo === 'v1') void reenviarSaidasPendentes(apiUrlRef.current).catch(() => undefined);
      if (sess) {
        sessaoRef.current = sess;
        setSessao(sess);
        await abrirMotor(sess, { abertura: true });
      }
      if (vivo) setReady(true);
      // T-0140: este build abriu com tela; a partir daqui a tarefa sem tela pode rodar com o app fechado
      void marcarBuildAberto();
    })()
      .catch((e: unknown) => void gravarErro(e, 'nao-fatal', 'abertura do app'))
      .finally(() => travaSync.sair('abertura'));
    return () => {
      vivo = false;
    };
  }, [abrirMotor, conferirPermissoes, modo, perfilBuild]);

  /** Módulos efetivos a cada sync (licença checada no servidor por requisição — RN-CORE-01/02). */
  const atualizarModulos = useCallback(async () => {
    const m = motorRef.current;
    const s = sessaoRef.current;
    if (!m || !s) return;
    // T-0029 E3: os parâmetros do tenant vêm na mesma resposta e ficam guardados (valem offline; somem com o módulo).
    // Só o mock-api da demonstração não tem /me/modulos; na API real o erro sobe e vale a última resposta guardada.
    const { efetivos, parametros } = await consultarModulosEfetivos(api(), modo, s.user.perfil);
    await m.aplicarModulosAtivos(efetivos, parametros);
  }, [api, modo]);

  /**
   * Sincronização do app (R-20261115-100000, `lib/sync-completa.ts`): parcial (botão, puxar para baixo e selo: fila + pedidos e
   * clientes), completa (segurar 10 s, tela de carga: fila + módulos + tudo) ou leve (automática e aviso: novidades). Uma por
   * vez (T-0059): quem chama durante uma em curso recebe a mesma promessa, sem consultar os módulos de novo nem reiniciar a
   * carga; só a completa pedida durante uma parcial ou leve roda, depois da em curso (`rodarSync` espera ela; o motor, ADR 0057). Telas
   * navegam pelo ESTADO do motor, não por esta promessa.
   */
  const executarSync = useCallback(
    (pedido: PedidoSync): Promise<boolean> => {
      const m = motorRef.current;
      // T-0145: sem as permissões obrigatórias nada sincroniza (nem a carga, nem o agendador, nem o botão)
      if (!m || !permissoesOkRef.current) return Promise.resolve(false);
      const emCurso = syncEmCursoRef.current;
      const decisao = decidirPedidoSync(pedido.tipo, emCurso ? tipoEmCursoRef.current : null);
      if (emCurso && decisao === 'juntar') return emCurso;
      ultimoInicioRef.current = Date.now();
      // T-0140: a sincronização do app (inclui a carga inicial) segura a trava única: a tarefa sem tela não começa junto
      travaSync.entrar('sincronizacao');
      const p: Promise<boolean> = (async () => {
        // T-0140/RD-0033 (ADR 0017 §3): a tarefa sem tela já estava rodando neste processo (app aberto durante a passada,
        // com o motor dela): espera ela terminar e relê o que ela gravou, sem duas passadas no mesmo arquivo. A trava é a
        // única porta (a tarefa e a tela dividem o processo e o runtime JS); o único `false` calado é a troca de usuário
        if (travaSync.segundoPlanoAtivo()) {
          await travaSync.esperarSegundoPlano();
          if (motorRef.current !== m) return false;
          await m.carregar();
        }
        // a completa pedida durante uma parcial ou leve espera a em curso antes do envio e dos módulos.
        // T-0181: com os módulos (só na completa), as frases da carga, sem segurar a carga; a falha mantém a lista anterior
        const modulosEFrases = async () => {
          if (modo === 'v1') void atualizarFrasesDaCarga(api());
          await atualizarModulos();
        };
        return rodarSync(pedido, m, { modo, offline: offlineRef.current, atualizarModulos: modulosEFrases, emCurso });
      })().finally(() => {
        travaSync.sair('sincronizacao');
        if (syncEmCursoRef.current === p) {
          syncEmCursoRef.current = null;
          tipoEmCursoRef.current = null;
        }
      });
      syncEmCursoRef.current = p;
      tipoEmCursoRef.current = pedido.tipo;
      return p;
    },
    [api, atualizarModulos, modo],
  );

  /** Sincronização completa (segurar 10 s no Sincronizar, tela de carga, modo sem sinal desligado): envia a fila e puxa tudo. */
  const sincronizar = useCallback((): Promise<boolean> => executarSync({ tipo: 'completa' }), [executarSync]);

  /** Sincroniza só se faz sentido agora (`deveSincronizar`): não reinicia a carga em andamento nem a que acabou de terminar. */
  const sincronizarSeNecessario = useCallback(
    (motivo: MotivoSync): Promise<boolean> | null => {
      const m = motorRef.current;
      if (!m) return null;
      // sem sinal: só a tela de carga tenta (o motor registra o erro e a tela oferece desligar o modo sem sinal)
      if (offlineRef.current && motivo !== 'tela-carga') return null;
      const ok = deveSincronizar(motivo, {
        estado: m.estado(),
        emCurso: syncEmCursoRef.current !== null,
        ultimoInicio: ultimoInicioRef.current,
        agora: Date.now(),
      });
      return ok ? sincronizar() : syncEmCursoRef.current;
    },
    [sincronizar],
  );

  const enviarFila = useCallback(
    (opcoes: { incluirFalhos?: boolean } = {}) => motorRef.current?.enviar(opcoes) ?? Promise.resolve([]),
    [],
  );

  // ---------- sessão ----------
  const abrirSessao = useCallback(
    async (s: Sessao, refresh: string | null) => {
      await gravarTokens({ access: s.token, refresh });
      setAvisoLogin(null);
      setSemFilial(null);
      const { token: _token, ...semToken } = s;
      await writeJson(keys.session, semToken);
      sessaoRef.current = s;
      setSessao(s);
      await abrirMotor(s);
    },
    [abrirMotor],
  );

  /**
   * Segurança (R-20261101-023742-alexandre): o login só sai do aparelho para um servidor que se identificou como Macuxi
   * (`testarServidor`). Guarda o último endereço aprovado nesta execução do app; endereço novo (ou salvo por uma versão
   * antiga do app) é testado antes. Falha: `ErroSemConexao` ou `ErroHttp` `SERVIDOR_INVALIDO` (mensagem no Core).
   */
  const servidorAprovadoRef = useRef<string | null>(null);
  const garantirServidorMacuxi = useCallback(async () => {
    const url = apiUrlRef.current;
    if (servidorAprovadoRef.current === url) return url;
    try {
      await new ApiClient(url, null).health(rotaDeSaude(modo), { exigirHttps: EXIGIR_HTTPS });
    } catch (e) {
      // endereço fixo (T-0038): "Servidor indisponível — tente mais tarde", sem pedir endereço
      throw erroDaVerificacao(perfilBuild, e);
    }
    servidorAprovadoRef.current = url;
    return url;
  }, [modo, perfilBuild]);

  /** Demonstração (mock-api): entra como um usuário fictício, sem senha. */
  const loginDemo = useCallback(
    async (user: FakeUser) => {
      const url = await garantirServidorMacuxi();
      const res = await new ApiClient(url, null).login(user.id);
      await abrirSessao({ token: res.access_token, user: usuarioDaFaseM(res.user), modo: 'demo' }, null);
    },
    [abrirSessao, garantirServidorMacuxi],
  );

  /** Transporte sem sessão para o endereço que acabou de passar no teste (login, troca e "Esqueci a senha"). */
  const postSemSessao = useCallback(async () => {
    // o pedido vai só para o endereço que acabou de passar no teste (nunca para o que mudar no meio)
    const endereco = await garantirServidorMacuxi();
    const cliente = new ApiClient(endereco, null);
    const post = async (caminho: string, corpo: unknown) => {
      try {
        return (await cliente.request<unknown>('POST', caminho, { body: corpo })).data;
      } catch (e) {
        throw traduzirErro(e);
      }
    };
    return { endereco, post };
  }, [garantirServidorMacuxi]);

  /** Sessão recebida do login ou da troca de senha: salva o código da empresa, confere o perfil da variante e abre o app. */
  const concluirLogin = useCallback(
    async (
      r: Awaited<ReturnType<typeof entrarComSenha>>,
      post: (caminho: string, corpo: unknown) => Promise<unknown>,
    ) => {
      const codigo = r.tenant.codigo;
      setCodigoSalvo(codigo);
      await writeJson(CHAVE_CODIGO_EMPRESA, codigo);
      // reserva para a API sem a conferência do `app` (RN-CORE-33): encerra a sessão recém-criada
      const fora = mensagemPerfilForaDoApp(r.usuario.perfil, variante);
      if (fora) {
        await post('/auth/logout', { refresh_token: r.refresh_token }).catch(() => undefined);
        throw new ErroHttp(403, 'PERFIL_FORA_DO_APP', fora);
      }
      // T-0176 (RN-CORE-39): a senha está certa, mas a conta não tem filial de cadastro. O app não entra: encerra a sessão
      // recém-criada e o login mostra o aviso da tela 13; depois que o admin informa a filial, o mesmo "Entrar" funciona
      // `sem_filial` do `UsuarioSessao` do Core (T-0176); ausente = emissor antigo = livre
      if (r.usuario.sem_filial === true) {
        await post('/auth/logout', { refresh_token: r.refresh_token }).catch(() => undefined);
        setSemFilial({ email: r.usuario.email });
        throw new ErroHttp(403, CODIGO_USUARIO_SEM_FILIAL, MENSAGEM_USUARIO_SEM_FILIAL);
      }
      const user: UsuarioSessao = {
        id: r.usuario.id,
        name: r.usuario.nome,
        email: r.usuario.email,
        perfil: r.usuario.perfil,
      };
      await abrirSessao({ token: r.access_token, user, tenant: r.tenant, modo: 'v1' }, r.refresh_token);
    },
    [abrirSessao, variante],
  );

  /** Identificação do aparelho no login e na troca (bloqueio remoto, RN-CORE-15). */
  const aparelhoDoLogin = useCallback(async () => {
    const nome = (Device.modelName ?? Device.deviceName ?? '').slice(0, 80);
    return { id: await dispositivoId(), ...(nome ? { nome } : {}) };
  }, []);

  /**
   * Login real (RF-CORE-01). Erros saem no contrato do SDK (`ErroHttp`/`ErroSemConexao`) para a `TelaLogin` do Core
   * mostrar a mensagem certa. RN-CORE-33 (T-0094): manda `app` = variante; a API recusa o perfil de outro app (403
   * `PERFIL_FORA_DO_APP`, sem sessão). 403 `SENHA_A_TROCAR` sobe como erro: a tela de login vai à "Crie sua senha".
   */
  const loginComSenha = useCallback(
    async (campos: CamposLogin) => {
      // nova tentativa: o aviso de sem filial só volta se a API ainda disser que falta a filial
      setSemFilial(null);
      const { endereco, post } = await postSemSessao();
      // o servidor acabou de responder: é a hora de mandar as saídas que ficaram na fila (logout sem sinal)
      void reenviarSaidasPendentes(endereco).catch(() => undefined);
      let r: Awaited<ReturnType<typeof entrarComSenha>>;
      try {
        r = await entrarComSenha(post, campos, await aparelhoDoLogin(), variante);
      } catch (e) {
        // RN-CORE-15: senha certa num aparelho bloqueado — limpa o aparelho; a tela de login mostra o aviso
        await aparelhoBloqueadoRef.current?.(e);
        throw e;
      }
      await concluirLogin(r, post);
    },
    [aparelhoDoLogin, concluirLogin, postSemSessao, variante],
  );

  /**
   * "Crie sua senha" (T-0094; RN-CORE-34): troca com a senha usada no login (que a tela de login guarda só na memória) e entra
   * direto com a sessão da resposta. Nada do app abre antes: a sessão só existe depois daqui.
   */
  const trocarSenha = useCallback(
    async (dados: DadosDaTroca) => {
      const { post } = await postSemSessao();
      let r: Awaited<ReturnType<typeof trocarSenhaPeloApp>>;
      try {
        r = await trocarSenhaPeloApp(post, dados, variante, await aparelhoDoLogin());
      } catch (e) {
        await aparelhoBloqueadoRef.current?.(e);
        throw e;
      }
      await concluirLogin(r, post);
    },
    [aparelhoDoLogin, concluirLogin, postSemSessao, variante],
  );

  /**
   * "Trocar senha" do Perfil (T-0178; RN-CORE-32 e RN-CORE-34): troca com a senha atual de quem está no app. A API sobe a
   * `sessao_versao`: os tokens novos da resposta tomam o lugar dos atuais, sem reabrir o motor (mesmo usuário e tenant).
   * Erros sobem como no login (`ErroHttp`/`ErroSemConexao`) para a tela do Core.
   */
  const trocarMinhaSenhaNoApp = useCallback(
    async (corpo: { senha_atual: string; senha_nova: string }) => {
      const conta = contaDaSessao(sessaoRef.current);
      if (!conta) throw new ErroHttp(401, 'SEM_SESSAO', 'Entre de novo para trocar a senha.');
      const { post } = await postSemSessao();
      let r: Awaited<ReturnType<typeof trocarMinhaSenha>>;
      try {
        r = await trocarMinhaSenha(post, conta, corpo, variante, await aparelhoDoLogin());
      } catch (e) {
        await aparelhoBloqueadoRef.current?.(e);
        throw e;
      }
      const nova = sessaoDepoisDaTroca(sessaoRef.current, r);
      if (!nova) {
        // a sessão mudou durante a troca (saiu ou trocou de usuário): encerra a sessão que acabou de nascer
        await post('/auth/logout', { refresh_token: r.refresh_token }).catch(() => undefined);
        return;
      }
      await gravarTokens({ access: r.access_token, refresh: r.refresh_token });
      const { token: _token, ...semToken } = nova;
      await writeJson(keys.session, semToken);
      sessaoRef.current = nova;
      setSessao(nova);
    },
    [aparelhoDoLogin, postSemSessao, variante],
  );

  /** "Esqueci a senha" (T-0094): a resposta é sempre a mesma; a tela mostra a confirmação de sempre. */
  const pedirSenha = useCallback(
    async (campos: CamposEsqueci) => {
      const { post } = await postSemSessao();
      await pedirSenhaTemporaria(post, campos);
    },
    [postSemSessao],
  );

  /** Fecha a sessão em memória (motor, usuário, módulos); quem chama cuida dos tokens e do disco. */
  const fecharSessaoLocal = useCallback(() => {
    desassinarRef.current?.();
    desassinarRef.current = null;
    syncEmCursoRef.current = null;
    tipoEmCursoRef.current = null;
    ultimoInicioRef.current = null;
    sincronizarAoAbrirRef.current = false;
    const usuarioId = sessaoRef.current?.user.id;
    if (usuarioId) void esquecerRegistroPush(usuarioId);
    sessaoRef.current = null;
    motorRef.current = null;
    // T-0088: quem fecha o arquivo é o logout (sem apagar) ou o bloqueio do aparelho (apaga os de todos)
    armazenamentoRef.current = null;
    // R-20261104-042956 🟢 3: a 1ª tela do próximo login não anima como "voltar"
    limparHistoricoDoShell();
    // ADR 0017: sem sessão (logout ou aparelho bloqueado), nada roda em segundo plano
    void desligarSyncEmSegundoPlano();
    setSessao(null);
    setMotor(null);
    setMe(null);
    setModulosAtivos(['core']);
    // T-0182: sair não apaga a cópia da logo (a carga do próximo login da mesma empresa a mostra); só some da tela
    setNomeEmpresa(null);
    setLogoEmpresa(null);
    setOcultarMarcaMacuxi(false);
    setArmazenamento(null);
    setErroArmazenamento(null);
  }, []);

  const logout = useCallback(async () => {
    const tokens = await lerTokens();
    if (modo === 'v1' && tokens?.refresh) {
      // R-20261102-174535 (🟡 1): apaga o token do push do aparelho e revoga a família do refresh (que no servidor também
      // limpa o push). Sem sinal, a saída vai para a fila e é reenviada na abertura do app ou no próximo login.
      const refresh = tokens.refresh;
      const id = await dispositivoId();
      const url = apiUrlRef.current;
      const r = await sairNoServidor({
        apagarPush: () =>
          resultadoDe(
            new ApiClient(url, tokens.access).request('DELETE', '/dispositivos/atual/push', {
              query: { dispositivo_id: id },
              timeoutMs: 5000,
            }),
          ),
        revogar: () =>
          resultadoDe(
            new ApiClient(url, null).request('POST', '/auth/logout', {
              body: { refresh_token: refresh },
              timeoutMs: 5000,
            }),
          ),
      });
      if (r === 'pendente') {
        const nova = { refresh, dispositivo_id: id, em: new Date().toISOString() };
        await gravarSaidasPendentes(filaDeSaidas(await lerSaidasPendentes(), Date.now(), nova));
      }
    }
    // T-0156 (tracking §3.4): sem sessão, a captura do trajeto para antes de o banco do usuário fechar
    await pararTrajeto();
    // T-0186: nenhum PDF do visor fica no cache depois de sair
    limparPdfsTemporarios();
    await gravarTokens(null);
    const aberto = armazenamentoRef.current;
    fecharSessaoLocal();
    await writeJson(keys.session, null);
    // T-0088 (desenho §3): sair NÃO apaga os dados do usuário; o arquivo fecha (espera as escritas da fila do adaptador)
    // e o próximo login do mesmo usuário e tenant reabre o mesmo arquivo, com a fila offline que ficou
    await fecharArmazenamentoDoUsuario(aberto?.arquivo ?? null).catch(() => undefined);
  }, [modo, fecharSessaoLocal]);
  // o tratador do sem filial é criado uma vez: lê o `logout` atual por ref
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  /** T-0088: "Tentar de novo" da tela de erro do armazenamento (arquivo do SQLite que não abriu). */
  const tentarAbrirDeNovo = useCallback(async () => {
    const s = sessaoRef.current;
    if (!s || tentandoAbrirRef.current) return;
    tentandoAbrirRef.current = true;
    setTentandoAbrir(true);
    try {
      await abrirMotor(s, { abertura: true, novaTentativa: true });
    } finally {
      tentandoAbrirRef.current = false;
      setTentandoAbrir(false);
    }
  }, [abrirMotor]);

  /**
   * RN-CORE-15: 423 `DISPOSITIVO_BLOQUEADO` no login, no refresh ou em qualquer chamada. O Core decide a ordem
   * (`tratarAparelhoBloqueado`): apaga tudo do aparelho (motor, chaves de todos os usuários, fotos), apaga os tokens,
   * fecha a sessão (sem `/auth/logout`: a API já revogou a família), mostra o aviso no login e volta para lá.
   */
  aparelhoBloqueadoRef.current ??= criarTratadorAparelhoBloqueado(
    {
      motor: () => motorRef.current,
      pararCaptura: pararTrajeto,
      // T-0088: os bancos SQLite de TODOS os usuários do aparelho (fecha as instâncias abertas antes)
      apagarBancos: apagarBancosDoAparelho,
      chavesLocais: async () => [...(await AsyncStorage.getAllKeys())],
      removerChaves: async (chaves) => {
        await Promise.all(chaves.map((k) => writeJson(k, null)));
      },
      apagarFotos: apagarFotosLocais,
      apagarTokens: () => gravarTokens(null),
      fecharSessao: () => fecharSessaoLocal(),
      avisar: setAvisoLogin,
      irParaLogin: () => {
        try {
          router.replace('/login');
        } catch {
          // navegação ainda não montada: sem sessão, as abas já redirecionam ao login
        }
      },
    },
    tratarAparelhoBloqueado,
    ehAparelhoBloqueado,
  );

  /**
   * T-0176 (RN-CORE-39; ADR 0056): 403 `USUARIO_SEM_FILIAL` com o usuário logado. Espera a sincronização em curso, sai como no
   * "Sair" (fecha o banco do usuário SEM apagar dados nem a fila offline) e volta ao login com o aviso da tela 13.
   */
  semFilialRef.current ??= criarTratadorSemFilial({
    temSessao: () => sessaoRef.current !== null,
    email: () => sessaoRef.current?.user.email ?? null,
    esperarSync: () => syncEmCursoRef.current ?? Promise.resolve(),
    sair: () => logoutRef.current(),
    avisar: (email) => setSemFilial({ email }),
    irParaLogin: () => {
      try {
        router.replace('/login');
      } catch {
        // navegação ainda não montada: sem sessão, as abas já redirecionam ao login
      }
    },
  });

  /** 401 na API real: troca o refresh por um par novo (uma troca por vez). Refresh recusado = sessão encerrada. */
  const renovando = useRef<Promise<string | null> | null>(null);
  renovarRef.current = () => {
    renovando.current ??= (async () => {
      try {
        if (!sessaoRef.current) return null;
        const access = await trocarRefresh(apiUrlRef.current);
        if (!access) return null;
        const atual = sessaoRef.current;
        if (atual) {
          const nova = { ...atual, token: access };
          sessaoRef.current = nova;
          setSessao(nova);
        }
        return access;
      } catch (e) {
        // RN-CORE-15: aparelho bloqueado no refresh — a limpeza já fecha a sessão
        if (await aparelhoBloqueadoRef.current?.(e).catch(() => false)) return null;
        // refresh recusado (expirado, reusado, usuário bloqueado): entrar de novo; a fila fica guardada no aparelho
        if (e instanceof HttpError && e.status < 500 && e.status !== 408 && e.status !== 429) await logout();
        return null;
      } finally {
        renovando.current = null;
      }
    })();
    return renovando.current;
  };

  const setApiUrl = useCallback(
    async (url: string | null) => {
      // endereço fixo (T-0038): não há o que trocar; nada é salvo
      if (!editavel) return;
      const v = url && url.trim() ? url.trim() : null;
      setApiOverride(v);
      apiUrlRef.current = v || platformDefaultApiUrl();
      await writeJson(keys.settings, { apiUrl: v });
    },
    [editavel],
  );

  /** Testa o endereço como digitado (só sem espaços nas pontas): só um servidor Macuxi passa; a mensagem diz o endereço testado. */
  const testApiUrl = useCallback(
    async (url: string) => {
      const endereco = normalizeApiUrl(url);
      const r = await testarServidor(endereco, {
        rota: rotaDeSaude(modo),
        exigirHttps: EXIGIR_HTTPS,
        buscar: (u, init) => fetch(u, init),
      });
      if (r.ok) servidorAprovadoRef.current = endereco;
      return { ok: r.ok, message: r.mensagem, testado: r.testado };
    },
    [modo],
  );

  const setOffline = useCallback(
    async (valor: boolean) => {
      offlineRef.current = valor;
      setOfflineState(valor);
      await writeJson(keys.offline, valor);
      if (!valor) {
        await enviarFila();
        void sincronizar();
      }
    },
    [enviarFila, sincronizar],
  );

  // ---------- RN-CORE-23: agendador único do app (nenhum timer de consulta abaixo de 15 min) ----------
  useEffect(() => {
    if (!motor) return;
    const m = motor;
    const ag = criarAgendadorSync({
      intervaloMs: () => intervaloSyncAutoMs(m.parametros('core')[PARAMETRO_SYNC_AUTO]),
      // R-20261115-100000: `manual` (botão, puxar para baixo, selo) = parcial; os outros = leve
      sincronizar: (motivo: MotivoAgendador, entidades?: readonly string[]) =>
        executarSync(pedidoDoAgendador(motivo, entidades)),
      ultimaSincronizacao: () => {
        const em = m.estado().sincronizado_em;
        const ms = em ? Date.parse(em) : NaN;
        return Number.isFinite(ms) ? ms : null;
      },
      // automática só depois da carga inicial (antes dela, quem sincroniza é a tela de carga), com sessão e sinal
      podeSincronizar: () =>
        permissoesOkRef.current &&
        !offlineRef.current &&
        sessaoRef.current !== null &&
        motorRef.current === m &&
        m.estado().sincronizado_em !== null,
      // abriu o app já com carga: o Início aparece na hora e a atualização leve roda sem prender a tela (R-20261102-091336)
      sincronizarAoAbrir: sincronizarAoAbrirRef.current,
      aoMudar: setEstadoAgendador,
    });
    sincronizarAoAbrirRef.current = false;
    setAgendador(ag);
    if (AppState.currentState === 'active') ag.primeiroPlano();
    // sincronização feita por fora (tela de carga, tarefa do ADR 0017, tela de módulo): o próximo disparo conta dela
    let ultimoSync = m.estado().sincronizado_em;
    const semEstado = m.assinar((e) => {
      if (e.sincronizado_em === ultimoSync) return;
      ultimoSync = e.sincronizado_em;
      ag.reprogramar();
    });

    // RN-CORE-23 item 2 (exceção à regra dos 15 min): reenvio da FILA só com item pendente, espera crescente, sem pull
    let tentativasFila = 0;
    let timerFila: ReturnType<typeof setTimeout> | null = null;
    const pendente = () =>
      m.estado().fila.some((i) => i.situacao === 'pendente') ||
      m.estado().arquivos.some((a) => a.situacao === 'pendente');
    const armarFila = () => {
      if (timerFila !== null) clearTimeout(timerFila);
      timerFila = null;
      if (!pendente() || AppState.currentState !== 'active') return;
      timerFila = setTimeout(() => {
        timerFila = null;
        if (offlineRef.current || m.estado().sincronizando || m.estado().enviando) {
          armarFila();
          return;
        }
        tentativasFila++;
        void m
          .enviar()
          .catch(() => undefined)
          .finally(() => {
            if (!pendente()) tentativasFila = 0;
            armarFila();
          });
      }, proximaEsperaFila(tentativasFila));
    };
    let tinhaPendente = pendente();
    const semFila = m.assinar(() => {
      const agora = pendente();
      if (agora && !tinhaPendente) {
        // item novo na fila: recomeça a espera curta
        tentativasFila = 0;
        armarFila();
      }
      if (!agora) tentativasFila = 0;
      tinhaPendente = agora;
    });
    armarFila();

    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        // voltou ao app: envia a fila na hora (não consulta nada) e o agendador decide a verificação (30 min)
        if (!offlineRef.current && !m.estado().sincronizando) void m.enviar().catch(() => undefined);
        tentativasFila = 0;
        armarFila();
        ag.primeiroPlano();
      } else {
        ag.segundoPlano();
        if (timerFila !== null) clearTimeout(timerFila);
        timerFila = null;
      }
    });
    return () => {
      ag.parar();
      semEstado();
      semFila();
      sub.remove();
      if (timerFila !== null) clearTimeout(timerFila);
      setAgendador((atual) => (atual === ag ? null : atual));
    };
  }, [motor, executarSync]);

  // ---------- T-0158 (v1.0.4, atrás da chave do build ou da chave remota do /v1/saude): fila dos diagnósticos, com a sessão aberta ----------
  const diagnosticoNuvem = useDiagnosticoNuvem();
  useEffect(() => {
    // a chave remota é lida a cada sessão aberta (R-20261111-004711: ligar depois sem build novo)
    if (motor) void atualizarDiagnosticoRemoto(api(), rotaDeSaude(modo));
  }, [motor, api, modo]);
  useEffect(() => {
    if (!motor || !diagnosticoNuvem) return;
    return ligarEnvioDeDiagnosticos({
      api,
      online: () => !offlineRef.current && sessaoRef.current !== null,
      dono: () => {
        const s = sessaoRef.current;
        return s ? { usuarioId: s.user.id, tenantId: s.tenant?.id ?? null } : null;
      },
      motor: () => motorRef.current,
    });
  }, [motor, api, diagnosticoNuvem]);

  // ---------- T-0182: nome e logo da empresa (parâmetros do Core) a cada sincronização; a logo só é baixada quando o sha muda ----------
  useEffect(() => {
    if (!motor) return;
    const porta = portaLogoEmpresa(api);
    let vivo = true;
    let fila: Promise<void> = Promise.resolve();
    const atualizar = () => {
      fila = fila.then(async () => {
        const tenantId = sessaoRef.current?.tenant?.id;
        const parametrosCore = motor.parametros('core');
        const empresa = empresaDosParametros(parametrosCore);
        if (vivo) {
          setNomeEmpresa(empresa?.nome ?? null);
          setOcultarMarcaMacuxi(ocultarMarcaMacuxiDosParametros(parametrosCore));
        }
        if (!tenantId) return;
        const l = await atualizarLogoDaEmpresa(porta, { tenantId, empresa, online: !offlineRef.current });
        if (vivo && motorRef.current === motor) setLogoEmpresa(logoDoTenant(l, sessaoRef.current?.tenant?.id));
      });
    };
    atualizar();
    let antes = motor.estado();
    const semEstado = motor.assinar((e) => {
      const mudou = e.sincronizado_em !== antes.sincronizado_em || e.modulosAtivos !== antes.modulosAtivos;
      antes = e;
      if (mudou) atualizar();
    });
    return () => {
      vivo = false;
      semEstado();
    };
  }, [motor, api]);

  /**
   * Logo da empresa para as telas: `file://` da cópia e a proporção guardada (a placa nasce do tamanho certo). `soLogoDoCliente`
   * (item 15): `logoQueSubstituiAMarca` do SDK (a chave ligada e a logo no aparelho); sem a logo, a do Macuxi continua.
   */
  const empresa = useMemo(() => {
    const uri = logoEmpresa ? uriDaLogo(logoEmpresa) : null;
    const logo = logoEmpresa && uri ? { uri, proporcao: proporcaoDaLogo(logoEmpresa) } : null;
    return { nome: nomeEmpresa, logo, soLogoDoCliente: logoQueSubstituiAMarca(ocultarMarcaMacuxi, logo) !== null };
  }, [nomeEmpresa, logoEmpresa, ocultarMarcaMacuxi]);

  // ---------- ADR 0017: sincronização incremental em segundo plano (expo-background-task) ----------
  useEffect(() => {
    if (!motor) return;
    // com o app vivo neste processo, a tarefa usa ESTE motor (mesma promessa de `sincronizar`, nada em paralelo)
    const semApp = registrarAppAberto({
      sincronizadoEm: () => motor.estado().sincronizado_em,
      prepararSessao: async () => 'ok',
      // ADR 0018 item 8: a passada é a atualização leve (novidades), como a automática do app
      sincronizar: () => executarSync({ tipo: 'leve' }),
      erro: () => motor.estado().erro,
    });
    // a tarefa só é agendada depois da carga inicial (antes dela, a carga roda só com o app aberto)
    let ligada = false;
    // T-0140: a tarefa não mexe em estado de React; o Diagnóstico relê o resultado dela quando o app volta ao primeiro plano
    const semVolta = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      void lerUltimoSegundoPlano()
        .then((r) => setSegundoPlano(r))
        .catch(() => undefined);
      // T-0156 (tracking §3.2): na volta ao primeiro plano, com a carga feita, liga ou desliga a captura do trajeto
      if (ligada) void atualizarTrajeto();
    });
    const ligar = (sincronizadoEm: string | null) => {
      if (ligada || !sincronizadoEm) return;
      ligada = true;
      void ligarSyncEmSegundoPlano();
      // T-0156 (tracking §3.2): na abertura, depois da carga
      void atualizarTrajeto();
    };
    ligar(motor.estado().sincronizado_em);
    const semEstado = motor.assinar((e) => ligar(e.sincronizado_em));
    return () => {
      semApp();
      semEstado();
      semVolta.remove();
    };
  }, [motor, executarSync]);

  // ---------- T-0145: permissões obrigatórias (a cada abertura e na volta das configurações ou do diálogo) ----------
  // Com o app liberado, a conferência é só na próxima abertura: retirar uma permissão no meio do uso não desmonta a tela em
  // que o vendedor está (o pedido aberto continua); na tela de permissões, a volta das configurações relê na hora
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && !permissoesOkRef.current) void conferirPermissoes().catch(() => undefined);
    });
    return () => sub.remove();
  }, [conferirPermissoes]);

  /** Tela de permissões (nula enquanto não leu ou com todas concedidas). */
  const telaPermissoes = useMemo<TelaDePermissoes | null>(
    () =>
      estadosPermissoes && !permissoesOk
        ? telaDePermissoes(variante, estadosPermissoes, apiDoAndroid(), toquesSemEfeito, permissoesDoUsuario)
        : null,
    [estadosPermissoes, permissoesOk, variante, toquesSemEfeito, permissoesDoUsuario],
  );
  const permissoesLidas = estadosPermissoes !== null;

  /** O botão único da tela: pede a próxima que falta ou abre as configurações; relê no fim (o diálogo já respondeu). */
  const tocarBotaoPermissoes = useCallback(async () => {
    const botao = telaPermissoes?.botao;
    if (!botao || pedindoPermissao) return;
    setPedindoPermissao(true);
    try {
      await executarAcaoDePermissao(botao);
      const mudou = await lerEGuardarPermissoes().catch(() => true);
      // o diálogo não apareceu (nada mudou): conta o toque; o "Abrir configurações" já é a saída e não conta
      if (!mudou && botao.acao !== 'abrir-configuracoes') setToquesSemEfeito((n) => n + 1);
    } finally {
      setPedindoPermissao(false);
    }
  }, [telaPermissoes, pedindoPermissao, lerEGuardarPermissoes]);

  const perfil = sessao?.user.perfil ?? null;
  const visao: VisaoShell<ComponenteTela> = useMemo(
    () => shell.montar({ perfil, modulosAtivos }),
    [shell, perfil, modulosAtivos],
  );
  /** Mesmo ambiente com identidade nova quando sinal/sessão mudam: telas que leem `online()` re-renderizam. */
  // `offline` e `sessao` entram só nas dependências, para trocar a identidade (as funções leem por ref)
  const ambienteTela = useMemo<AmbienteAparelho>(() => ({ ...ambiente }), [ambiente, offline, sessao]);

  return {
    ready,
    modo,
    codigoSalvo,
    empresa,
    variante,
    apiUrl,
    defaultApiUrl,
    apiOverride,
    perfilBuild,
    servidorEditavel: editavel,
    sessao,
    perfil,
    me,
    avisoLogin,
    semFilial,
    offline,
    motor,
    ambiente: ambienteTela,
    visao,
    modulosAtivos,
    loginDemo,
    loginComSenha,
    trocarSenha,
    trocarMinhaSenhaNoApp,
    pedirSenha,
    logout,
    setApiUrl,
    testApiUrl,
    setOffline,
    sincronizar,
    sincronizarSeNecessario,
    agendador,
    estadoAgendador,
    falhaSync,
    segundoPlano,
    enviarFila,
    armazenamento,
    preparo,
    erroArmazenamento,
    tentandoAbrir,
    tentarAbrirDeNovo,
    telaPermissoes,
    permissoesLidas,
    pedindoPermissao,
    tocarBotaoPermissoes,
  };
}

export type Plataforma = ReturnType<typeof usePlataformaValor>;

const Ctx = createContext<Plataforma | null>(null);

export function PlataformaProvider({ children }: { children: ReactNode }) {
  const valor = usePlataformaValor();
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function usePlataforma(): Plataforma {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlataforma fora do PlataformaProvider');
  return v;
}
