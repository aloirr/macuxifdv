'use client';

/**
 * Resultados da pesquisa no BKO (RF-PES-06): filtros na URL (período, versão, equipes), indicadores, gráfico por
 * pergunta (consolidado entre versões pelo id estável, RN-PES-01, ou de uma versão), respostas suspeitas (RN-PES-04),
 * respostas em texto, galeria de fotos e exportação CSV (Excel). Escopo do perfil aplicado pela API (RN-CORE-04).
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Bar, Button, ErrorBlock, FilterBar, formatDateTime, KpiCard, KpiGrid, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th } from '@macuxi/ui/web';
import { useCallback, useEffect, useState } from 'react';
import type { ResultadoPergunta } from '../../contracts';
import { lerFiltrosResultado, paraBusca, type FiltrosResultado } from '../lib/filtros-url';
import { barrasDaPergunta, resumoDaPergunta, textoTaxa } from '../lib/graficos';
import { baixarCsv, urlDaFoto, useFusoDoTenant, useGaleria, useQuestionario, useRespostas, useResultado } from '../lib/queries';

function useFiltros(): [FiltrosResultado, (p: Partial<FiltrosResultado>) => void] {
  const [f, setF] = useState<FiltrosResultado>(() => lerFiltrosResultado(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosResultado(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosResultado>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBusca({ id: novo.id, de: novo.de, ate: novo.ate, versao: novo.versao, equipes: novo.equipes })}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

function GraficoPergunta({ p, indice }: { p: ResultadoPergunta; indice: number }) {
  const barras = barrasDaPergunta(p);
  return (
    <div className="flex flex-col gap-2 border-b border-line-2 pb-4" data-testid={`resultado.pergunta-${indice + 1}`}>
      <strong className="text-[14px]">
        {indice + 1}. {p.enunciado}
      </strong>
      <span className="text-[12px] text-ink-3">{resumoDaPergunta(p)}</span>
      {barras.map((b) => (
        <div key={b.rotulo} className="flex items-center gap-3 text-[13px]">
          <span className="w-[180px] truncate" title={b.rotulo}>
            {b.rotulo}
          </span>
          <Bar pct={b.pct ?? 0} colorClass="bg-accent" />
          <span className="w-[90px] text-right tabular-nums">
            {b.contagem} · {b.pct === null ? '—' : `${b.pct.toLocaleString('pt-BR')}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Foto({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    let criada: string | null = null;
    void urlDaFoto(id).then((u) => {
      criada = u;
      if (vivo) setUrl(u);
    });
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [id]);
  if (url === undefined) return <div className="h-[140px] w-[140px] animate-pulse rounded-xl bg-line-2" />;
  if (url === null) return <div className="flex h-[140px] w-[140px] items-center justify-center rounded-xl bg-ground p-2 text-center text-[12px] text-ink-3">Foto ainda não enviada pelo aparelho</div>;
  return <img src={url} alt="Foto da resposta" className="h-[140px] w-[140px] rounded-xl object-cover" />;
}

export function ResultadosPage() {
  const [f, mudar] = useFiltros();
  const fuso = useFusoDoTenant();
  const podeExportar = usePode('resultado.exportar');
  const q = useQuestionario(f.id);
  const r = useResultado(f.id, f);
  const respostas = useRespostas(f.id, f);
  const galeria = useGaleria(f.id, f);
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);

  if (!f.id) return <Notice tone="warning">Abra os resultados pela lista de pesquisas.</Notice>;
  const publicadas = (q.data?.versoes ?? []).filter((v) => v.status === 'publicada');
  const titulo = publicadas[publicadas.length - 1]?.titulo ?? 'Pesquisa';
  const enunciados = new Map(publicadas.flatMap((v) => v.perguntas.map((p) => [p.id, p.enunciado] as const)));

  const exportar = async () => {
    setExportando(true);
    setErroExportar(null);
    try {
      await baixarCsv(f.id!, f);
    } catch (e) {
      setErroExportar(errorMessage(e));
    } finally {
      setExportando(false);
    }
  };

  const dados = r.data;
  const total = dados ? (dados.tipo === 'versao' ? dados.resultado.total_respostas : dados.resultado.versoes.reduce((n, v) => n + v.respostas, 0)) : 0;
  const suspeitas = dados ? (dados.tipo === 'versao' ? dados.resultado.respostas_suspeitas : dados.resultado.respostas_suspeitas) : 0;
  const perguntas: ResultadoPergunta[] = dados ? (dados.tipo === 'versao' ? dados.resultado.por_pergunta : [...dados.resultado.consolidadas.map((c) => c.pergunta), ...dados.resultado.por_versao.flatMap((v) => v.perguntas)]) : [];
  const textos = (respostas.data?.itens ?? []).flatMap((x) => x.itens.flatMap((i) => (i.tipo === 'texto' && i.texto.trim() ? [{ id: `${x.id}:${i.pergunta_id}`, pergunta: enunciados.get(i.pergunta_id) ?? '', texto: i.texto, em: x.respondida_em }] : [])));

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="resultado.tela">
      <PageHeader
        eyebrow={<a href="/pesquisas" className="text-accent">← Pesquisas</a>}
        title={`Resultados · ${titulo}`}
        subtitle="Respostas no seu escopo: supervisor e gerente veem a equipe; analista e admin, a empresa."
        actions={
          podeExportar ? (
            <Button variant="primary" onClick={() => void exportar()} disabled={exportando} data-testid="resultado.exportar">
              {exportando ? 'Gerando…' : 'Exportar Excel (CSV)'}
            </Button>
          ) : null
        }
      />
      {erroExportar ? <Notice tone="danger">{erroExportar}</Notice> : null}

      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          De
          <input type="date" className="h-[38px] rounded-[10px] border border-field px-3 text-[14px]" value={f.de ?? ''} onChange={(e) => mudar({ de: e.target.value || undefined })} data-testid="resultado.de" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Até
          <input type="date" className="h-[38px] rounded-[10px] border border-field px-3 text-[14px]" value={f.ate ?? ''} min={f.de} onChange={(e) => mudar({ ate: e.target.value || undefined })} data-testid="resultado.ate" />
        </label>
        <SelectField label="Versão" value={f.versao ?? ''} onChange={(e) => mudar({ versao: e.target.value || undefined })} data-testid="resultado.versao">
          <option value="">Todas (consolidado)</option>
          {publicadas.map((v) => (
            <option key={v.id} value={v.id}>
              Versão {v.numero}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {r.isError ? <ErrorBlock message={errorMessage(r.error)} onRetry={() => void r.refetch()} /> : null}
      {r.isPending ? <LoadingBlock label="Apurando os resultados…" /> : null}
      {dados ? (
        <>
          <KpiGrid>
            <KpiCard label="Respostas" value={total} />
            <KpiCard label="Respondentes" value={dados.tipo === 'versao' ? dados.resultado.respondentes_distintos : '—'} sub={dados.tipo === 'versao' ? 'usuários distintos' : 'escolha uma versão'} />
            <KpiCard label="Taxa de resposta" value={dados.tipo === 'versao' ? textoTaxa(dados.resultado.taxa_resposta_pct) : '—'} sub="depende do público informado pelo Core" />
            <KpiCard label="Suspeitas" value={suspeitas} sub="relógio adiantado ou fora da vigência" />
          </KpiGrid>
          {suspeitas > 0 ? <Notice tone="warning">{suspeitas} resposta(s) chegaram com relógio do aparelho adiantado ou fora da vigência. Foram aceitas e estão marcadas no CSV (RN-PES-04).</Notice> : null}
          <Panel label="Perguntas" title="Por pergunta">
            {perguntas.length === 0 ? <Notice tone="info">Sem respostas no período.</Notice> : null}
            <div className="flex flex-col gap-4">
              {perguntas.map((p, i) => (
                <GraficoPergunta key={`${p.pergunta_id}:${i}`} p={p} indice={i} />
              ))}
            </div>
          </Panel>
        </>
      ) : null}

      <Panel label="Textos" title="Respostas em texto">
        {respostas.isError ? <ErrorBlock message={errorMessage(respostas.error)} /> : null}
        {textos.length === 0 ? (
          <span className="text-[13px] text-ink-3">Nenhuma resposta em texto.</span>
        ) : (
          <TableScroll minWidth={720}>
            <table className="w-full border-collapse text-[14px]" data-testid="resultado.textos">
              <thead>
                <tr>
                  <th scope="col" className={th}>Quando</th>
                  <th scope="col" className={th}>Pergunta</th>
                  <th scope="col" className={th}>Resposta</th>
                </tr>
              </thead>
              <tbody>
                {textos.slice(0, 200).map((x) => (
                  <tr key={x.id}>
                    <td className={td}>{formatDateTime(x.em, fuso)}</td>
                    <td className={td}>{x.pergunta}</td>
                    <td className={td}>{x.texto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      <Panel label="Galeria" title={`Galeria de fotos (${galeria.data?.itens.length ?? 0})`}>
        {galeria.isError ? <ErrorBlock message={errorMessage(galeria.error)} /> : null}
        {(galeria.data?.itens.length ?? 0) === 0 ? <span className="text-[13px] text-ink-3">Nenhuma foto.</span> : null}
        <div className="flex flex-wrap gap-3" data-testid="resultado.galeria">
          {galeria.data?.itens.slice(0, 60).map((g) => (
            <figure key={g.foto_id} className="flex w-[140px] flex-col gap-1">
              <Foto id={g.foto_id} />
              <figcaption className="text-[11px] text-ink-3">
                {g.enunciado} · {formatDateTime(g.capturada_em, fuso)}
              </figcaption>
            </figure>
          ))}
        </div>
      </Panel>
    </div>
  );
}
