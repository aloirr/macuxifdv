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
 */
import { ehAparelhoBloqueado, entrarComSenha, tratarAparelhoBloqueado, type CamposLogin } from '@macuxi/core/app';
import type { FakeUser, Me } from '@macuxi/core/contracts';
import {
  ErroHttp,
  mensagemPerfilForaDoApp,
  perfilDaFaseM,
  type AmbienteAparelho,
  type EtapaSync,
  type ModuloId,
  type MotorSync,
  type Perfil,
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { criarTratadorAparelhoBloqueado } from '@/lib/aparelho-bloqueado';
import { limparHistoricoDoShell } from '@/lib/transicao-modulo';
import { deveSincronizar, type MotivoSync } from '@/lib/carga';
import { proximaEsperaFila } from '@/lib/fila-reenvio';
import { observarFalhasDeSync, type FalhaSync } from '@/lib/diagnostico-sync';
import { efetivosSemServidor } from '@/lib/efetivos-locais';
import { shellDaVariante, type ComponenteTela } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { normalizeApiUrl } from '@/lib/api-url';
import { enderecoSalvoValido, erroDaVerificacao, servidorEditavel } from '@/lib/endereco-do-build';
import { rotaDeSaude, type ModoApi } from '@/lib/modo-api';
import { CHAVE_LEASE, DONO_APP, leaseOcupado, type LeaseSync, type ResultadoSegundoPlano } from '@/lib/segundo-plano';
import { testarServidor } from '@/lib/servidor';
import { criarAmbienteDoAparelho, traduzirErro } from '@/services/ambiente';
import { ApiClient, HttpError, NetworkError } from '@/services/api';
import { armazenamentoDoUsuario } from '@/services/armazenamento';
import { gravarSaidasPendentes, gravarTokens, lerSaidasPendentes, lerTokens } from '@/services/credenciais';
import { modoApi, perfilBuildAtual, platformDefaultApiUrl } from '@/services/device';
import { consultarModulosEfetivos, criarMotorDoUsuario, dispositivoId, trocarRefresh } from '@/services/motor-do-usuario';
import {
  desligarSyncEmSegundoPlano,
  ligarSyncEmSegundoPlano,
  lerUltimoSegundoPlano,
  passadaEmSegundoPlano,
  registrarAppAberto,
} from '@/services/segundo-plano';
import { keys, readJson, writeJson } from '@/services/storage';
import { apagarFotosLocais } from '@/services/arquivos';
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
    if (e instanceof HttpError) return e.status >= 500 || e.status === 408 || e.status === 429 ? 'sem_sinal' : 'recusado';
    return 'sem_sinal';
  }
}

