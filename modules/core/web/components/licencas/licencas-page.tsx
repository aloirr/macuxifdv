'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERFIS, ROTULO_PERFIL, type ModuloId, type Perfil } from '@macuxi/platform-sdk';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CartaoDeModulo, Dialog, ErrorBlock, FilterBar, LoadingBlock, MenuAcoes, modulosContrataveis, nomeDoModulo, Notice, PageHeader, Panel, SelectField, useToast, type IdDoModulo } from '@macuxi/ui/web';
import { LicencasEstadoSchema, NIVEIS_LICENCA, type LicencasEstado, type NivelLicenca } from '../../../contracts';
import { PromotorPedidosPanel } from './promotor-pedidos-panel';
import { csvDeLicencas, efetivosDoUsuario, linhasDoNivel, modulosQueTambemDesligam, ROTULO_NIVEL } from '../../lib/licencas';

const CHAVE = ['core', 'licencas'] as const;

interface Alteracao {
  nivel: NivelLicenca;
  modulo: ModuloId;
  ativo: boolean;
  perfil: Perfil | null;
  usuarioId: string | null;
  tambemDesligam: ModuloId[];
}

function caminhoDaAlteracao(a: Alteracao): string {
  if (a.nivel === 'tenant') return `/core/licencas/tenant/${a.modulo}`;
  if (a.nivel === 'perfil') return `/core/licencas/perfis/${a.perfil}/${a.modulo}`;
  return `/core/licencas/usuarios/${a.usuarioId}/${a.modulo}`;
}

/**
 * Tela "Usuários e módulos" do BKO (RF-CORE-02; RN-CORE-01/02/03). Só admin: o item de menu e a página dependem da
 * ação `modulo.gerir_licencas` e a API revalida. Filtros (nível, perfil, usuário) ficam na URL. Desligar módulo com
 * dependentes mostra o aviso antes de confirmar; o `core` não desliga. testIDs: docs/modulos/core/test-ids.md.
 */
function LicencasConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('modulo.gerir_licencas');
  const toast = useToast();

  const nivelParam = params.get('nivel');
  const nivel: NivelLicenca = (NIVEIS_LICENCA as readonly string[]).includes(nivelParam ?? '') ? (nivelParam as NivelLicenca) : 'tenant';
  const perfilParam = params.get('perfil');
  const perfil: Perfil = (PERFIS as readonly string[]).includes(perfilParam ?? '') ? (perfilParam as Perfil) : 'vendedor';
  const usuarioParam = params.get('usuario');

  const [pendente, setPendente] = useState<Alteracao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const q = useQuery({ queryKey: CHAVE, queryFn: async () => LicencasEstadoSchema.parse(await api<unknown>('/core/licencas')) });
  const estado: LicencasEstado | undefined = q.data;
  const usuarioId = estado?.usuarios.find((u) => u.id === usuarioParam)?.id ?? estado?.usuarios[0]?.id ?? null;

  const aplicar = useMutation({
    mutationFn: async (a: Alteracao) => api(caminhoDaAlteracao(a), { method: 'PUT', body: { ativo: a.ativo } }),
    onSuccess: async (_r, a) => {
      setPendente(null);
      setAviso(null);
      toast('success', `${nomeDoModulo(a.modulo)} ${a.ativo ? 'ativado' : 'desativado'}.`);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      setPendente(null);
      setAviso(errorMessage(e));
    },
  });

  const exportar = () => {
    if (!estado) return;
    downloadBlob(new Blob([csvDeLicencas(estado)], { type: 'text/csv;charset=utf-8' }), 'licencas-de-modulos.csv');
  };

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // nativos (Core, Catálogo, Integração) entram em toda empresa e não aparecem na lista (§P10)
  const contrataveis = new Set<string>(modulosContrataveis().map((m) => m.id));
  const todas = estado ? linhasDoNivel(estado, nivel, { perfil, usuarioId }) : [];
  const linhas = todas.filter((l) => contrataveis.has(l.modulo));
  const efetivos = (estado && nivel === 'usuario' ? efetivosDoUsuario(estado, usuarioId) : []).filter((m) => contrataveis.has(m));

  const pedir = (modulo: ModuloId, ativo: boolean) => {
    if (!estado || !pode) return;
    const ligados = todas.filter((l) => l.ativo).map((l) => l.modulo);
    setAviso(null);
    setPendente({ nivel, modulo, ativo, perfil: nivel === 'perfil' ? perfil : null, usuarioId: nivel === 'usuario' ? usuarioId : null, tambemDesligam: ativo ? [] : modulosQueTambemDesligam(estado, modulo, ligados) });
  };

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="licencas.tela">
      <PageHeader
        title="Usuários e módulos"
        actions={<MenuAcoes acoes={[{ id: 'exportar', rotulo: 'Exportar CSV', desligada: !estado, testId: 'licencas.exportar-csv', aoEscolher: exportar }]} />}
      />

      {!pode && <Notice tone="info">Só o administrador altera licenças. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}

      <div role="tablist" aria-label="Nível da licença" className="flex flex-wrap gap-2">
        {NIVEIS_LICENCA.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === nivel}
            data-testid={`licencas.nivel.${n}`}
            onClick={() => set({ nivel: n === 'tenant' ? null : n })}
            className={`h-[42px] rounded-xl border px-4 text-[14px] font-semibold ${n === nivel ? 'border-ink bg-ink text-white' : 'border-field bg-surface text-ink hover:bg-ground'}`}
          >
            {ROTULO_NIVEL[n]}
          </button>
        ))}
      </div>

      <FilterBar>
        {nivel === 'perfil' && (
          <SelectField label="Perfil" value={perfil} onChange={(e) => set({ perfil: e.target.value })} data-testid="licencas.seletor-perfil">
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERFIL[p]}
              </option>
            ))}
          </SelectField>
        )}
        {nivel === 'usuario' && estado && (
          <SelectField label="Usuário" value={usuarioId ?? ''} onChange={(e) => set({ usuario: e.target.value })} data-testid="licencas.seletor-usuario">
            {estado.usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} — {ROTULO_PERFIL[u.perfil]}
              </option>
            ))}
          </SelectField>
        )}
      </FilterBar>

      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando as licenças…" />}

      {estado && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid={`licencas.lista.${nivel}`}>
          {linhas.map((l) => (
            <CartaoDeModulo
              key={l.modulo}
              id={l.modulo as IdDoModulo}
              ativo={l.ativo}
              aoAlternar={pode ? (ativo) => pedir(l.modulo, ativo) : undefined}
              testId={`licencas.modulo.${nivel}.${l.modulo}`}
            />
          ))}
        </div>
      )}

      {nivel === 'perfil' && perfil === 'promotor' && <PromotorPedidosPanel />}

      {estado && nivel === 'usuario' && (
        <Panel title="Módulos efetivos do usuário">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="licencas.efetivos">
            {efetivos.map((m) => (
              <li key={m} data-testid={`licencas.efetivo.${m}`}>
                <Badge tone="success">{nomeDoModulo(m)}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Dialog
        open={pendente !== null}
        title={pendente?.ativo ? `Ativar ${nomeDoModulo(pendente.modulo)}?` : `Desativar ${pendente ? nomeDoModulo(pendente.modulo) : ''}?`}
        onClose={() => setPendente(null)}
        footer={
          <>
            <Button onClick={() => setPendente(null)} data-testid="licencas.cancelar">
              Cancelar
            </Button>
            <Button variant={pendente?.ativo ? 'primary' : 'danger'} disabled={aplicar.isPending} onClick={() => pendente && aplicar.mutate(pendente)} data-testid="licencas.confirmar">
              {aplicar.isPending ? 'Salvando…' : 'Confirmar'}
            </Button>
          </>
        }
      >
        {pendente && (
          <div className="flex flex-col gap-2">
            {!pendente.ativo && <p className="m-0">O módulo some dos aparelhos.</p>}
            {pendente.tambemDesligam.length > 0 && (
              <Notice tone="warning">
                <span data-testid="licencas.aviso-dependencia">Este módulo também desliga: {pendente.tambemDesligam.map(nomeDoModulo).join(', ')}.</span>
              </Notice>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** `useSearchParams` exige Suspense no Next. */
export function LicencasPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando…" />}>
      <LicencasConteudo />
    </Suspense>
  );
}
