'use client';

import { formatPct } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import {
  type AcaoDoMenu,
  Badge,
  Bar,
  Button,
  cx,
  CampoBusca,
  type ColunaDaTabela,
  Dialog,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  formatDateTime,
  IconPlus,
  KpiCard,
  KpiGrid,
  LoadingBlock,
  MenuAcoes,
  monthLabel,
  Notice,
  PageHeader,
  rotuloDoPerfil,
  SelectField,
  TabelaDados,
  TextField,
  useToast,
  type BadgeTone,
} from '@macuxi/ui/web';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdesaoResposta, BkoTrilhaResumo, PessoasResposta } from '../../contracts';
import { pessoasParaCsv, ROTULO_STATUS, trilhasParaCsv } from '../lib/csv';
import { abaVisivel, mesDoFiltro, type Aba, type FiltrosTrilhas } from '../lib/filtros-url';
import { useAdesao, useFusoDoBko, useMudarStatus, usePessoas, useTrilhasBko } from '../lib/queries';
import { hrefEditarTrilha } from '../lib/rotas';
import { useFiltrosNaUrl } from '../lib/use-filtros';

const ROTULO_ABA: Record<Aba, string> = { adesao: 'Adesão', pessoas: 'Pessoas', trilhas: 'Trilhas' };
const TOM_STATUS: Record<string, BadgeTone> = { rascunho: 'neutral', publicada: 'success', arquivada: 'warning' };
const pctOuTraco = (n: number | null) => (n === null ? '—' : formatPct(n, 0));
const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const baixarCsv = (conteudo: string, arquivo: string) => downloadBlob(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }), arquivo);

/**
 * Trilhas do Treinamento no BKO: painel de adesão (RF-TRE-05; supervisor, gerente, analista, admin, no escopo do perfil),
 * notas por pessoa e o cadastro de trilhas (RF-TRE-01; analista e admin). Cada aba aparece só para quem pode (usePode);
 * a API revalida licença, perfil e escopo. Filtros na URL. Revisão do BKO: cabeçalho sem subtítulo, "⋯" da página,
 * contagem nas abas, tabelas sem rolagem lateral (§P1 a §P7).
 */
