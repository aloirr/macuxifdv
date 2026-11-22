'use client';

/**
 * Aba "Integração" do portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §10.2; R-20261114-132000 e R-20261114-170200):
 * ou é Conector, ou é API, em dois lados com a mesma largura e uma divisória de 1 px no meio (`line`), com 24 px de folga para cada
 * lado; abaixo de 768 px, empilhados (Conector primeiro) com a divisória na horizontal, 24 px antes da API.
 * - "Integração via Conector": passos numerados (1 Baixar o Conector, 2 Gerar a credencial, 3 Instalar e colar a credencial) e a
 *   tabela "Conectores" (tipos `conector` e `arquivo`; só o `conector` tem "Bases" e "Gerar nova chave").
 * - "Integração via API": "Gerar a credencial" (botão neutro) pela mesma rota com `tipo: 'nuvem'`, escolhendo entre as bases livres e
 *   se envia os pedidos; o cartão "Guia" (botão do PDF pela rota pública `GUIA_PDF_HUB`; link do OpenAPI 3.1) e a tabela "Credenciais".
 * - Linha ativa: "Bases" (`PATCH { entidades }`, só as bases livres para ele) e "Gerar nova chave" (`POST ROTAS_PORTAL.chaveConector`)
 *   fora do de arquivo; "Desativar" (`PATCH { ativo: false }`); nova chave e desativar com confirmação, no texto do tipo (Conector ou
 *   credencial de API). Linha desativada: sem botões.
 * A chave em claro vem só na resposta e aparece UMA vez, com "Copiar". Na v1 cada base vem de um único Conector por empresa
 * (RN-INT-13): a credencial nova leva só bases livres e a API revalida (409 `topologia_conflitante`). testIDs: integracao.*.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, ORDEM_CARGA_ENTIDADES, type Entidade, type TipoConector } from '@macuxi/integracao/contracts';
import { Badge, Button, cx, Dialog, ErrorBlock, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDocumentoPublico, chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL, type OpcoesChamada } from '@/lib/portal-api';
import { NOME_DA_BASE } from '@/lib/portal-bases';
import { DOWNLOAD_CONECTOR } from '@/lib/conector-download';
import { ENCAIXE_API_HUB, OPENAPI_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { BaixarPacote } from './baixar-conector';
import { principalDesabilitadoCss } from './seletor-plano';
import { Campo } from '@/components/campo-acesso';

type Criado = ReturnType<typeof ConectorCriado.parse>;
type ChaveNova = Criado['chave'];
type Conector = ReturnType<typeof ConectorResumo.parse>;
type Topologia = { ativo: boolean; entidades: readonly Entidade[]; conector_id: string };
export type AcaoConector = 'chave' | 'desativar';
const ListaDaApi = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

/** Chamada ao portal (injetável nos testes). */
export type Chamar = <T>(caminho: string, o: OpcoesChamada<T>) => Promise<T>;

/**
 * Bases que nenhum Conector ativo recebe, fora o `ignorar`: sem ele, as que a credencial nova pode levar; com ele, as que o diálogo
 * "Bases" daquele Conector lista (as dele mais as livres).
 */
export function entidadesLivres(conectores: readonly Topologia[], ignorar?: string): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo && c.conector_id !== ignorar).flatMap((c) => c.entidades));
  return ENTIDADES.filter((e) => !ocupadas.has(e));
}

/**
 * Aviso quando não sobra base livre, só com a ação que libera: "Bases" ou "Desativar" no Conector ou na credencial de API (os dois
 * ocupam bases); o Conector de arquivo só tem "Desativar".
 */
export function mensagemSemBases(temArquivo: boolean): string {
  const inicio = 'Todas as bases já estão em outro Conector ou credencial.';
  return temArquivo ? `${inicio} Desative o Conector de arquivo.` : `${inicio} Tire bases dele em "Bases" ou desative-o.`;
}

/**
 * O que deixa de acontecer ao desativar: o Conector de arquivo recusa as cargas por CSV (a API só aceita lote de Conector de
 * arquivo ativo, RN-INT-13); o do ERP para de enviar as bases e, só se recebe pedidos, de buscá-los.
 */
