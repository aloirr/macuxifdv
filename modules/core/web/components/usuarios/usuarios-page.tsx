'use client';

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROTULO_PERFIL, type ModuloId } from '@macuxi/platform-sdk';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, Drawer, ErrorBlock, FilterBar, CampoSenha, IconeModulo, IconUser, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, RegrasDaSenha, SelectField, td, th, useToast, rotuloDoPerfil, type AcaoDoMenu, type IdDoModulo } from '@macuxi/ui/web';
import { FiliaisListaSchema, CriarUsuarioRespostaSchema, DesbloquearUsuarioRespostaSchema, LicencasEstadoSchema, PerfilOpcoesRespostaSchema, RedefinirSenhaRespostaSchema, UsuarioListaRespostaSchema, VincularErpRespostaSchema, SENHA_MIN_CARACTERES, mensagemDaSenha, type HorarioAlmoco, type LicencasEstado, type UsuarioItem } from '../../../contracts';
import { efetivosPelasDependencias } from '../../../domain/licencas';
import {
  acaoDeSenha,
  codigoFdvParaLista,
  corpoDeVinculoErp,
  emailParaLista,
  podeVincularErp,
  provisoriosParaVincular,
  textoDaOpcaoDoProvisorio,
  textoDaConfirmacaoDoVinculo,
  textoDoVinculoErp,
  tituloDaConfirmacaoDoVinculo,
  almocoPadraoDoTenant,
  corpoDeRedefinicao,
  faltasDaSenhaDigitada,
  gerarSenhaNoNavegador,
  resultadoDeCriar,
  resultadoDeRedefinir,
  TEXTO_ENVIAR_ACESSO_SEM_EMAIL,
  TEXTO_SENHA_NAO_REDEFINIVEL,
  textoAcessoEnviado,
  type ResultadoDoEmail,
  corpoDeCriacao,
  corpoDeEdicao,
  errosDoFormulario,
  FORMULARIO_VAZIO,
  formularioDoUsuario,
  formularioNovo,
  type FormularioUsuario,
  ERRO_SEM_PERFIL,
  opcoesDeChefia,
  pessoasDaLista,
  seloDoUsuario,
  type SeloDoUsuario,
} from '../../lib/usuarios';
import { alternarVenda, avisoSemFilial, descricaoParaLeitor, erroDaFilialCadastro, escolherCadastro, estaSemFilial, filiaisEmOrdem, filtrarPorFilial, FILTRO_FILIAL_SEM, mostraColunaFilial, nomeDaFilialDe, ROTULO_FILIAL_DE_CADASTRO, SELO_SEM_FILIAL, vendaTravada } from '../../lib/filial-usuario';
import { regrasDoCargo } from '../../../domain/cargos';
import { modulosExibiveis, removidosDoFormulario } from '../../lib/acesso';
import { efetivosDoUsuario } from '../../lib/licencas';
import { useMe } from '../../lib/queries';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { rotuloDoAlmoco } from '../../../domain/jornada';
const BOTAO_LINHA = 'h-[44px] min-w-[88px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:text-disabled';

type Modal = { tipo: 'form'; usuario: UsuarioItem | null } | { tipo: 'ativo'; usuario: UsuarioItem } | { tipo: 'senha'; usuario: UsuarioItem } | null;

/** Ícone do módulo na coluna "Módulos", com o nome para leitor de tela e dica (nome e ícone de `modulos.tsx`, §P10). */
function IconeComNome({ id, nome }: { id: IdDoModulo; nome: string }) {
  return (
    <span role="img" aria-label={nome} title={nome} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ground text-ink">
      <IconeModulo id={id} size={18} />
    </span>
  );
}

function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
      {rotulo}
      {children}
      {erro && <span className="text-[12px] font-medium text-danger">{erro}</span>}
    </label>
  );
}

/**
 * Tela "Usuários" do BKO (RF-CORE-02; T-0067; T-0094; simplificada a pedido do dono do produto, R-20261114-144500): título, "Novo usuário"
 * e a tabela Nome · E-mail · Perfil · Módulos · ⋯ (Desbloquear, Editar, Redefinir senha, Desativar). Um selo por linha: Inativo, Bloqueado ou
 * Bloqueado até HHhMM (docs/design/telas/usuario-bloqueio.md); "Desbloquear" age na hora, sem confirmação nem aviso: o selo some. "Novo usuário" e "Editar" abrem numa gaveta com
 * Nome, E-mail, Perfil e Módulos; a senha inicial é gerada e vai por e-mail (RN-CORE-34). Os módulos vêm da licença (RN-CORE-01: a exceção
 * do usuário só remove, e só dentro do que o perfil tem); Core, Catálogo e Integração não aparecem. Escrita só para quem tem as chaves do
 * motor (`usuario.criar|editar|desativar`, `senha.redefinir`); a API revalida. testIDs: docs/modulos/core/test-ids.md.
 */