export function TrilhasPage() {
  const router = useRouter();
  const [f, mudar] = useFiltrosNaUrl();
  const podeTrilhas = usePode('trilha.editar');
  const permitidas: Record<Aba, boolean> = { adesao: usePode('adesao.ver'), pessoas: usePode('notas.ver'), trilhas: podeTrilhas };
  const aba = abaVisivel(f.aba, permitidas);
  const tz = useFusoDoBko();
  // as consultas ficam aqui para a contagem das abas e o "⋯" da página (a mesma chave: o React Query não repete a chamada)
  const adesao = useAdesao(f, aba === 'adesao');
  const pessoas = usePessoas(f, permitidas.pessoas);
  const trilhas = useTrilhasBko(f, permitidas.trilhas);
  const [chaveBusca, setChaveBusca] = useState(0);

  const nTrilhas = trilhas.data?.length ?? 0;
  const nPessoas = pessoas.data?.pessoas.length ?? 0;
  const ativa = aba === 'adesao' ? adesao : aba === 'pessoas' ? pessoas : trilhas;

  const acoes: AcaoDoMenu[] = [];
  if (aba === 'trilhas') acoes.push({ id: 'csv', rotulo: 'Exportar CSV', desligada: nTrilhas === 0, testId: 'treinamento.exportar-trilhas', aoEscolher: () => baixarCsv(trilhasParaCsv(trilhas.data ?? []), 'treinamento_trilhas.csv') });
  if (aba === 'pessoas') acoes.push({ id: 'csv', rotulo: 'Exportar CSV', desligada: nPessoas === 0, testId: 'treinamento.exportar-pessoas', aoEscolher: () => pessoas.data && baixarCsv(pessoasParaCsv(pessoas.data.pessoas, tz), `treinamento_pessoas_${pessoas.data.mes}.csv`) });
  acoes.push({ id: 'atualizar', rotulo: ativa.isFetching ? 'Atualizando…' : 'Atualizar', desligada: ativa.isFetching, aoEscolher: () => void ativa.refetch() });

  const filtroLigado = aba === 'trilhas' ? !!(f.busca || f.status) : !!f.mes;
  const limpar = () => {
    mudar(aba === 'trilhas' ? { busca: '', status: '' } : { mes: '' });
    setChaveBusca((n) => n + 1);
  };

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="treinamento.trilhas">
      <PageHeader
        title="Treinamento"
        actions={
          aba === null ? null : (
            <div className="flex items-center gap-2">
              {podeTrilhas && (
                <Button variant="primary" onClick={() => router.push(hrefEditarTrilha())} data-testid="treinamento.nova-trilha">
                  <IconPlus size={15} /> Nova trilha
                </Button>
              )}
              <MenuAcoes acoes={acoes} />
            </div>
          )
        }
      />
      {aba === null ? (
        <Notice tone="info">Seu perfil não tem acesso ao painel nem ao cadastro de trilhas.</Notice>
      ) : (
        <>
          <div role="tablist" aria-label="Seções do treinamento" className="flex gap-1 overflow-x-auto border-b border-line">
            {(Object.keys(ROTULO_ABA) as Aba[])
              .filter((a) => permitidas[a])
              .map((a) => {
                const n = a === 'trilhas' ? nTrilhas : a === 'pessoas' ? nPessoas : 0;
                return (
                  <button
                    key={a}
                    type="button"
                    role="tab"
                    id={`treinamento-aba-${a}`}
                    aria-selected={aba === a}
                    aria-controls="treinamento-painel"
                    data-testid={`treinamento.aba-${a}`}
                    onClick={() => mudar({ aba: a })}
                    className={cx('-mb-px min-h-[44px] shrink-0 border-b-2 px-4 text-[14px] font-semibold', aba === a ? 'border-accent text-accent-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
                    {n > 0 ? `${ROTULO_ABA[a]} (${n.toLocaleString('pt-BR')})` : ROTULO_ABA[a]}
                  </button>
                );
              })}
          </div>
          <div role="tabpanel" id="treinamento-painel" aria-labelledby={`treinamento-aba-${aba}`} className="flex flex-col gap-5">
            <FilterBar>
              {aba === 'trilhas' ? (
                <>
                  <BuscaComEspera key={chaveBusca} valor={f.busca} aoMudar={(busca) => mudar({ busca })} />
                  <SelectField label="Situação" value={f.status} onChange={(e) => mudar({ status: e.target.value })} data-testid="treinamento.filtro-status">
                    <option value="">Todas</option>
                    <option value="rascunho">Rascunho</option>
                    <option value="publicada">Publicada</option>
                    <option value="arquivada">Arquivada</option>
                  </SelectField>
                </>
              ) : (
                <TextField label="Mês" type="month" value={mesDoFiltro(f, tz)} onChange={(e) => mudar({ mes: e.target.value })} data-testid="treinamento.filtro-mes" />
              )}
              {filtroLigado && (
                <Button size="sm" onClick={limpar} data-testid="treinamento.limpar-filtros">
                  Limpar filtros
                </Button>
              )}
            </FilterBar>
            {aba === 'adesao' && <AbaAdesao q={adesao} />}
            {aba === 'pessoas' && <AbaPessoas q={pessoas} />}
            {aba === 'trilhas' && <AbaTrilhas q={trilhas} f={f} />}
          </div>
        </>
      )}
    </div>
  );
}

/** Busca que espera 300 ms depois da última tecla antes de gravar na URL (§P4). Remonta (key) ao limpar os filtros. */
function BuscaComEspera({ valor, aoMudar }: { valor: string; aoMudar: (busca: string) => void }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => {
    if (texto === valor) return;
    const t = setTimeout(() => aoMudar(texto), 300);
    return () => clearTimeout(t);
  }, [texto, valor, aoMudar]);
  return <CampoBusca rotulo="Buscar trilha" value={texto} onChange={(e) => setTexto(e.target.value)} data-testid="treinamento.filtro-busca" />;
}

