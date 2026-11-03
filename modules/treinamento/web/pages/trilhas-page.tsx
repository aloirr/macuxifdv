'use client';

import { formatPct } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Bar, Button, cx, Dialog, ErrorBlock, FilterBar, formatDateTime, IconDownload, IconPlus, KpiCard, KpiGrid, LoadingBlock, monthLabel, Notice, PageHeader, Panel, SelectField, TableScroll, td, tdNum, th, thNum, type BadgeTone } from '@macuxi/ui/web';
import Link from 'next/link';
import { useState } from 'react';
import type { BkoTrilhaResumo } from '../../contracts';
import { pessoasParaCsv, ROTULO_PERFIL, ROTULO_STATUS, trilhasParaCsv } from '../lib/csv';
import { abaVisivel, type Aba } from '../lib/filtros-url';
import { useAdesao, useFusoDoBko, useMudarStatus, usePessoas, useTrilhasBko } from '../lib/queries';
import { hrefEditarTrilha } from '../lib/rotas';
import { useFiltrosNaUrl } from '../lib/use-filtros';

const ROTULO_ABA: Record<Aba, string> = { adesao: 'Adesão', pessoas: 'Pessoas', trilhas: 'Trilhas' };
const TOM_STATUS: Record<string, BadgeTone> = { rascunho: 'neutral', publicada: 'success', arquivada: 'warning' };
const pctOuTraco = (n: number | null) => (n === null ? '—' : formatPct(n, 0));

/**
 * Trilhas do Treinamento no BKO: painel de adesão (RF-TRE-05; supervisor, gerente, analista, admin, no escopo do perfil),
 * notas por pessoa e o cadastro de trilhas (RF-TRE-01; analista e admin). Cada aba aparece só para quem pode (usePode);
 * a API revalida licença, perfil e escopo. Filtros na URL.
 */
