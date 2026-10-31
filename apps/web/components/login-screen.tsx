'use client';

/**
 * Login do BKO (copiado de components/login-screen.tsx da Fase M): ambiente de demonstração contra o
 * mock-api, escolhendo um usuário fictício sem senha. O papel em inglês da Fase M é convertido para o
 * perfil do doc 03 (`perfilDaFaseM`); só aparecem perfis do BKO (Q6: admin, analista, assistente,
 * supervisor, gerente). O login definitivo — código da empresa + e-mail + senha (Q3) — chega com a
 * API de auth da T-0003 e troca só esta tela e `salvarSessao`.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FakeUser, LoginResponse } from '@macuxi/core/contracts';
import { PERFIS_DO_APP, ROTULO_PERFIL, type Perfil } from '@macuxi/platform-sdk';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, IconChevronRight, LoadingBlock } from '@macuxi/ui/web';
import { salvarSessao, usuarioDaFaseM } from '@/lib/session';

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
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-white">M</span>
          <div className="flex flex-col">
            <span className="font-display text-[15px] font-bold">Backoffice Macuxi</span>
            <span className="text-[12px] text-ink-2">Força de vendas · web do BKO</span>
          </div>
        </div>
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