type Consulta<T> = { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

const COLUNAS_ADESAO: ColunaDaTabela<AdesaoResposta['trilhas'][number]>[] = [
  {
    id: 'trilha',
    titulo: 'Trilha',
    largura: '34%',
    texto: (t) => t.titulo,
    celula: (t) => (
      <>
        <span className="font-semibold">{t.titulo}</span>
        {t.obrigatoria && <span className="ml-2 text-[11px] text-ink-2">obrigatória{t.prazo ? ` até ${dataBr(t.prazo)}` : ''}</span>}
      </>
    ),
  },
  { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (t) => <Badge tone={TOM_STATUS[t.status] ?? 'neutral'}>{ROTULO_STATUS[t.status] ?? t.status}</Badge> },
  { id: 'publico', titulo: 'Público', prioridade: 3, numero: true, largura: '90px', celula: (t) => t.publico },
  { id: 'concluiram', titulo: 'Concluíram', prioridade: 2, numero: true, largura: '110px', celula: (t) => t.concluiram },
  {
    id: 'conclusao',
    titulo: 'Conclusão',
    largura: '200px',
    celula: (t) => (
      <div className="flex items-center gap-2">
        <Bar pct={t.conclusao_pct ?? 0} colorClass="bg-accent" min={60} />
        <span className="w-[44px] text-right tabular-nums">{pctOuTraco(t.conclusao_pct)}</span>
      </div>
    ),
  },
  { id: 'nota', titulo: 'Nota média', prioridade: 2, numero: true, largura: '100px', celula: (t) => pctOuTraco(t.nota_media_pct) },
];

function AbaAdesao({ q }: { q: Consulta<AdesaoResposta> }) {
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
            <KpiCard label={`Adesão em ${monthLabel(d.mes)}`} value={pctOuTraco(d.adesao.adesao_pct)} sub="concluíram ao menos uma lição" />
            <KpiCard label="Público" value={d.adesao.publico} />
            <KpiCard label="Ativos" value={d.adesao.ativos_no_mes} />
          </KpiGrid>
          <TabelaDados
            rotulo="Conclusão por trilha"
            testId="treinamento.tabela-adesao"
            colunas={COLUNAS_ADESAO}
            linhas={d.trilhas}
            chave={(t) => t.trilha_id}
            vazio={<EstadoVazio titulo="Nenhuma trilha publicada ainda." />}
          />
        </>
      )}
    </>
  );
}

function AbaPessoas({ q }: { q: Consulta<PessoasResposta> }) {
  const tz = useFusoDoBko();
  const d = q.data;
  const colunas: ColunaDaTabela<PessoasResposta['pessoas'][number]>[] = [
    { id: 'pessoa', titulo: 'Pessoa', largura: '30%', texto: (p) => p.nome, celula: (p) => <span className="font-semibold">{p.nome}</span> },
    { id: 'perfil', titulo: 'Perfil', prioridade: 2, texto: (p) => rotuloDoPerfil(p.perfil), celula: (p) => rotuloDoPerfil(p.perfil) },
    { id: 'licoes', titulo: 'Lições no mês', prioridade: 2, numero: true, largura: '120px', celula: (p) => p.licoes_no_mes },
    { id: 'concluidas', titulo: 'Trilhas concluídas', prioridade: 3, numero: true, largura: '140px', celula: (p) => p.trilhas_concluidas },
    {
      id: 'pendentes',
      titulo: 'Obrigatórias pendentes',
      numero: true,
      largura: '170px',
      celula: (p) => <span className={p.obrigatorias_pendentes > 0 ? 'font-semibold text-warning' : undefined}>{p.obrigatorias_pendentes}</span>,
    },
    { id: 'nota', titulo: 'Nota média', prioridade: 2, numero: true, largura: '100px', celula: (p) => pctOuTraco(p.nota_media_pct) },
    {
      id: 'atividade',
      titulo: 'Última atividade',
      prioridade: 3,
      numero: true,
      largura: '150px',
      texto: (p) => (p.ultima_atividade_em ? formatDateTime(p.ultima_atividade_em, tz) : ''),
      celula: (p) => (p.ultima_atividade_em ? formatDateTime(p.ultima_atividade_em, tz) : '—'),
    },
  ];
  return (
    <>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando as pessoas…" />}
      {d && (
        <TabelaDados
          rotulo="Pessoas"
          testId="treinamento.tabela-pessoas"
          colunas={colunas}
          linhas={d.pessoas}
          chave={(p) => p.usuario_id}
          vazio={<EstadoVazio titulo="Nenhuma pessoa no seu escopo ainda." />}
        />
      )}
    </>
  );
}

