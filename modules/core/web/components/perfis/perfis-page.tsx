'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { useMe } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { ROTULO_CARGO } from '../../../contracts/cargos';
import { Moldura } from '../moldura';
import {
  alternarMarcado,
  Badge,
  Button,
  contagemNaoSalva,
  formatDateTimeFull,
  descricaoDaLinha,
  Dialog,
  Drawer,
  ErrorBlock,
  idsDaLinha,
  Interruptor,
  LinhaDePermissao,
  LoadingBlock,
  NOTA_DO_RESUMO,
  MenuAcoes,
  Notice,
  PageHeader,
  Panel,
  ResumoDasMudancas,
  ROTULO_ALVO_TODOS,
  ROTULO_PERFIL_BASE,
  SECOES_DO_PERFIL,
  SELO_PADRAO,
  SeletorDeNivel,
  SeletorDePerfis,
  textoDoPadrao,
  CADEADO,
  td,
  th,
  useToast,
  type SecaoDoPerfil,
  rotuloDoPerfil,
} from '@macuxi/ui/web';
import { CODIGO_REPETIDO, MENSAGEM_NOME_OBRIGATORIO, MENSAGEM_PERFIL_REPETIDO, REGRA_DA_SENHA, PerfilDetalheSchema, UsuarioListaRespostaSchema, PerfilHistoricoRespostaSchema, PerfilListaRespostaSchema, type PerfilDetalhe, type PerfilHistoricoItem, type PerfilResumo } from '../../../contracts';
import {
  ALVO_TODOS_PERFIS,
  corpoDoPerfil,
  edicaoDaFabrica,
  errosPorChave,
  frasesDoHistorico,
  rotuloDoModulo,
  edicaoInicial,
  erroDeAlvos,
  escolherNivel,
  frasesDaRecusa,
  ligadoDaLinha,
  ligarLinha,
  marcarAlvos,
  montarLinhas,
  mudancasDaEdicao,
  mudancasPorSecao,
  nivelDaLinha,
  textoDoValor,
  type Edicao,
  type Identificacao,
  type LinhaDoPerfil,
  type RegistroSobre,
} from '../../lib/perfis';
import { contagemPorPerfil } from '../../lib/acesso';
import { NovoPerfil } from './novo-perfil';
import { PARAM_EDITAR_PERFIL, perfilEmEdicao } from '../../lib/parametros-url';

const CAMPO = 'h-[44px] w-full rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink disabled:bg-ground disabled:text-ink-2';
const SEM_PERMISSAO = 'O seu perfil não gerencia perfis de acesso. Fale com o admin da sua empresa.';
const SEM_CONEXAO = 'Sem conexão. Confira a internet e tente de novo.';

const ehSemPermissao = (e: unknown) => e instanceof ApiRequestError && e.status === 403;
const ehSemConexao = (e: unknown) => e instanceof TypeError || (e instanceof ApiRequestError && e.status === 0);

// ---------------------------------------------------------------- lista

