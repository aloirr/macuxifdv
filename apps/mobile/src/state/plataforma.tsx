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
import { MeusModulosRespostaSchema, RefreshRespostaSchema, type FakeUser, type Me } from '@macuxi/core/contracts';
import {
  criarMotorSync,
  ErroHttp,
  mensagemPerfilForaDoApp,
  perfilDaFaseM,
  type AmbienteAparelho,
  type EtapaSync,
  type ModuloId,
  type MotorSync,
  type ParametrosModulos,
  type Perfil,
  type VisaoShell,
} from '@macuxi/platform-sdk';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { criarTratadorAparelhoBloqueado } from '@/lib/aparelho-bloqueado';
import { efetivosSemServidor } from '@/lib/efetivos-locais';
import { shellDaVariante, type ComponenteTela } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { normalizeApiUrl } from '@/lib/api-url';
import { enderecoSalvoValido, erroDaVerificacao, servidorEditavel } from '@/lib/endereco-do-build';
import { rotaDeSaude, type ModoApi } from '@/lib/modo-api';
import { testarServidor } from '@/lib/servidor';
import { criarAmbienteDoAparelho, traduzirErro } from '@/services/ambiente';
import { ApiClient, errorMessage, HttpError } from '@/services/api';
import { armazenamentoDoUsuario } from '@/services/armazenamento';
import { gravarTokens, lerTokens } from '@/services/credenciais';
import { modoApi, perfilBuildAtual, platformDefaultApiUrl, uuid } from '@/services/device';
import { keys, readJson, writeJson } from '@/services/storage';
import { modoSync, transporteFaseM, transporteV1 } from '@/services/transporte';
import { apagarFotosLocais, arquivosLocais } from '@/services/arquivos';

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
/** Fora do desenvolvimento só https (R-20261101-023742-alexandre). */
const EXIGIR_HTTPS = !__DEV__;
const SYNC_AUTOMATICO_MS = 15 * 60_000;

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
        // ADR 0012: `ambiente.consultar` (ex.: preço do Catálogo para o Vendedor, offline) sobre as linhas locais do dono
        consultas: shell.consultas,
      });
      await m.carregar();
      setMe(await m.armazenamentoDoModulo('core').ler<Me>('me'));
      const ativos = m.estado().modulosAtivos;
      // T-0034: sem resposta de /me/modulos guardada, na API real só o Core (nenhuma aba sem licença)
      setModulosAtivos(ativos.length > 0 ? ativos : efetivosSemServidor(modo, s.user.perfil));
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
      // endereço salvo por versão antiga do app: ignorado nos builds de endereço fixo (T-0038)
      const salvo = enderecoSalvoValido(perfilBuild, settings?.apiUrl);
      if (salvo) {
        setApiOverride(salvo);
        apiUrlRef.current = salvo;
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
  }, [abrirMotor, modo, perfilBuild]);

  /** Módulos efetivos a cada sync (licença checada no servidor por requisição — RN-CORE-01/02). */
  const atualizarModulos = useCallback(async () => {
    const m = motorRef.current;
    const s = sessaoRef.current;
    if (!m || !s) return;
    let efetivos: ModuloId[];
    // T-0029 E3: os parâmetros do tenant vêm na mesma resposta e ficam guardados (valem offline; somem com o módulo)
    let parametros: ParametrosModulos | undefined;
    try {
      const r = MeusModulosRespostaSchema.parse((await api().request<unknown>('GET', '/me/modulos')).data);
      efetivos = r.modulos.map((m) => m.id);
      parametros = Object.fromEntries(r.modulos.map((m) => [m.id, m.parametros ?? {}])) as ParametrosModulos;
    } catch (e) {
      // só o mock-api da demonstração não tem /me/modulos; na API real o erro sobe e vale a última resposta guardada
      if (modo !== 'demo' || !(e instanceof HttpError) || e.status !== 404) throw e;
      efetivos = efetivosSemServidor(modo, s.user.perfil);
    }
    await m.aplicarModulosAtivos(efetivos, parametros);
  }, [api, modo]);

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
      // o login vai só para o endereço que acabou de passar no teste (nunca para o que mudar no meio)
      const cliente = new ApiClient(await garantirServidorMacuxi(), null);
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
    [abrirSessao, dispositivoId, garantirServidorMacuxi, variante],
  );

  /** Fecha a sessão em memória (motor, usuário, módulos); quem chama cuida dos tokens e do disco. */
  const fecharSessaoLocal = useCallback(() => {
    desassinarRef.current?.();
    desassinarRef.current = null;
    sessaoRef.current = null;
    motorRef.current = null;
    setSessao(null);
    setMotor(null);
    setMe(null);
    setModulosAtivos(['core']);
  }, []);

  const logout = useCallback(async () => {
    const tokens = await lerTokens();
    if (modo === 'v1' && tokens?.refresh) {
      // revoga a família do refresh no servidor (melhor esforço: sem sinal, o refresh expira sozinho)
      await new ApiClient(apiUrlRef.current, null).request('POST', '/auth/logout', { body: { refresh_token: tokens.refresh }, timeoutMs: 5000 }).catch(() => undefined);
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
