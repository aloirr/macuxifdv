'use client';

/**
 * Construtor do questionário no BKO (RF-PES-01/02/03/05, RN-PES-01): edita o RASCUNHO (título, modo, frequência,
 * público, vigência, perguntas e regras), salva, publica (congela a versão; auditado) e arquiva. Versão publicada é só
 * leitura: "Editar" abre a próxima versão a partir dela. Perfis sem `questionario.editar` veem tudo em leitura.
 */
import { ROTULO_PERFIL } from '@macuxi/platform-sdk';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, cx, Dialog, ErrorBlock, EstadoVazio, formatDateTime, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem } from '@macuxi/ui/web';
import { useEffect, useMemo, useState } from 'react';
import { FREQUENCIAS, PERFIS_QUE_RESPONDEM, TIPOS_PERGUNTA, type QuestionarioVersao, type TipoPergunta } from '../../contracts';
import { versaoVigente } from '../../domain';
import { EditorPergunta } from '../components/editor-pergunta';
import { corpoDoForm, formDaVersao, idsInvalidos, moverPergunta, novaPergunta, removerPergunta, ROTULO_TIPO, type FormRascunho } from '../lib/construtor';
import { useAcoesDoQuestionario, useFusoDoTenant, useQuestionario } from '../lib/queries';

const ROTULO_FREQUENCIA: Record<(typeof FREQUENCIAS)[number], string> = {
  uma_vez_por_cliente: 'Uma vez por cliente',
  a_cada_visita: 'A cada visita',
  semanal: 'Semanal (segunda a domingo)',
  mensal: 'Mensal',
};

const campo = cx(CLASSE_CAMPO, 'disabled:bg-ground');
const novoId = () => crypto.randomUUID();

function idDaUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('id') ?? undefined;
}

