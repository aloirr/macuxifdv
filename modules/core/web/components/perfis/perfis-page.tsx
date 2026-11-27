'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { ROTULO_CARGO } from '../../../contracts/cargos';
import {
  alternarMarcado,
  Badge,
  Button,
  contagemNaoSalva,
  Dialog,
  Drawer,
  ErrorBlock,
  filtrarGruposPorBusca,
  formatDateTimeFull,
  LoadingBlock,
  MenuAcoes,
  Notice,
  ROTULO_ALVO_TODOS,
  resumoDosAlvos,
  rotuloDoPerfil,
  SeletorDePerfis,
  SeletorEscopo,
  TabelaPermissoes,
  td,
  tdNum,
  th,
  thNum,
  useToast,
  type GrupoDaTabela,
} from '@macuxi/ui/web';
import {
  CatalogoRespostaSchema,
  CODIGO_REPETIDO,
  CODIGOS_ERRO_PERFIL_V2,
  MENSAGEM_NOME_OBRIGATORIO,
  MENSAGEM_PERFIL_REPETIDO,
  PerfilDetalheV2Schema,
  PerfilHistoricoRespostaV2Schema,
  UsuarioListaRespostaSchema,
  type PerfilDetalheV2,
  type PerfilHistoricoItemV2,
  type PerfilResumoV2,
} from '../../../contracts';
import { ALVO_TODOS_PERFIS, frasesDaRecusa } from '../../lib/perfis';
import {
  alternarLinha,
  aplicarMarcacoes,
  AVISO_AUTOGESTAO,
  contarMudancas,
  copiarDoPerfil,
  corpoDoPut,
  edicaoDoDetalhe,
  ehNaoMigrado,
  erroDeAlvos,
  escolherNivel,
  frasesDoHistorico,
  marcarAlvos,
  MENSAGEM_NAO_MIGRADO,
  montarGrupos,
  type EdicaoTabela,
  type Identificacao,
  type LinhaModelo,
  type OrigemDaCopia,
} from '../../lib/perfis-tabela';
import { contagemPorPerfil, rotuloDaPermissao } from '../../lib/acesso';
import { NovoPerfil } from './novo-perfil';
import { PARAM_EDITAR_PERFIL, perfilEmEdicao } from '../../lib/parametros-url';
import { BotaoVoltar, CabecalhoDoPerfil, CAMPO, IdentificacaoDoPerfil } from './cabecalho-perfil';
import { useMe, useModelosDePerfil, usePerfisV2 } from '../../lib/queries';

const SEM_PERMISSAO = 'O seu perfil não gerencia perfis de acesso. Fale com o admin da sua empresa.';
const SEM_CONEXAO = 'Sem conexão. Confira a internet e tente de novo.';
const ABERTOS_AO_ENTRAR = ['acesso', 'dados'];

const ehSemPermissao = (e: unknown) => e instanceof ApiRequestError && e.status === 403;
const ehSemConexao = (e: unknown) => e instanceof TypeError || (e instanceof ApiRequestError && e.status === 0);

// ---------------------------------------------------------------- lista

