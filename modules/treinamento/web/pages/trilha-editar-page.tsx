'use client';

import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { type AcaoDoMenu, Badge, Button, CampoFormulario, CLASSE_CAMPO, CLASSE_CAMPO_BASE, cx, Dialog, ErrorBlock, IconPlus, IconTrash, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, useToast, type BadgeTone } from '@macuxi/ui/web';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { BkoTrilhaDetalhe } from '../../contracts';
import { ROTULO_STATUS } from '../lib/csv';
import {
  adicionarQuestao,
  alterarLicao,
  alterarModulo,
  alterarQuestao,
  alternarQuiz,
  deTrilha,
  editavel,
  errosDoFormulario,
  type ErrosDoFormulario,
  marcarCorreta,
  mover,
  novaAlternativa,
  novaLicao,
  novaTrilha,
  novoModulo,
  paraEdicao,
  PERFIS_DO_PUBLICO,
  remover,
  removerQuestao,
  TIPOS_DE_LICAO,
  type EditorTrilha,
  type LicaoForm,
} from '../lib/editor';
import { useMudarStatus, useSalvarTrilha, useTrilhaBko } from '../lib/queries';
import { hrefEditarTrilha, hrefTrilhas } from '../lib/rotas';

const TOM_STATUS: Record<string, BadgeTone> = { rascunho: 'neutral', publicada: 'success', arquivada: 'warning' };
const gerarId = (): string => crypto.randomUUID();
const AREA_TEXTO = cx(CLASSE_CAMPO_BASE, 'w-full px-3 py-2 aria-[invalid=true]:border-danger');
const SEM_ERROS: ErrosDoFormulario = { campos: {}, outros: [] };

function lerIdDaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('id');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Editor de trilha do BKO (RF-TRE-01; ação `trilha.editar`, analista e admin). Trilha nova (sem `?id=`) ganha o UUID no
 * navegador e é criada com POST (idempotente); a existente salva com PUT. Só rascunho é editável — publicada e arquivada
 * abrem só para leitura (a API também recusa: TRILHA_NAO_EDITAVEL). O que ainda impede publicar vem da API
 * (`problemas_para_publicar`); publicar e arquivar ficam na auditoria (RN-AUD-01).
 */