export function ConstrutorPage() {
  const [id] = useState(idDaUrl);
  const d = useQuestionario(id);
  const fuso = useFusoDoTenant();
  const podeEditar = usePode('questionario.editar');
  const podePublicar = usePode('questionario.publicar');
  const podeArquivar = usePode('questionario.arquivar');
  const podeResultados = usePode('resultado.ver');
  const acoes = useAcoesDoQuestionario(id ?? '');
  const [form, setForm] = useState<FormRascunho | null>(null);
  const [sujo, setSujo] = useState(false);
  const [confirmaArquivar, setConfirmaArquivar] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger' | 'warning'; texto: string } | null>(null);

  const versoes = d.data?.versoes ?? [];
  const rascunho = versoes.find((v) => v.status === 'rascunho') ?? null;
  const vigente = d.data ? versaoVigente(d.data.questionario, versoes) : null;
  const arquivado = d.data?.questionario.arquivado_em != null;
  const ro = !podeEditar || !rascunho || arquivado;
  const exibida: QuestionarioVersao | null = rascunho ?? vigente ?? versoes[versoes.length - 1] ?? null;

  // recarrega o formulário quando chega outra versão/rascunho do servidor (sem atropelar edição em andamento)
  const chaveVersao = exibida ? `${exibida.id}:${exibida.status}` : '';
  useEffect(() => {
    if (exibida && !sujo) setForm(formDaVersao(exibida, fuso));
  }, [chaveVersao, fuso, d.dataUpdatedAt]);

  const mudar = (patch: Partial<FormRascunho>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSujo(true);
    setAviso(null);
  };

  const problemasPorPergunta = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of d.data?.validacao_rascunho?.erros ?? []) if (e.pergunta_id) m.set(e.pergunta_id, [...(m.get(e.pergunta_id) ?? []), e.mensagem]);
    return m;
  }, [d.data?.validacao_rascunho]);

  if (!id) return <Notice tone="warning">Abra o questionário pela lista de pesquisas.</Notice>;
  if (d.isError) return <ErrorBlock message={errorMessage(d.error)} onRetry={() => void d.refetch()} />;
  if (d.isPending || !form || !exibida) return <LoadingBlock label="Carregando o questionário…" />;

  const invalidos = [...idsInvalidos(form.equipes), ...idsInvalidos(form.clientes)];

  const salvar = async (): Promise<boolean> => {
    try {
      await acoes.salvar.mutateAsync(corpoDoForm(form, fuso));
      setSujo(false);
      setAviso({ tom: 'success', texto: 'Rascunho salvo.' });
      return true;
    } catch (e) {
      setAviso({ tom: 'danger', texto: errorMessage(e) });
      return false;
    }
  };

  const publicar = async () => {
    if (sujo && !(await salvar())) return;
    try {
      const r = await acoes.publicar.mutateAsync();
      setSujo(false);
      setAviso({ tom: r.avisos.length ? 'warning' : 'success', texto: `Versão ${r.versao.numero} publicada.${r.avisos.length ? ` Atenção: ${r.avisos.map((a) => a.mensagem).join(' ')}` : ''}` });
    } catch (e) {
      setAviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };

  const abrirEdicao = async () => {
    try {
      await acoes.salvar.mutateAsync({});
      setSujo(false);
      setAviso({ tom: 'success', texto: `Versão ${Math.max(...versoes.map((v) => v.numero)) + 1} aberta em rascunho.` });
    } catch (e) {
      setAviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };

  const arquivar = async () => {
    setConfirmaArquivar(false);
    try {
      await acoes.arquivar.mutateAsync();
      setAviso({ tom: 'success', texto: 'Questionário arquivado.' });
    } catch (e) {
      setAviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };

  const adicionar = (tipo: TipoPergunta) => mudar({ perguntas: [...form.perguntas, novaPergunta(tipo, novoId)] });

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="construtor.tela">
      <PageHeader
        eyebrow={<a href="/pesquisas" className="text-accent-ink">‹ Pesquisas</a>}
        title={form.titulo || 'Questionário'}
        badge={arquivado ? <Badge tone="neutral">Arquivado</Badge> : rascunho ? <Badge tone="pending">Rascunho v{rascunho.numero}</Badge> : <Badge tone="success">Publicada v{exibida.numero}</Badge>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {podeResultados && vigente ? (
              <a href={`/pesquisa-resultados?id=${id}`} className="inline-flex h-[42px] items-center rounded-xl border border-field px-4 text-[14px] font-semibold text-ink" data-testid="construtor.resultados">
                Resultados
              </a>
            ) : null}
            {podeEditar && !rascunho && !arquivado ? (
              <Button variant="primary" onClick={() => void abrirEdicao()} disabled={acoes.salvar.isPending} data-testid="construtor.editar">
                Editar
              </Button>
            ) : null}
            {podeArquivar && !arquivado ? (
              <MenuAcoes
                rotulo="Mais ações"
                testId="construtor.mais-acoes"
                acoes={[{ id: 'arquivar', rotulo: 'Arquivar', perigo: true, aoEscolher: () => setConfirmaArquivar(true), testId: 'construtor.arquivar' }]}
              />
            ) : null}
          </div>
        }
      />
      <Dialog
        open={confirmaArquivar}
        title="Arquivar este questionário?"
        onClose={() => setConfirmaArquivar(false)}
        footer={
          <>
            <Button onClick={() => setConfirmaArquivar(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void arquivar()} disabled={acoes.arquivar.isPending} data-testid="construtor.arquivar-confirmar">
              Arquivar
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">Some do app.</p>
      </Dialog>

      {aviso ? (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      ) : null}
      {d.data.validacao_rascunho && (d.data.validacao_rascunho.erros.length > 0 || d.data.validacao_rascunho.avisos.length > 0) ? (
        <Panel label="Validação" title="Antes de publicar">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]" data-testid="construtor.validacao">
            {d.data.validacao_rascunho.erros.map((e, i) => (
              <li key={`e${i}`} className="text-danger">
                {e.mensagem}
              </li>
            ))}
            {d.data.validacao_rascunho.avisos.map((a, i) => (
              <li key={`a${i}`} className="text-warning">
                {a.mensagem}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel label="Configuração" title="Configuração">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CampoFormulario rotulo="Título" erro={!ro && !form.titulo.trim() ? 'Informe o título.' : undefined}>
            <input className={campo} disabled={ro} value={form.titulo} maxLength={200} aria-invalid={!ro && !form.titulo.trim() ? true : undefined} onChange={(e) => mudar({ titulo: e.target.value })} data-testid="construtor.titulo" />
          </CampoFormulario>
          <CampoFormulario rotulo="Descrição no app" opcional>
            <input className={campo} disabled={ro} value={form.descricao} maxLength={1000} onChange={(e) => mudar({ descricao: e.target.value })} />
          </CampoFormulario>
          <CampoFormulario rotulo="Modo">
            <select className={campo} disabled={ro} value={form.modo} onChange={(e) => mudar({ modo: e.target.value as FormRascunho['modo'] })} data-testid="construtor.modo">
              <option value="avulsa">Avulsa (aba Pesquisas)</option>
              <option value="checkout_obrigatoria">Obrigatória no checkout da visita</option>
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Frequência">
            <select className={campo} disabled={ro} value={form.frequencia} onChange={(e) => mudar({ frequencia: e.target.value as FormRascunho['frequencia'] })}>
              {FREQUENCIAS.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FREQUENCIA[f]}
                </option>
              ))}
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Vale a partir de" erro={!ro && !form.inicio ? 'Informe a data de início.' : undefined}>
            <input className={campo} disabled={ro} type="date" value={form.inicio} aria-invalid={!ro && !form.inicio ? true : undefined} onChange={(e) => mudar({ inicio: e.target.value })} data-testid="construtor.inicio" />
          </CampoFormulario>
          <CampoFormulario rotulo="Vale até" opcional>
            <input className={campo} disabled={ro} type="date" value={form.fim} min={form.inicio} onChange={(e) => mudar({ fim: e.target.value })} data-testid="construtor.fim" />
          </CampoFormulario>
        </div>
      </Panel>

      <Panel label="Público" title="Público-alvo">
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-wrap gap-4" disabled={ro}>
            <legend className="mb-1 text-[12px] font-semibold text-ink-2">Perfis (nenhum marcado: todos)</legend>
            {PERFIS_QUE_RESPONDEM.map((p) => (
              <label key={p} className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" checked={form.perfis.includes(p)} onChange={(e) => mudar({ perfis: e.target.checked ? [...form.perfis, p] : form.perfis.filter((x) => x !== p) })} />
                {ROTULO_PERFIL[p]}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CampoFormulario rotulo="Segmentos" opcional>
              <input className={campo} disabled={ro} value={form.segmentos} placeholder="Separados por vírgula" onChange={(e) => mudar({ segmentos: e.target.value })} />
            </CampoFormulario>
            <CampoFormulario rotulo="Regiões" opcional>
              <input className={campo} disabled={ro} value={form.regioes} placeholder="Separadas por vírgula" onChange={(e) => mudar({ regioes: e.target.value })} />
            </CampoFormulario>
            <CampoFormulario rotulo="Canais do cliente" opcional>
              <input className={campo} disabled={ro} value={form.canais} onChange={(e) => mudar({ canais: e.target.value })} placeholder="Ex.: Tradicional, Auto Serviço" data-testid="construtor.canais" />
            </CampoFormulario>
            <CampoFormulario rotulo="Equipes" opcional>
              <textarea className={cx(campo, 'h-[76px] py-2')} disabled={ro} value={form.equipes} placeholder="Um id por linha" onChange={(e) => mudar({ equipes: e.target.value })} />
            </CampoFormulario>
            <CampoFormulario rotulo="Clientes específicos" opcional>
              <textarea className={cx(campo, 'h-[76px] py-2')} disabled={ro} value={form.clientes} placeholder="Um id por linha" onChange={(e) => mudar({ clientes: e.target.value })} />
            </CampoFormulario>
          </div>
          {invalidos.length ? <Notice tone="warning">Estes ids não são válidos e ficam de fora: {invalidos.join(', ')}.</Notice> : null}
        </div>
      </Panel>

      <Panel label="Perguntas" title={rotuloComContagem('Perguntas', form.perguntas.length)}>
        <div className="flex flex-col gap-3">
          {form.perguntas.length === 0 ? <EstadoVazio titulo="Nenhuma pergunta ainda." testId="construtor.sem-perguntas" /> : null}
          {form.perguntas.map((p, i) => (
            <EditorPergunta
              key={p.id}
              pergunta={p}
              indice={i}
              perguntas={form.perguntas}
              regras={form.regras}
              somenteLeitura={ro}
              problemas={problemasPorPergunta.get(p.id) ?? []}
              novoId={novoId}
              onChange={(nova, regras) => mudar({ perguntas: form.perguntas.map((x) => (x.id === p.id ? nova : x)), ...(regras ? { regras } : {}) })}
              onRegras={(regras) => mudar({ regras })}
              onMover={(delta) => mudar({ perguntas: moverPergunta(form.perguntas, p.id, delta) })}
              onRemover={() => mudar(removerPergunta(form.perguntas, form.regras, p.id))}
            />
          ))}
          {!ro ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="construtor.adicionar">
              <span className="text-[13px] font-semibold text-ink-2">Adicionar:</span>
              {TIPOS_PERGUNTA.map((t) => (
                <Button key={t} size="sm" onClick={() => adicionar(t)} data-testid={`construtor.adicionar-${t}`}>
                  {ROTULO_TIPO[t]}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel label="Versões" title="Histórico de versões">
        <ul className="flex flex-col gap-1 text-[13px]">
          {[...versoes].reverse().map((v) => (
            <li key={v.id}>
              Versão {v.numero} · {v.status === 'publicada' ? `publicada em ${formatDateTime(v.publicada_em, fuso)}` : 'rascunho'} · {v.perguntas.length} pergunta(s)
              {vigente?.id === v.id ? ' · vigente' : ''}
            </li>
          ))}
        </ul>
      </Panel>

      {!ro || (podePublicar && rascunho && !arquivado) ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-line-2 bg-surface px-1 py-3" data-testid="construtor.barra">
          {sujo ? <span className="mr-auto text-[13px] font-semibold text-warning">Alterações não salvas</span> : null}
          {!ro ? (
            <Button onClick={() => void salvar()} disabled={acoes.salvar.isPending || !form.titulo.trim() || !form.inicio} data-testid="construtor.salvar">
              {acoes.salvar.isPending ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
          ) : null}
          {podePublicar && rascunho && !arquivado ? (
            <Button variant="primary" onClick={() => void publicar()} disabled={acoes.publicar.isPending || acoes.salvar.isPending} data-testid="construtor.publicar">
              Publicar versão {rascunho.numero}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
