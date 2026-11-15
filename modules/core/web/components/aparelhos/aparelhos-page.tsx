'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, SelectField, td, th, TableScroll } from '@macuxi/ui/web';
import { DispositivoItemSchema, type DispositivoItem } from '../../../contracts';
import { csvDeAparelhos, quandoEmPortugues } from '../../lib/aparelhos';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

const FUSO_PADRAO = 'America/Manaus';

/**
 * Tela "Aparelhos" do BKO (RN-CORE-15): lista os aparelhos do tenant e bloqueia/desbloqueia (admin e analista, ação
 * `dispositivo.bloquear`; a API revalida e audita). O bloqueio vale para o TENANT inteiro: nenhum usuário entra no aparelho
 * e o app apaga os dados e a fila não enviada na próxima conexão. Filtros ficam na URL. testIDs: docs/modulos/core/test-ids.md.
 */
function AparelhosConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('dispositivo.bloquear');
  const [pendente, setPendente] = useState<DispositivoItem | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const situacao = params.get('situacao') ?? '';
  const q = params.get('q') ?? '';
  const chave = ['core', 'dispositivos', situacao, q] as const;

  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (situacao) qs.set('bloqueado', situacao === 'bloqueado' ? 'true' : 'false');
      if (q) qs.set('q', q);
      const r = await api<{ itens: unknown[] }>(`/core/dispositivos${qs.size ? `?${qs.toString()}` : ''}`);
      return r.itens.map((i) => DispositivoItemSchema.parse(i));
    },
  });

  const alterar = useMutation({
    mutationFn: async (d: DispositivoItem) =>
      api(`/core/dispositivos/${d.id}/bloqueio`, d.bloqueado_em ? { method: 'DELETE' } : { method: 'PUT', body: {} }),
    onSuccess: async (_r, d) => {
      setPendente(null);
      setAviso(d.bloqueado_em ? 'Aparelho liberado. Os usuários já podem entrar nele.' : 'Aparelho bloqueado. Na próxima conexão ele apaga os dados e volta ao login.');
      await qc.invalidateQueries({ queryKey: ['core', 'dispositivos'] });
    },
    onError: (e) => {
      setPendente(null);
      setAviso(errorMessage(e));
    },
  });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const itens = lista.data ?? [];
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="aparelhos.tela">
      <PageHeader
        title="Aparelhos"
        subtitle="Bloqueie um aparelho perdido, roubado ou de quem saiu da empresa. O bloqueio vale para todos os usuários da empresa naquele aparelho."
        actions={
          <Button onClick={() => downloadBlob(new Blob([csvDeAparelhos(itens, FUSO_PADRAO)], { type: 'text/csv;charset=utf-8' }), 'aparelhos.csv')} disabled={itens.length === 0} data-testid="aparelhos.exportar-csv">
            Exportar CSV
          </Button>
        }
      />
      {!pode && <Notice tone="info">Só administrador e analista bloqueiam aparelhos. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <FilterBar>
        <SelectField label="Situação" value={situacao} onChange={(e) => set({ situacao: e.target.value })} data-testid="aparelhos.filtro-situacao">
          <option value="">Todos</option>
          <option value="bloqueado">Bloqueados</option>
          <option value="liberado">Liberados</option>
        </SelectField>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          Buscar por usuário ou aparelho
          <input
            defaultValue={q}
            onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value })}
            onBlur={(e) => set({ q: e.currentTarget.value })}
            data-testid="aparelhos.busca"
            className={CLASSE_CAMPO_BKO}
          />
        </label>
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os aparelhos…" />}

      {lista.data && (
        <Panel title={`${itens.length} aparelho${itens.length === 1 ? '' : 's'}`}>
          <TableScroll minWidth={720}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Aparelho</th>
                  <th className={th}>Usuário</th>
                  <th className={th}>Último acesso</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && (
                  <tr>
                    <td className={td} colSpan={5}>
                      Nenhum aparelho com esses filtros. Limpe a busca ou a situação para ver todos.
                    </td>
                  </tr>
                )}
                {itens.map((d) => (
                  <tr key={d.id} data-testid={`aparelhos.linha.${d.id}`}>
                    <td className={td}>{d.nome ?? d.id.slice(0, 8)}</td>
                    <td className={td}>{d.usuario_nome}</td>
                    <td className={td}>{quandoEmPortugues(d.ultimo_acesso_em, FUSO_PADRAO)}</td>
                    <td className={td}>
                      <Badge tone={d.bloqueado_em ? 'danger' : 'success'}>{d.bloqueado_em ? 'Bloqueado' : 'Liberado'}</Badge>
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={!pode}
                        data-testid={`aparelhos.alternar.${d.id}`}
                        onClick={() => {
                          setAviso(null);
                          setPendente(d);
                        }}
                        className="h-[44px] min-w-[112px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:text-disabled"
                      >
                        {d.bloqueado_em ? 'Liberar' : 'Bloquear'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      <Dialog
        open={pendente !== null}
        title={pendente?.bloqueado_em ? 'Liberar este aparelho?' : 'Bloquear este aparelho?'}
        onClose={() => setPendente(null)}
        footer={
          <>
            <Button onClick={() => setPendente(null)} data-testid="aparelhos.cancelar">
              Cancelar
            </Button>
            <Button variant={pendente?.bloqueado_em ? 'primary' : 'danger'} disabled={alterar.isPending} onClick={() => pendente && alterar.mutate(pendente)} data-testid="aparelhos.confirmar">
              {alterar.isPending ? 'Salvando…' : 'Confirmar'}
            </Button>
          </>
        }
      >
        {pendente && (
          <p className="m-0">
            {pendente.bloqueado_em
              ? 'Os usuários da empresa voltam a poder entrar neste aparelho. Os dados apagados não voltam: o app baixa tudo de novo no primeiro login.'
              : 'Nenhum usuário da empresa poderá entrar neste aparelho. Na próxima conexão ele apaga os dados guardados e o que ainda não foi enviado, e volta ao login. Fica registrado na auditoria.'}
          </p>
        )}
      </Dialog>
    </div>
  );
}

/** `useSearchParams` exige Suspense no Next. */
export function AparelhosPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando…" />}>
      <AparelhosConteudo />
    </Suspense>
  );
}
