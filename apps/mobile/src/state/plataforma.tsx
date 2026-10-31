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
import { entrarComSenha, type CamposLogin } from '@macuxi/core/app';
import { MeusModulosRespostaSchema, RefreshRespostaSchema, type FakeUser, type Me } from '@macuxi/core/contracts';
import {
  criarMotorSync,
  ErroHttp,
  mensagemPerfilForaDoApp,
  modulosEfetivos,
  perfilDaFaseM,
  type AmbienteAparelho,
  type EtapaSync,
  type ModuloId,
  type MotorSync,
  type Perfil,
  type VisaoShell,
} from '@macuxi/platform-sdk';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Device from 'expo-device';
import { AppState } from 'react-native';

import { MANIFESTOS_APP, shellDaVariante, type ComponenteTela } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { rotaDeSaude, type ModoApi } from '@/lib/modo-api';
import { criarAmbienteDoAparelho, traduzirErro } from '@/services/ambiente';
import { ApiClient, errorMessage, HttpError, NetworkError } from '@/services/api';
import { armazenamentoDoUsuario } from '@/services/armazenamento';
import { gravarTokens, lerTokens } from '@/services/credenciais';
import { modoApi, platformDefaultApiUrl, uuid } from '@/services/device';
import { keys, readJson, writeJson } from '@/services/storage';
import { modoSync, transporteFaseM, transporteV1 } from '@/services/transporte';
import { arquivosLocais } from '@/services/arquivos';

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
/** UUID do aparelho (gerado aqui, uma vez): bloqueio remoto de aparelho (RF-CORE-01). */
const CHAVE_DISPOSITIVO = 'fv:dispositivo';

const RETENTAR_FILA_MS = 15_000;
const SYNC_AUTOMATICO_MS = 15 * 60_000;

export function usuarioDaFaseM(u: FakeUser): UsuarioSessao & FakeUser {
  return { ...u, perfil: perfilDaFaseM(u.role) };
}

/** Efetivos sem `GET /v1/me/modulos` (mock-api): todos os instalados ativos no tenant + padrão do perfil. */
function efetivosLocais(perfil: Perfil | null): ModuloId[] {
  if (!perfil) return ['core'];
  return modulosEfetivos({
    manifestos: MANIFESTOS_APP,
    ativosNoTenant: MANIFESTOS_APP.map((m) => m.id),
    doPerfil: MANIFESTOS_APP.filter((m) => m.perfis.includes(perfil)).map((m) => m.id),
  });
}

