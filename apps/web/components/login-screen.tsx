'use client';

/**
 * Login do BKO (T-0003 F2; T-0094).
 * - API real (padrão): código da empresa + e-mail + senha (`POST /v1/auth/login` do Core com `app: 'web'`, contrato
 *   `LoginSenhaRequestSchema`/`SessaoWebRespostaSchema`; T-0117: modo cookie, o refresh fica no cookie httpOnly). RN-CORE-33: a API recusa o perfil que não usa o backoffice (403
 *   `PERFIL_FORA_DO_APP`, sem sessão) e a tela mostra a frase dela; a conferência do SDK (`mensagemPerfilForaDoApp`) fica como reserva
 *   para a API antiga. O código da empresa fica salvo no navegador. Mensagens: `lib/login.ts` e `lib/ciclo-senha.ts`.
 * - T-0094 (spec docs/design/ciclo-de-senha.md §1 a §3): 403 `SENHA_A_TROCAR` abre "Crie sua senha" sem texto (nada abre antes:
 *   a sessão só nasce na resposta da troca); a senha digitada fica só no estado desta tela (nunca em storage, URL ou log) e some
 *   ao voltar ou entrar. Link "Esqueci a senha" abaixo do Entrar. 410 `SENHA_TEMPORARIA_VENCIDA` com o texto do §1. Aviso de volta
 *   (ex.: 403 `PERFIL_SEM_BKO` durante o uso) em `info`, uma vez.
 * - Demonstração (`NEXT_PUBLIC_API_MODO=demo`, mock-api da Fase M): escolher um usuário fictício sem senha; o papel
 *   em inglês vira o perfil do doc 03 (`perfilDaFaseM`) e só aparecem os perfis que entram no BKO pelo motor de permissões do
 *   SDK (`entraEm`; RN-CORE-33: supervisor fora).
 * testIDs do login real: login.tela, login.codigo-empresa, login.email, login.senha, login.entrar, login.erro, login.aviso, login.esqueci.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  detalhesDaTroca,
  EsqueciSenhaRequestSchema,
  LoginSenhaRequestSchema,
  TEXTOS_CRIE_SENHA,
  TEXTOS_LOGIN_SENHA,
  TrocarSenhaRequestSchema,
  validarLogin,
  type CamposLogin,
  type DetalhesSenhaATrocar,
  type FakeUser,
  type LoginResponse,
  type SessaoWebResposta,
} from '@macuxi/core/contracts';
import { entraEm, mensagemPerfilForaDoApp, perfisDeFabricaQueEntram, type Perfil } from '@macuxi/platform-sdk';
import { api, apiFetch, errorMessage, MODO_API } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, IconChevronRight, LoadingBlock, Notice, rotuloDoPerfil, useToast } from '@macuxi/ui/web';
import { CrieSuaSenha, EsqueciSenha } from '@/components/ciclo-senha';
import { MarcaNaFaixa } from '@/components/marca-faixa';
import { CAMINHO_ESQUECI_SENHA, consumirAvisoDoLogin } from '@/lib/ciclo-senha';
import { CHAVE_CODIGO_EMPRESA, mensagemDoLogin } from '@/lib/login';
import { encerrarSessao, pedirLogin, pedirTrocaDeSenha, salvarSessao, salvarSessaoReal, usuarioDaFaseM } from '@/lib/session';

const DICA: Partial<Record<Perfil, string>> = {
  gerente: 'Aprova pedidos fora da alçada, acompanha a equipe e fecha o mês.',
  analista: 'Edita o plano de RV, as metas e as alçadas de desconto.',
  assistente: 'Trata pedidos e pendências; acompanha os faróis.',
  admin: 'Usuários, módulos, filiais e integração com o ERP.',
};

/** Perfis que entram no BKO (motor do SDK), do de linha de frente ao admin. */
const ORDEM = perfisDeFabricaQueEntram('bko');

/** Só aceita destino interno (evita redirecionar para fora). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : '/';
}

export function LoginScreen() {
  return MODO_API === 'demo' ? <LoginDemo /> : <LoginReal />;
}

/** Marca do login do BKO: o logo negativo na faixa Azul noite (T-0172, manual §4). */
function Marca() {
  return <MarcaNaFaixa area="Backoffice" />;
}

const campoCss = 'h-11 rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/** A troca pendente: só na memória desta tela (estado do React). A senha usada no login nunca vai a storage. */
interface TrocaPendente {
  codigo_empresa: string;
  email: string;
  senha: string;
  motivo: DetalhesSenhaATrocar['motivo'];
}

