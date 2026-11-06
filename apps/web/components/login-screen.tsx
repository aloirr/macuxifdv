'use client';

/**
 * Login do BKO (T-0003 F2).
 * - API real (padrão): código da empresa + e-mail + senha (`POST /v1/auth/login` do Core, contrato
 *   `LoginSenhaRequestSchema`/`SessaoRespostaSchema`). Só entram admin, analista, assistente, supervisor e gerente:
 *   promotor e vendedor recebem o aviso do app certo e a sessão recém-criada é encerrada (doc 03). O código da
 *   empresa fica salvo no navegador. Mensagens: `lib/login.ts`. Vindo do aceite do convite (`/convite/<token>`), o e-mail chega
 *   preenchido (uma vez, pelo `sessionStorage`).
 * - Demonstração (`NEXT_PUBLIC_API_MODO=demo`, mock-api da Fase M): escolher um usuário fictício sem senha; o papel
 *   em inglês vira o perfil do doc 03 (`perfilDaFaseM`) e só aparecem perfis do BKO.
 * testIDs do login real: login.tela, login.codigo-empresa, login.email, login.senha, login.entrar, login.erro.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoginSenhaRequestSchema, SessaoRespostaSchema, type FakeUser, type LoginResponse } from '@macuxi/core/contracts';
import { mensagemPerfilForaDoApp, PERFIS_DO_APP, ROTULO_PERFIL, type Perfil } from '@macuxi/platform-sdk';
import { api, errorMessage, MODO_API } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, IconChevronRight, LoadingBlock, Notice } from '@macuxi/ui/web';
import { CHAVE_EMAIL_DO_CONVITE } from '@/lib/convite';
import { CHAVE_CODIGO_EMPRESA, mensagemDoLogin, validarCampos, type CamposLogin } from '@/lib/login';
import { salvarSessao, salvarSessaoReal, usuarioDaFaseM } from '@/lib/session';

const DICA: Partial<Record<Perfil, string>> = {
  gerente: 'Aprova pedidos fora da alçada, acompanha a equipe e fecha o mês.',
  supervisor: 'Acompanha a equipe e aprova pedidos até a própria alçada.',
  analista: 'Edita o plano de RV, as metas e as alçadas de desconto.',
  assistente: 'Trata pedidos e pendências; acompanha os faróis.',
  admin: 'Usuários, módulos, filiais e integração com o ERP.',
};

const ORDEM = PERFIS_DO_APP.web;

/** Só aceita destino interno (evita redirecionar para fora). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : '/';
}

export function LoginScreen() {
  return MODO_API === 'demo' ? <LoginDemo /> : <LoginReal />;
}

function Marca() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-white">M</span>
      <div className="flex flex-col">
        <span className="font-display text-[15px] font-bold">Backoffice Macuxi</span>
        <span className="text-[12px] text-ink-2">Força de vendas · web do BKO</span>
      </div>
    </div>
  );
}

const campoCss = 'h-11 rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/** Login real: código da empresa + e-mail + senha. */
function LoginReal() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [campos, setCampos] = useState<CamposLogin>({ codigo_empresa: '', email: '', senha: '' });
  const [erros, setErros] = useState<Partial<Record<keyof CamposLogin, string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [vindoDoConvite, setVindoDoConvite] = useState(false);
  const refs = useRef<Partial<Record<keyof CamposLogin, HTMLInputElement | null>>>({});
  // vindo do convite, código e e-mail já preenchidos: o foco vai à senha (revisão de UX R-20261106-050553 Y11)
  useEffect(() => {
    if (vindoDoConvite) refs.current.senha?.focus();
  }, [vindoDoConvite]);

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE_CODIGO_EMPRESA);
      if (salvo) setCampos((c) => (c.codigo_empresa ? c : { ...c, codigo_empresa: salvo }));
      // depois do aceite do convite (T-0087 fatia E): o e-mail vem uma vez pela aba e some
      const email = window.sessionStorage.getItem(CHAVE_EMAIL_DO_CONVITE);
      if (email) {
        window.sessionStorage.removeItem(CHAVE_EMAIL_DO_CONVITE);
        setCampos((c) => (c.email ? c : { ...c, email }));
        setVindoDoConvite(true);
      }
    } catch {
      // navegador sem storage
    }
  }, []);

  const mudar = (campo: keyof CamposLogin) => (e: { target: { value: string } }) => setCampos((c) => ({ ...c, [campo]: e.target.value }));

  const entrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (entrando) return;
    const e = validarCampos(campos);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) {
      // foco no primeiro campo com erro (Y10)
      const primeiro = (['codigo_empresa', 'email', 'senha'] as const).find((n) => e[n]);
      if (primeiro) refs.current[primeiro]?.focus();
      return;
    }
    setEntrando(true);
    try {
      const corpo = LoginSenhaRequestSchema.parse({ codigo_empresa: campos.codigo_empresa.trim(), email: campos.email.trim(), senha: campos.senha });
      const sessao = SessaoRespostaSchema.parse(await api<unknown>('/auth/login', { method: 'POST', body: corpo }));
      try {
        window.localStorage.setItem(CHAVE_CODIGO_EMPRESA, sessao.tenant.codigo);
      } catch {
        // navegador sem storage
      }
      const fora = mensagemPerfilForaDoApp(sessao.usuario.perfil, 'web');
      if (fora) {
        // promotor e vendedor não usam o BKO: encerra a sessão que acabou de nascer
        await api('/auth/logout', { method: 'POST', body: { refresh_token: sessao.refresh_token } }).catch(() => undefined);
        setErro(fora);
        setCampos((c) => ({ ...c, senha: '' }));
        return;
      }
      qc.clear();
      salvarSessaoReal(sessao);
      router.replace(safeNext(params.get('next')));
    } catch (x) {
      setErro(mensagemDoLogin(x));
      setCampos((c) => ({ ...c, senha: '' }));
    } finally {
      setEntrando(false);
    }
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

  return (
    <div data-testid="login.tela" className="flex min-h-screen flex-col items-center bg-ground px-4 py-10 sm:py-16">
      <form onSubmit={(e) => void entrar(e)} noValidate className="flex w-full max-w-[400px] flex-col gap-5">
        <Marca />
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold">Entrar</h1>
          <span className="text-[13px] text-ink-2">Use o código da sua empresa, o seu e-mail e a sua senha.</span>
        </div>
        {vindoDoConvite && !erro && (
          <div data-testid="login.senha-criada">
            <Notice tone="success">Senha criada. Digite a senha para entrar.</Notice>
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
        <Button data-testid="login.entrar" type="submit" variant="primary" disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </Button>
        <span className="text-[12px] text-ink-2">Vendedores e promotores usam o app Macuxi Campo no celular.</span>
      </form>
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
                <span className="text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">{ROTULO_PERFIL[u.perfil]}</span>
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
        {doCampo > 0 && <span className="text-[12px] text-ink-2">Os {doCampo} usuários de campo (vendedores e promotores) usam o app Macuxi Campo, não o backoffice.</span>}
      </div>
    </div>
  );
}