export function TrilhaEditarPage() {
  const [id, setId] = useState<string | null>(lerIdDaUrl);
  const detalhe = useTrilhaBko(id);
  const salvar = useSalvarTrilha();
  const mudarStatus = useMudarStatus();
  const podePublicar = usePode('trilha.publicar');
  const [estado, setEstado] = useState<EditorTrilha | null>(() => (lerIdDaUrl() ? null : novaTrilha(gerarId)));
  const [base, setBase] = useState<BkoTrilhaDetalhe | null>(null);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<'publicar' | 'arquivar' | null>(null);

  // carrega (ou recarrega depois de salvar/publicar) o que veio da API
  useEffect(() => {
    const d = detalhe.data;
    if (d && (base?.id !== d.id || base.updated_at !== d.updated_at || base.status !== d.status)) {
      setBase(d);
      setEstado(deTrilha(d));
    }
  }, [detalhe.data, base]);

  const somenteLeitura = !editavel(base?.status);
  const alterado = useMemo(() => !base || !estado || JSON.stringify(paraEdicao(estado)) !== JSON.stringify(paraEdicao(deTrilha(base))), [base, estado]);

  if (id && detalhe.isError) {
    return (
      <div className="flex w-full max-w-[1180px] flex-col gap-5">
        <PageHeader title="Trilha" />
        <ErrorBlock message={errorMessage(detalhe.error)} onRetry={() => void detalhe.refetch()} />
        <VoltarParaTrilhas />
      </div>
    );
  }
  if (!estado) return <LoadingBlock label="Carregando a trilha…" />;

  // erros embaixo dos campos só depois da 1ª tentativa de salvar; recalculados a cada mudança (somem ao corrigir)
  const erros = tentouSalvar ? errosDoFormulario(estado) : SEM_ERROS;
  const temErro = Object.keys(erros.campos).length > 0 || erros.outros.length > 0;

  const mudar = (fn: (e: EditorTrilha) => EditorTrilha) => setEstado((e) => (e ? fn(e) : e));

  const aoSalvar = () => {
    setTentouSalvar(true);
    const e = errosDoFormulario(estado);
    if (Object.keys(e.campos).length > 0 || e.outros.length > 0) return;
    salvar.mutate(
      { corpo: paraEdicao(estado), nova: !base },
      {
        onSuccess: (d) => {
          if (!id) {
            window.history.replaceState(window.history.state, '', hrefEditarTrilha(d.id));
            setId(d.id);
          }
          setTentouSalvar(false);
          toast('success', d.problemas_para_publicar.length === 0 ? 'Rascunho salvo. Já pode publicar.' : 'Rascunho salvo.');
        },
      },
    );
  };

  const executar = () => {
    if (!base || !confirmar) return;
    const acao = confirmar;
    setConfirmar(null);
    mudarStatus.mutate({ id: base.id, acao }, { onSuccess: (d) => (acao === 'arquivar' ? toast('success', 'Trilha arquivada.') : d.status === 'publicada' ? toast('success', 'Trilha publicada.') : toast('warning', 'A trilha ainda não pode ser publicada.')) });
  };

  const erro = salvar.error ?? mudarStatus.error;
  const acoesDaPagina: AcaoDoMenu[] =
    podePublicar && base && base.status !== 'arquivada' ? [{ id: 'arquivar', rotulo: 'Arquivar', perigo: true, desligada: mudarStatus.isPending, testId: 'treinamento.arquivar', aoEscolher: () => setConfirmar('arquivar') }] : [];
  const problemasApi = base?.problemas_para_publicar ?? [];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="treinamento.editor">
      <PageHeader
        eyebrow={<VoltarParaTrilhas />}
        title={base ? estado.titulo || 'Trilha sem título' : 'Nova trilha'}
        badge={base ? <Badge tone={TOM_STATUS[base.status] ?? 'neutral'}>{ROTULO_STATUS[base.status] ?? base.status}</Badge> : <Badge tone="neutral">Rascunho (não salvo)</Badge>}
        actions={acoesDaPagina.length > 0 ? <MenuAcoes acoes={acoesDaPagina} rotulo="Mais ações" /> : null}
      />
      {erro && <Notice tone="danger">{errorMessage(erro)}</Notice>}
      {somenteLeitura && <Notice tone="info">{base?.status === 'publicada' ? 'Só leitura. Para mudar o conteúdo, arquive e crie uma nova trilha.' : 'Só leitura.'}</Notice>}
      {erros.outros.length > 0 && (
        <Notice tone="warning">
          Corrija antes de salvar:
          <ul className="mt-1 list-disc pl-5">
            {erros.outros.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      {base?.status === 'rascunho' && problemasApi.length > 0 && (
        <Notice tone="warning">
          Para publicar, falta:
          <ul className="mt-1 list-disc pl-5" data-testid="treinamento.problemas-publicar">
            {problemasApi.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <fieldset disabled={somenteLeitura} className="flex min-w-0 flex-col gap-5">
        <Panel label="Dados da trilha" title="Dados da trilha">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CampoFormulario rotulo="Título" erro={erros.campos['titulo']} className="md:col-span-2">
              <input className={CLASSE_CAMPO} aria-invalid={!!erros.campos['titulo']} value={estado.titulo} maxLength={200} onChange={(e) => mudar((x) => ({ ...x, titulo: e.target.value }))} data-testid="treinamento.titulo" />
            </CampoFormulario>
            <CampoFormulario rotulo="Descrição" opcional erro={erros.campos['descricao']} className="md:col-span-2">
              <textarea className={AREA_TEXTO} aria-invalid={!!erros.campos['descricao']} rows={2} maxLength={2000} value={estado.descricao} onChange={(e) => mudar((x) => ({ ...x, descricao: e.target.value }))} />
            </CampoFormulario>
            <CampoFormulario rotulo="Prazo para concluir" opcional erro={erros.campos['prazo']}>
              <input type="date" className={CLASSE_CAMPO} aria-invalid={!!erros.campos['prazo']} value={estado.prazo} onChange={(e) => mudar((x) => ({ ...x, prazo: e.target.value }))} />
            </CampoFormulario>
            <div className="flex flex-col justify-end gap-2 text-[14px]">
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={estado.obrigatoria} onChange={(e) => mudar((x) => ({ ...x, obrigatoria: e.target.checked }))} />
                Obrigatória
              </label>
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={estado.sequencial} onChange={(e) => mudar((x) => ({ ...x, sequencial: e.target.checked }))} />
                Sequencial (cada lição libera a próxima)
              </label>
            </div>
          </div>
        </Panel>

        <Panel label="Público-alvo" title="Público-alvo">
          <span className="text-[13px] text-ink-2">Sem perfil marcado, a trilha vale para toda a empresa.</span>
          <div className="mt-2 flex flex-wrap gap-4 text-[14px]">
            {PERFIS_DO_PUBLICO.map((p) => (
              <label key={p.id} className="flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={estado.perfis.includes(p.id)}
                  onChange={(e) => mudar((x) => ({ ...x, perfis: e.target.checked ? [...x.perfis, p.id] : x.perfis.filter((v) => v !== p.id) }))}
                  data-testid={`treinamento.perfil-${p.id}`}
                />
                {p.rotulo}
              </label>
            ))}
          </div>
        </Panel>

        {estado.modulos.map((m, mi) => (
          <Panel
            key={m.id}
            label={`Módulo ${mi + 1}`}
            title={`Módulo ${mi + 1}`}
            aside={
              somenteLeitura ? null : (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => mudar((x) => ({ ...x, modulos: mover(x.modulos, mi, -1) }))} disabled={mi === 0} aria-label={`Subir módulo ${mi + 1}`}>
                    ↑
                  </Button>
                  <Button size="sm" onClick={() => mudar((x) => ({ ...x, modulos: mover(x.modulos, mi, 1) }))} disabled={mi === estado.modulos.length - 1} aria-label={`Descer módulo ${mi + 1}`}>
                    ↓
                  </Button>
                  <Button size="sm" onClick={() => mudar((x) => ({ ...x, modulos: remover(x.modulos, mi) }))} aria-label={`Remover módulo ${mi + 1}`}>
                    <IconTrash size={14} />
                  </Button>
                </div>
              )
            }>
            <CampoFormulario rotulo="Título do módulo" erro={erros.campos[`modulos.${mi}.titulo`]}>
              <input className={CLASSE_CAMPO} aria-invalid={!!erros.campos[`modulos.${mi}.titulo`]} value={m.titulo} maxLength={200} onChange={(e) => mudar((x) => alterarModulo(x, mi, (mm) => ({ ...mm, titulo: e.target.value })))} data-testid={`treinamento.modulo-${mi}-titulo`} />
            </CampoFormulario>
            <div className="mt-3 flex flex-col gap-3">
              {m.licoes.map((l, li) => (
                <EditorLicao key={l.id} licao={l} mi={mi} li={li} total={m.licoes.length} somenteLeitura={somenteLeitura} mudar={mudar} erros={erros.campos} />
              ))}
            </div>
            {!somenteLeitura && (
              <Button size="sm" className="mt-3" onClick={() => mudar((x) => alterarModulo(x, mi, (mm) => ({ ...mm, licoes: [...mm.licoes, novaLicao(gerarId)] })))} data-testid={`treinamento.modulo-${mi}-nova-licao`}>
                <IconPlus size={14} /> Lição
              </Button>
            )}
          </Panel>
        ))}
        {!somenteLeitura && (
          <Button onClick={() => mudar((x) => ({ ...x, modulos: [...x.modulos, novoModulo(gerarId)] }))} data-testid="treinamento.novo-modulo" className="self-start">
            <IconPlus size={15} /> Módulo
          </Button>
        )}
      </fieldset>

      {(!somenteLeitura || (podePublicar && base?.status === 'rascunho')) && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface py-3">
          {temErro && <span className="mr-auto text-[13px] text-danger">Corrija os campos marcados.</span>}
          {podePublicar && base?.status === 'rascunho' && (
            <Button onClick={() => setConfirmar('publicar')} disabled={alterado || problemasApi.length > 0 || mudarStatus.isPending} title={alterado ? 'Salve antes de publicar.' : undefined} data-testid="treinamento.publicar">
              Publicar
            </Button>
          )}
          {!somenteLeitura && (
            <Button variant="primary" onClick={aoSalvar} disabled={salvar.isPending || (!!base && !alterado)} data-testid="treinamento.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={confirmar !== null}
        title={confirmar === 'publicar' ? 'Publicar trilha?' : 'Arquivar trilha?'}
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <Button onClick={() => setConfirmar(null)}>Voltar</Button>
            <Button variant={confirmar === 'arquivar' ? 'danger' : 'primary'} onClick={executar} data-testid="treinamento.confirmar">
              {confirmar === 'publicar' ? 'Publicar' : 'Arquivar'}
            </Button>
          </>
        }>
        {confirmar === 'publicar'
          ? 'A trilha vai aparecer no app de quem está no público e deixa de ser editável.'
          : 'A trilha sai do app do público e não volta a ser publicada. O progresso de quem já fez é mantido.'}
      </Dialog>
    </div>
  );
}

function VoltarParaTrilhas() {
  return (
    <Link href={hrefTrilhas('trilhas')} className="text-[13px] font-semibold text-accent-ink no-underline hover:underline">
      ‹ Trilhas
    </Link>
  );
}

function EditorLicao({
  licao: l,
  mi,
  li,
  total,
  somenteLeitura,
  mudar,
  erros,
}: {
  licao: LicaoForm;
  mi: number;
  li: number;
  total: number;
  somenteLeitura: boolean;
  mudar: (fn: (e: EditorTrilha) => EditorTrilha) => void;
  erros: Readonly<Record<string, string>>;
}) {
  const caminho = `modulos.${mi}.licoes.${li}`;
  const alterar = (fn: (x: LicaoForm) => LicaoForm) => mudar((e) => alterarLicao(e, mi, li, fn));
  const prefixo = `treinamento.licao-${mi}-${li}`;
  return (
    <div className="rounded-xl border border-line p-3" data-testid={prefixo}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-ink-2">Lição {li + 1}</span>
        {!somenteLeitura && (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => mudar((e) => alterarModulo(e, mi, (m) => ({ ...m, licoes: mover(m.licoes, li, -1) })))} disabled={li === 0} aria-label={`Subir lição ${li + 1}`}>
              ↑
            </Button>
            <Button size="sm" onClick={() => mudar((e) => alterarModulo(e, mi, (m) => ({ ...m, licoes: mover(m.licoes, li, 1) })))} disabled={li === total - 1} aria-label={`Descer lição ${li + 1}`}>
              ↓
            </Button>
            <Button size="sm" onClick={() => mudar((e) => alterarModulo(e, mi, (m) => ({ ...m, licoes: remover(m.licoes, li) })))} aria-label={`Remover lição ${li + 1}`}>
              <IconTrash size={14} />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_160px]">
        <CampoFormulario rotulo="Título" erro={erros[`${caminho}.titulo`]}>
          <input className={CLASSE_CAMPO} aria-invalid={!!erros[`${caminho}.titulo`]} value={l.titulo} maxLength={200} onChange={(e) => alterar((x) => ({ ...x, titulo: e.target.value }))} data-testid={`${prefixo}-titulo`} />
        </CampoFormulario>
        <CampoFormulario rotulo="Tipo">
          <select className={CLASSE_CAMPO} value={l.tipo} onChange={(e) => alterar((x) => ({ ...x, tipo: e.target.value as LicaoForm['tipo'] }))}>
            {TIPOS_DE_LICAO.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </CampoFormulario>
        <CampoFormulario rotulo="Duração (min)" opcional erro={erros[`${caminho}.duracao_estimada_seg`]}>
          <input className={CLASSE_CAMPO} aria-invalid={!!erros[`${caminho}.duracao_estimada_seg`]} inputMode="decimal" value={l.duracao_min} onChange={(e) => alterar((x) => ({ ...x, duracao_min: e.target.value }))} />
        </CampoFormulario>
      </div>
      {l.tipo !== 'texto' && (
        <CampoFormulario rotulo={l.tipo === 'video' ? 'Endereço do vídeo curto' : l.tipo === 'pdf' ? 'Endereço do PDF' : 'Endereço do link'} erro={erros[`${caminho}.midia_url`]} className="mt-3">
          <input className={CLASSE_CAMPO} aria-invalid={!!erros[`${caminho}.midia_url`]} type="url" placeholder="https://" value={l.midia_url} onChange={(e) => alterar((x) => ({ ...x, midia_url: e.target.value }))} />
        </CampoFormulario>
      )}
      <CampoFormulario rotulo={l.tipo === 'texto' ? 'Texto da lição' : 'Resumo'} opcional={l.tipo !== 'texto'} erro={erros[`${caminho}.texto`]} className="mt-3">
        <textarea className={AREA_TEXTO} aria-invalid={!!erros[`${caminho}.texto`]} rows={l.tipo === 'texto' ? 5 : 2} value={l.texto} onChange={(e) => alterar((x) => ({ ...x, texto: e.target.value }))} data-testid={`${prefixo}-texto`} />
      </CampoFormulario>
      <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="checkbox" className="h-5 w-5" checked={l.quiz !== null} onChange={() => mudar((e) => alternarQuiz(e, mi, li, gerarId))} data-testid={`${prefixo}-quiz`} />
        Quiz no fim da lição
      </label>
      {l.quiz && (
        <div className="mt-2 flex flex-col gap-3 border-l-2 border-accent-soft pl-3">
          {l.quiz.questoes.map((q, qi) => (
            <div key={q.id} className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <CampoFormulario rotulo={`Questão ${qi + 1}`} erro={erros[`${caminho}.quiz.questoes.${qi}.enunciado`]} className="flex-1">
                  <input className={CLASSE_CAMPO} aria-invalid={!!erros[`${caminho}.quiz.questoes.${qi}.enunciado`]} value={q.enunciado} maxLength={1000} onChange={(e) => mudar((x) => alterarQuestao(x, mi, li, qi, (qq) => ({ ...qq, enunciado: e.target.value })))} />
                </CampoFormulario>
                {!somenteLeitura && (
                  <Button size="sm" onClick={() => mudar((x) => removerQuestao(x, mi, li, qi))} aria-label={`Remover questão ${qi + 1}`}>
                    <IconTrash size={14} />
                  </Button>
                )}
              </div>
              {q.alternativas.map((a, ai) => (
                <div key={a.id} className="flex items-center gap-2 pl-3">
                  <label className="flex min-h-[44px] items-center gap-1 text-[12px] font-semibold text-ink-2" title="Marque as corretas (pode mais de uma)">
                    <input type="checkbox" className="h-5 w-5" checked={a.correta} onChange={() => mudar((x) => marcarCorreta(x, mi, li, qi, ai))} aria-label={`Alternativa ${ai + 1} correta`} />
                    correta
                  </label>
                  <input
                    className={CLASSE_CAMPO}
                    aria-invalid={!!erros[`${caminho}.quiz.questoes.${qi}.alternativas.${ai}.texto`]}
                    title={erros[`${caminho}.quiz.questoes.${qi}.alternativas.${ai}.texto`]}
                    value={a.texto}
                    maxLength={500}
                    placeholder={`Alternativa ${ai + 1}`}
                    onChange={(e) => mudar((x) => alterarQuestao(x, mi, li, qi, (qq) => ({ ...qq, alternativas: qq.alternativas.map((aa, k) => (k === ai ? { ...aa, texto: e.target.value } : aa)) })))}
                  />
                  {!somenteLeitura && (
                    <Button size="sm" onClick={() => mudar((x) => alterarQuestao(x, mi, li, qi, (qq) => ({ ...qq, alternativas: remover(qq.alternativas, ai) })))} aria-label={`Remover alternativa ${ai + 1}`}>
                      <IconTrash size={14} />
                    </Button>
                  )}
                </div>
              ))}
              {!somenteLeitura && (
                <Button size="sm" variant="link" className="self-start pl-3" onClick={() => mudar((x) => alterarQuestao(x, mi, li, qi, (qq) => ({ ...qq, alternativas: [...qq.alternativas, novaAlternativa(gerarId)] })))}>
                  + alternativa
                </Button>
              )}
            </div>
          ))}
          {!somenteLeitura && (
            <Button size="sm" className="self-start" onClick={() => mudar((x) => adicionarQuestao(x, mi, li, gerarId))}>
              <IconPlus size={14} /> Questão
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