export function corpoDesativar(c: { tipo: string; recebe_pedidos: boolean }): string {
  if (c.tipo === 'arquivo') return 'A carga por CSV deixa de funcionar nesta empresa.';
  if (c.tipo === 'nuvem') return 'As chamadas com esta chave passam a ser recusadas.';
  return c.recebe_pedidos ? 'Ele para de enviar as bases e de buscar os pedidos.' : 'Ele para de enviar as bases.';
}

type CorpoCredencial = { conector_id: string; nome: string; tipo: TipoConector; recebe_pedidos: boolean; entidades: Entidade[] };

/** Corpo do "Gerar credencial" (`ConectorCriar`), com identificador e nome aparados; `null` sem base (não envia). */
export function corpoDaCredencial(p: { identificador: string; nome: string; tipo: TipoConector; recebePedidos: boolean; entidades: readonly Entidade[] }): CorpoCredencial | null {
  if (p.entidades.length === 0) return null;
  return { conector_id: p.identificador.trim(), nome: p.nome.trim(), tipo: p.tipo, recebe_pedidos: p.recebePedidos, entidades: [...p.entidades] };
}

/** "Gerar credencial" dos dois lados: `POST /conectores` com o tipo, as bases e os pedidos. */
export function criarCredencial(tenant: string, corpo: CorpoCredencial, chamar: Chamar = chamarPortal): Promise<Criado> {
  return chamar(ROTAS_PORTAL.conectores, { metodo: 'POST', tenant, corpo, schema: ConectorCriado });
}

/** O único PATCH do Conector (`ConectorAtualizar`): "Bases" (`{ entidades }`, 409 `topologia_conflitante` no conflito) e "Desativar" (`{ ativo: false }`). */
export function patchConector(tenant: string, id: string, corpo: { entidades: Entidade[] } | { ativo: false }, chamar: Chamar = chamarPortal): Promise<Conector> {
  return chamar(ROTAS_PORTAL.conector(id), { metodo: 'PATCH', tenant, corpo, schema: ConectorResumo });
}

/** Como o diálogo chama a linha: Conector (esquerda, `conector`/`arquivo`) ou credencial de API (direita, `nuvem`). */
export const nomeDoAlvo = (c: { tipo: string; conector_id: string }) => (c.tipo === 'nuvem' ? `a credencial ${c.conector_id}` : `o Conector ${c.conector_id}`);

const TEXTO_ACAO: Record<AcaoConector, { titulo: (c: Conector) => string; corpo: (c: Conector) => string; botao: string }> = {
  chave: {
    titulo: (c) => `Gerar nova chave para ${nomeDoAlvo(c)}?`,
    corpo: (c) => `A chave atual ainda funciona por pouco tempo. Troque a chave ${c.tipo === 'nuvem' ? 'no sistema que chama a API' : 'na configuração do Conector'}.`,
    botao: 'Gerar nova chave',
  },
  desativar: { titulo: (c) => `Desativar ${nomeDoAlvo(c)}?`, corpo: corpoDesativar, botao: 'Desativar' },
};

export function DialogoConector({ alvo, acao, enviando, aoFechar, aoConfirmar }: { alvo: Conector | null; acao: AcaoConector; enviando: boolean; aoFechar: () => void; aoConfirmar: () => void }) {
  const t = TEXTO_ACAO[acao];
  return (
    <Dialog
      open={alvo !== null}
      title={alvo ? t.titulo(alvo) : ''}
      onClose={aoFechar}
      footer={
        <>
          <Button data-testid="integracao.acao-cancelar" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button variant="danger" data-testid={`integracao.acao-confirmar-${acao}`} disabled={enviando} onClick={aoConfirmar}>
            {t.botao}
          </Button>
        </>
      }
    >
      {alvo ? t.corpo(alvo) : null}
    </Dialog>
  );
}

/** A chave em claro, UMA vez, com "Copiar"; `testId` separa a do Conector (`integracao.`) da de API (`integracao.api-`). */
export function Credencial({ c, aoFechar, testId = 'integracao.' }: { c: ChaveNova; aoFechar: () => void; testId?: string }) {
  const toast = useToast();
  const [copiou, setCopiou] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.chave);
      setCopiou(true);
    } catch {
      toast('warning', 'Não deu para copiar: selecione a chave e copie com Ctrl+C.');
    }
  };
  return (
    <div data-testid={`${testId}credencial`} className="flex flex-col items-start gap-2">
      <Notice tone="warning" className="w-full">
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span>Copie a chave agora: ela não aparece de novo.</span>
          <code data-testid={`${testId}chave`} className="min-w-0 font-mono text-[13px] break-all text-ink select-all">
            {c.chave}
          </code>
          <Button data-testid={`${testId}copiar`} size="sm" onClick={() => void copiar()}>
            {copiou ? 'Copiada' : 'Copiar'}
          </Button>
        </span>
      </Notice>
      <Button size="sm" data-testid={`${testId}ja-copiei`} onClick={aoFechar}>
        Já copiei, esconder
      </Button>
    </div>
  );
}

