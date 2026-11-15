'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, EtiquetaCadastroIncompleto, FilterBar, LoadingBlock, Notice, PageHeader, Panel, SelectField, td, th, TableScroll } from '@macuxi/ui/web';
import { ClienteListaRespostaSchema, type CarteiraItemPut } from '../../../contracts';
import { csvDaCarteira, DIAS_DA_SEMANA, rotuloFrequencia } from '../../lib/carteira';
import { usePapeisDeCampo, useSellersDeCampo } from '../../lib/queries';
import type { ClienteDaCarteira } from '../../lib/rotas-api';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

type Frequencia = 1 | 2 | 4 | null;

/**
 * Carteira (RF-CORE-02; RN-CORE-04): vínculos cliente × usuário × papel, com a frequência e o dia da visita que alimentam
 * "gerar rotas pela frequência". Escolha o vendedor ou promotor, ajuste ou desvincule; para vincular, busque o cliente.
 * Só analista e admin editam (`carteira.editar`); a API revalida e audita. Filtros na URL.
 */
function CarteiraConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('carteira.editar');
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const equipe = useSellersDeCampo();
  const papeis = usePapeisDeCampo();
  const usuario = params.get('usuario') ?? '';
  const papel: 'vendedor' | 'promotor' = papeis.data?.[usuario] ?? 'vendedor';

  const lista = useQuery({
    queryKey: ['core', 'carteira-do-usuario', usuario],
    queryFn: async () => (await api<{ itens: ClienteDaCarteira[] }>(`/core/usuarios/${usuario}/clientes`)).itens,
    enabled: Boolean(usuario),
  });
  const candidatos = useQuery({
    queryKey: ['core', 'clientes-busca', busca],
    queryFn: async () => ClienteListaRespostaSchema.parse(await api<unknown>('/core/clientes', { query: { q: busca, limite: 8 } })).itens,
    enabled: busca.trim().length >= 3,
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

  const atualizar = async (msg: string) => {
    setAviso(msg);
    await qc.invalidateQueries({ queryKey: ['core', 'carteira-do-usuario', usuario] });
  };
  const vincular = useMutation({
    mutationFn: (c: CarteiraItemPut) => api('/core/carteira', { method: 'PUT', body: c }),
    onSuccess: () => atualizar('Carteira atualizada e registrada na auditoria.'),
    onError: (e) => setAviso(errorMessage(e)),
  });
  const desvincular = useMutation({
    mutationFn: (carteiraId: string) => api(`/core/carteira/${carteiraId}`, { method: 'DELETE' }),
    onSuccess: () => atualizar('Cliente desvinculado e registrado na auditoria.'),
    onError: (e) => setAviso(errorMessage(e)),
  });

  const vinculo = (c: ClienteDaCarteira, freq: Frequencia, dia: number | null): CarteiraItemPut => ({
    cliente_id: c.id,
    usuario_id: usuario,
    papel: c.papel ?? papel,
    frequencia_semanas: freq,
    dia_semana: freq ? (dia ?? 1) : null,
  });

  const itens = lista.data ?? [];
  const nome = equipe.data?.find((s) => s.id === usuario)?.name ?? '';
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="carteira.tela">
      <PageHeader
        title="Carteira"
        subtitle="Clientes de cada vendedor ou promotor, com a frequência e o dia da visita. A frequência gera a rota da semana."
        actions={
          <Button onClick={() => downloadBlob(new Blob([csvDaCarteira(itens, nome)], { type: 'text/csv;charset=utf-8' }), `carteira_${nome.replace(/\s+/g, '_') || 'usuario'}.csv`)} disabled={itens.length === 0} data-testid="carteira.exportar-csv">
            Exportar CSV
          </Button>
        }
      />
      {!pode && <Notice tone="info">Só analista e administrador alteram a carteira. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <FilterBar>
        <SelectField label="Vendedor ou promotor" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="carteira.filtro-usuario">
          <option value="">Escolha um usuário</option>
          {(equipe.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {!usuario && <Notice tone="info">Escolha um vendedor ou promotor para ver os clientes dele.</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && usuario && <LoadingBlock label="Carregando a carteira…" />}

      {usuario && lista.data && (
        <>
          <Panel title="Vincular cliente">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Buscar cliente por nome, CNPJ ou cidade (mínimo 3 letras)
              <input value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="carteira.busca" disabled={!pode} className={CLASSE_CAMPO_BKO} />
            </label>
            {candidatos.data && candidatos.data.length === 0 && <p className="mt-2 text-[13px] text-ink-2">Nenhum cliente encontrado.</p>}
            <ul className="mt-2 flex flex-col gap-2">
              {(candidatos.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="min-w-[240px] font-semibold">{c.nome_fantasia || c.razao_social}</span>
                  <span className="text-ink-2">{c.cidade ?? ''}</span>
                  <Button
                    variant="primary"
                    disabled={!pode || vincular.isPending || itens.some((i) => i.id === c.id)}
                    onClick={() => {
                      vincular.mutate({ cliente_id: c.id, usuario_id: usuario, papel });
                      setBusca('');
                    }}
                    data-testid={`carteira.vincular.${c.id}`}
                  >
                    {itens.some((i) => i.id === c.id) ? 'Já na carteira' : 'Vincular'}
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={`${itens.length} cliente${itens.length === 1 ? '' : 's'} vigente${itens.length === 1 ? '' : 's'}`}>
            <TableScroll minWidth={880}>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Cliente</th>
                    <th className={th}>Cidade</th>
                    <th className={th}>Frequência</th>
                    <th className={th}>Dia da visita</th>
                    <th className={th}>Situação</th>
                    <th className={th}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 && (
                    <tr>
                      <td className={td} colSpan={6}>
                        Esta carteira está vazia. Busque um cliente acima para vincular.
                      </td>
                    </tr>
                  )}
                  {itens.map((c) => (
                    <tr key={c.id} data-testid={`carteira.linha.${c.id}`}>
                      <td className={td}>
                        <Link href={`/cliente?id=${c.id}`} className="font-semibold text-accent-ink no-underline hover:underline">
                          {c.nome}
                        </Link>
                      </td>
                      <td className={td}>{c.cidade ?? ''}</td>
                      <td className={td}>
                        <select
                          value={c.frequencia_semanas ?? ''}
                          disabled={!pode}
                          aria-label={`Frequência de ${c.nome}`}
                          data-testid={`carteira.frequencia.${c.id}`}
                          onChange={(e) => vincular.mutate(vinculo(c, e.target.value ? (Number(e.target.value) as Frequencia) : null, c.dia_semana))}
                          className="h-[44px] rounded-xl border border-field bg-surface px-2 text-[13px]"
                        >
                          <option value="">Sem frequência</option>
                          {([1, 2, 4] as const).map((f) => (
                            <option key={f} value={f}>
                              {rotuloFrequencia(f)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        <select
                          value={c.dia_semana ?? ''}
                          disabled={!pode || !c.frequencia_semanas}
                          aria-label={`Dia da visita de ${c.nome}`}
                          data-testid={`carteira.dia.${c.id}`}
                          onChange={(e) => vincular.mutate(vinculo(c, (c.frequencia_semanas as Frequencia) ?? null, Number(e.target.value)))}
                          className="h-[44px] rounded-xl border border-field bg-surface px-2 text-[13px]"
                        >
                          <option value="">—</option>
                          {DIAS_DA_SEMANA.map((d) => (
                            <option key={d.valor} value={d.valor}>
                              {d.rotulo}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td} data-testid={`carteira.situacao.${c.id}`}>
                        {c.cadastro_incompleto ? <EtiquetaCadastroIncompleto /> : c.lat === null ? <Badge tone="warning">Sem coordenada</Badge> : null}
                      </td>
                      <td className={td}>
                        <Button disabled={!pode || !c.carteira_id || desvincular.isPending} onClick={() => c.carteira_id && desvincular.mutate(c.carteira_id)} data-testid={`carteira.desvincular.${c.id}`}>
                          Desvincular
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        </>
      )}
    </div>
  );
}

export function CarteiraPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando a carteira…" />}>
      <CarteiraConteudo />
    </Suspense>
  );
}