export function UsuariosConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const podeCriar = usePode('usuario.criar');
  const podeEditar = usePode('usuario.editar');
  const podeDesativar = usePode('usuario.desativar');
  const podeSenha = usePode('senha.redefinir');
  const podeDesbloquear = usePode('usuario.desbloquear');
  const podeFilial = usePode('usuario.filial_editar');
  const fuso = useMe().data.tenant.timezone;
  const [agora, setAgora] = useState(() => new Date());
  const [anuncio, setAnuncio] = useState('');
  const [erroDaLista, setErroDaLista] = useState<string | null>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<FormularioUsuario>(FORMULARIO_VAZIO);
  // T-0180 (D5; RN-CORE-44): o padrão da empresa vem na própria lista de usuários (quem edita usuário não precisa de `parametro.inicio`)
  const [padraoDaLista, setPadraoDaLista] = useState<HorarioAlmoco | undefined>(undefined);
  const padraoAlmoco = almocoPadraoDoTenant(padraoDaLista ? { almoco_padrao: padraoDaLista } : undefined);
  const [desmarcados, setDesmarcados] = useState<ReadonlySet<string>>(new Set());
  const [tentou, setTentou] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // e-mail que não saiu: a senha aparece UMA vez, da memória da tela, e some ao fechar o aviso ou sair da página
  const [semEmail, setSemEmail] = useState<Extract<ResultadoDoEmail, { tipo: 'sem_email' }> | null>(null);
  const toast = useToast();
  const [vinculo, setVinculo] = useState<{ real: UsuarioItem; escolhido: string; etapa: 'escolher' | 'confirmar'; erro: string | null } | null>(null);
  const copiarCodigoFdv = async (codigo: string) => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast('success', 'Código copiado');
    } catch {
      toast('danger', 'Não foi possível copiar. Selecione o código e copie.');
    }
  };
  const copiarSenha = async (senha: string) => {
    try {
      await navigator.clipboard.writeText(senha);
      toast('success', 'Senha copiada.');
    } catch {
      toast('danger', 'Não foi possível copiar. Selecione a senha e copie.');
    }
  };

  const q = params.get('q') ?? '';
  const perfil = params.get('perfil') ?? '';
  const situacao = params.get('situacao') ?? '';
  const filialFiltro = params.get('filial') ?? '';
  const provisorios = params.get('provisorios') === '1';

  const lista = useQuery({
    queryKey: ['core', 'usuarios', q, perfil, situacao, provisorios],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (perfil) qs.set('perfil', perfil);
      if (situacao) qs.set('ativo', situacao === 'ativo' ? 'true' : 'false');
      if (provisorios) qs.set('provisorio', 'true');
      const resposta = UsuarioListaRespostaSchema.parse(await api(`/core/usuarios${qs.size ? `?${qs.toString()}` : ''}`));
      if (resposta.almoco_padrao) setPadraoDaLista(resposta.almoco_padrao);
      return resposta.itens;
    },
  });
  // §2: o selo "Bloqueado até" some sozinho, na hora em que o bloqueio vence (um único aviso do relógio, sem rede)
  const proximoFim = (lista.data ?? [])
    .map((u) => (u.bloqueio === 'tentativas' && u.bloqueio_ate ? new Date(u.bloqueio_ate).getTime() : NaN))
    .filter((t) => t > agora.getTime())
    .reduce((min, t) => Math.min(min, t), Infinity);
  useEffect(() => setAgora(new Date()), [lista.dataUpdatedAt]);
  useEffect(() => {
    if (!Number.isFinite(proximoFim)) return;
    const t = setTimeout(() => setAgora(new Date()), proximoFim - Date.now() + 500);
    return () => clearTimeout(t);
  }, [proximoFim]);
  const perfisQ = useQuery({ queryKey: ['core', 'perfis', 'opcoes'], queryFn: async () => PerfilOpcoesRespostaSchema.parse(await api('/core/perfis/opcoes')).itens });
  const opcoesDePerfil = perfisQ.data ?? [];
  // só o admin lê as licenças (`modulo.gerir_licencas`); sem elas a coluna e a lista de módulos não aparecem
  const licencasQ = useQuery({
    queryKey: ['core', 'licencas'],
    queryFn: async () => LicencasEstadoSchema.parse(await api('/core/licencas')),
    retry: false,
  });
  const licencas: LicencasEstado | undefined = licencasQ.data;
  // RN-CORE-55 (0069): supervisores e gerentes para a hierarquia da gaveta, de todos os ativos (a lista da tela pode estar filtrada)
  const ativosQ = useQuery({ queryKey: ['core', 'usuarios', 'ativos'], queryFn: async () => UsuarioListaRespostaSchema.parse(await api('/core/usuarios?ativo=true')).itens });
  const ativos = ativosQ.data ?? [];
  // filiais para a coluna, o filtro e a gaveta (RN-CORE-39); quem não consegue lê-las vê a lista sem a coluna
  const filiaisQ = useQuery({ queryKey: ['core', 'filiais', 'opcoes'], queryFn: async () => FiliaisListaSchema.parse(await api('/core/filiais')).itens.filter((f) => f.ativo), retry: false });
  const filiais = filiaisEmOrdem(filiaisQ.data ?? []);
  const semFilialNoApp = ativos.filter(estaSemFilial).length;
  const aviso0 = avisoSemFilial(semFilialNoApp, filialFiltro);

  const fechar = () => {
    setModal(null);
    setErroApi(null);
    setTentou(false);
    setNovaSenha('');
    setSenhaVisivel(false);
  };
  const concluir = async (msg: string | null) => {
    fechar();
    setAviso(msg);
    await qc.invalidateQueries({ queryKey: ['core', 'usuarios'] });
    await qc.invalidateQueries({ queryKey: ['core', 'licencas'] });
    await qc.invalidateQueries({ queryKey: ['core', 'perfis'] });
  };

  const mostrar = (res: ResultadoDoEmail) => {
    if (res.tipo === 'enviado') {
      setSemEmail(null);
      return concluir(res.texto);
    }
    setSemEmail(res);
    return concluir(null);
  };

  /** Módulos do perfil escolhido (o padrão do perfil base, RN-CORE-01) e os efetivos do formulário. */
  const perfilEscolhido = opcoesDePerfil.find((p) => p.codigo === form.perfis[0]);
  const baseEscolhida = perfilEscolhido?.base;
  const cargo = perfilEscolhido?.cargo ?? null;
  const regras = regrasDoCargo(cargo);
  const doPerfil: ModuloId[] = licencas && baseEscolhida ? (licencas.perfis[baseEscolhida] ?? []) : [];
  const efetivosDoForm = licencas
    ? efetivosPelasDependencias({
        modulos: licencas.modulos,
        dependencias: licencas.dependencias,
        ativosNoTenant: licencas.modulos.filter((m) => licencas.tenant[m] === true),
        doPerfil,
        removidosDoUsuario: [...desmarcados] as ModuloId[],
      })
    : [];
  const modulosDoForm = licencas ? modulosExibiveis(licencas.modulos.filter((m) => licencas.tenant[m] === true)) : [];

  /** Grava só a diferença das exceções do usuário (PUT por módulo; só o admin chega aqui, a API revalida). */
  const gravarModulos = async (usuarioId: string, antes: readonly string[]) => {
    if (!licencas) return;
    const depois = removidosDoFormulario(doPerfil, new Set(modulosDoForm.map((m) => m.id).filter((m) => !desmarcados.has(m))));
    const ids = new Set<string>([...antes, ...depois]);
    for (const modulo of ids) {
      const removerAgora = depois.includes(modulo as ModuloId);
      if (removerAgora === antes.includes(modulo)) continue;
      await api(`/core/licencas/usuarios/${usuarioId}/${modulo}`, { method: 'PUT', body: { ativo: !removerAgora } });
    }
  };

  const salvar = useMutation({
    mutationFn: async ({ editando, corpo }: { editando: UsuarioItem | null; corpo: FormularioUsuario }) => {
      if (editando) {
        await api(`/core/usuarios/${editando.id}`, { method: 'PUT', body: corpoDeEdicao(corpo, cargo, podeFilial) });
        await gravarModulos(editando.id, licencas?.usuarios.find((x) => x.id === editando.id)?.removidos ?? []);
        return null;
      }
      const criado = CriarUsuarioRespostaSchema.parse(await api('/core/usuarios', { method: 'POST', body: corpoDeCriacao(corpo, cargo, podeFilial) }));
      await gravarModulos(criado.id, []);
      return criado;
    },
    onSuccess: (criado, { editando, corpo }) => {
      setForm(FORMULARIO_VAZIO);
      if (editando || !criado) return concluir('Usuário atualizado.');
      return mostrar(resultadoDeCriar(criado.email_acesso, corpo.email.trim().toLowerCase(), corpo.senha));
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: async (u: UsuarioItem) => api(`/core/usuarios/${u.id}/ativo`, { method: 'PUT', body: { ativo: !u.ativo } }),
    onSuccess: (_r, u) => concluir(u.ativo ? 'Usuário desativado.' : 'Usuário reativado.'),
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const vincular = useMutation({
    mutationFn: async ({ provisorio, real }: { provisorio: UsuarioItem; real: UsuarioItem }) => VincularErpRespostaSchema.parse(await api(`/core/usuarios/${provisorio.id}/vincular-erp`, { method: 'POST', body: corpoDeVinculoErp(real.id) })),
    onSuccess: async (r, { provisorio, real }) => {
      setVinculo(null);
      toast('success', textoDoVinculoErp(r, real.nome));
      setForm((f) => ({ ...f, external_id: r.external_id }));
      if (modal?.tipo === 'form' && modal.usuario?.id === real.id) setModal({ tipo: 'form', usuario: { ...modal.usuario, external_id: r.external_id } });
      qc.setQueriesData<UsuarioItem[]>({ queryKey: ['core', 'usuarios'] }, (velha) => velha?.filter((x) => x.id !== provisorio.id));
      await qc.invalidateQueries({ queryKey: ['core', 'usuarios'] });
    },
    onError: (e) => setVinculo((v) => (v ? { ...v, erro: errorMessage(e) } : v)),
  });
  const redefinir = useMutation({
    mutationFn: async (u: UsuarioItem) => api(`/core/usuarios/${u.id}/senha`, { method: 'PUT', body: corpoDeRedefinicao(novaSenha) }),
    onSuccess: (r, u) => {
      const email = RedefinirSenhaRespostaSchema.parse(r).email_acesso;
      if (u.sem_senha) return concluir(textoAcessoEnviado(u.email));
      return mostrar(resultadoDeRedefinir(email, u.email, novaSenha));
    },
    onError: (e, u) => {
      const codigo = (e as { code?: string } | null)?.code;
      if (codigo === 'EMAIL_INDISPONIVEL' && u.sem_senha) setErroApi(TEXTO_ENVIAR_ACESSO_SEM_EMAIL);
      else if (codigo === 'SENHA_PROPRIA' || codigo === 'SENHA_DE_ADMIN') setErroApi(TEXTO_SENHA_NAO_REDEFINIVEL);
      else setErroApi(errorMessage(e));
    },
  });

  const desbloquear = useMutation({
    mutationFn: async ({ u }: { u: UsuarioItem; naGaveta: boolean }) => DesbloquearUsuarioRespostaSchema.parse(await api(`/core/usuarios/${u.id}/bloqueio`, { method: 'DELETE' })),
    onMutate: () => {
      setErroDaLista(null);
      setAnuncio('');
    },
    onSuccess: async (_r, { u, naGaveta }) => {
      // §5: sem toast nem aviso; o selo some e o leitor de tela ouve "Desbloqueado."
      qc.setQueriesData<UsuarioItem[]>({ queryKey: ['core', 'usuarios'] }, (velha) => velha?.map((x) => (x.id === u.id ? { ...x, bloqueio: null, bloqueio_ate: null } : x)));
      if (modal?.tipo === 'form' && modal.usuario?.id === u.id) setModal({ tipo: 'form', usuario: { ...modal.usuario, bloqueio: null, bloqueio_ate: null } });
      setAnuncio('Desbloqueado.');
      if (naGaveta) campoNome.current?.focus();
      await qc.invalidateQueries({ queryKey: ['core', 'usuarios'] });
    },
    onError: (e, { naGaveta }) => (naGaveta ? setErroApi(errorMessage(e)) : setErroDaLista(errorMessage(e))),
  });
  const desbloqueando = (u: UsuarioItem) => desbloquear.isPending && desbloquear.variables?.u.id === u.id;
  const seloDe = (u: UsuarioItem): SeloDoUsuario | null => seloDoUsuario(u, agora, fuso);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const abrirForm = (u: UsuarioItem | null) => {
    setAviso(null);
    setSemEmail(null);
    setErroApi(null);
    setTentou(false);
    setForm(u ? formularioDoUsuario(u, padraoAlmoco) : formularioNovo(padraoAlmoco));
    setDesmarcados(new Set(u ? (licencas?.usuarios.find((x) => x.id === u.id)?.removidos ?? []) : []));
    setModal({ tipo: 'form', usuario: u });
  };
  const editando = modal?.tipo === 'form' ? modal.usuario : null;
  const comSenha = (f: FormularioUsuario): FormularioUsuario => (editando ? f : { ...f, senha: f.senha || gerarSenhaNoNavegador() });
  const erros = modal?.tipo === 'form' ? errosDoFormulario(comSenha(form), editando ? 'editar' : 'criar', { cargo, pessoas: pessoasDaLista(ativos) }) : [];
  const erroDe = (campo: string) => (tentou ? erros.find((e) => e.campo === campo)?.mensagem : undefined);
  const ocupado = salvar.isPending || alternar.isPending || redefinir.isPending || vincular.isPending;
  const upd = (patch: Partial<FormularioUsuario>) => setForm((f) => ({ ...f, ...patch }));

  const itens = filtrarPorFilial(lista.data ?? [], filialFiltro);
  const comColunaFilial = mostraColunaFilial(filialFiltro);
  const colunas = comColunaFilial ? 7 : 6;
  // um perfil por usuário (0069, R-20261114-153500)
  const rotuloDoPerfilDe = (u: UsuarioItem) => (u.perfis[0] ? rotuloDoPerfil(u.perfis[0].codigo, { nome: u.perfis[0].nome }) : ROTULO_PERFIL[u.perfil]);
  const supervisores = opcoesDeChefia(ativos, 'supervisor', cargo === 'promotor' ? form.gerente_id : '').filter((u) => u.id !== editando?.id);
  const gerentes = opcoesDeChefia(ativos, 'gerente').filter((u) => u.id !== editando?.id);
  // ordem do menu (§3 de usuario-bloqueio.md): Desbloquear · Editar · Redefinir senha · ── · Desativar (o MenuAcoes põe o perigo por último)
  const menuDe = (u: UsuarioItem): AcaoDoMenu[] => [
    ...(podeDesbloquear && seloDe(u)?.bloqueado
      ? [{ id: 'desbloquear', rotulo: desbloqueando(u) ? 'Desbloqueando…' : 'Desbloquear', desligada: desbloqueando(u), aoEscolher: () => desbloquear.mutate({ u, naGaveta: false }), testId: `usuarios.desbloquear.${u.id}` }]
      : []),
    ...(podeEditar ? [{ id: 'editar', rotulo: 'Editar', aoEscolher: () => abrirForm(u), testId: `usuarios.editar.${u.id}` }] : []),
    ...(podeSenha && acaoDeSenha(u)
      ? [
          {
            id: 'senha',
            rotulo: acaoDeSenha(u)!.rotulo,
            testId: `usuarios.senha.${u.id}`,
            aoEscolher: () => {
              setAviso(null);
              setErroApi(null);
              setNovaSenha('');
              setModal({ tipo: 'senha', usuario: u });
            },
          },
        ]
      : []),
    ...(podeDesativar
      ? [
          {
            id: 'alternar',
            rotulo: u.ativo ? 'Desativar' : 'Reativar',
            perigo: u.ativo,
            testId: `usuarios.alternar.${u.id}`,
            aoEscolher: () => {
              setAviso(null);
              setErroApi(null);
              setModal({ tipo: 'ativo', usuario: u });
            },
          },
        ]
      : []),
  ];
  const seloDaGaveta = editando && podeDesbloquear ? seloDe(editando) : null;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="usuarios.tela">
      <PageHeader
        title="Usuários"
        actions={
          podeCriar && (
            <Button variant="primary" onClick={() => abrirForm(null)} data-testid="usuarios.novo">
              Novo usuário
            </Button>
          )
        }
      />
      {semEmail && (
        <Notice tone="warning" onClose={() => setSemEmail(null)}>
          <span data-testid="usuarios.aviso-sem-email">
            {semEmail.antes}
            <strong className="font-mono">{semEmail.senha}</strong>
            {semEmail.depois}
          </span>{' '}
          <button type="button" className={BOTAO_LINHA} onClick={() => void copiarSenha(semEmail.senha)} data-testid="usuarios.copiar-senha">
            Copiar senha
          </button>
        </Notice>
      )}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {erroDaLista && (
        <Notice tone="danger" onClose={() => setErroDaLista(null)}>
          <span data-testid="usuarios.erro-lista">{erroDaLista}</span>
        </Notice>
      )}
      <span className="sr-only" aria-live="polite" data-testid="usuarios.anuncio">
        {anuncio}
      </span>
      {aviso0 && (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-3" data-testid="usuarios.aviso-sem-filial">
            {aviso0.texto}
            <button type="button" className={BOTAO_LINHA} onClick={() => set({ filial: FILTRO_FILIAL_SEM, q: null, perfil: null, situacao: 'ativo' })} data-testid="usuarios.ver-sem-filial">
              {aviso0.botao}
            </button>
          </span>
        </Notice>
      )}
      <FilterBar>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          Buscar
          <input
            defaultValue={q}
            onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value })}
            onBlur={(e) => set({ q: e.currentTarget.value })}
            data-testid="usuarios.busca"
            className={CLASSE_CAMPO_BKO}
          />
        </label>
        <SelectField label="Perfil" value={perfil} onChange={(e) => set({ perfil: e.target.value })} data-testid="usuarios.filtro-perfil">
          <option value="">Todos</option>
          {opcoesDePerfil.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {rotuloDoPerfil(p.codigo, { nome: p.nome })}
            </option>
          ))}
        </SelectField>
        <SelectField label="Situação" value={situacao} onChange={(e) => set({ situacao: e.target.value })} data-testid="usuarios.filtro-situacao">
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </SelectField>
        <SelectField label="Provisórios" value={provisorios ? '1' : ''} onChange={(e) => set({ provisorios: e.target.value })} data-testid="usuarios.filtro-provisorios">
          <option value="">Todos os usuários</option>
          <option value="1">Só provisórios</option>
        </SelectField>
        {filiaisQ.data && (
          <SelectField label="Filial de cadastro" value={filialFiltro} onChange={(e) => set({ filial: e.target.value })} data-testid="usuarios.filtro-filial">
            <option value="">Todas</option>
            <option value={FILTRO_FILIAL_SEM}>{SELO_SEM_FILIAL}</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </SelectField>
        )}
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os usuários…" />}

      {lista.data && (
        <Panel label="Usuários">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Nome</th>
                <th className={th}>E-mail</th>
                <th className={th}>Perfil</th>
                {comColunaFilial && <th className={th}>Filial</th>}
                <th className={th}>Código FDV</th>
                <th className={th}>Módulos</th>
                <th className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td className={td} colSpan={colunas}>
                    Nenhum usuário com esses filtros. Limpe a busca ou os filtros para ver todos.
                  </td>
                </tr>
              )}
              {itens.map((u) => {
                const modulos = licencas ? modulosExibiveis(efetivosDoUsuario(licencas, u.id)) : null;
                const selo = seloDe(u);
                return (
                  <tr key={u.id} data-testid={`usuarios.linha.${u.id}`}>
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-2">
                        {u.nome}
                        {u.provisorio && (
                          <span data-testid={`usuarios.provisorio.${u.id}`}>
                            <Badge tone="neutral">Provisório</Badge>
                          </span>
                        )}
                        {selo && (
                          <span data-testid={`usuarios.selo.${u.id}`}>
                            <Badge tone={selo.tom}>{selo.texto}</Badge>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{emailParaLista(u)}</td>
                    <td className={td}>{rotuloDoPerfilDe(u)}</td>
                    {comColunaFilial && (
                      <td className={td} data-testid={`usuarios.filial.${u.id}`}>
                        {estaSemFilial(u) ? <Badge tone="danger">{SELO_SEM_FILIAL}</Badge> : (nomeDaFilialDe(u, filiais) ?? '—')}
                      </td>
                    )}
                    <td className={`${td} font-mono`} data-testid={`usuarios.codigo-fdv.${u.id}`}>
                      {codigoFdvParaLista(u)}
                    </td>
                    <td className={td}>
                      {modulos === null ? (
                        '—'
                      ) : (
                        <span className="flex flex-wrap gap-1" data-testid={`usuarios.modulos.${u.id}`}>
                          {modulos.length === 0 ? '—' : modulos.map((m) => <IconeComNome key={m.id} id={m.id} nome={m.nome} />)}
                        </span>
                      )}
                    </td>
                    <td className={`${td} w-[56px] text-right`}>
                      <MenuAcoes rotulo={`Ações de ${u.nome}`} acoes={menuDe(u)} testId={`usuarios.menu.${u.id}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      <Drawer open={modal?.tipo === 'form'} title={editando ? 'Editar usuário' : 'Novo usuário'} onClose={fechar}>
        <form
          className="flex min-h-full flex-col gap-4"
          data-testid="usuarios.gaveta"
          onSubmit={(e) => {
            e.preventDefault();
            setTentou(true);
            setErroApi(null);
            const corpo = comSenha(form);
            if (erros.length === 0 && !erroDaFilialCadastro(form, podeFilial) && !ocupado) salvar.mutate({ editando, corpo });
          }}
        >
          {editando && seloDaGaveta?.bloqueado && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-[3px]" data-testid="usuarios.gaveta-bloqueio">
              <Badge tone={seloDaGaveta.tom}>{seloDaGaveta.texto}</Badge>
              <Button size="sm" disabled={desbloqueando(editando)} onClick={() => desbloquear.mutate({ u: editando, naGaveta: true })} data-testid="usuarios.gaveta-desbloquear">
                {desbloqueando(editando) ? 'Desbloqueando…' : 'Desbloquear'}
              </Button>
            </div>
          )}
          <Campo rotulo="Nome" erro={erroDe('nome')}>
            <input ref={campoNome} value={form.nome} onChange={(e) => upd({ nome: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-nome" />
          </Campo>
          <Campo rotulo="E-mail" erro={erroDe('email')}>
            <input type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-email" />
          </Campo>
          <Campo rotulo="Perfil" erro={tentou && form.perfis.length === 0 ? ERRO_SEM_PERFIL : undefined}>
            <select
              value={form.perfis[0] ?? ''}
              onChange={(e) => upd({ perfis: e.target.value ? [e.target.value] : [], perfil: opcoesDePerfil.find((p) => p.codigo === e.target.value)?.base ?? form.perfil })}
              className={CLASSE_CAMPO_BKO}
              data-testid="usuarios.campo-perfis"
            >
              <option value="">Escolha…</option>
              {opcoesDePerfil.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {rotuloDoPerfil(p.codigo, { nome: p.nome })}
                </option>
              ))}
            </select>
          </Campo>
          {(regras.gerente === 'obrigatorio' || regras.gerente === 'opcional') && (
            <Campo rotulo="Gerente" erro={erroDe('gerente_id')}>
              <select
                value={form.gerente_id}
                onChange={(e) => upd({ gerente_id: e.target.value, ...(cargo === 'promotor' && ativos.find((x) => x.id === form.supervisor_id)?.gerente_id !== e.target.value ? { supervisor_id: '' } : {}) })}
                className={CLASSE_CAMPO_BKO}
                data-testid="usuarios.campo-gerente"
              >
                <option value="">Escolha…</option>
                {gerentes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {regras.supervisor !== 'nao' && (
            <Campo rotulo="Supervisor" erro={erroDe('supervisor_id')}>
              <select value={form.supervisor_id} onChange={(e) => upd({ supervisor_id: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-supervisor">
                <option value="">{regras.supervisor === 'opcional' ? 'Sem supervisor' : 'Escolha…'}</option>
                {supervisores.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {regras.nomeEquipe !== 'nao' && (
            <Campo rotulo="Nome da equipe" erro={erroDe('equipe_nome')}>
              <input value={form.equipe_nome} maxLength={80} onChange={(e) => upd({ equipe_nome: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-equipe-nome" />
            </Campo>
          )}
          {podeFilial && (
            <>
              <Campo rotulo="Filial de cadastro" erro={erroDaFilialCadastro(form, tentou)}>
                <select value={form.filial_cadastro_id} onChange={(e) => upd(escolherCadastro(form, e.target.value))} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-filial-cadastro">
                  <option value="">Escolha…</option>
                  {filiais.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="usuarios.filiais-venda">
                <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Filiais de venda</legend>
                <div className="grid grid-cols-2 gap-2">
                  {filiais.map((f) => {
                    const travada = vendaTravada(form, f.id);
                    return (
                      <label key={f.id} className={`flex min-h-[48px] items-center gap-3 rounded-xl border border-line px-3 text-[15px] font-semibold text-ink ${travada ? 'bg-ground' : 'bg-surface'}`}>
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-accent"
                          checked={form.filial_venda_ids.includes(f.id)}
                          aria-disabled={travada || undefined}
                          aria-label={descricaoParaLeitor(f.nome, form, f.id)}
                          onChange={() => !travada && upd(alternarVenda(form, f.id))}
                          data-testid={`usuarios.filial-venda.${f.id}`}
                        />
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          {f.nome}
                          {travada && <span className="text-[12px] font-normal text-ink-2">{ROTULO_FILIAL_DE_CADASTRO}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}
          {editando && (
            <Campo rotulo="Código FDV">
              <span className="flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-1" data-testid="usuarios.codigo-fdv">
                <span className="flex-1 font-mono text-[15px] font-medium text-ink" data-testid="usuarios.campo-codigo-fdv">
                  {codigoFdvParaLista(editando)}
                </span>
                {editando.codigo_fdv && (
                  <button type="button" aria-label="Copiar código FDV" onClick={() => void copiarCodigoFdv(editando.codigo_fdv!)} className="flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-line bg-surface text-ink" data-testid="usuarios.copiar-codigo-fdv">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                      <path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
                    </svg>
                  </button>
                )}
              </span>
            </Campo>
          )}
          <Campo rotulo="Código no ERP" erro={erroDe('external_id')}>
            <input value={form.external_id} maxLength={100} onChange={(e) => upd({ external_id: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="usuarios.campo-external-id" />
          </Campo>
          {editando && podeEditar && podeVincularErp(ativos, editando) && form.external_id.trim() === '' && (
            <div>
              <Button onClick={() => setVinculo({ real: editando, escolhido: '', etapa: 'escolher', erro: null })} data-testid="usuarios.vincular">
                <IconUser size={18} /> Vincular vendedor do ERP
              </Button>
            </div>
          )}
          {editando && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="usuarios.jornada">
              <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Horário de almoço</legend>
              <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-surface px-3 text-[15px] font-semibold text-ink">
                <input type="checkbox" className="h-5 w-5 accent-accent" checked={form.almoco_padrao} onChange={(e) => upd({ almoco_padrao: e.target.checked })} data-testid="usuarios.campo-almoco-padrao" />
                Padrão da empresa ({rotuloDoAlmoco(padraoAlmoco)})
              </label>
              {!form.almoco_padrao && (
                <div className="flex flex-wrap items-start gap-3">
                  <Campo rotulo="Início" erro={erroDe('almoco_inicio')}>
                    <input value={form.almoco_inicio} inputMode="numeric" aria-invalid={erroDe('almoco_inicio') ? true : undefined} onChange={(e) => upd({ almoco_inicio: e.target.value })} className={`${CLASSE_CAMPO_BKO} w-[120px]`} data-testid="usuarios.campo-almoco-inicio" />
                  </Campo>
                  <Campo rotulo="Fim" erro={erroDe('almoco_fim')}>
                    <input value={form.almoco_fim} inputMode="numeric" aria-invalid={erroDe('almoco_fim') ? true : undefined} onChange={(e) => upd({ almoco_fim: e.target.value })} className={`${CLASSE_CAMPO_BKO} w-[120px]`} data-testid="usuarios.campo-almoco-fim" />
                  </Campo>
                </div>
              )}
            </fieldset>
          )}
          {licencas && (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="usuarios.modulos-campo">
              <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Módulos</legend>
              {modulosDoForm.map((m) => {
                const noPerfil = doPerfil.includes(m.id);
                const marcado = efetivosDoForm.includes(m.id);
                return (
                  <label key={m.id} className={`flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-surface px-3 text-[15px] font-semibold ${noPerfil ? 'text-ink' : 'text-disabled'}`}>
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-accent"
                      checked={marcado}
                      disabled={!noPerfil}
                      onChange={() =>
                        setDesmarcados((d) => {
                          const novo = new Set(d);
                          if (marcado) novo.add(m.id);
                          else novo.delete(m.id);
                          return novo;
                        })
                      }
                      data-testid={`usuarios.modulo.${m.id}`}
                    />
                    <IconeModulo id={m.id} size={18} />
                    {m.nome}
                  </label>
                );
              })}
            </fieldset>
          )}
          {erroApi && (
            <Notice tone="danger">
              <span data-testid="usuarios.erro">{erroApi}</span>
            </Notice>
          )}
          <div className="sticky -bottom-4 -mx-5 -mb-4 mt-auto flex justify-end gap-2 border-t border-line bg-ground px-5 py-3">
            <Button onClick={fechar} data-testid="usuarios.cancelar">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={ocupado} data-testid="usuarios.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Drawer>

      {vinculo &&
        (() => {
          const opcoes = provisoriosParaVincular(ativos, vinculo.real);
          const escolhido = opcoes.find((x) => x.id === vinculo.escolhido);
          const confirmando = vinculo.etapa === 'confirmar' && escolhido;
          return (
            <Dialog
              open
              title={confirmando ? tituloDaConfirmacaoDoVinculo(escolhido, vinculo.real) : 'Vincular vendedor do ERP'}
              onClose={() => setVinculo(null)}
              footer={
                confirmando ? (
                  <>
                    <Button onClick={() => setVinculo({ ...vinculo, etapa: 'escolher', erro: null })} data-testid="usuarios.vincular-voltar">
                      Voltar
                    </Button>
                    <Button variant="primary" disabled={vincular.isPending} onClick={() => vincular.mutate({ provisorio: escolhido, real: vinculo.real })} data-testid="usuarios.vincular-confirmar">
                      {vincular.isPending ? 'Vinculando…' : 'Vincular'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setVinculo(null)} data-testid="usuarios.vincular-cancelar">
                      Cancelar
                    </Button>
                    <Button variant="primary" disabled={!escolhido} onClick={() => setVinculo({ ...vinculo, etapa: 'confirmar', erro: null })} data-testid="usuarios.vincular-continuar">
                      Continuar
                    </Button>
                  </>
                )
              }
            >
              <div className="flex flex-col gap-3">
                {confirmando ? (
                  <p className="m-0">{textoDaConfirmacaoDoVinculo(escolhido)}</p>
                ) : (
                  <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="mb-2 p-0 text-[15px] font-normal text-ink">Escolha o vendedor provisório que é {vinculo.real.nome}.</legend>
                    {opcoes.map((x) => (
                      <label key={x.id} className={`flex min-h-[56px] items-center gap-3 rounded-xl border px-3 text-[15px] ${vinculo.escolhido === x.id ? 'border-2 border-accent' : 'border-line'}`}>
                        <input type="radio" name="provisorio" className="h-5 w-5 accent-accent" checked={vinculo.escolhido === x.id} onChange={() => setVinculo({ ...vinculo, escolhido: x.id })} data-testid={`usuarios.vincular-opcao.${x.id}`} />
                        <span className="flex flex-col">
                          <span className="font-semibold text-ink">{x.nome}</span>
                          <span className="text-[13px] text-ink-2">{textoDaOpcaoDoProvisorio(x)}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {vinculo.erro && <Notice tone="danger">{vinculo.erro}</Notice>}
              </div>
            </Dialog>
          );
        })()}

      <Dialog
        open={modal?.tipo === 'ativo'}
        title={modal?.tipo === 'ativo' && modal.usuario.ativo ? 'Desativar este usuário?' : 'Reativar este usuário?'}
        onClose={fechar}
        footer={
          <>
            <Button onClick={fechar} data-testid="usuarios.ativo-cancelar">
              Cancelar
            </Button>
            <Button
              variant={modal?.tipo === 'ativo' && modal.usuario.ativo ? 'danger' : 'primary'}
              disabled={ocupado}
              onClick={() => modal?.tipo === 'ativo' && alternar.mutate(modal.usuario)}
              data-testid="usuarios.ativo-confirmar"
            >
              {alternar.isPending ? 'Salvando…' : 'Confirmar'}
            </Button>
          </>
        }
      >
        {modal?.tipo === 'ativo' && (
          <div className="flex flex-col gap-3">
            <p className="m-0">
              {modal.usuario.ativo
                ? `${modal.usuario.nome} perde o acesso e sai de todos os aparelhos.`
                : `${modal.usuario.nome} volta a entrar com a senha atual.`}
            </p>
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={modal?.tipo === 'senha'}
        title={modal?.tipo === 'senha' ? (modal.usuario.sem_senha ? `Enviar acesso para ${modal.usuario.nome}?` : `Redefinir a senha de ${modal.usuario.nome}?`) : 'Redefinir senha'}
        onClose={fechar}
        footer={
          <>
            <Button onClick={fechar} data-testid="usuarios.senha-cancelar">
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={ocupado || (modal?.tipo === 'senha' && !modal.usuario.sem_senha && faltasDaSenhaDigitada(novaSenha).length > 0)}
              onClick={() => modal?.tipo === 'senha' && redefinir.mutate(modal.usuario)}
              data-testid="usuarios.senha-confirmar"
            >
              {modal?.tipo === 'senha' && modal.usuario.sem_senha ? (redefinir.isPending ? 'Enviando…' : 'Enviar acesso') : redefinir.isPending ? 'Redefinindo…' : 'Redefinir senha'}
            </Button>
          </>
        }
      >
        {modal?.tipo === 'senha' && (
          <div className="flex flex-col gap-3">
            {modal.usuario.sem_senha ? (
              <p className="m-0">O acesso vai para {modal.usuario.email}.</p>
            ) : (
              <>
                <p className="m-0">
                  {modal.usuario.nome} sai de todos os aparelhos e recebe a senha nova em {modal.usuario.email}.
                </p>
                <CampoSenha
                  id="usuarios-senha-nova"
                  rotulo="Senha nova"
                  finalidade="criacao"
                  visivel={senhaVisivel}
                  onAlternar={() => setSenhaVisivel((v) => !v)}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  descrito="usuarios-regras-senha-nova"
                  testId="usuarios.senha-campo"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOTAO_LINHA}
                    onClick={() => {
                      setNovaSenha(gerarSenhaNoNavegador());
                      setSenhaVisivel(true);
                    }}
                    data-testid="usuarios.senha-gerar"
                  >
                    Gerar senha
                  </button>
                </div>
                <RegrasDaSenha id="usuarios-regras-senha-nova" faltas={faltasDaSenhaDigitada(novaSenha)} minimo={SENHA_MIN_CARACTERES} resumo={mensagemDaSenha(faltasDaSenhaDigitada(novaSenha)) ?? undefined} />
              </>
            )}
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** `useSearchParams` exige Suspense no Next. */
export function UsuariosPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando…" />}>
      <UsuariosConteudo />
    </Suspense>
  );
}
