/**
 * Estado de PLATAFORMA do app (substitui o `app-store.tsx` monolítico da Fase M — ADR 0003, desenho
 * T-0001 §13): sessão, servidor, modo sem sinal, módulos efetivos e o motor de sync do platform-sdk.
 *
 * O que era de pedido, visita, rascunho e carteira NÃO mora mais aqui: cada módulo registra entidades
 * e etapas de sync em `modules/<m>/app` (`moduloApp`) e guarda o próprio estado no armazenamento do
 * módulo (`motor.armazenamentoDoModulo`), apagado junto se o módulo for desativado (RN-CORE-02).
 *
 * Telas de módulo acessam isto por `@macuxi/platform-sdk/react` (`useMotorSync`, `usePode`,
 * `useVisaoShell`) — o shell monta o `ShellProvider` em app/_layout.tsx.
 */
import type { FakeUser, Me } from '@macuxi/core/contracts';
import { criarMotorSync, modulosEfetivos, perfilDaFaseM, type EtapaSync, type ModuloId, type MotorSync, type Perfil, type VisaoShell } from '@macuxi/platform-sdk';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { MANIFESTOS_APP, shellDaVariante, type ComponenteTela } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { ApiClient, errorMessage, HttpError, NetworkError } from '@/services/api';
import { armazenamentoDoUsuario } from '@/services/armazenamento';
import { platformDefaultApiUrl } from '@/services/device';
import { keys, readJson, writeJson } from '@/services/storage';
import { modoSync, transporteFaseM, transporteV1 } from '@/services/transporte';

export interface UsuarioSessao extends FakeUser {
  /** Perfil do doc 03 (convertido do papel da Fase M no login). */
  perfil: Perfil | null;
}

export interface Sessao {
  token: string;
  user: UsuarioSessao;
}

const RETENTAR_FILA_MS = 15_000;
const SYNC_AUTOMATICO_MS = 15 * 60_000;

export function usuarioDaFaseM(u: FakeUser): UsuarioSessao {
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

  const api = useCallback(() => new ApiClient(apiUrlRef.current, sessaoRef.current?.token ?? null), []);

  /** Etapa de plataforma: perfil/tenant do usuário (`GET /v1/me`), guardado no armazenamento do core. */
  const etapaMe = useMemo<EtapaSync>(
    () => ({
      id: 'me',
      rotulo: 'Seu perfil',
      modulo: 'core',
      executar: async (ctx) => {
        const dados = await api().me();
        await ctx.armazenamento.gravar('me', dados);
        setMe(dados);
      },
    }),
    [api],
  );

  const abrirMotor = useCallback(
    async (s: Sessao) => {
      const m = criarMotorSync({
        registro: shell.registroSync,
        armazenamento: armazenamentoDoUsuario(s.user.id),
        transporte: modoSync() === 'v1' ? transporteV1(api) : transporteFaseM(api),
        online: () => !offlineRef.current,
        etapas: [etapaMe, ...shell.etapasSync],
        mensagemDeErro: errorMessage,
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
    [shell, api, etapaMe],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [settings, sess, off] = await Promise.all([readJson<{ apiUrl?: string | null }>(keys.settings), readJson<Sessao>(keys.session), readJson<boolean>(keys.offline)]);
      if (!vivo) return;
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
  }, [abrirMotor]);

  /** Módulos efetivos a cada sync (licença checada no servidor por requisição — RN-CORE-01/02). */
  const atualizarModulos = useCallback(async () => {
    const m = motorRef.current;
    const s = sessaoRef.current;
    if (!m || !s) return;
    let efetivos: ModuloId[];
    try {
      efetivos = (await api().request<{ modulos: ModuloId[] }>('GET', '/me/modulos')).data.modulos;
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
  const login = useCallback(
    async (user: FakeUser) => {
      const res = await new ApiClient(apiUrlRef.current, null).login(user.id);
      const s: Sessao = { token: res.access_token, user: usuarioDaFaseM(res.user) };
      sessaoRef.current = s;
      setSessao(s);
      await writeJson(keys.session, s);
      await abrirMotor(s);
    },
    [abrirMotor],
  );

  const logout = useCallback(async () => {
    desassinarRef.current?.();
    desassinarRef.current = null;
    sessaoRef.current = null;
    motorRef.current = null;
    setSessao(null);
    setMotor(null);
    setMe(null);
    setModulosAtivos(['core']);
    await writeJson(keys.session, null);
  }, []);

  const setApiUrl = useCallback(async (url: string | null) => {
    const v = url && url.trim() ? url.trim() : null;
    setApiOverride(v);
    apiUrlRef.current = v || platformDefaultApiUrl();
    await writeJson(keys.settings, { apiUrl: v });
  }, []);

  const testApiUrl = useCallback(async (url: string) => {
    try {
      await new ApiClient(url, null).health();
      return { ok: true, message: 'Servidor respondeu.' };
    } catch (e) {
      return { ok: false, message: e instanceof NetworkError ? e.message : errorMessage(e) };
    }
  }, []);

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

  return {
    ready,
    variante,
    apiUrl,
    defaultApiUrl,
    apiOverride,
    sessao,
    perfil,
    me,
    offline,
    motor,
    visao,
    modulosAtivos,
    login,
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