/** Login real: código da empresa + e-mail + senha; "Crie sua senha" e "Esqueci a senha" na mesma moldura. */
function LoginReal() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [campos, setCampos] = useState<CamposLogin>({ codigo_empresa: '', email: '', senha: '' });
  const [erros, setErros] = useState<Partial<Record<keyof CamposLogin, string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [etapa, setEtapa] = useState<'entrar' | 'esqueci'>('entrar');
  const [troca, setTroca] = useState<TrocaPendente | null>(null);
  const refs = useRef<Partial<Record<keyof CamposLogin, HTMLInputElement | null>>>({});

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE_CODIGO_EMPRESA);
      if (salvo) setCampos((c) => (c.codigo_empresa ? c : { ...c, codigo_empresa: salvo }));
    } catch {
      // navegador sem storage
    }
    // motivo de ter voltado ao Entrar (ex.: 403 PERFIL_SEM_BKO durante o uso), uma vez
    const a = consumirAvisoDoLogin();
    if (a) setAviso(a);
  }, []);

  const mudar = (campo: keyof CamposLogin) => (e: { target: { value: string } }) => setCampos((c) => ({ ...c, [campo]: e.target.value }));

  /** Sessão aberta (login ou troca): o código da empresa vai ao navegador; o acesso, pela sessão do SDK; a renovação, no cookie httpOnly. */
  const abrirSessao = (sessao: SessaoWebResposta) => {
    try {
      window.localStorage.setItem(CHAVE_CODIGO_EMPRESA, sessao.tenant.codigo);
    } catch {
      // navegador sem storage
    }
    qc.clear();
    salvarSessaoReal(sessao);
    router.replace(safeNext(params.get('next')));
  };

  const entrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (entrando) return;
    const e = validarLogin(campos);
    setErros(e);
    setErro(null);
    setAviso(null);
    if (Object.keys(e).length > 0) {
      // foco no primeiro campo com erro (Y10)
      const primeiro = (['codigo_empresa', 'email', 'senha'] as const).find((n) => e[n]);
      if (primeiro) refs.current[primeiro]?.focus();
      return;
    }
    setEntrando(true);
    const senha = campos.senha;
    try {
      const corpo = LoginSenhaRequestSchema.parse({ codigo_empresa: campos.codigo_empresa.trim(), email: campos.email.trim(), senha, app: 'web' });
      const sessao = await pedirLogin(corpo);
      if (!entraEm('bko', sessao.usuario.perfil)) {
        const fora = mensagemPerfilForaDoApp(sessao.usuario.perfil, 'web') ?? TEXTOS_LOGIN_SENHA.semBko;
        // reserva para a API sem a conferência do `app`: encerra a sessão que acabou de nascer (revoga e apaga o cookie)
        await encerrarSessao();
        setErro(fora);
        setCampos((c) => ({ ...c, senha: '' }));
        return;
      }
      setCampos((c) => ({ ...c, senha: '' }));
      abrirSessao(sessao);
    } catch (x) {
      setCampos((c) => ({ ...c, senha: '' }));
      const d = detalhesDaTroca(x);
      // senha certa e temporária: vai direto à "Crie sua senha", sem texto
      if (d) setTroca({ codigo_empresa: campos.codigo_empresa.trim(), email: campos.email.trim(), senha, motivo: d.motivo });
      else setErro(mensagemDoLogin(x));
    } finally {
      setEntrando(false);
    }
  };

  const salvarSenhaNova = async (senhaNova: string) => {
    if (!troca) return;
    const corpo = TrocarSenhaRequestSchema.parse({ codigo_empresa: troca.codigo_empresa, email: troca.email, senha_atual: troca.senha, senha_nova: senhaNova, app: 'web' });
    const sessao = await pedirTrocaDeSenha(corpo);
    setTroca(null);
    toast('success', TEXTOS_CRIE_SENHA.criada);
    abrirSessao(sessao);
  };

  const voltarDaTroca = (mensagem?: string) => {
    // a senha usada some da memória; o código da empresa e o e-mail continuam no login
    setTroca(null);
    setErro(mensagem ?? null);
  };

  const pedirSenhaTemporaria = async (c: { codigo_empresa: string; email: string }) => {
    const corpo = EsqueciSenhaRequestSchema.safeParse(c);
    // formato fora do contrato: nada vai à API e a tela mostra a mesma confirmação (a resposta nunca revela cadastro)
    if (!corpo.success) return;
    await apiFetch(CAMINHO_ESQUECI_SENHA, { method: 'POST', body: corpo.data });
  };

  const campo = (nome: keyof CamposLogin, rotulo: string, props: { type: string; autoComplete: string }) => (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input
        data-testid={`login.${nome === 'codigo_empresa' ? 'codigo-empresa' : nome}`}
        name={nome}
        ref={(el) => {
          refs.current[nome] = el;
        }}
        value={campos[nome]}
        onChange={mudar(nome)}
        aria-invalid={erros[nome] ? true : undefined}
        aria-describedby={erros[nome] ? `login-erro-${nome}` : undefined}
        className={campoCss}
        {...props}
      />
      {erros[nome] && (
        <span id={`login-erro-${nome}`} className="text-[12px] text-danger">
          {erros[nome]}
        </span>
      )}
    </label>
  );

  if (troca) {
    return (
      <Moldura>
        <CrieSuaSenha codigoEmpresa={troca.codigo_empresa} email={troca.email} motivo={troca.motivo} onSalvar={salvarSenhaNova} onVoltarAoLogin={voltarDaTroca} />
      </Moldura>
    );
  }

  if (etapa === 'esqueci') {
    return (
      <Moldura>
        <EsqueciSenha
          codigoEmpresa={campos.codigo_empresa}
          email={campos.email}
          onPedir={pedirSenhaTemporaria}
          onVoltarAoLogin={(c) => {
            setCampos((x) => ({ ...x, ...c, senha: '' }));
            setErro(null);
            setEtapa('entrar');
          }}
        />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <form data-testid="login.tela" onSubmit={(e) => void entrar(e)} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold">Entrar</h1>
          <span className="text-[13px] text-ink-2">Use o código da sua empresa, o seu e-mail e a sua senha.</span>
        </div>
        {aviso && !erro && (
          <div data-testid="login.aviso">
            <Notice tone="info">{aviso}</Notice>
          </div>
        )}
        {erro && (
          <div data-testid="login.erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
        {campo('codigo_empresa', 'Código da empresa', { type: 'text', autoComplete: 'organization' })}
        {campo('email', 'E-mail', { type: 'email', autoComplete: 'username' })}
        {campo('senha', 'Senha', { type: 'password', autoComplete: 'current-password' })}
        <div className="flex flex-col gap-1">
          <Button data-testid="login.entrar" type="submit" variant="primary" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </Button>
          <Button
            data-testid="login.esqueci"
            variant="link"
            className="min-h-[44px] self-start text-[14px]"
            onClick={() => {
              setErro(null);
              setAviso(null);
              setCampos((c) => ({ ...c, senha: '' }));
              setEtapa('esqueci');
            }}
          >
            {TEXTOS_LOGIN_SENHA.esqueci}
          </Button>
        </div>
        <span className="text-[12px] text-ink-2">Vendedores e promotores usam o app Macuxi Campo; supervisores, o Macuxi Gestão.</span>
      </form>
    </Moldura>
  );
}

/** Moldura do login (marca + coluna estreita), igual nas três etapas. */
function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-ground px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <Marca />
        {children}
      </div>
    </div>
  );
}

