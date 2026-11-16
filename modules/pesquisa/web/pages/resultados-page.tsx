'use client';

/**
 * Resultados da pesquisa no BKO (RF-PES-06): filtros na URL (período, versão, equipes), indicadores, gráfico por
 * pergunta (consolidado entre versões pelo id estável, RN-PES-01, ou de uma versão), respostas suspeitas (RN-PES-04),
 * respostas em texto, galeria de fotos e exportação CSV (Excel), no "⋯" da página (revisão do BKO §P1). Sem resposta no
 * filtro, a página mostra o vazio uma vez (§P6). Escopo do perfil aplicado pela API (RN-CORE-04).
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Bar, ErrorBlock, EstadoVazio, FilterBar, formatDateTime, KpiCard, KpiGrid, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';
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
      <strong className="text-[15px]">
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

interface TextoRespondido {
  id: string;
  pergunta: string;
  texto: string;
  em: string;
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
  if (url === null) return <div className="flex h-[140px] w-[140px] items-center justify-center rounded-xl bg-ground p-2 text-center text-[12px] text-ink-3">Foto não enviada</div>;
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
  const textos: TextoRespondido[] = (respostas.data?.itens ?? []).flatMap((x) => x.itens.flatMap((i) => (i.tipo === 'texto' && i.texto.trim() ? [{ id: `${x.id}:${i.pergunta_id}`, pergunta: enunciados.get(i.pergunta_id) ?? '', texto: i.texto, em: x.respondida_em }] : [])));

  const comTextos = respostas.data !== undefined && textos.length > 0;
  const fotos = galeria.data?.itens ?? [];
  const colunasTexto: ColunaDaTabela<TextoRespondido>[] = [
    { id: 'resposta', titulo: 'Resposta', celula: (x) => x.texto, texto: (x) => x.texto },
    { id: 'pergunta', titulo: 'Pergunta', prioridade: 2, largura: '36%', celula: (x) => x.pergunta, texto: (x) => x.pergunta },
    { id: 'quando', titulo: 'Quando', prioridade: 2, numero: true, largura: '150px', celula: (x) => formatDateTime(x.em, fuso) },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="resultado.tela">
      <PageHeader
        eyebrow={<a href="/pesquisas" className="text-accent-ink">‹ Pesquisas</a>}
        title={`Resultados · ${titulo}`}
        actions={
          podeExportar ? (
            <MenuAcoes
              rotulo="Mais ações"
              testId="resultado.mais-acoes"
              acoes={[{ id: 'exportar', rotulo: exportando ? 'Exportando…' : 'Exportar CSV', desligada: exportando, aoEscolher: () => void exportar(), testId: 'resultado.exportar' }]}
            />
          ) : null
        }
      />
      {erroExportar ? <Notice tone="danger">{erroExportar}</Notice> : null}

      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          De
          <input type="date" className="h-[38px] rounded-[10px] border border-field px-3 text-[15px]" value={f.de ?? ''} onChange={(e) => mudar({ de: e.target.value || undefined })} data-testid="resultado.de" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Até
          <input type="date" className="h-[38px] rounded-[10px] border border-field px-3 text-[15px]" value={f.ate ?? ''} min={f.de} onChange={(e) => mudar({ ate: e.target.value || undefined })} data-testid="resultado.ate" />
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
      {dados && total === 0 ? <EstadoVazio titulo="Nenhuma resposta com esses filtros." testId="resultado.vazio" /> : null}
      {dados && total > 0 ? (
        <>
          <KpiGrid>
            <KpiCard label="Respostas" value={total.toLocaleString('pt-BR')} />
            {dados.tipo === 'versao' ? (
              <KpiCard label="Respondentes" value={dados.resultado.respondentes_distintos.toLocaleString('pt-BR')} />
            ) : null}
            {dados.tipo === 'versao' ? <KpiCard label="Taxa de resposta" value={textoTaxa(dados.resultado.taxa_resposta_pct)} /> : null}
            <KpiCard label="Suspeitas" value={suspeitas.toLocaleString('pt-BR')} sub="Relógio adiantado ou fora da vigência" valueClass={suspeitas > 0 ? 'text-warning' : undefined} />
          </KpiGrid>
          <Panel label="Perguntas" title="Por pergunta">
            <div className="flex flex-col gap-4">
              {perguntas.map((p, i) => (
                <GraficoPergunta key={`${p.pergunta_id}:${i}`} p={p} indice={i} />
              ))}
            </div>
          </Panel>

          {respostas.isError ? <ErrorBlock message={errorMessage(respostas.error)} /> : null}
          {comTextos ? (
            <Panel label="Textos" title={rotuloComContagem('Respostas em texto', Math.min(textos.length, 200), textos.length > 200 || (respostas.data?.total ?? 0) > (respostas.data?.itens.length ?? 0))}>
              <TabelaDados rotulo="Respostas em texto" colunas={colunasTexto} linhas={textos.slice(0, 200)} chave={(x) => x.id} testId="resultado.textos" />
            </Panel>
          ) : null}

          {galeria.isError ? <ErrorBlock message={errorMessage(galeria.error)} /> : null}
          {fotos.length > 0 ? (
            <Panel label="Galeria" title={rotuloComContagem('Galeria de fotos', fotos.length)}>
              <div className="flex flex-wrap gap-3" data-testid="resultado.galeria">
                {fotos.slice(0, 60).map((g) => (
                  <figure key={g.foto_id} className="flex w-[140px] flex-col gap-1">
                    <Foto id={g.foto_id} />
                    <figcaption className="text-[12px] text-ink-3">
                      {g.enunciado} · {formatDateTime(g.capturada_em, fuso)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