/** Reenvia o `/auth/logout` das saídas feitas sem sinal (o servidor revoga a sessão e limpa o push do aparelho). */
async function reenviarSaidasPendentes(url: string): Promise<void> {
  const fila = filaDeSaidas(await lerSaidasPendentes(), Date.now());
  if (!fila.length) return;
  const restam = await reenviarSaidas(fila, (x) =>
    resultadoDe(new ApiClient(url, null).request('POST', '/auth/logout', { body: { refresh_token: x.refresh }, timeoutMs: 5000 })),
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
  /** T-0038: preview/producao usam sempre o endereço do build (sem campo Servidor); só o desenvolvimento edita. */
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
  const renovarRef = useRef<(() => Promise<string | null>) | null>(null);
  /** RN-CORE-15: aviso de aparelho bloqueado (dados apagados) que fica visível na tela de login. */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);
  const aparelhoBloqueadoRef = useRef<((erro: unknown) => Promise<boolean>) | null>(null);
  /** T-0059: sincronização do shell em curso (inclui a consulta dos módulos antes do motor) e quando começou. */
  const syncEmCursoRef = useRef<Promise<boolean> | null>(null);
  const ultimoInicioRef = useRef<number | null>(null);
  /** Abriu o app com sessão e carga gravada: vai direto ao Início e sincroniza em segundo plano (R-20261102-091336). */
  const sincronizarAoAbrirRef = useRef(false);
  const [falhaSync, setFalhaSync] = useState<FalhaSync | null>(null);
  /** ADR 0017: última execução da tarefa em segundo plano (Diagnóstico do Perfil). */
  const [segundoPlano, setSegundoPlano] = useState<ResultadoSegundoPlano | null>(null);
  /** RN-CORE-23: agendador único do app (abrir, voltar depois de 30 min, `sync_auto_min`, push, puxar/botão). */
  const [agendador, setAgendador] = useState<AgendadorSync | null>(null);
  const [estadoAgendador, setEstadoAgendador] = useState<EstadoAgendadorSync>({ puxando: false, recente: false });

  const api = useCallback(
    () =>
      new ApiClient(
        apiUrlRef.current,
        sessaoRef.current?.token ?? null,
        modo === 'v1' ? () => renovarRef.current?.() ?? Promise.resolve(null) : undefined,
        // qualquer chamada (fila, pull, etapas, telas) que receba 423 DISPOSITIVO_BLOQUEADO limpa o aparelho
        (e) => void aparelhoBloqueadoRef.current?.(e).catch(() => undefined),
      ),
    [modo],
  );

  /** Ambiente do aparelho para módulos: um só por instância do app (lê sessão, servidor e sinal por ref). */
  const ambiente = useMemo<AmbienteAparelho>(
    () =>
      criarAmbienteDoAparelho({
        api,
        online: () => !offlineRef.current && sessaoRef.current !== null,
        usuario: () => {
          const s = sessaoRef.current;
          const u = s?.user;
          if (!u) return null;
          // fuso do tenant do login v1 (RN-CORE-11: virada do dia); a demonstração não tem
          return { id: u.id, nome: u.name, perfil: u.perfil, ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}) };
        },
      }),
    [api],
  );

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
    async (s: Sessao, opcoes: { abertura?: boolean } = {}) => {
      const m = criarMotorDoUsuario({
        usuarioId: s.user.id,
        shell,
        modo,
        api,
        online: () => !offlineRef.current,
        ambiente,
        // `GET /v1/me` é do mock-api; na API real o perfil e o tenant vêm do login
        etapasExtras: modo === 'demo' ? [etapaMe] : [],
      });
      await m.carregar();
      setMe(await m.armazenamentoDoModulo('core').ler<Me>('me'));
      const ativos = m.estado().modulosAtivos;
      // T-0034: sem resposta de /me/modulos guardada, na API real só o Core (nenhuma aba sem licença)
      setModulosAtivos(ativos.length > 0 ? ativos : efetivosSemServidor(modo, s.user.perfil));
      desassinarRef.current?.();
      const semModulos = m.assinar((e) => setModulosAtivos(e.modulosAtivos.length > 0 ? e.modulosAtivos : ['core']));
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
    },
    [shell, api, ambiente, etapaMe, modo],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [settings, guardada, off, tokens, codigo, falha, ultimoSegundoPlano] = await Promise.all([
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
      const sess: Sessao | null = guardada && token && (guardada.modo ?? 'demo') === modo ? { ...guardada, token, modo } : null;
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
    })();
    return () => {
      vivo = false;
    };
  }, [abrirMotor, modo, perfilBuild]);

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
   * Sincronização completa. Uma por vez (T-0059): quem chama durante uma em curso recebe a mesma promessa, sem
   * consultar os módulos de novo nem reiniciar a carga. Telas navegam pelo ESTADO do motor, não por esta promessa.
   */
  const executarSync = useCallback((leve: { entidades?: readonly string[] } | null): Promise<boolean> => {
    const m = motorRef.current;
    if (!m) return Promise.resolve(false);
    if (syncEmCursoRef.current) return syncEmCursoRef.current;
    ultimoInicioRef.current = Date.now();
    const p: Promise<boolean> = (async () => {
      // ADR 0017: a tarefa em segundo plano está sincronizando com outro motor (app reaberto durante a tarefa): espera
      // ela terminar e relê o que ela gravou; sem a passada neste processo, o lease vence em 2 min e a próxima segue
      const s = sessaoRef.current;
      if (s) {
        const lease = await armazenamentoDoUsuario(s.user.id).ler<LeaseSync>(CHAVE_LEASE);
        if (leaseOcupado(lease, DONO_APP, Date.now())) {
          const tarefa = passadaEmSegundoPlano();
          if (!tarefa) return false;
          await tarefa.catch(() => undefined);
          if (motorRef.current !== m) return false;
          await m.carregar();
        }
      }
      if (offlineRef.current) return m.sincronizar();
      // leve com o motor novo: a própria chamada de novidades traz os módulos efetivos (1 requisição sem mudança)
      // (T-0065: `motor.sincronizarNovidades` + `transporteV1.novidades`). Demonstração (Fase M, sem novidades): completa
      if (leve && modo === 'v1') return m.sincronizarNovidades(leve.entidades ? { entidades: leve.entidades } : {});
      try {
        await atualizarModulos();
      } catch {
        // sem rede: o motor registra o erro na sincronização abaixo
      }
      return m.sincronizar();
    })().finally(() => {
      if (syncEmCursoRef.current === p) syncEmCursoRef.current = null;
    });
    syncEmCursoRef.current = p;
    return p;
  }, [atualizarModulos, modo]);

  /** Sincronização completa (botão Sincronizar, puxar para baixo, tela de carga): envia a fila e puxa na hora. */
  const sincronizar = useCallback((): Promise<boolean> => executarSync(null), [executarSync]);

  /** Sincroniza só se faz sentido agora (`deveSincronizar`): não reinicia a carga em andamento nem a que acabou de terminar. */
  const sincronizarSeNecessario = useCallback(
    (motivo: MotivoSync): Promise<boolean> | null => {
      const m = motorRef.current;
      if (!m) return null;
      // sem sinal: só a tela de carga tenta (o motor registra o erro e a tela oferece desligar o modo sem sinal)
      if (offlineRef.current && motivo !== 'tela-carga') return null;
      const ok = deveSincronizar(motivo, { estado: m.estado(), emCurso: syncEmCursoRef.current !== null, ultimoInicio: ultimoInicioRef.current, agora: Date.now() });
      return ok ? sincronizar() : syncEmCursoRef.current;
    },
    [sincronizar],
  );

  const enviarFila = useCallback((opcoes: { incluirFalhos?: boolean } = {}) => motorRef.current?.enviar(opcoes) ?? Promise.resolve([]), []);

  // ---------- sessão ----------
  const abrirSessao = useCallback(
    async (s: Sessao, refresh: string | null) => {
      await gravarTokens({ access: s.token, refresh });
      setAvisoLogin(null);
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

  /**
   * Login real (RF-CORE-01). Erros saem no contrato do SDK (`ErroHttp`/`ErroSemConexao`) para a `TelaLogin` do Core
   * mostrar a mensagem certa. Perfil de outro app: encerra a sessão recém-criada e lança `PERFIL_FORA_DO_APP`.
   */
  const loginComSenha = useCallback(
    async (campos: CamposLogin) => {
      // o login vai só para o endereço que acabou de passar no teste (nunca para o que mudar no meio)
      const endereco = await garantirServidorMacuxi();
      const cliente = new ApiClient(endereco, null);
      // o servidor acabou de responder: é a hora de mandar as saídas que ficaram na fila (logout sem sinal)
      void reenviarSaidasPendentes(endereco).catch(() => undefined);
      const post = async (caminho: string, corpo: unknown) => {
        try {
          return (await cliente.request<unknown>('POST', caminho, { body: corpo })).data;
        } catch (e) {
          throw traduzirErro(e);
        }
      };
      const nome = (Device.modelName ?? Device.deviceName ?? '').slice(0, 80);
      let r: Awaited<ReturnType<typeof entrarComSenha>>;
      try {
        r = await entrarComSenha(post, campos, { id: await dispositivoId(), ...(nome ? { nome } : {}) });
      } catch (e) {
        // RN-CORE-15: senha certa num aparelho bloqueado — limpa o aparelho; a tela de login mostra o aviso
        await aparelhoBloqueadoRef.current?.(e);
        throw e;
      }
      const codigo = r.tenant.codigo;
      setCodigoSalvo(codigo);
      await writeJson(CHAVE_CODIGO_EMPRESA, codigo);
      const fora = mensagemPerfilForaDoApp(r.usuario.perfil, variante);
      if (fora) {
        await post('/auth/logout', { refresh_token: r.refresh_token }).catch(() => undefined);
        throw new ErroHttp(403, 'PERFIL_FORA_DO_APP', fora);
      }
      const user: UsuarioSessao = { id: r.usuario.id, name: r.usuario.nome, email: r.usuario.email, perfil: r.usuario.perfil };
      await abrirSessao({ token: r.access_token, user, tenant: r.tenant, modo: 'v1' }, r.refresh_token);
    },
    [abrirSessao, garantirServidorMacuxi, variante],
  );

  /** Fecha a sessão em memória (motor, usuário, módulos); quem chama cuida dos tokens e do disco. */
  const fecharSessaoLocal = useCallback(() => {
    desassinarRef.current?.();
    desassinarRef.current = null;
    syncEmCursoRef.current = null;
    ultimoInicioRef.current = null;
    sincronizarAoAbrirRef.current = false;
    const usuarioId = sessaoRef.current?.user.id;
    if (usuarioId) void esquecerRegistroPush(usuarioId);
    sessaoRef.current = null;
    motorRef.current = null;
    // R-20261104-042956 🟢 3: a 1ª tela do próximo login não anima como "voltar"
    limparHistoricoDoShell();
    // ADR 0017: sem sessão (logout ou aparelho bloqueado), nada roda em segundo plano
    void desligarSyncEmSegundoPlano();
    setSessao(null);
    setMotor(null);
    setMe(null);
    setModulosAtivos(['core']);
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
        apagarPush: () => resultadoDe(new ApiClient(url, tokens.access).request('DELETE', '/dispositivos/atual/push', { query: { dispositivo_id: id }, timeoutMs: 5000 })),
        revogar: () => resultadoDe(new ApiClient(url, null).request('POST', '/auth/logout', { body: { refresh_token: refresh }, timeoutMs: 5000 })),
      });
      if (r === 'pendente') {
        const nova = { refresh, dispositivo_id: id, em: new Date().toISOString() };
        await gravarSaidasPendentes(filaDeSaidas(await lerSaidasPendentes(), Date.now(), nova));
      }
    }
    await gravarTokens(null);
    fecharSessaoLocal();
    await writeJson(keys.session, null);
  }, [modo, fecharSessaoLocal]);

  /**
   * RN-CORE-15: 423 `DISPOSITIVO_BLOQUEADO` no login, no refresh ou em qualquer chamada. O Core decide a ordem
   * (`tratarAparelhoBloqueado`): apaga tudo do aparelho (motor, chaves de todos os usuários, fotos), apaga os tokens,
   * fecha a sessão (sem `/auth/logout`: a API já revogou a família), mostra o aviso no login e volta para lá.
   */
  aparelhoBloqueadoRef.current ??= criarTratadorAparelhoBloqueado(
    {
      motor: () => motorRef.current,
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

  const setApiUrl = useCallback(async (url: string | null) => {
    // endereço fixo (T-0038): não há o que trocar; nada é salvo
    if (!editavel) return;
    const v = url && url.trim() ? url.trim() : null;
    setApiOverride(v);
    apiUrlRef.current = v || platformDefaultApiUrl();
    await writeJson(keys.settings, { apiUrl: v });
  }, [editavel]);

  /** Testa o endereço como digitado (só sem espaços nas pontas): só um servidor Macuxi passa; a mensagem diz o endereço testado. */
  const testApiUrl = useCallback(
    async (url: string) => {
      const endereco = normalizeApiUrl(url);
      const r = await testarServidor(endereco, { rota: rotaDeSaude(modo), exigirHttps: EXIGIR_HTTPS, buscar: (u, init) => fetch(u, init) });
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
      sincronizar: (motivo: MotivoAgendador, entidades?: readonly string[]) =>
        motivo === 'manual' ? executarSync(null) : executarSync(entidades ? { entidades } : {}),
      ultimaSincronizacao: () => {
        const em = m.estado().sincronizado_em;
        const ms = em ? Date.parse(em) : NaN;
        return Number.isFinite(ms) ? ms : null;
      },
      // automática só depois da carga inicial (antes dela, quem sincroniza é a tela de carga), com sessão e sinal
      podeSincronizar: () => !offlineRef.current && sessaoRef.current !== null && motorRef.current === m && m.estado().sincronizado_em !== null,
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
    const pendente = () => m.estado().fila.some((i) => i.situacao === 'pendente') || m.estado().arquivos.some((a) => a.situacao === 'pendente');
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

  // ---------- ADR 0017: sincronização incremental em segundo plano (expo-background-task) ----------
  useEffect(() => {
    if (!motor) return;
    // com o app vivo neste processo, a tarefa usa ESTE motor (mesma promessa de `sincronizar`, nada em paralelo)
    const semApp = registrarAppAberto(
      {
        sincronizadoEm: () => motor.estado().sincronizado_em,
        prepararSessao: async () => 'ok',
        // ADR 0018 item 8: a passada é a atualização leve (novidades), como a automática do app
        sincronizar: () => executarSync({}),
        erro: () => motor.estado().erro,
      },
      setSegundoPlano,
    );
    // a tarefa só é agendada depois da carga inicial (antes dela, a carga roda só com o app aberto)
    let ligada = false;
    const ligar = (sincronizadoEm: string | null) => {
      if (ligada || !sincronizadoEm) return;
      ligada = true;
      void ligarSyncEmSegundoPlano();
    };
    ligar(motor.estado().sincronizado_em);
    const semEstado = motor.assinar((e) => ligar(e.sincronizado_em));
    return () => {
      semApp();
      semEstado();
    };
  }, [motor, executarSync]);

  const perfil = sessao?.user.perfil ?? null;
  const visao: VisaoShell<ComponenteTela> = useMemo(() => shell.montar({ perfil, modulosAtivos }), [shell, perfil, modulosAtivos]);
  /** Mesmo ambiente com identidade nova quando sinal/sessão mudam: telas que leem `online()` re-renderizam. */
  // `offline` e `sessao` entram só nas dependências, para trocar a identidade (as funções leem por ref)
  const ambienteTela = useMemo<AmbienteAparelho>(() => ({ ...ambiente }), [ambiente, offline, sessao]);

  return {
    ready,
    modo,
    codigoSalvo,
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
    offline,
    motor,
    ambiente: ambienteTela,
    visao,
    modulosAtivos,
    loginDemo,
    loginComSenha,
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