export function TrilhasPage() {
  const [f, mudar] = useFiltrosNaUrl();
  const permitidas: Record<Aba, boolean> = { adesao: usePode('adesao.ver'), pessoas: usePode('notas.ver'), trilhas: usePode('trilha.editar') };
  const aba = abaVisivel(f.aba, permitidas);

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="treinamento.trilhas">
      <PageHeader
        title="Treinamento"
        subtitle="Adesão da equipe às trilhas, notas por pessoa e o cadastro das trilhas."
        actions={
          permitidas.trilhas ? (
            <Link href={hrefEditarTrilha()} data-testid="treinamento.nova-trilha" className="inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-ink px-4 text-[14px] font-semibold text-white no-underline hover:bg-[#0b1218]">
              <IconPlus size={15} /> Nova trilha
            </Link>
          ) : null
        }
      />
      {aba === null ? (
        <Notice tone="info">Seu perfil não tem acesso ao painel nem ao cadastro de trilhas.</Notice>
      ) : (
        <>
          <div role="tablist" aria-label="Seções do treinamento" className="flex gap-1 border-b border-line">
            {(Object.keys(ROTULO_ABA) as Aba[])
              .filter((a) => permitidas[a])
              .map((a) => (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={aba === a}
                  data-testid={`treinamento.aba-${a}`}
                  onClick={() => mudar({ aba: a })}
                  className={cx('-mb-px min-h-[44px] border-b-2 px-4 text-[14px] font-semibold', aba === a ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
                  {ROTULO_ABA[a]}
                </button>
              ))}
          </div>
          {(aba === 'adesao' || aba === 'pessoas') && (
            <FilterBar>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
                Mês
                <input type="month" value={f.mes} onChange={(e) => mudar({ mes: e.target.value })} data-testid="treinamento.filtro-mes" className="h-[42px] rounded-xl border border-field bg-surface px-3 text-[14px] text-ink" />
              </label>
            </FilterBar>
          )}
          {aba === 'adesao' && <AbaAdesao />}
          {aba === 'pessoas' && <AbaPessoas />}
          {aba === 'trilhas' && <AbaTrilhas />}
        </>
      )}
    </div>
  );
}

function AbaAdesao() {
  const [f] = useFiltrosNaUrl();
  const q = useAdesao(f, true);
  const d = q.data;
  return (
    <>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Calculando a adesão…" />}
      {d && (
        <>
          {d.base_parcial && (
            <p className="text-[12px] text-ink-2" data-testid="treinamento.aviso-base-parcial">
              Adesão calculada só com quem já usou o Treinamento.
            </p>
          )}
          <KpiGrid>
            <KpiCard label={`Adesão em ${monthLabel(d.mes)}`} value={pctOuTraco(d.adesao.adesao_pct)} sub="concluíram ao menos uma lição no mês" />
            <KpiCard label="Público" value={d.adesao.publico} sub="pessoas ativas no público das trilhas" />
            <KpiCard label="Ativos no mês" value={d.adesao.ativos_no_mes} />
          </KpiGrid>
          <Panel label="Conclusão por trilha" title="Conclusão por trilha">
            {d.trilhas.length === 0 ? (
              <span className="text-[13px] text-ink-2">Nenhuma trilha publicada ainda.</span>
            ) : (
              <TableScroll minWidth={760}>
                <table className="w-full border-collapse text-[13px]" data-testid="treinamento.tabela-adesao">
                  <thead>
                    <tr>
                      <th scope="col" className={th}>Trilha</th>
                      <th scope="col" className={th}>Status</th>
                      <th scope="col" className={thNum}>Público</th>
                      <th scope="col" className={thNum}>Concluíram</th>
                      <th scope="col" className={th}>Conclusão</th>
                      <th scope="col" className={thNum}>Nota média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.trilhas.map((t) => (
                      <tr key={t.trilha_id}>
                        <td className={td}>
                          <span className="font-semibold">{t.titulo}</span>
                          {t.obrigatoria && <span className="ml-2 text-[11px] text-ink-2">obrigatória{t.prazo ? ` até ${t.prazo.split('-').reverse().join('/')}` : ''}</span>}
                        </td>
                        <td className={td}>
                          <Badge tone={TOM_STATUS[t.status] ?? 'neutral'}>{ROTULO_STATUS[t.status] ?? t.status}</Badge>
                        </td>
                        <td className={tdNum}>{t.publico}</td>
                        <td className={tdNum}>{t.concluiram}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <Bar pct={t.conclusao_pct ?? 0} colorClass="bg-accent" />
                            <span className="w-[44px] text-right tabular-nums">{pctOuTraco(t.conclusao_pct)}</span>
                          </div>
                        </td>
                        <td className={tdNum}>{pctOuTraco(t.nota_media_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function AbaPessoas() {
  const [f] = useFiltrosNaUrl();
  const tz = useFusoDoBko();
  const q = usePessoas(f, true);
  const d = q.data;
  const exportar = () => d && downloadBlob(new Blob([pessoasParaCsv(d.pessoas, tz)], { type: 'text/csv;charset=utf-8' }), `treinamento_pessoas_${d.mes}.csv`);
  return (
    <Panel
      label="Pessoas"
      title={d ? `Pessoas · ${monthLabel(d.mes)}` : 'Pessoas'}
      aside={
        <Button size="sm" onClick={exportar} disabled={!d || d.pessoas.length === 0} data-testid="treinamento.exportar-pessoas">
          <IconDownload size={14} /> Exportar CSV
        </Button>
      }>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando as pessoas…" />}
      {d && d.pessoas.length === 0 && <span className="text-[13px] text-ink-2">Ninguém no seu escopo ainda.</span>}
      {d && d.pessoas.length > 0 && (
        <TableScroll minWidth={860}>
          <table className="w-full border-collapse text-[13px]" data-testid="treinamento.tabela-pessoas">
            <thead>
              <tr>
                <th scope="col" className={th}>Pessoa</th>
                <th scope="col" className={th}>Perfil</th>
                <th scope="col" className={thNum}>Lições no mês</th>
                <th scope="col" className={thNum}>Trilhas concluídas</th>
                <th scope="col" className={thNum}>Obrigatórias pendentes</th>
                <th scope="col" className={thNum}>Nota média</th>
                <th scope="col" className={th}>Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {d.pessoas.map((p) => (
                <tr key={p.usuario_id}>
                  <td className={`${td} font-semibold`}>{p.nome}</td>
                  <td className={td}>{ROTULO_PERFIL[p.perfil] ?? p.perfil}</td>
                  <td className={tdNum}>{p.licoes_no_mes}</td>
                  <td className={tdNum}>{p.trilhas_concluidas}</td>
                  <td className={cx(tdNum, p.obrigatorias_pendentes > 0 && 'font-semibold text-warning')}>{p.obrigatorias_pendentes}</td>
                  <td className={tdNum}>{pctOuTraco(p.nota_media_pct)}</td>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{p.ultima_atividade_em ? formatDateTime(p.ultima_atividade_em, tz) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

function AbaTrilhas() {
  const [f, mudar] = useFiltrosNaUrl();
  const tz = useFusoDoBko();
  const podePublicar = usePode('trilha.publicar');
  const q = useTrilhasBko(f, true);
  const status = useMudarStatus();
  const [confirmar, setConfirmar] = useState<{ trilha: BkoTrilhaResumo; acao: 'publicar' | 'arquivar' } | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tom: 'success' | 'warning' } | null>(null);
  const itens = q.data ?? [];
  const exportar = () => downloadBlob(new Blob([trilhasParaCsv(itens)], { type: 'text/csv;charset=utf-8' }), 'treinamento_trilhas.csv');

  const executar = () => {
    if (!confirmar) return;
    const { trilha, acao } = confirmar;
    setConfirmar(null);
    status.mutate(
      { id: trilha.id, acao },
      {
        onSuccess: (d) => setAviso(acao === 'arquivar' ? { texto: `"${d.titulo}" arquivada.`, tom: 'success' } : d.status === 'publicada' ? { texto: `"${d.titulo}" publicada: já aparece no app do público.`, tom: 'success' } : { texto: `"${d.titulo}" ainda não pode ser publicada.`, tom: 'warning' }),
      },
    );
  };

  return (
    <>
      <FilterBar>
        <SelectField label="Status" value={f.status} onChange={(e) => mudar({ status: e.target.value })} data-testid="treinamento.filtro-status">
          <option value="">Todos</option>
          <option value="rascunho">Rascunho</option>
          <option value="publicada">Publicada</option>
          <option value="arquivada">Arquivada</option>
        </SelectField>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Buscar
          <input type="search" value={f.busca} placeholder="Título da trilha" onChange={(e) => mudar({ busca: e.target.value })} data-testid="treinamento.filtro-busca" className="h-[42px] w-[260px] rounded-xl border border-field bg-surface px-3 text-[14px] text-ink" />
        </label>
        <Button size="sm" onClick={exportar} disabled={itens.length === 0} data-testid="treinamento.exportar-trilhas" className="self-end">
          <IconDownload size={14} /> Exportar CSV
        </Button>
      </FilterBar>
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      {status.isError && <Notice tone="danger">{errorMessage(status.error)}</Notice>}
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando as trilhas…" />}
      {q.data && itens.length === 0 && <Notice tone="info">Nenhuma trilha com esse filtro. Use “Nova trilha” para começar.</Notice>}
      {itens.length > 0 && (
        <Panel label="Trilhas" title={`${itens.length} ${itens.length === 1 ? 'trilha' : 'trilhas'}`}>
          <TableScroll minWidth={900}>
            <table className="w-full border-collapse text-[13px]" data-testid="treinamento.tabela-trilhas">
              <thead>
                <tr>
                  <th scope="col" className={th}>Trilha</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Público</th>
                  <th scope="col" className={thNum}>Lições</th>
                  <th scope="col" className={thNum}>Quizzes</th>
                  <th scope="col" className={th}>Atualizada</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {itens.map((t) => (
                  <tr key={t.id} data-testid={`treinamento.trilha-${t.id}`}>
                    <td className={td}>
                      <Link href={hrefEditarTrilha(t.id)} className="font-semibold text-accent no-underline hover:underline">
                        {t.titulo}
                      </Link>
                      {t.obrigatoria && <span className="ml-2 text-[11px] text-ink-2">obrigatória{t.prazo ? ` até ${t.prazo.split('-').reverse().join('/')}` : ''}</span>}
                    </td>
                    <td className={td}>
                      <Badge tone={TOM_STATUS[t.status] ?? 'neutral'}>{ROTULO_STATUS[t.status] ?? t.status}</Badge>
                    </td>
                    <td className={`${td} text-ink-2`}>
                      {t.publico_perfis.length === 0 ? 'Todos os perfis' : t.publico_perfis.map((p) => ROTULO_PERFIL[p] ?? p).join(', ')}
                      {t.publico_equipes > 0 ? ` · ${t.publico_equipes} ${t.publico_equipes === 1 ? 'equipe' : 'equipes'}` : ''}
                    </td>
                    <td className={tdNum}>{t.licoes}</td>
                    <td className={tdNum}>{t.quizzes}</td>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(t.updated_at, tz)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <div className="flex justify-end gap-2">
                        {t.status === 'rascunho' && (
                          <Link href={hrefEditarTrilha(t.id)} className="inline-flex h-[38px] items-center rounded-[10px] border border-field px-3 text-[13px] font-semibold text-ink no-underline hover:bg-ground">
                            Editar
                          </Link>
                        )}
                        {podePublicar && t.status === 'rascunho' && (
                          <Button size="sm" variant="primary" disabled={status.isPending} onClick={() => setConfirmar({ trilha: t, acao: 'publicar' })} data-testid={`treinamento.publicar-${t.id}`}>
                            Publicar
                          </Button>
                        )}
                        {podePublicar && t.status !== 'arquivada' && (
                          <Button size="sm" disabled={status.isPending} onClick={() => setConfirmar({ trilha: t, acao: 'arquivar' })} data-testid={`treinamento.arquivar-${t.id}`}>
                            Arquivar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
      <Dialog
        open={confirmar !== null}
        title={confirmar?.acao === 'publicar' ? 'Publicar trilha?' : 'Arquivar trilha?'}
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <Button onClick={() => setConfirmar(null)}>Voltar</Button>
            <Button variant={confirmar?.acao === 'arquivar' ? 'danger' : 'primary'} onClick={executar} data-testid="treinamento.confirmar">
              {confirmar?.acao === 'publicar' ? 'Publicar' : 'Arquivar'}
            </Button>
          </>
        }>
        {confirmar?.acao === 'publicar'
          ? `"${confirmar.trilha.titulo}" vai aparecer no app de quem está no público e deixa de ser editável. A ação fica registrada na auditoria.`
          : `"${confirmar?.trilha.titulo ?? ''}" sai do app do público e não volta a ser publicada. O progresso de quem já fez é mantido. A ação fica registrada na auditoria.`}
      </Dialog>
    </>
  );
}