function AbaTrilhas({ q, f }: { q: Consulta<BkoTrilhaResumo[]>; f: FiltrosTrilhas }) {
  const tz = useFusoDoBko();
  const router = useRouter();
  const toast = useToast();
  const podePublicar = usePode('trilha.publicar');
  const status = useMudarStatus();
  const [confirmar, setConfirmar] = useState<{ trilha: BkoTrilhaResumo; acao: 'publicar' | 'arquivar' } | null>(null);
  const itens = q.data ?? [];

  const executar = () => {
    if (!confirmar) return;
    const { trilha, acao } = confirmar;
    setConfirmar(null);
    status.mutate(
      { id: trilha.id, acao },
      {
        onSuccess: (d) => {
          if (acao === 'arquivar') toast('success', `"${d.titulo}" arquivada.`);
          else if (d.status === 'publicada') toast('success', `"${d.titulo}" publicada.`);
          else toast('warning', `"${d.titulo}" ainda não pode ser publicada.`);
        },
      },
    );
  };

  const acoesDaLinha = (t: BkoTrilhaResumo): AcaoDoMenu[] => {
    const lista: AcaoDoMenu[] = [];
    if (t.status === 'rascunho') lista.push({ id: 'editar', rotulo: 'Editar', aoEscolher: () => router.push(hrefEditarTrilha(t.id)) });
    if (podePublicar && t.status === 'rascunho') lista.push({ id: 'publicar', rotulo: 'Publicar', desligada: status.isPending, testId: `treinamento.publicar-${t.id}`, aoEscolher: () => setConfirmar({ trilha: t, acao: 'publicar' }) });
    if (podePublicar && t.status !== 'arquivada') lista.push({ id: 'arquivar', rotulo: 'Arquivar', perigo: true, desligada: status.isPending, testId: `treinamento.arquivar-${t.id}`, aoEscolher: () => setConfirmar({ trilha: t, acao: 'arquivar' }) });
    return lista;
  };

  const colunas: ColunaDaTabela<BkoTrilhaResumo>[] = [
    {
      id: 'trilha',
      titulo: 'Trilha',
      largura: '36%',
      texto: (t) => (t.obrigatoria ? `${t.titulo} (obrigatória${t.prazo ? ` até ${dataBr(t.prazo)}` : ''})` : t.titulo),
      celula: (t) => (
        <>
          <span className="font-semibold text-accent-ink">{t.titulo}</span>
          {t.obrigatoria && <span className="ml-2 text-[11px] text-ink-2">obrigatória{t.prazo ? ` até ${dataBr(t.prazo)}` : ''}</span>}
        </>
      ),
    },
    { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (t) => <Badge tone={TOM_STATUS[t.status] ?? 'neutral'}>{ROTULO_STATUS[t.status] ?? t.status}</Badge> },
    {
      id: 'publico',
      titulo: 'Público',
      prioridade: 2,
      texto: (t) => textoDoPublico(t),
      celula: (t) => <span className="text-ink-2">{textoDoPublico(t)}</span>,
    },
    { id: 'atualizada', titulo: 'Atualizada', prioridade: 2, numero: true, largura: '150px', texto: (t) => formatDateTime(t.updated_at, tz), celula: (t) => formatDateTime(t.updated_at, tz) },
    { id: 'licoes', titulo: 'Lições', prioridade: 3, numero: true, largura: '80px', celula: (t) => t.licoes },
    { id: 'quizzes', titulo: 'Quizzes', prioridade: 3, numero: true, largura: '80px', celula: (t) => t.quizzes },
  ];

  const filtroLigado = !!(f.busca || f.status);
  return (
    <>
      {status.isError && <Notice tone="danger">{errorMessage(status.error)}</Notice>}
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando as trilhas…" />}
      {q.data && (
        <TabelaDados
          rotulo="Trilhas"
          testId="treinamento.tabela-trilhas"
          colunas={colunas}
          linhas={itens}
          chave={(t) => t.id}
          linhaTestId={(t) => `treinamento.trilha-${t.id}`}
          aoAbrir={(t) => router.push(hrefEditarTrilha(t.id))}
          acoes={acoesDaLinha}
          vazio={
            filtroLigado ? (
              <EstadoVazio titulo="Nenhuma trilha com esses filtros." />
            ) : (
              <EstadoVazio
                titulo="Nenhuma trilha cadastrada."
                acao={
                  <Button variant="primary" onClick={() => router.push(hrefEditarTrilha())}>
                    <IconPlus size={15} /> Nova trilha
                  </Button>
                }
              />
            )
          }
        />
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
          ? `"${confirmar.trilha.titulo}" vai aparecer no app de quem está no público e deixa de ser editável.`
          : `"${confirmar?.trilha.titulo ?? ''}" sai do app do público e não volta a ser publicada. O progresso de quem já fez é mantido.`}
      </Dialog>
    </>
  );
}

function textoDoPublico(t: BkoTrilhaResumo): string {
  const perfis = t.publico_perfis.length === 0 ? 'Todos os perfis' : t.publico_perfis.map((p) => rotuloDoPerfil(p)).join(', ');
  return t.publico_equipes > 0 ? `${perfis} · ${t.publico_equipes} ${t.publico_equipes === 1 ? 'equipe' : 'equipes'}` : perfis;
}