function usePlataformaValor() {
  const modo = useMemo(() => modoApi(), []);
  const variante = useMemo(() => varianteAtual(), []);
  const shell = useMemo(() => shellDaVariante(variante), [variante]);
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

  const api = useCallback(
    () => new ApiClient(apiUrlRef.current, sessaoRef.current?.token ?? null, modo === 'v1' ? () => renovarRef.current?.() ?? Promise.resolve(null) : undefined),
    [modo],
  );

  /** Ambiente do aparelho para módulos: um só por instância do app (lê sessão, servidor e sinal por ref). */
  const ambiente = useMemo<AmbienteAparelho>(
    () =>
      criarAmbienteDoAparelho({
        api,
        online: () => !offlineRef.current && sessaoRef.current !== null,
        usuario: () => {
          const u = sessaoRef.current?.user;
          return u ? { id: u.id, nome: u.name, perfil: u.perfil } : null;
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
    async (s: Sessao) => {
      const m = criarMotorSync({
        registro: shell.registroSync,
        armazenamento: armazenamentoDoUsuario(s.user.id),
        transporte: modoSync(modo) === 'v1' ? transporteV1(api) : transporteFaseM(api),
        online: () => !offlineRef.current,
        ambiente,
        // `GET /v1/me` é do mock-api; na API real o perfil e o tenant vêm do login
        etapas: modo === 'demo' ? [etapaMe, ...shell.etapasSync] : shell.etapasSync,
        mensagemDeErro: errorMessage,
        // ADR 0010 §4: bytes das fotos da fila de arquivos (o transporte v1 faz o PUT /v1/arquivos/:id)
        arquivos: arquivosLocais(),
      });
      await m.carregar();
      setMe(await m.armazenamentoDoModulo('core').ler<Me>('me'));
      const ativos = m.estado().modulosAtivos;
      setModulosAtivos(ativos.length > 0 ? ativos : efetivosLocais(s.user.perfil));
      desassinarRef.current?.();
      desassinarRef.current = m.assinar((e) => setModulosAtivos(e.modulosAtivos.length > 0 ? e.modulosAtivos : ['core']));
      motorRef.current = m;
      setMotor(m);
    },
    [shell, api, ambiente, etapaMe, modo],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [settings, guardada, off, tokens, codigo] = await Promise.all([
        readJson<{ apiUrl?: string | null }>(keys.settings),
        readJson<SessaoGuardada>(keys.session),
        readJson<boolean>(keys.offline),
        lerTokens(),
        readJson<string>(CHAVE_CODIGO_EMPRESA),
      ]);
      if (!vivo) return;
      setCodigoSalvo(codigo);
      // sessão de outro modo (build demo x real) não vale; a sessão antiga da demo trazia o token junto
      const token = tokens?.access ?? (modo === 'demo' ? guardada?.token : undefined);
      const sess: Sessao | null = guardada && token && (guardada.modo ?? 'demo') === modo ? { ...guardada, token, modo } : null;
      if (settings?.apiUrl) {
        setApiOverride(settings.apiUrl);
        apiUrlRef.current = settings.apiUrl;
      }
      offlineRef.current = Boolean(off);
      setOfflineState(Boolean(off));
      if (sess) {
        sessaoRef.current = sess;
        setSessao(sess);
        await abrirMotor(sess);
      }
      if (vivo) setReady(true);
    })();
    return () => {
      vivo = false;
    };
  }, [abrirMotor, modo]);

  /** Módulos efetivos a cada sync (licença checada no servidor por requisição — RN-CORE-01/02). */
  const atualizarModulos = useCallback(async () => {
    const m = motorRef.current;
    const s = sessaoRef.current;
    if (!m || !s) return;
    let efetivos: ModuloId[];
    try {
      const r = MeusModulosRespostaSchema.parse((await api().request<unknown>('GET', '/me/modulos')).data);
      efetivos = r.modulos.map((m) => m.id);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
      efetivos = efetivosLocais(s.user.perfil);
    }
    await m.aplicarModulosAtivos(efetivos);
  }, [api]);

  const sincronizar = useCallback(async (): Promise<boolean> => {
    const m = motorRef.current;
    if (!m || offlineRef.current) return m ? m.sincronizar() : false;
    try {
      await atualizarModulos();
    } catch {
      // sem rede: o motor registra o erro na sincronização abaixo
    }
    return m.sincronizar();
  }, [atualizarModulos]);

  const enviarFila = useCallback((opcoes: { incluirFalhos?: boolean } = {}) => motorRef.current?.enviar(opcoes) ?? Promise.resolve([]), []);

  // ---------- sessão ----------
  const abrirSessao = useCallback(
    async (s: Sessao, refresh: string | null) => {
      await gravarTokens({ access: s.token, refresh });
      const { token: _token, ...semToken } = s;
      await writeJson(keys.session, semToken);
      sessaoRef.current = s;
      setSessao(s);
      await abrirMotor(s);
    },
    [abrirMotor],
  );

  /** Demonstração (mock-api): entra como um usuário fictício, sem senha. */
  const loginDemo = useCallback(
    async (user: FakeUser) => {
      const res = await new ApiClient(apiUrlRef.current, null).login(user.id);
      await abrirSessao({ token: res.access_token, user: usuarioDaFaseM(res.user), modo: 'demo' }, null);
    },
    [abrirSessao],
  );

  const dispositivoId = useCallback(async () => {
    let id = await readJson<string>(CHAVE_DISPOSITIVO);
    if (!id) {
      id = uuid();
      await writeJson(CHAVE_DISPOSITIVO, id);
    }
    return id;
  }, []);

  /**
   * Login real (RF-CORE-01). Erros saem no contrato do SDK (`ErroHttp`/`ErroSemConexao`) para a `TelaLogin` do Core
   * mostrar a mensagem certa. Perfil de outro app: encerra a sessão recém-criada e lança `PERFIL_FORA_DO_APP`.
   */
  const loginComSenha = useCallback(
    async (campos: CamposLogin) => {
      const cliente = new ApiClient(apiUrlRef.current, null);
      const post = async (caminho: string, corpo: unknown) => {
        try {
          return (await cliente.request<unknown>('POST', caminho, { body: corpo })).data;
        } catch (e) {
          throw traduzirErro(e);
        }
      };
      const nome = (Device.modelName ?? Device.deviceName ?? '').slice(0, 80);
      const r = await entrarComSenha(post, campos, { id: await dispositivoId(), ...(nome ? { nome } : {}) });
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
    [abrirSessao, dispositivoId, variante],
  );

  const logout = useCallback(async () => {
    const tokens = await lerTokens();
    if (modo === 'v1' && tokens?.refresh) {
      // revoga a família do refresh no servidor (melhor esforço: sem sinal, o refresh expira sozinho)
      await new ApiClient(apiUrlRef.current, null).request('POST', '/auth/logout', { body: { refresh_token: tokens.refresh }, timeoutMs: 5000 }).catch(() => undefined);
    }
    await gravarTokens(null);
    desassinarRef.current?.();
    desassinarRef.current = null;
    sessaoRef.current = null;
    motorRef.current = null;
    setSessao(null);
    setMotor(null);
    setMe(null);
    setModulosAtivos(['core']);
    await writeJson(keys.session, null);
  }, [modo]);

  /** 401 na API real: troca o refresh por um par novo (uma troca por vez). Refresh recusado = sessão encerrada. */
  const renovando = useRef<Promise<string | null> | null>(null);
  renovarRef.current = () => {
    renovando.current ??= (async () => {
      try {
        const t = await lerTokens();
        if (!t?.refresh || !sessaoRef.current) return null;
        const dispositivo_id = await dispositivoId();
        const r = RefreshRespostaSchema.parse(
          (await new ApiClient(apiUrlRef.current, null).request<unknown>('POST', '/auth/refresh', { body: { refresh_token: t.refresh, dispositivo_id } })).data,
        );
        await gravarTokens({ access: r.access_token, refresh: r.refresh_token });
        const atual = sessaoRef.current;
        if (atual) {
          const nova = { ...atual, token: r.access_token };
          sessaoRef.current = nova;
          setSessao(nova);
        }
        return r.access_token;
      } catch (e) {
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
    const v = url && url.trim() ? url.trim() : null;
    setApiOverride(v);
    apiUrlRef.current = v || platformDefaultApiUrl();
    await writeJson(keys.settings, { apiUrl: v });
  }, []);

  const testApiUrl = useCallback(async (url: string) => {
    try {
      await new ApiClient(url, null).health(rotaDeSaude(modo));
      return { ok: true, message: 'Servidor respondeu.' };
    } catch (e) {
      return { ok: false, message: e instanceof NetworkError ? e.message : errorMessage(e) };
    }
  }, [modo]);

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

  // ---------- segundo plano: fila a cada 15 s; sync completo a cada 15 min e ao voltar ao app ----------
  useEffect(() => {
    if (!motor) return;
    const retry = setInterval(() => {
      if (!offlineRef.current && motor.estado().fila.some((i) => i.situacao === 'pendente')) void motor.enviar();
    }, RETENTAR_FILA_MS);
    const auto = setInterval(() => {
      if (!offlineRef.current && AppState.currentState === 'active') void sincronizar();
    }, SYNC_AUTOMATICO_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' || offlineRef.current) return;
      void motor.enviar();
      const ultimo = motor.estado().sincronizado_em;
      if (!ultimo || Date.now() - Date.parse(ultimo) > SYNC_AUTOMATICO_MS) void sincronizar();
    });
    return () => {
      clearInterval(retry);
      clearInterval(auto);
      sub.remove();
    };
  }, [motor, sincronizar]);

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
    sessao,
    perfil,
    me,
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