function ListaDePerfis() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [acao, setAcao] = useState<{ tipo: 'desativar' | 'reativar'; perfil: PerfilResumoV2 } | null>(null);
  const lista = usePerfisV2();
  // a contagem sai da MESMA lista da tela Usuários (sem filtro); sem permissão de ver usuários, vale a da API
  const usuariosQ = useQuery({
    queryKey: ['core', 'usuarios', '', '', ''],
    queryFn: async () => UsuarioListaRespostaSchema.parse(await api('/core/usuarios')).itens,
    retry: false,
  });
  const itens = lista.data ?? [];
  const contagem = usuariosQ.data ? contagemPorPerfil(usuariosQ.data) : null;
  const usuariosDe = (p: PerfilResumoV2): number => (contagem ? (contagem[p.codigo] ?? 0) : p.usuarios);

  const abrir = (codigo: string) => router.push(`${pathname}?${PARAM_EDITAR_PERFIL}=${encodeURIComponent(codigo)}`);

  const mudarSituacao = useMutation({
    mutationFn: async ({ perfil, ativo }: { perfil: PerfilResumoV2; ativo: boolean }) => {
      const d = PerfilDetalheV2Schema.parse(await api(`/core/perfis/${perfil.codigo}`));
      return api(`/core/perfis/${perfil.codigo}`, {
        method: 'PUT',
        body: corpoDoPut(d, edicaoDoDetalhe(d), { nome: perfil.nome, descricao: perfil.descricao ?? '', cargo: perfil.cargo }, ativo),
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

  const botaoNovo = (
    <Button variant="primary" onClick={() => router.push(`${pathname}?novo=1`)} data-testid="perfis.novo">
      Novo perfil
    </Button>
  );
  return (
    <div className="flex w-full flex-col gap-4" data-testid="perfis.lista">
      <div className="flex justify-end">{botaoNovo}</div>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Perfil</th>
              <th className={th}>Cargo</th>
              <th className={thNum}>Usuários</th>
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
                    <button type="button" className="min-h-[44px] text-left text-[15px] font-semibold text-ink hover:underline" onClick={() => abrir(p.codigo)}>
                      {rotuloDoPerfil(p.codigo, { nome: p.nome })}
                    </button>
                    {!p.ativo && <Badge tone="neutral">Inativo</Badge>}
                  </div>
                </td>
                <td className={td}>{ROTULO_CARGO[p.cargo]}</td>
                <td className={tdNum}>
                  {usuariosDe(p) === 0 ? (
                    <span className="tabular-nums text-ink-2">0</span>
                  ) : (
                    <button type="button" className="min-h-[44px] min-w-[44px] text-right font-semibold tabular-nums text-accent-ink hover:underline" onClick={() => router.push(`/usuarios?perfil=${encodeURIComponent(p.codigo)}`)}>
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
                      ...(p.ativo ? [{ id: 'desativar', rotulo: 'Desativar', perigo: true, aoEscolher: () => setAcao({ tipo: 'desativar', perfil: p }), testId: `perfis.desativar.${p.codigo}` }] : []),
                      ...(!p.ativo ? [{ id: 'reativar', rotulo: 'Reativar', aoEscolher: () => setAcao({ tipo: 'reativar', perfil: p }), testId: `perfis.reativar.${p.codigo}` }] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <p className="m-0 text-[15px]">
            {acao.tipo === 'reativar'
              ? `${acao.perfil.nome} volta a aparecer no cadastro de usuários.`
              : usuariosDe(acao.perfil) > 0
                ? `${acao.perfil.nome} tem ${usuariosDe(acao.perfil)} ${usuariosDe(acao.perfil) === 1 ? 'usuário' : 'usuários'}. Troque o perfil deles em Usuários antes de desativar.`
                : `${acao.perfil.nome} deixa de aparecer no cadastro de usuários. Dá para reativar depois.`}
          </p>
          {mudarSituacao.isError && <Notice tone="danger">{ehSemConexao(mudarSituacao.error) ? SEM_CONEXAO : ehNaoMigrado(mudarSituacao.error) ? MENSAGEM_NAO_MIGRADO : errorMessage(mudarSituacao.error)}</Notice>}
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
  const q = useQuery({ queryKey: ['core', 'perfis', codigo], queryFn: async () => PerfilDetalheV2Schema.parse(await api(`/core/perfis/${codigo}`)) });
  const cat = useQuery({ queryKey: ['core', 'permissoes', 'catalogo'], queryFn: async () => CatalogoRespostaSchema.parse(await api('/core/permissoes/catalogo')) });
  const lista = usePerfisV2();
  const d = q.data;
  const [edicao, setEdicao] = useState<EdicaoTabela | null>(null);
  const [ident, setIdent] = useState<Identificacao | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set(ABERTOS_AO_ENTRAR));
  const [busca, setBusca] = useState('');
  const [recusa, setRecusa] = useState<string[] | null>(null);
  const [conflito, setConflito] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [sair, setSair] = useState(false);
  const [copiar, setCopiar] = useState(false);
  const [historico, setHistorico] = useState(false);
  const [alvosDe, setAlvosDe] = useState<string | null>(null);
  const [sem403, setSem403] = useState(false);

  const identDe = (x: PerfilDetalheV2): Identificacao => ({ nome: x.perfil.nome, descricao: x.perfil.descricao ?? '', cargo: x.perfil.cargo });
  // o rascunho nasce do servidor e é refeito depois de salvar
  useEffect(() => {
    if (d) {
      setEdicao(edicaoDoDetalhe(d));
      setIdent(identDe(d));
    }
  }, [d]);

  const autogestao = !!d?.perfil.autogestao;
  const grupos = useMemo(
    () => (d && cat.data && edicao ? montarGrupos({ catalogo: cat.data, detalhe: d, edicao, rotuloDoCargo: ROTULO_CARGO[d.perfil.cargo] }) : []),
    [d, cat.data, edicao],
  );
  const rotulos = useMemo(() => Object.fromEntries((d?.alvos_possiveis ?? []).map((p) => [p.codigo, rotuloDoPerfil(p.codigo, { nome: p.nome })])), [d]);
  const inicial = useMemo(() => (d ? edicaoDoDetalhe(d) : {}), [d]);
  const identInicial = d ? identDe(d) : null;
  const mudancas = d && edicao && ident && identInicial ? contarMudancas(inicial, edicao, identInicial, ident) : 0;
  const sujo = mudancas > 0;

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!d || !edicao || !ident) throw new Error('sem estado');
      return PerfilDetalheV2Schema.parse(await api(`/core/perfis/${codigo}`, { method: 'PUT', body: corpoDoPut(d, edicao, ident) }));
    },
    onSuccess: async (novo) => {
      qc.setQueryData(['core', 'perfis', codigo], novo);
      setEdicao(edicaoDoDetalhe(novo));
      setIdent(identDe(novo));
      setRecusa(null);
      setConflito(false);
      setErroNome(null);
      toast('success', 'Perfil salvo.');
      await qc.invalidateQueries({ queryKey: ['core', 'perfis'], exact: true });
    },
    onError: (e) => {
      if (ehSemPermissao(e)) setSem403(true);
      else if (e instanceof ApiRequestError && e.code === CODIGOS_ERRO_PERFIL_V2.alterado) setConflito(true);
      else if (e instanceof ApiRequestError && e.code === CODIGO_REPETIDO) {
        setErroNome(MENSAGEM_PERFIL_REPETIDO);
        window.setTimeout(() => document.getElementById('perfil-nome')?.focus(), 0);
      } else if (ehNaoMigrado(e)) setRecusa([MENSAGEM_NAO_MIGRADO]);
      else if (e instanceof ApiRequestError && e.status === 422) setRecusa(frasesDaRecusa(e.details, e.message));
      else setRecusa([ehSemConexao(e) ? SEM_CONEXAO : 'Não foi possível salvar agora. Tente de novo.']);
    },
  });

  const voltar = () => router.push(pathname);
  if (sem403 || (q.isError && ehSemPermissao(q.error))) return <Notice tone="info">{SEM_PERMISSAO}</Notice>;
  if (q.isError || cat.isError) {
    const nao = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <BotaoVoltar onClick={voltar} />
        <ErrorBlock message={ehSemConexao(q.error ?? cat.error) ? SEM_CONEXAO : nao ? 'Este perfil não existe mais.' : 'Não foi possível abrir o perfil. Tente de novo.'} onRetry={nao ? undefined : () => void (q.isError ? q.refetch() : cat.refetch())} />
      </div>
    );
  }
  if (q.isPending || cat.isPending || !d || !edicao || !ident) return <LoadingBlock label="Carregando o perfil…" />;

  const alteraEdicao = (fn: (e: EdicaoTabela) => EdicaoTabela) => {
    setRecusa(null);
    setEdicao((e) => fn(e ?? {}));
  };
  const todasAsLinhas = grupos.flatMap((g) => g.linhas);
  const semAlvo = todasAsLinhas.some((l) => erroDeAlvos(l, edicao));
  const nomeVazio = ident.nome.trim() === '';
  const erroDoNome = nomeVazio ? MENSAGEM_NOME_OBRIGATORIO : erroNome;
  const cargoTravado = d.perfil.usuarios > 0;
  const modeloDe = (id: string) => todasAsLinhas.find((l) => l.id === id);

  const direitaDa = (l: LinhaModelo) => {
    if (l.tipo === 'escopo' && l.niveis)
      return (
        <SeletorEscopo
          nome={`escopo-${l.id}`}
          rotulo={l.rotulo}
          niveis={l.niveis}
          valor={edicao[l.id]?.nivel ?? l.teto ?? 'carteira'}
          teto={l.teto}
          motivoTeto={l.motivoTeto}
          onChange={(n) => alteraEdicao((e) => escolherNivel(e, l.id, n))}
          testId={`permissao.${l.id}.nivel`}
        />
      );
    if (l.tipo === 'alcada' && l.niveis && l.marcada)
      return <SeletorEscopo nome={`nivel-${l.id}`} rotulo={l.rotulo} niveis={l.niveis} valor={edicao[l.id]?.nivel ?? 'ate_alcada'} desabilitado={!!l.trava} onChange={(n) => alteraEdicao((e) => escolherNivel(e, l.id, n))} testId={`permissao.${l.id}.nivel`} />;
    if (l.tipo === 'alvos' && l.marcada)
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-ink-2" data-testid={`permissao.${l.id}.alvos`}>
          De: {resumoDosAlvos(edicao[l.id]?.alvos, rotulos)}
          <button type="button" className="min-h-[44px] font-semibold text-accent-ink hover:underline" onClick={() => setAlvosDe(l.id)}>
            Mudar
          </button>
          {erroDeAlvos(l, edicao) && <span className="text-danger">{erroDeAlvos(l, edicao)}</span>}
        </span>
      );
    return undefined;
  };

  const doKit = (g: (typeof grupos)[number]): GrupoDaTabela => ({
    id: g.id,
    titulo: g.titulo,
    semLicenca: g.semLicenca,
    semCaixa: g.semCaixa,
    linhas: g.linhas.map((l) => ({
      id: l.id,
      rotulo: l.rotulo,
      marcada: l.marcada,
      trava: l.trava,
      semCaixa: l.tipo === 'escopo',
      descricao: l.motivoTeto,
      semEfeito: l.semEfeito,
      direita: direitaDa(l),
    })),
  });
  const visiveis = filtrarGruposPorBusca(grupos.map(doKit), busca);
  const abertosAgora = busca.trim() ? new Set(visiveis.map((g) => g.id)) : abertos;
  const alvoDaTela = alvosDe ? modeloDe(alvosDe) : undefined;
  const opcoesAlvo = d.alvos_possiveis.map((p) => ({ valor: p.codigo, rotulo: rotuloDoPerfil(p.codigo, { nome: p.nome }) }));
  const marcadosAlvo = (alvosDe && edicao[alvosDe]?.alvos) || [];

  return (
    <div className="flex flex-col gap-4 pb-24">
      <CabecalhoDoPerfil
        voltar={<BotaoVoltar onClick={() => (sujo ? setSair(true) : voltar())} />}
        titulo={d.perfil.nome}
        selo={d.perfil.ativo ? undefined : <Badge tone="neutral">Inativo</Badge>}
        acoes={
          <>
            <Button size="sm" onClick={() => setCopiar(true)} data-testid="perfil.copiar">
              Copiar permissões de…
            </Button>
            <Button size="sm" onClick={() => setHistorico(true)} data-testid="perfil.historico">
              Histórico
            </Button>
          </>
        }
      />
      <IdentificacaoDoPerfil
        nome={ident.nome}
        cargo={ident.cargo as never}
        cargoTravado={cargoTravado}
        erroNome={erroDoNome}
        onNome={(v) => {
          setErroNome(null);
          setIdent({ ...ident, nome: v });
        }}
        onCargo={(v) => setIdent({ ...ident, cargo: v })}
      />
      <TabelaPermissoes
        grupos={visiveis}
        abertos={abertosAgora}
        onAlternarAberto={(id) =>
          setAbertos((a) => {
            const n = new Set(a);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        onAlternarLinha={(id, marcada) => {
          const l = modeloDe(id);
          if (l) alteraEdicao((e) => alternarLinha(e, l, marcada));
        }}
        onMarcarVarias={(gid, m) => alteraEdicao((e) => aplicarMarcacoes(e, grupos.find((g) => g.id === gid)?.linhas ?? [], m))}
        aviso={autogestao ? AVISO_AUTOGESTAO : undefined}
        busca={busca}
        onBusca={setBusca}
      />
      {recusa && (
        <Notice tone="danger">
          <span data-testid="perfil.erro">{recusa.join(' ')}</span>
        </Notice>
      )}
      {conflito && (
        <Notice tone="danger">
          <span data-testid="perfil.conflito">Outra pessoa alterou este perfil enquanto você editava.</span>{' '}
          <button type="button" className="min-h-[44px] font-semibold underline" onClick={() => { setConflito(false); void q.refetch(); }}>
            Recarregar o perfil
          </button>
        </Notice>
      )}
      <div className="fixed inset-x-0 bottom-0 md:left-[240px] z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <span className="text-[13px] font-semibold" role="status" aria-live="polite" data-testid="perfil.contagem">
          {contagemNaoSalva(mudancas)}
        </span>
        <Button variant="primary" disabled={!sujo || semAlvo || nomeVazio || ident.cargo === '' || salvar.isPending} onClick={() => { setRecusa(null); salvar.mutate(); }} data-testid="perfil.salvar">
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      {alvoDaTela && (
        <Dialog open title={`De quais perfis: ${alvoDaTela.rotulo}`} onClose={() => setAlvosDe(null)} footer={<Button variant="primary" onClick={() => setAlvosDe(null)}>Pronto</Button>}>
          <SeletorDePerfis
            nome={`alvos-${alvoDaTela.id}`}
            legenda="De quais perfis"
            opcoes={opcoesAlvo}
            marcados={marcadosAlvo}
            todos={{ rotulo: ROTULO_ALVO_TODOS }}
            onChange={(valor) => alteraEdicao((e) => marcarAlvos(e, alvoDaTela.id, alternarMarcado(marcadosAlvo, valor, [ALVO_TODOS_PERFIS, ...opcoesAlvo.map((o) => o.valor)])))}
          />
        </Dialog>
      )}
      {sair && (
        <Dialog
          open
          title="Sair sem salvar?"
          onClose={() => setSair(false)}
          footer={
            <>
              <Button onClick={() => setSair(false)}>Continuar editando</Button>
              <Button variant="danger" onClick={voltar}>
                Sair sem salvar
              </Button>
            </>
          }
        >
          <p className="m-0 text-[15px]">{mudancas === 1 ? 'A mudança não salva se perde.' : `As ${mudancas} mudanças não salvas se perdem.`}</p>
        </Dialog>
      )}
      {copiar && (
        <CopiarPermissoes
          perfis={(lista.data ?? []).filter((p) => p.codigo !== codigo && p.ativo)}
          onClose={() => setCopiar(false)}
          onCopiar={(origem) => {
            alteraEdicao((e) => copiarDoPerfil(e, grupos, origem, d.teto_escopo));
            setCopiar(false);
          }}
        />
      )}
      {historico && <HistoricoDoPerfil codigo={codigo} nome={d.perfil.nome} onClose={() => setHistorico(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- copiar de outro perfil

function CopiarPermissoes({ perfis, onClose, onCopiar }: { perfis: PerfilResumoV2[]; onClose: () => void; onCopiar: (origem: OrigemDaCopia) => void }) {
  const [origem, setOrigem] = useState('');
  const modelos = useModelosDePerfil();
  const copiar = useMutation({
    mutationFn: async (): Promise<OrigemDaCopia> => {
      const modelo = origem.startsWith('modelo:') ? modelos.data?.find((m) => m.modelo === origem.slice(7)) : undefined;
      return modelo ?? PerfilDetalheV2Schema.parse(await api(`/core/perfis/${origem.slice(7)}`));
    },
    onSuccess: onCopiar,
  });
  return (
    <Dialog
      open
      title="Copiar permissões de…"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!origem || copiar.isPending} onClick={() => copiar.mutate()} data-testid="perfil.copiar.confirmar">
            Copiar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[15px]">As caixas marcadas trocam pelas do perfil escolhido.</p>
        <select className={CAMPO} value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Perfil de origem" data-testid="perfil.copiar.origem">
          <option value="">Escolha um perfil…</option>
          <optgroup label="Perfis da empresa">
            {perfis.map((p) => (
              <option key={p.codigo} value={`perfil:${p.codigo}`}>
                {rotuloDoPerfil(p.codigo, { nome: p.nome })}
              </option>
            ))}
          </optgroup>
          <optgroup label="Modelos">
            {(modelos.data ?? []).map((m) => (
              <option key={m.modelo} value={`modelo:${m.modelo}`}>
                {rotuloDoPerfil(m.modelo, { nome: m.nome })}
              </option>
            ))}
          </optgroup>
        </select>
        {copiar.isError && <Notice tone="danger">{ehSemConexao(copiar.error) ? SEM_CONEXAO : errorMessage(copiar.error)}</Notice>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- histórico

function HistoricoDoPerfil({ codigo, nome, onClose }: { codigo: string; nome: string; onClose: () => void }) {
  const fuso = useMe().data.tenant.timezone;
  const [antes, setAntes] = useState<string | null>(null);
  const [itens, setItens] = useState<PerfilHistoricoItemV2[]>([]);
  const q = useQuery({
    queryKey: ['core', 'perfis', codigo, 'historico', antes],
    queryFn: async () => PerfilHistoricoRespostaV2Schema.parse(await api(`/core/perfis/${codigo}/historico${antes ? `?antes=${encodeURIComponent(antes)}` : ''}`)),
  });
  useEffect(() => {
    if (q.data) setItens((atual) => (antes ? [...atual, ...q.data.itens.filter((i) => !atual.some((a) => a.id === i.id))] : q.data.itens));
  }, [q.data, antes]);
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
            const frases = i.acao === 'perfil.criar' ? ['Perfil criado.'] : frasesDoHistorico(i, (c) => rotuloDaPermissao(c));
            return (
              <div key={i.id} className="flex flex-col gap-1 border-b border-line pb-3">
                <strong className="text-[13px]">
                  {formatDateTimeFull(i.em, fuso)} · {i.usuario_nome ?? 'Sistema'}
                </strong>
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

function PerfisConteudo() {
  const params = useSearchParams();
  const podeGerir = usePode('perfil.gerir');
  const codigo = perfilEmEdicao(params);
  if (!podeGerir) return <Notice tone="info">{SEM_PERMISSAO}</Notice>;
  if (params.get('novo')) return <NovoPerfil />;
  return codigo ? <EdicaoDoPerfil key={codigo} codigo={codigo} /> : <ListaDePerfis />;
}

export function PerfisPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando perfis…" />}>
      <PerfisConteudo />
    </Suspense>
  );
}