/** Demonstração (mock-api da Fase M): escolher um usuário fictício, sem senha. */
function LoginDemo() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['auth-users'], queryFn: () => api<{ items: FakeUser[] }>('/auth/users').then((r) => r.items) });
  const login = useMutation({
    mutationFn: (userId: string) => api<LoginResponse>('/auth/login', { method: 'POST', body: { user_id: userId } }),
    onSuccess: (res) => {
      qc.clear();
      salvarSessao(res.access_token, res.user);
      router.replace(safeNext(params.get('next')));
    },
  });

  const todos = (users.data ?? []).map(usuarioDaFaseM);
  const bko = todos
    .filter((u): u is typeof u & { perfil: Perfil } => !!u.perfil && ORDEM.includes(u.perfil))
    .sort((a, b) => ORDEM.indexOf(a.perfil) - ORDEM.indexOf(b.perfil));
  const doCampo = todos.length - bko.length;

  return (
    <div className="flex min-h-screen flex-col items-center bg-ground px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-[1060px] flex-col gap-6">
        <Marca />
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold">Escolha um perfil para entrar</h1>
          <span className="text-[13px] text-ink-2">Ambiente de demonstração: sem senha e com dados fictícios. Cada perfil vê o que pode fazer.</span>
        </div>

        {users.isPending && <LoadingBlock label="Buscando perfis…" />}
        {users.isError && <ErrorBlock message={errorMessage(users.error)} onRetry={() => void users.refetch()} />}
        {login.isError && <ErrorBlock message={errorMessage(login.error)} />}

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {bko.map((u) => {
            const busy = login.isPending && pickedId === u.id;
            return (
              <button
                key={u.id}
                type="button"
                data-testid={`login-${u.perfil}-${u.id}`}
                disabled={login.isPending}
                onClick={() => {
                  setPickedId(u.id);
                  login.mutate(u.id);
                }}
                className="group flex min-h-[132px] flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70"
              >
                <span className="text-[11px] font-semibold tracking-[0.06em] text-accent-ink uppercase">{rotuloDoPerfil(u.perfil)}</span>
                <span className="flex items-center justify-between gap-2 font-display text-[18px] font-bold">
                  {u.name}
                  <IconChevronRight size={18} className="text-ink-2 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-[13px] text-ink-2">{DICA[u.perfil]}</span>
                <span className="mt-auto text-[12px] text-ink-2">{busy ? 'Entrando…' : u.email}</span>
              </button>
            );
          })}
        </div>
        {doCampo > 0 && <span className="text-[12px] text-ink-2">Os {doCampo} usuários de campo e de supervisão usam os apps Macuxi Campo e Macuxi Gestão, não o backoffice.</span>}
      </div>
    </div>
  );
}
