'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, Dialog, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { DispositivoItemSchema, type DispositivoItem } from '../../../contracts';
import { csvDeAparelhos, quandoEmPortugues } from '../../lib/aparelhos';

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
  const toast = useToast();
  const [buscaDigitada, setBuscaDigitada] = useState<string | null>(null);
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
      toast('success', d.bloqueado_em ? 'Aparelho liberado.' : 'Aparelho bloqueado.');
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

  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (buscaDigitada === null || buscaDigitada.trim() === q) return;
    const t = setTimeout(() => set({ q: buscaDigitada.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const itens = lista.data ?? [];
  const temFiltro = Boolean(situacao || q);
  const colunas: ColunaDaTabela<DispositivoItem>[] = [
    { id: 'aparelho', titulo: 'Aparelho', largura: '34%', celula: (d) => d.nome ?? d.id.slice(0, 8), texto: (d) => d.nome ?? d.id.slice(0, 8) },
    { id: 'usuario', titulo: 'Usuário', prioridade: 2, celula: (d) => d.usuario_nome, texto: (d) => d.usuario_nome },
    { id: 'acesso', titulo: 'Último acesso', numero: true, prioridade: 2, largura: '150px', celula: (d) => quandoEmPortugues(d.ultimo_acesso_em, FUSO_PADRAO) },
    { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (d) => <SeloSituacao selos={[{ tom: d.bloqueado_em ? 'danger' : 'success', texto: d.bloqueado_em ? 'Bloqueado' : 'Liberado' }]} /> },
  ];
  const acoes = (d: DispositivoItem): AcaoDoMenu[] =>
    pode
      ? [
          {
            id: 'alternar',
            rotulo: d.bloqueado_em ? 'Liberar' : 'Bloquear',
            perigo: !d.bloqueado_em,
            testId: `aparelhos.alternar.${d.id}`,
            aoEscolher: () => {
              setAviso(null);
              setPendente(d);
            },
          },
        ]
      : [];
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="aparelhos.tela">
      <PageHeader
        title={rotuloComContagem('Aparelhos', itens.length)}
        actions={
          <MenuAcoes
            acoes={[
              {
                id: 'exportar',
                rotulo: 'Exportar CSV',
                desligada: itens.length === 0,
                testId: 'aparelhos.exportar-csv',
                aoEscolher: () => downloadBlob(new Blob([csvDeAparelhos(itens, FUSO_PADRAO)], { type: 'text/csv;charset=utf-8' }), 'aparelhos.csv'),
              },
            ]}
          />
        }
      />
      {!pode && <Notice tone="info">Só administrador e analista bloqueiam aparelhos. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <FilterBar>
        <CampoBusca
          rotulo="Buscar usuário ou aparelho"
          value={buscaDigitada ?? q}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value.trim() || null })}
          data-testid="aparelhos.busca"
        />
        <SelectField label="Situação" value={situacao} onChange={(e) => set({ situacao: e.target.value })} data-testid="aparelhos.filtro-situacao">
          <option value="">Todos</option>
          <option value="bloqueado">Bloqueados</option>
          <option value="liberado">Liberados</option>
        </SelectField>
        {temFiltro && (
          <Button
            size="sm"
            onClick={() => {
              setBuscaDigitada(null);
              set({ situacao: null, q: null });
            }}
            data-testid="aparelhos.limpar-filtros"
          >
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os aparelhos…" />}

      {lista.data &&
        (itens.length === 0 ? (
          <EstadoVazio titulo={temFiltro ? 'Nenhum aparelho com esses filtros.' : 'Nenhum aparelho cadastrado.'} testId="aparelhos.vazio" />
        ) : (
          <Panel>
            <TabelaDados rotulo="Aparelhos" colunas={colunas} linhas={itens} chave={(d) => d.id} linhaTestId={(d) => `aparelhos.linha.${d.id}`} acoes={acoes} testId="aparelhos.tabela" />
          </Panel>
        ))}

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
              ? 'Os usuários da empresa voltam a entrar neste aparelho.'
              : 'Nenhum usuário da empresa poderá entrar neste aparelho, e os dados guardados nele são apagados.'}
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