/**
 * Seleção das bases (a mesma no formulário da API e no diálogo "Bases"): `null` = o padrão (`padrao`); depois do primeiro clique, o
 * conjunto marcado. Só conta o que está em `bases` (as livres para aquele lado), na ordem de carga.
 */
function useSelecaoDeBases(bases: readonly Entidade[], padrao: readonly Entidade[]) {
  const [escolha, setEscolha] = useState<ReadonlySet<Entidade> | null>(null);
  const atual = escolha ?? new Set(padrao);
  const marcadas = ORDEM_CARGA_ENTIDADES.filter((e) => bases.includes(e) && atual.has(e));
  const mudar = (e: Entidade, marcada: boolean) => setEscolha(new Set(marcada ? [...marcadas, e] : marcadas.filter((x) => x !== e)));
  return { marcadas, mudar, limpar: () => setEscolha(null) };
}

/**
 * "Bases": as caixas das `bases`, na ordem de carga, num `fieldset` com a legenda "Bases" (formulário da API e diálogo "Bases").
 * `legendaOculta`: a legenda fica só para o leitor de tela (`sr-only`), quando o título do diálogo já diz "Bases".
 */
export function ListaBases({ bases, marcadas, aoMudar, testId, legendaOculta = false }: { bases: readonly Entidade[]; marcadas: readonly Entidade[]; aoMudar: (e: Entidade, marcada: boolean) => void; testId: string; legendaOculta?: boolean }) {
  return (
    <fieldset data-testid={testId} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className={legendaOculta ? 'sr-only' : 'mb-1.5 p-0 text-[13px] font-semibold text-ink'}>Bases</legend>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {ORDEM_CARGA_ENTIDADES.filter((e) => bases.includes(e)).map((e) => (
          <label key={e} className="flex cursor-pointer items-center gap-2.5 text-[15px]">
            <input type="checkbox" data-testid={`${testId}.${e}`} className="h-4 w-4 shrink-0 accent-accent" checked={marcadas.includes(e)} onChange={(x) => aoMudar(e, x.target.checked)} />
            {NOME_DA_BASE[e]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Título do passo com o número num círculo Azul noite, texto branco (MC-0024). */
function Passo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
        {n}
      </span>
      {children}
    </span>
  );
}

interface InicialCredencial {
  identificador: string;
  nome: string;
  recebePedidos: boolean;
  exemplo?: { identificador: string; nome: string };
}

/**
 * "Gerar a credencial": Identificador · Nome · [bases livres, só no lado da API] · "Envia os pedidos aprovados ao ERP" · "Gerar
 * credencial". O Conector leva todas as bases livres; a API escolhe entre elas (todas marcadas no começo, ao menos uma).
 */
function GerarCredencial({
  tenant,
  tipo,
  todos,
  carregando,
  principal,
  escolheBases,
  inicial,
  testId,
  aoCriar,
}: {
  tenant: string;
  tipo: TipoConector;
  todos: readonly Conector[];
  carregando: boolean;
  principal: boolean;
  escolheBases: boolean;
  inicial: InicialCredencial;
  testId: string;
  aoCriar: () => void;
}) {
  const [identificador, setIdentificador] = useState(inicial.identificador);
  const [nome, setNome] = useState(inicial.nome);
  const [recebePedidos, setRecebePedidos] = useState(inicial.recebePedidos);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const livres = entidadesLivres(todos);
  const selecao = useSelecaoDeBases(livres, livres);
  const escolhidas = escolheBases ? selecao.marcadas : livres;
  const semBases = mensagemSemBases(todos.some((c) => c.ativo && c.tipo === 'arquivo'));
  const semLivres = escolheBases && !carregando && livres.length === 0;

  const gerar = async () => {
    if (enviando) return;
    setErro(null);
    const corpo = corpoDaCredencial({ identificador, nome, tipo, recebePedidos, entidades: escolhidas });
    if (!corpo) return setErro(semBases);
    setEnviando(true);
    try {
      setCriado(await criarCredencial(tenant, corpo));
      selecao.limpar();
      aoCriar();
    } catch (x) {
      setErro(ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

  if (criado) return <Credencial c={criado.chave} testId={testId} aoFechar={() => setCriado(null)} />;
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void gerar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Identificador" testId={`${testId}identificador`} value={identificador} placeholder={inicial.exemplo?.identificador} spellCheck={false} onChange={(e) => setIdentificador(e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} />
        <Campo rotulo="Nome" testId={`${testId}nome`} value={nome} placeholder={inicial.exemplo?.nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      {escolheBases &&
        !carregando &&
        (semLivres ? (
          <div data-testid={`${testId}sem-bases`}>
            <Notice tone="warning">{semBases}</Notice>
          </div>
        ) : (
          <ListaBases bases={livres} marcadas={escolhidas} testId={`${testId}bases`} aoMudar={selecao.mudar} />
        ))}
      <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
        <input type="checkbox" data-testid={`${testId}recebe-pedidos`} className="h-4 w-4 accent-accent" checked={recebePedidos} onChange={(e) => setRecebePedidos(e.target.checked)} />
        Envia os pedidos aprovados ao ERP
      </label>
      {erro && (
        <div data-testid={`${testId}erro`}>
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      <div>
        <Button
          data-testid={`${testId}gerar`}
          type="submit"
          variant={principal ? 'primary' : 'secondary'}
          className={principalDesabilitadoCss}
          disabled={enviando || !identificador.trim() || !nome.trim() || carregando || semLivres || (escolheBases && escolhidas.length === 0)}
        >
          {enviando ? 'Gerando…' : 'Gerar credencial'}
        </Button>
      </div>
    </form>
  );
}

/** Diálogo "Bases": só as bases livres para ele (as dele mais as que nenhum outro Conector ativo recebe), as dele marcadas; "Gravar" pede ao menos uma. */
export function DialogoBases({ alvo, todos, tenant, aoFechar, aoGravar }: { alvo: Conector | null; todos: readonly Conector[]; tenant: string; aoFechar: () => void; aoGravar: () => void }) {
  const bases = alvo ? entidadesLivres(todos, alvo.conector_id) : [];
  const selecao = useSelecaoDeBases(bases, alvo?.entidades ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const fechar = () => {
    if (gravando) return;
    selecao.limpar();
    setErro(null);
    aoFechar();
  };
  const gravar = async () => {
    if (!alvo || gravando || selecao.marcadas.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      await patchConector(tenant, alvo.id, { entidades: selecao.marcadas });
      selecao.limpar();
      aoGravar();
    } catch (x) {
      // 409 `topologia_conflitante`: a mensagem da API diz qual Conector já recebe cada base
      setErro(ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setGravando(false);
    }
  };
  return (
    <Dialog
      open={alvo !== null}
      title={alvo ? `Bases ${alvo.tipo === 'nuvem' ? 'da credencial' : 'do Conector'} ${alvo.conector_id}` : ''}
      largura="media"
      onClose={fechar}
      footer={
        <>
          <Button data-testid="integracao.bases-cancelar" disabled={gravando} onClick={fechar}>
            Cancelar
          </Button>
          <Button variant="primary" data-testid="integracao.bases-gravar" disabled={gravando || selecao.marcadas.length === 0} onClick={() => void gravar()}>
            {gravando ? 'Gravando…' : 'Gravar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ListaBases bases={bases} marcadas={selecao.marcadas} testId="integracao.bases" aoMudar={selecao.mudar} legendaOculta />
        {erro && (
          <div data-testid="integracao.bases-erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}

type Consulta = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

/** Tabela "Conectores" / "Credenciais": Identificador · Pedidos · Situação; os botões da linha ativa numa segunda linha (lado estreito e celular). */
export function ListaConectores({
  q,
  itens,
  vazio,
  testId,
  novaChave,
  agindo,
  aoAgir,
  aoBases,
  aoFecharChave,
}: {
  q: Consulta;
  itens: readonly Conector[];
  vazio: string;
  testId: string;
  novaChave: { id: string; chave: ChaveNova } | null;
  agindo: boolean;
  aoAgir: (c: Conector, acao: AcaoConector) => void;
  aoBases: (c: Conector) => void;
  aoFecharChave: () => void;
}) {
  if (q.isPending) return <LoadingBlock label="Buscando…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (itens.length === 0) return <span className="text-[13px] text-ink-2">{vazio}</span>;
  return (
    <TableScroll minWidth={320}>
      <table data-testid={testId} className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>Identificador</th>
            <th className={th}>Pedidos</th>
            <th className={th}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((c) => {
            // linha ativa: sem a borda de baixo, porque os botões vêm na linha seguinte
            const cel = c.ativo ? td.replace(/\bborder-b border-line-2\b/, '').trim() : td;
            return (
              <Fragment key={c.id}>
                <tr>
                  <td className={cx(cel, 'font-mono')}>{c.conector_id}</td>
                  <td className={cel}>{c.recebe_pedidos ? 'Sim' : '—'}</td>
                  <td className={cel}>
                    <Badge tone={c.ativo ? 'success' : 'neutral'}>{c.ativo ? 'Ativo' : 'Desativado'}</Badge>
                  </td>
                </tr>
                {c.ativo && (
                  <tr>
                    <td colSpan={3} className={cx(td, 'pt-0')}>
                      <span className="flex flex-wrap items-center gap-2">
                        {c.tipo !== 'arquivo' && (
                          <>
                            <Button size="sm" data-testid={`integracao.bases-${c.conector_id}`} disabled={agindo} onClick={() => aoBases(c)}>
                              Bases
                            </Button>
                            <Button size="sm" data-testid={`integracao.nova-chave-${c.conector_id}`} disabled={agindo} onClick={() => aoAgir(c, 'chave')}>
                              Gerar nova chave
                            </Button>
                          </>
                        )}
                        <Button size="sm" data-testid={`integracao.desativar-${c.conector_id}`} disabled={agindo} onClick={() => aoAgir(c, 'desativar')}>
                          Desativar
                        </Button>
                      </span>
                      {novaChave?.id === c.id && (
                        <div className="mt-2">
                          <Credencial c={novaChave.chave} testId={`integracao.nova-chave-${c.conector_id}.`} aoFechar={aoFecharChave} />
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

/** Cartão "Guia": o botão do PDF (`guiaPdf`, rota pública, sem sessão); o link do OpenAPI 3.1 sempre (uma informação, um lugar). */
export function CartaoGuia({ guiaPdf }: { guiaPdf: string | null }) {
  const toast = useToast();
  const [indisponivel, setIndisponivel] = useState(false);
  const baixar = async (caminho: string, nome: string) => {
    try {
      // documentos públicos (T-0092): sem token e sem tenant
      await baixarDocumentoPublico(caminho, nome);
    } catch (x) {
      if (ehRotaAusente(x)) setIndisponivel(true);
      else if (x instanceof ErroPortal && x.status === 429) toast('warning', 'Muitos downloads seguidos deste endereço. Espere um minuto e tente de novo.');
      else toast('danger', mensagemDoErro(x));
    }
  };
  return (
    <Panel title="Guia">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {guiaPdf && (
          <Button data-testid="integracao.guia" onClick={() => void baixar(guiaPdf, 'macuxi-guia-api-v1.pdf')}>
            Baixar o guia (PDF)
          </Button>
        )}
        <Button variant="link" data-testid="integracao.openapi" onClick={() => void baixar(OPENAPI_HUB.viaProxy, 'macuxi-openapi-hub-v1.json')}>
          Documentação (OpenAPI 3.1)
        </Button>
        {indisponivel && <span className="text-[12px] text-ink-2">{TEXTO_INDISPONIVEL}</span>}
      </div>
    </Panel>
  );
}

export function AbaIntegracao({ tenant, guiaPdf = ENCAIXE_API_HUB.guiaPdf }: { tenant: string; guiaPdf?: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['portal', tenant, 'conectores'] as const;
  const q = useQuery({ queryKey: chave, queryFn: () => chamarPortal(ROTAS_PORTAL.conectores, { tenant, schema: ListaDaApi }) });
  const [alvo, setAlvo] = useState<{ conector: Conector; acao: AcaoConector } | null>(null);
  const [novaChave, setNovaChave] = useState<{ id: string; chave: ChaveNova } | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [bases, setBases] = useState<Conector | null>(null);

  const todos = q.data ?? [];
  const aoMudar = () => void qc.invalidateQueries({ queryKey: chave });

  const confirmarAcao = async () => {
    if (!alvo || agindo) return;
    setAgindo(true);
    try {
      const id = alvo.conector.id;
      if (alvo.acao === 'chave') setNovaChave({ id, chave: await chamarPortal(ROTAS_PORTAL.chaveConector(id), { metodo: 'POST', tenant, corpo: {}, schema: ConectorCriado.shape.chave }) });
      else await patchConector(tenant, id, { ativo: false });
      setAlvo(null);
      aoMudar();
    } catch (x) {
      setAlvo(null);
      toast('danger', ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setAgindo(false);
    }
  };

  const lista = (itens: readonly Conector[], vazio: string, testId: string) => (
    <ListaConectores
      q={q}
      itens={itens}
      vazio={vazio}
      testId={testId}
      novaChave={novaChave}
      agindo={agindo}
      aoAgir={(c, acao) => setAlvo({ conector: c, acao })}
      aoBases={setBases}
      aoFecharChave={() => setNovaChave(null)}
    />
  );

  return (
    <div data-testid="integracao.aba" className="grid md:grid-cols-2">
      {/* divisória: filete de 1 px (`line`) no meio, da altura do lado mais alto, 24 px de folga; abaixo de 768 px, horizontal */}
      <section aria-labelledby="integracao-conector" className="flex min-w-0 flex-col gap-4 border-b border-line pb-6 md:border-r md:border-b-0 md:pr-6 md:pb-0">
        <h2 id="integracao-conector" className="m-0 text-[20px] font-extrabold">
          Integração via Conector
        </h2>
        <Panel title={<Passo n={1}>Baixar o Conector</Passo>}>
          <BaixarPacote produto={DOWNLOAD_CONECTOR} tenant={tenant} />
        </Panel>
        <Panel title={<Passo n={2}>Gerar a credencial</Passo>}>
          <GerarCredencial tenant={tenant} tipo="conector" todos={todos} carregando={q.isPending} principal escolheBases={false} inicial={{ identificador: 'erp', nome: 'Conector do ERP', recebePedidos: true }} testId="integracao." aoCriar={aoMudar} />
        </Panel>
        <Panel title={<Passo n={3}>Instalar e colar a credencial</Passo>}>
          <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[15px]">
            <li>Instale o Conector no servidor do ERP.</li>
            <li>Cole o identificador e a chave na configuração.</li>
            <li>Inicie o serviço.</li>
          </ol>
        </Panel>
        <Panel title="Conectores">{lista(todos.filter((c) => c.tipo !== 'nuvem'), 'Nenhum Conector.', 'integracao.conectores')}</Panel>
      </section>

      <section aria-labelledby="integracao-api" className="flex min-w-0 flex-col gap-4 pt-6 md:pt-0 md:pl-6">
        <h2 id="integracao-api" className="m-0 text-[20px] font-extrabold">
          Integração via API
        </h2>
        <Panel title="Gerar a credencial">
          <GerarCredencial
            tenant={tenant}
            tipo="nuvem"
            todos={todos}
            carregando={q.isPending}
            principal={false}
            escolheBases
            inicial={{ identificador: '', nome: '', recebePedidos: false, exemplo: { identificador: 'ex.: erp-api', nome: 'ex.: ERP do cliente' } }}
            testId="integracao.api-"
            aoCriar={aoMudar}
          />
        </Panel>
        <CartaoGuia guiaPdf={guiaPdf} />
        <Panel title="Credenciais">{lista(todos.filter((c) => c.tipo === 'nuvem'), 'Nenhuma credencial.', 'integracao.api-credenciais')}</Panel>
      </section>

      <DialogoConector alvo={alvo?.conector ?? null} acao={alvo?.acao ?? 'chave'} enviando={agindo} aoFechar={() => setAlvo(null)} aoConfirmar={() => void confirmarAcao()} />
      <DialogoBases
        alvo={bases}
        todos={todos}
        tenant={tenant}
        aoFechar={() => setBases(null)}
        aoGravar={() => {
          setBases(null);
          aoMudar();
        }}
      />
    </div>
  );
}