function ListaDePerfis({ emPainel }: { emPainel?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [acao, setAcao] = useState<{ tipo: 'desativar' | 'reativar'; perfil: PerfilResumo } | null>(null);
  const lista = useQuery({ queryKey: ['core', 'perfis'], queryFn: async () => PerfilListaRespostaSchema.parse(await api('/core/perfis')).itens });
  // a contagem sai da MESMA lista da tela Usuários (sem filtro); sem permissão de ver usuários, vale a da API
  const usuariosQ = useQuery({
    queryKey: ['core', 'usuarios', '', '', ''],
    queryFn: async () => UsuarioListaRespostaSchema.parse(await api('/core/usuarios')).itens,
    retry: false,
  });
  const itens = lista.data ?? [];
  const contagem = usuariosQ.data ? contagemPorPerfil(usuariosQ.data) : null;
  const usuariosDe = (p: PerfilResumo): number => (contagem ? (contagem[p.codigo] ?? 0) : p.usuarios);

  const abrir = (codigo: string) => router.push(`${pathname}?${PARAM_EDITAR_PERFIL}=${encodeURIComponent(codigo)}`);

  const mudarSituacao = useMutation({
    mutationFn: async ({ perfil, ativo }: { perfil: PerfilResumo; ativo: boolean }) => {
      const d = PerfilDetalheSchema.parse(await api(`/core/perfis/${perfil.codigo}`));
      return api(`/core/perfis/${perfil.codigo}`, {
        method: 'PUT',
        body: { ...corpoDoPerfil(edicaoInicial(d), { nome: perfil.nome, descricao: perfil.descricao ?? '', ativo }, false) },
      });
    },
    onSuccess: async () => {
      setAcao(null);
      await qc.invalidateQueries({ queryKey: ['core', 'perfis'] });
    },
  });

  if (lista.isPending) return <LoadingBlock label="Carregando perfis…" />;
  if (lista.isError) {
    if (ehSemPermissao(lista.error)) return <Notice tone="info">{SEM_PERMISSAO}</Notice>;
    return <ErrorBlock message={ehSemConexao(lista.error) ? SEM_CONEXAO : errorMessage(lista.error)} onRetry={() => void lista.refetch()} />;
  }

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-4" data-testid="perfis.lista">
      {emPainel ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => router.push(`${pathname}?novo=1`)} data-testid="perfis.novo">
            Novo perfil
          </Button>
        </div>
      ) : (
        <PageHeader
          title="Perfis de acesso"
          actions={
            <Button variant="primary" onClick={() => router.push(`${pathname}?novo=1`)} data-testid="perfis.novo">
              Novo perfil
            </Button>
          }
        />
      )}
      <Moldura sem={emPainel} title="">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Perfil</th>
              <th className={th}>Cargo</th>
              <th className={`${th} text-right`}>Usuários</th>
              <th className={`${th} w-[56px]`}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((p) => (
              <tr key={p.codigo} data-testid={`perfis.linha.${p.codigo}`}>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="min-h-[44px] text-left text-[14px] font-semibold text-ink hover:underline" onClick={() => abrir(p.codigo)}>
                      {rotuloDoPerfil(p.codigo, { nome: p.nome })}
                    </button>
                    {!p.ativo && <Badge tone="neutral">Inativo</Badge>}
                  </div>
                </td>
                <td className={td}>{ROTULO_CARGO[p.cargo]}</td>
                <td className={`${td} text-right`}>
                  {usuariosDe(p) === 0 ? (
                    <span className="text-ink-2">0</span>
                  ) : (
                    <button type="button" className="min-h-[44px] min-w-[44px] font-semibold text-accent-ink hover:underline" onClick={() => router.push(`/usuarios?perfil=${encodeURIComponent(p.codigo)}`)}>
                      {usuariosDe(p)}
                    </button>
                  )}
                </td>
                <td className={`${td} text-right`}>
                  <MenuAcoes
                    rotulo={`Ações de ${p.nome}`}
                    testId={`perfis.menu.${p.codigo}`}
                    acoes={[
                      { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrir(p.codigo), testId: `perfis.editar.${p.codigo}` },
                      ...(!p.fabrica && p.ativo ? [{ id: 'desativar', rotulo: 'Desativar', perigo: true, aoEscolher: () => setAcao({ tipo: 'desativar', perfil: p }), testId: `perfis.desativar.${p.codigo}` }] : []),
                      ...(!p.fabrica && !p.ativo ? [{ id: 'reativar', rotulo: 'Reativar', aoEscolher: () => setAcao({ tipo: 'reativar', perfil: p }), testId: `perfis.reativar.${p.codigo}` }] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Moldura>
      {acao && (
        <Dialog
          open
          title={acao.tipo === 'desativar' ? 'Desativar este perfil?' : 'Reativar este perfil?'}
          onClose={() => setAcao(null)}
          footer={
            acao.tipo === 'desativar' && usuariosDe(acao.perfil) > 0 ? (
              <>
                <Button onClick={() => setAcao(null)}>Fechar</Button>
                <Button variant="primary" onClick={() => router.push(`/usuarios?perfil=${encodeURIComponent(acao.perfil.codigo)}`)}>
                  Ver os usuários
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setAcao(null)}>Cancelar</Button>
                <Button
                  variant={acao.tipo === 'desativar' ? 'danger' : 'primary'}
                  disabled={mudarSituacao.isPending}
                  onClick={() => mudarSituacao.mutate({ perfil: acao.perfil, ativo: acao.tipo === 'reativar' })}
                >
                  {acao.tipo === 'desativar' ? 'Desativar' : 'Reativar'}
                </Button>
              </>
            )
          }
        >
          <p className="m-0 text-[14px]">
            {acao.tipo === 'reativar'
              ? `${acao.perfil.nome} volta a aparecer no cadastro de usuários.`
              : usuariosDe(acao.perfil) > 0
                ? `${acao.perfil.nome} tem ${usuariosDe(acao.perfil)} ${usuariosDe(acao.perfil) === 1 ? 'usuário' : 'usuários'}. Troque o perfil deles em Usuários antes de desativar.`
                : `${acao.perfil.nome} deixa de aparecer no cadastro de usuários. Dá para reativar depois.`}
          </p>
          {mudarSituacao.isError && <Notice tone="danger">{ehSemConexao(mudarSituacao.error) ? SEM_CONEXAO : errorMessage(mudarSituacao.error)}</Notice>}
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- edição

function EdicaoDoPerfil({ codigo }: { codigo: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['core', 'perfis', codigo], queryFn: async () => PerfilDetalheSchema.parse(await api(`/core/perfis/${codigo}`)) });
  const d = q.data;
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [ident, setIdent] = useState<Identificacao | null>(null);
  const [resumo, setResumo] = useState(false);
  const [recusa, setRecusa] = useState<string[] | null>(null);
  const [errosDeChave, setErrosDeChave] = useState<Record<string, string>>({});
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [ativa, setAtiva] = useState<string>('identificacao');
  const [sair, setSair] = useState<'voltar' | 'descartar' | null>(null);
  const [restaurar, setRestaurar] = useState(false);
  const [historico, setHistorico] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const [sem403, setSem403] = useState(false);

  const identDe = (x: NonNullable<typeof d>): Identificacao => ({ nome: x.perfil.nome, descricao: x.perfil.descricao ?? '', ativo: x.perfil.ativo });
  // o estado de edição nasce do servidor e é refeito depois de salvar
  useEffect(() => {
    if (d) {
      setEdicao(edicaoInicial(d));
      setIdent(identDe(d));
    }
  }, [d]);

  const { linhas, outras } = useMemo(() => (d ? montarLinhas(d) : { linhas: [], outras: [] }), [d]);
  const rotulos = useMemo(() => Object.fromEntries((d?.alvos_possiveis ?? []).map((p) => [p.codigo, rotuloDoPerfil(p.codigo, { nome: p.nome })])), [d]);
  const inicial = useMemo(() => (d ? edicaoInicial(d) : {}), [d]);
  const fabrica = useMemo(() => (d ? edicaoDaFabrica(d) : {}), [d]);
  const identInicial = d ? identDe(d) : null;
  const todasOutras = outras.flatMap((g) => g.linhas);
  const mudancas =
    d && edicao && ident && identInicial ? mudancasDaEdicao({ linhas, outras: todasOutras, inicial, atual: edicao, identInicial, identAtual: ident, rotulosDosPerfis: rotulos }) : [];
  const porSecao = mudancasPorSecao(mudancas);
  const sujo = mudancas.length > 0;

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!d || !edicao || !ident) throw new Error('sem estado');
      return PerfilDetalheSchema.parse(await api(`/core/perfis/${codigo}`, { method: 'PUT', body: corpoDoPerfil(edicao, ident, d.perfil.fabrica) }));
    },
    onSuccess: async (novo) => {
      qc.setQueryData(['core', 'perfis', codigo], novo);
      setEdicao(edicaoInicial(novo));
      setIdent(identDe(novo));
      setResumo(false);
      setRecusa(null);
      setErrosDeChave({});
      setErroNome(null);
      toast('success', 'Perfil salvo. Vale na próxima ação de quem o usa.');
      await qc.invalidateQueries({ queryKey: ['core', 'perfis'], exact: true });
    },
    onError: (e) => {
      if (ehSemPermissao(e)) {
        setResumo(false);
        setSem403(true);
      } else if (e instanceof ApiRequestError && e.code === CODIGO_REPETIDO) {
        setResumo(false);
        setErroNome(MENSAGEM_PERFIL_REPETIDO);
        setRecusa(null);
        window.setTimeout(() => document.getElementById('perfil-nome')?.focus(), 0);
      } else if (e instanceof ApiRequestError && e.status === 422) {
        setRecusa(frasesDaRecusa(e.details, e.message));
        setErrosDeChave(errosPorChave(e.details));
      }
      else setRecusa([ehSemConexao(e) ? 'Sem conexão. Suas mudanças continuam na tela. Tente de novo.' : 'Não foi possível salvar agora. Suas mudanças continuam na tela. Tente de novo.']);
    },
  });

  const voltar = () => router.push(pathname);
  // índice: a seção que está na tela vira a atual (aria-current)
  const carregado = !!d;
  useEffect(() => {
    if (!carregado || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entradas) => {
        const visivel = entradas.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visivel) setAtiva(visivel.target.id.replace('secao-', ''));
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    document.querySelectorAll('[id^="secao-"]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [carregado]);
  if (sem403 || (q.isError && ehSemPermissao(q.error))) return <Notice tone="info">{SEM_PERMISSAO}</Notice>;
  if (q.isPending || !d || !edicao || !ident) {
    if (!q.isError) return <LoadingBlock label="Carregando o perfil…" />;
    const nao = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="min-h-[44px] self-start text-accent-ink hover:underline" onClick={voltar}>
          ‹ Perfis de acesso
        </button>
        <ErrorBlock message={ehSemConexao(q.error) ? SEM_CONEXAO : nao ? 'Este perfil não existe mais.' : ''} onRetry={nao ? undefined : () => void q.refetch()} />
      </div>
    );
  }

  const fab = d.perfil.fabrica;
  const escopoLinha = linhas.find((l) => l.id === 'dados-escopo');
  const base = d.perfil.base;
  const alteraLinha = (fn: (e: Edicao) => Edicao) => {
    setErrosDeChave({});
    setEdicao((e) => fn(e ?? {}));
  };
  const erroDaLinha = (l: LinhaDoPerfil) => erroDeAlvos(l, edicao) ?? l.chaves.map((c) => errosDeChave[c]).find((m) => !!m) ?? null;
  const algumErro = linhas.some((l) => erroDeAlvos(l, edicao));
  const nomeVazio = !fab && ident.nome.trim() === '';
  const erroDoNome = nomeVazio ? MENSAGEM_NOME_OBRIGATORIO : erroNome;
  const irParaPrimeiroErro = () => {
    setResumo(false);
    const primeira = [...linhas, ...todasOutras].find((l) => erroDaLinha(l));
    if (!primeira) return;
    if (primeira.secao === 'outras') setMaisAberto(true);
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="permissao.${primeira.id}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.querySelector<HTMLElement>('button, input, [role="switch"], [tabindex]')?.focus();
    }, 0);
  };
  const secoesVisiveis = SECOES_DO_PERFIL.filter((s) => s.id === 'identificacao' || s.id === 'modulos' || (s.id === 'outras' ? outras.length > 0 : linhas.some((l) => l.secao === s.id)));

  const renderLinha = (l: LinhaDoPerfil): ReactNode => {
    const ids = idsDaLinha(`permissao-${l.id}`);
    const travada = !!l.trava;
    const padrao = textoDoValor(l, fabrica, rotulos);
    const atual = textoDoValor(l, edicao, rotulos);
    const desc = descricaoDaLinha(`permissao-${l.id}`, { ajuda: !!l.ajuda, travada });
    let controle: ReactNode;
    let abaixo: ReactNode = null;
    if (l.tipo === 'nivel') {
      controle = (
        <SeletorDeNivel
          nome={`nivel-${l.id}`}
          opcoes={[...(l.opcoes ?? [])]}
          valor={nivelDaLinha(l, edicao)}
          onChange={(n) => alteraLinha((e) => escolherNivel(l, e, n))}
          rotuloId={ids.rotulo}
          descricaoId={desc}
        />
      );
    } else {
      const lig = ligadoDaLinha(l, edicao);
      controle = (
        <Interruptor ligado={lig !== 'nao'} misto={lig === 'misto'} desabilitado={travada} onChange={(v) => alteraLinha((e) => ligarLinha(l, e, v))} rotuloId={ids.rotulo} descricaoId={desc} />
      );
      if (l.tipo === 'alvos' && lig !== 'nao') {
        const opcoes = d.alvos_possiveis.map((p) => ({
          valor: p.codigo,
          rotulo: rotuloDoPerfil(p.codigo, { nome: p.nome }),
          detalhe: p.fabrica ? undefined : `Base: ${ROTULO_PERFIL_BASE[p.base]}`,
          selo: p.fabrica ? SELO_PADRAO : undefined,
          desabilitada: p.base === 'admin',
          motivo: p.base === 'admin' ? CADEADO.senhaDeAdmin : undefined,
        }));
        const marcados = edicao[l.chaves[0]!]?.alvos ?? [];
        abaixo = (
          <SeletorDePerfis
            nome={`alvos-${l.id}`}
            legenda="De quais perfis"
            opcoes={opcoes}
            marcados={marcados}
            todos={{ rotulo: ROTULO_ALVO_TODOS }}
            onChange={(valor) => alteraLinha((e) => marcarAlvos(l, e, alternarMarcado(marcados, valor, [ALVO_TODOS_PERFIS, ...opcoes.map((o) => o.valor)])))}
            erro={erroDaLinha(l)}
          />
        );
      }
    }
    return (
      <LinhaDePermissao key={l.id} id={`permissao-${l.id}`} rotulo={l.rotulo} ajuda={l.ajuda} padrao={atual !== padrao ? textoDoPadrao(padrao) : undefined} trava={l.trava ? { mensagem: l.trava } : null} erro={erroDaLinha(l)} abaixo={abaixo} testId={`permissao.${l.id}`}>
        {controle}
      </LinhaDePermissao>
    );
  };

  const secao = (id: SecaoDoPerfil, titulo: string, corpo: ReactNode) => (
    <Panel key={id} title={titulo} label={titulo}>
      <div data-testid={`perfil.secao.${id}`} id={`secao-${id}`} className="flex flex-col gap-3">
        {corpo}
      </div>
    </Panel>
  );

  const restaurarPadrao = () => {
    setEdicao(edicaoDaFabrica(d));
    setRestaurar(false);
  };
  const temDiferencaDoPadrao = d.chaves.some((c) => JSON.stringify(c.atual) !== JSON.stringify(c.fabrica));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          <button type="button" className="text-accent-ink hover:underline" onClick={() => (sujo ? setSair('voltar') : voltar())}>
            ‹ Perfis de acesso
          </button>
        }
        title={d.perfil.nome}
        badge={d.perfil.ativo ? undefined : <Badge tone="neutral">Inativo</Badge>}
                actions={
          <>
            <Button size="sm" onClick={() => setHistorico(true)} data-testid="perfil.historico">
              Histórico
            </Button>
            {temDiferencaDoPadrao && (
              <Button size="sm" onClick={() => setRestaurar(true)} data-testid="perfil.restaurar">
                Restaurar o padrão
              </Button>
            )}
          </>
        }
      />
      {!d.perfil.ativo && (
        <Notice tone="info">Este perfil está inativo: não aparece no cadastro de usuários. Ligue &quot;Ativo&quot; em Identificação para usar de novo.</Notice>
      )}
      <div className="flex gap-6">
        <nav aria-label="Seções do perfil" className="sticky top-4 hidden h-fit w-[200px] shrink-0 flex-col gap-1 lg:flex" data-testid="perfil.indice">
          {secoesVisiveis.map((s) => (
            <a key={s.id} href={`#secao-${s.id}`} aria-current={ativa === s.id ? 'true' : undefined} className={`flex min-h-[36px] items-center justify-between rounded-lg px-2 py-2 text-[13px] text-ink hover:bg-ground ${ativa === s.id ? 'bg-ground font-bold' : ''}`}>
              {s.titulo}
              {porSecao[s.id] ? <Badge tone="pending">{porSecao[s.id]}</Badge> : null}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4 pb-24">
          {secao(
            'identificacao',
            'Identificação',
            <>
              <LinhaDePermissao id="ident-nome" rotulo="Nome" erro={erroDoNome}>
                {fab ? <span className="text-[14px]">{ident.nome}</span> : <input id="perfil-nome" className={CAMPO} value={ident.nome} maxLength={40} onChange={(e) => { setErroNome(null); setIdent({ ...ident, nome: e.target.value }); }} aria-label="Nome" aria-invalid={!!erroDoNome} />}
              </LinhaDePermissao>
              <LinhaDePermissao id="ident-base" rotulo="Perfil base" trava={{ mensagem: CADEADO.baseImutavel }}>
                <span className="text-[14px]">{ROTULO_PERFIL_BASE[base]}</span>
              </LinhaDePermissao>
              <LinhaDePermissao id="ident-descricao" rotulo="Descrição">
                <textarea className="min-h-[64px] w-full rounded-xl border border-field bg-surface px-3 py-2 text-[14px] text-ink" rows={2} maxLength={200} value={ident.descricao} onChange={(e) => setIdent({ ...ident, descricao: e.target.value })} aria-label="Descrição" />
              </LinhaDePermissao>
              <LinhaDePermissao
                id="ident-ativo"
                rotulo="Ativo"
                trava={fab ? { mensagem: CADEADO.padraoNaoDesativa } : null}
                ajuda={!fab && d.perfil.usuarios > 0 ? `Tem ${d.perfil.usuarios} ${d.perfil.usuarios === 1 ? 'usuário' : 'usuários'}. Troque o perfil deles em Usuários antes de desativar.` : undefined}
              >
                <Interruptor ligado={ident.ativo} desabilitado={fab || (d.perfil.usuarios > 0 && ident.ativo)} onChange={(v) => setIdent({ ...ident, ativo: v })} rotulo="Ativo" />
              </LinhaDePermissao>
            </>,
          )}
          {SECOES_DO_PERFIL.filter((s) => !['identificacao', 'outras'].includes(s.id) && (s.id === 'modulos' || linhas.some((l) => l.secao === s.id))).map((s) =>
            s.id === 'modulos'
              ? secao(
                  'modulos',
                  'Módulos',
                  <>
                    <p className="m-0 text-[13px] text-ink-2">Os módulos que quem tem este perfil usa. Só aparecem os contratados pela empresa. Para ligar ou desligar, use Usuários e módulos.</p>
                    <div className="flex flex-wrap gap-2" data-testid="perfil.modulos">
                      {d.modulos.length === 0 && <span className="text-[13px] text-ink-2">Nenhum</span>}
                      {d.modulos.map((m) => (
                        <span key={m} className="flex items-center gap-1">
                          <Badge tone="neutral">{rotuloDoModulo(m)}</Badge>
                          {m === 'core' && <span title={CADEADO.coreSempreLigado} aria-label={CADEADO.coreSempreLigado} role="img" data-testid="perfil.modulos.core.cadeado">🔒</span>}
                        </span>
                      ))}
                    </div>
                  </>,
                )
              : secao(
                  s.id,
                  s.titulo,
                  <>
                    {linhas.filter((l) => l.secao === s.id).map(renderLinha)}
                    {s.id === 'clientes' && (
                      <LinhaDePermissao id="cliente-ver-360" rotulo="Ver o Cliente 360" testId="permissao.cliente-ver-360">
                        <span className="flex flex-wrap items-center gap-2 text-[13px]">
                          {escopoLinha ? textoDoValor(escopoLinha, edicao, rotulos) : 'Conforme o escopo de dados'}
                          <a href="#secao-escopo" className="font-semibold text-accent-ink hover:underline">
                            Mudar em Escopo de dados
                          </a>
                        </span>
                      </LinhaDePermissao>
                    )}
                    {s.id === 'usuarios' && (
                      <LinhaDePermissao id="senha-regra" rotulo="Regra da senha" trava={{ mensagem: CADEADO.senhaSempreComRegra }}>
                        <span className="text-[13px]">{REGRA_DA_SENHA}</span>
                      </LinhaDePermissao>
                    )}
                  </>,
                ),
          )}
          {outras.length > 0 &&
            secao(
              'outras',
              'Outras permissões',
              <>
                <button type="button" className="min-h-[44px] self-start text-[13px] font-semibold text-accent-ink hover:underline" aria-expanded={maisAberto} onClick={() => setMaisAberto(!maisAberto)} data-testid="perfil.outras">
                  {maisAberto ? 'Menos permissões' : `Mais permissões (${todasOutras.length})`}
                </button>
                {maisAberto &&
                  outras.map((g) => (
                    <div key={g.area} className="flex flex-col gap-3">
                      <h3 className="m-0 text-[13px] font-bold text-ink-2">{g.titulo}</h3>
                      {g.linhas.map(renderLinha)}
                    </div>
                  ))}
              </>,
            )}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 md:left-[220px] z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <span className="text-[13px] font-semibold" role="status" aria-live="polite" data-testid="perfil.contagem">
          {contagemNaoSalva(mudancas.length)}
        </span>
        <span className="flex gap-2">
          <Button disabled={!sujo} onClick={() => setSair('descartar')} data-testid="perfil.descartar">
            Descartar
          </Button>
          <Button variant="primary" disabled={!sujo || algumErro || nomeVazio} onClick={() => { setRecusa(null); setResumo(true); }} data-testid="perfil.salvar">
            Salvar
          </Button>
        </span>
      </div>

      {resumo && (
        <Dialog
          open
          title="Confira antes de salvar"
          onClose={() => !salvar.isPending && setResumo(false)}
          footer={
            <>
              <Button disabled={salvar.isPending} onClick={irParaPrimeiroErro} data-testid="perfil.resumo.voltar">
                Voltar e ajustar
              </Button>
              <Button variant="primary" disabled={salvar.isPending} onClick={() => salvar.mutate()} data-testid="perfil.resumo.salvar">
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3" data-testid="perfil.resumo">
            {recusa && (
              <Notice tone="danger">
                <span data-testid="perfil.resumo.erro">{recusa.join(' ')}</span>
              </Notice>
            )}
            <ResumoDasMudancas mudancas={mudancas} afetados={d.perfil.usuarios} />
            <p className="m-0 text-[12px] text-ink-2">{NOTA_DO_RESUMO}</p>
          </div>
        </Dialog>
      )}
      {sair && (
        <Dialog
          open
          title={sair === 'voltar' ? 'Sair sem salvar?' : 'Descartar as mudanças?'}
          onClose={() => setSair(null)}
          footer={
            <>
              <Button onClick={() => setSair(null)}>Continuar editando</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (sair === 'voltar') voltar();
                  else { setEdicao(inicial); setIdent(identInicial); }
                  setSair(null);
                }}
              >
                {sair === 'voltar' ? 'Sair sem salvar' : 'Descartar'}
              </Button>
            </>
          }
        >
          <p className="m-0 text-[14px]">{mudancas.length === 1 ? 'A mudança não salva se perde.' : `As ${mudancas.length} mudanças não salvas se perdem.`}</p>
        </Dialog>
      )}
      {restaurar && (
        <Dialog
          open
          title="Voltar ao padrão?"
          onClose={() => setRestaurar(false)}
          footer={
            <>
              <Button onClick={() => setRestaurar(false)}>Cancelar</Button>
              <Button variant="primary" onClick={restaurarPadrao}>
                Voltar ao padrão
              </Button>
            </>
          }
        >
          <p className="m-0 text-[14px]">
            {fab ? `As permissões de ${d.perfil.nome} voltam a ser as que vêm prontas. Confira e salve para valer.` : `As permissões voltam a ser as do perfil base ${ROTULO_PERFIL_BASE[base]}. Confira e salve para valer.`}
          </p>
        </Dialog>
      )}
      {historico && <HistoricoDoPerfil codigo={codigo} nome={d.perfil.nome} detalhe={d} onClose={() => setHistorico(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- histórico

function HistoricoDoPerfil({ codigo, nome, detalhe, onClose }: { codigo: string; nome: string; detalhe: PerfilDetalhe; onClose: () => void }) {
  const fuso = useMe().data.tenant.timezone;
  const [antes, setAntes] = useState<string | null>(null);
  const [itens, setItens] = useState<PerfilHistoricoItem[]>([]);
  const q = useQuery({
    queryKey: ['core', 'perfis', codigo, 'historico', antes],
    queryFn: async () => PerfilHistoricoRespostaSchema.parse(await api(`/core/perfis/${codigo}/historico${antes ? `?antes=${encodeURIComponent(antes)}` : ''}`)),
  });
  useEffect(() => {
    if (q.data) setItens((atual) => (antes ? [...atual, ...q.data.itens.filter((i) => !atual.some((a) => a.id === i.id))] : q.data.itens));
  }, [q.data, antes]);
  const { linhas, outras } = useMemo(() => montarLinhas(detalhe), [detalhe]);
  const rotulos = useMemo(() => Object.fromEntries(detalhe.alvos_possiveis.map((p) => [p.codigo, rotuloDoPerfil(p.codigo, { nome: p.nome })])), [detalhe]);
  const fabrica = useMemo(() => edicaoDaFabrica(detalhe), [detalhe]);
  return (
    <Drawer open title={`Histórico de ${nome}`} onClose={onClose}>
      {q.isPending && itens.length === 0 ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : itens.length === 0 ? (
        <p className="text-[13px] text-ink-2">Nada mudou neste perfil desde que foi criado.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {itens.map((i) => {
            const a = i.antes as { sobreposicoes?: RegistroSobre[]; ativo?: boolean } | null;
            const dpo = i.depois as { sobreposicoes?: RegistroSobre[]; ativo?: boolean; base?: string } | null;
            const frases = frasesDoHistorico({ antes: a?.sobreposicoes ?? [], depois: dpo?.sobreposicoes ?? [], linhas: [...linhas, ...outras.flatMap((g) => g.linhas)], fabrica, rotulos });
            return (
              <div key={i.id} className="flex flex-col gap-1 border-b border-line pb-3">
                <strong className="text-[13px]">
                  {formatDateTimeFull(i.em, fuso)} · {i.usuario_nome ?? 'Sistema'}
                </strong>
                {i.acao === 'perfil.criar' && <span className="text-[13px]">Perfil criado a partir de {dpo?.base ? ROTULO_PERFIL_BASE[dpo.base as keyof typeof ROTULO_PERFIL_BASE] : 'um perfil base'}.</span>}
                {a && dpo && a.ativo !== undefined && dpo.ativo !== undefined && a.ativo !== dpo.ativo && <span className="text-[13px]">{dpo.ativo ? 'Perfil reativado.' : 'Perfil desativado.'}</span>}
                {frases.map((t) => (
                  <span key={t} className="text-[13px]">
                    {t}
                  </span>
                ))}
              </div>
            );
          })}
          {q.data?.proximo && (
            <Button onClick={() => setAntes(q.data.proximo)} disabled={q.isFetching}>
              Mostrar mais
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- página

function PerfisConteudo({ emPainel }: { emPainel?: boolean }) {
  const params = useSearchParams();
  const podeGerir = usePode('perfil.gerir');
  const codigo = perfilEmEdicao(params);
  if (!podeGerir) return <Notice tone="info">{SEM_PERMISSAO}</Notice>;
  if (params.get('novo')) return <NovoPerfil />;
  return codigo ? <EdicaoDoPerfil key={codigo} codigo={codigo} /> : <ListaDePerfis emPainel={emPainel} />;
}

export function PerfisPage({ emPainel }: { emPainel?: boolean }) {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando perfis…" />}>
      <PerfisConteudo emPainel={emPainel} />
    </Suspense>
  );
}

