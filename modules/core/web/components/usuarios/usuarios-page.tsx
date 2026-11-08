'use client';

import { Suspense, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, RegrasDaSenha, SelectField, td, th, TableScroll, useToast, alternarMarcado, AJUDA_CAMPO_PERFIS, AJUDA_PREVIA_MODULOS, ERRO_SEM_PERFIL, ROTULO_CAMPO_PERFIS, ROTULO_PERFIL_BASE, SELO_PADRAO, SeletorDePerfis, textoOndeEntra, TITULO_PREVIA_MODULOS } from '@macuxi/ui/web';
import { CriarUsuarioRespostaSchema, EquipeListaRespostaSchema, PerfilOpcoesRespostaSchema, RedefinirSenhaRespostaSchema, UsuarioListaRespostaSchema, type UsuarioItem } from '../../../contracts';
import {
  acaoDeSenha,
  AJUDA_SENHA_INICIAL,
  corpoDeRedefinicao,
  etiquetaDeSenha,
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
  csvDeUsuarios,
  errosDoFormulario,
  FORMULARIO_VAZIO,
  formularioDoUsuario,
  ondeEntraDosPerfis,
  ROTULO_PERFIL,
  textoDoSuperiorDaEquipe,
  type FormularioUsuario,
} from '../../lib/usuarios';
import { useMe } from '../../lib/queries';

const CAMPO = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink';
const BOTAO_LINHA = 'h-[44px] min-w-[88px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:text-disabled';

type Modal = { tipo: 'form'; usuario: UsuarioItem | null } | { tipo: 'ativo'; usuario: UsuarioItem } | { tipo: 'senha'; usuario: UsuarioItem } | null;

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
 * Tela "Usuários" do BKO (RF-CORE-02; T-0067; T-0094): lista com busca e filtros na URL, exportar CSV e, só para quem tem as chaves do motor
 * (`usuario.criar|editar|desativar`, `senha.redefinir`; fábrica = admin), criar (senha inicial por e-mail, com "Gerar senha"), editar, ativar/desativar e "Redefinir senha" /
 * "Enviar acesso" (nunca para admin, P7). O gerente consulta as equipes abaixo (a API recorta pelo escopo, RN-CORE-04);
 * supervisor não usa o BKO (RN-CORE-33). O superior imediato deriva da equipe. Nunca apaga usuário. A senha nunca é guardada
 * na tela depois de salvar. testIDs: docs/modulos/core/test-ids.md.
 */
function UsuariosConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const podeCriar = usePode('usuario.criar');
  const podeEditar = usePode('usuario.editar');
  const podeDesativar = usePode('usuario.desativar');
  const podeSenha = usePode('senha.redefinir');
  const pode = podeCriar || podeEditar || podeDesativar || podeSenha;
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<FormularioUsuario>(FORMULARIO_VAZIO);
  const [tentou, setTentou] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // e-mail que não saiu: a senha aparece UMA vez, da memória da tela, e some ao fechar o aviso ou sair da página
  const [semEmail, setSemEmail] = useState<Extract<ResultadoDoEmail, { tipo: 'sem_email' }> | null>(null);
  const fuso = useMe().data.tenant.timezone;
  const toast = useToast();
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
  const equipe = params.get('equipe') ?? '';
  const situacao = params.get('situacao') ?? '';

  const lista = useQuery({
    queryKey: ['core', 'usuarios', q, perfil, equipe, situacao],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (perfil) qs.set('perfil', perfil);
      if (equipe) qs.set('equipe_id', equipe);
      if (situacao) qs.set('ativo', situacao === 'ativo' ? 'true' : 'false');
      return UsuarioListaRespostaSchema.parse(await api(`/core/usuarios${qs.size ? `?${qs.toString()}` : ''}`)).itens;
    },
  });
  const equipesQ = useQuery({ queryKey: ['core', 'equipes'], queryFn: async () => EquipeListaRespostaSchema.parse(await api('/core/equipes')).itens });
  const equipes = equipesQ.data ?? [];
  const perfisQ = useQuery({ queryKey: ['core', 'perfis', 'opcoes'], queryFn: async () => PerfilOpcoesRespostaSchema.parse(await api('/core/perfis/opcoes')).itens });
  const opcoesDePerfil = perfisQ.data ?? [];

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
    await qc.invalidateQueries({ queryKey: ['core', 'equipes'] });
  };

  const mostrar = (res: ResultadoDoEmail) => {
    if (res.tipo === 'enviado') {
      setSemEmail(null);
      return concluir(res.texto);
    }
    setSemEmail(res);
    return concluir(null);
  };

  const salvar = useMutation({
    mutationFn: async (editando: UsuarioItem | null) =>
      editando ? api(`/core/usuarios/${editando.id}`, { method: 'PUT', body: corpoDeEdicao(form) }) : api('/core/usuarios', { method: 'POST', body: corpoDeCriacao(form) }),
    onSuccess: (r, editando) => {
      if (editando) {
        setForm(FORMULARIO_VAZIO);
        return concluir('Usuário atualizado.');
      }
      const res = resultadoDeCriar(CriarUsuarioRespostaSchema.parse(r).email_acesso, form.email.trim().toLowerCase(), form.senha);
      setForm(FORMULARIO_VAZIO); // a senha digitada sai da memória da tela assim que o servidor responde
      return mostrar(res);
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: async (u: UsuarioItem) => api(`/core/usuarios/${u.id}/ativo`, { method: 'PUT', body: { ativo: !u.ativo } }),
    onSuccess: (_r, u) => concluir(u.ativo ? 'Usuário desativado. Ele perde o acesso na próxima requisição e as sessões foram encerradas.' : 'Usuário reativado. Ele já pode entrar com a senha atual.'),
    onError: (e) => setErroApi(errorMessage(e)),
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
    setForm(u ? formularioDoUsuario(u) : FORMULARIO_VAZIO);
    setModal({ tipo: 'form', usuario: u });
  };
  const editando = modal?.tipo === 'form' ? modal.usuario : null;
  const erros = modal?.tipo === 'form' ? errosDoFormulario(form, editando ? 'editar' : 'criar') : [];
  const erroDe = (campo: string) => (tentou ? erros.find((e) => e.campo === campo)?.mensagem : undefined);
  const ocupado = salvar.isPending || alternar.isPending || redefinir.isPending;
  const upd = (patch: Partial<FormularioUsuario>) => setForm((f) => ({ ...f, ...patch }));

  const itens = lista.data ?? [];
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="usuarios.tela">
      <PageHeader
        title="Usuários"
        subtitle="Quem entra no Macuxi, com qual perfil e em qual equipe. O superior imediato vem da equipe. Usuário não se apaga: desative para cortar o acesso."
        actions={
          <>
            {podeCriar && (
              <Button variant="primary" onClick={() => abrirForm(null)} data-testid="usuarios.novo">
                Novo usuário
              </Button>
            )}
            <Button onClick={() => downloadBlob(new Blob([csvDeUsuarios(itens)], { type: 'text/csv;charset=utf-8' }), 'usuarios.csv')} disabled={itens.length === 0} data-testid="usuarios.exportar-csv">
              Exportar CSV
            </Button>
          </>
        }
      />
      {!pode && <Notice tone="info">O seu perfil só consulta usuários. Para criar ou alterar, peça a quem administra a sua empresa.</Notice>}
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
      <FilterBar>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          Buscar por nome ou e-mail
          <input
            defaultValue={q}
            onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value })}
            onBlur={(e) => set({ q: e.currentTarget.value })}
            data-testid="usuarios.busca"
            className={CAMPO}
          />
        </label>
        <SelectField label="Perfil" value={perfil} onChange={(e) => set({ perfil: e.target.value })} data-testid="usuarios.filtro-perfil">
          <option value="">Todos</option>
          {opcoesDePerfil.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Equipe" value={equipe} onChange={(e) => set({ equipe: e.target.value })} data-testid="usuarios.filtro-equipe">
          <option value="">Todas</option>
          {equipes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Situação" value={situacao} onChange={(e) => set({ situacao: e.target.value })} data-testid="usuarios.filtro-situacao">
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </SelectField>
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os usuários…" />}

      {lista.data && (
        <Panel title={`${itens.length} usuário${itens.length === 1 ? '' : 's'}`}>
          <TableScroll minWidth={980}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Nome</th>
                  <th className={th}>E-mail</th>
                  <th className={th}>Perfis</th>
                  <th className={th}>Equipe</th>
                  <th className={th}>Superior imediato</th>
                  <th className={th}>Código do ERP</th>
                  <th className={th}>Situação</th>
                  {pode && <th className={th}>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && (
                  <tr>
                    <td className={td} colSpan={pode ? 8 : 7}>
                      Nenhum usuário com esses filtros. Limpe a busca ou os filtros para ver todos.
                    </td>
                  </tr>
                )}
                {itens.map((u) => (
                  <tr key={u.id} data-testid={`usuarios.linha.${u.id}`}>
                    <td className={td}>{u.nome}</td>
                    <td className={td}>{u.email}</td>
                    <td className={td} title={u.perfis.map((p) => p.nome).join(', ')}>
                      {u.perfis.length === 0 ? ROTULO_PERFIL[u.perfil] : u.perfis.length <= 2 ? u.perfis.map((p) => p.nome).join(', ') : `${u.perfis.slice(0, 2).map((p) => p.nome).join(', ')} +${u.perfis.length - 2}`}
                    </td>
                    <td className={td}>{u.equipe_nome ?? '—'}</td>
                    <td className={td}>{u.superior_nome ?? '—'}</td>
                    <td className={td}>{u.external_id ?? '—'}</td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                        {(() => {
                          const e = etiquetaDeSenha(u, fuso);
                          return e ? (
                            <span data-testid={`usuarios.etiqueta-senha.${u.id}`}>
                              <Badge tone={e.tom}>{e.texto}</Badge>
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    {pode && (
                      <td className={td}>
                        <div className="flex flex-wrap gap-2">
                          {podeEditar && (
                            <button type="button" className={BOTAO_LINHA} onClick={() => abrirForm(u)} data-testid={`usuarios.editar.${u.id}`}>
                              Editar
                            </button>
                          )}
                          {podeDesativar && (
                          <button
                            type="button"
                            className={BOTAO_LINHA}
                            onClick={() => {
                              setAviso(null);
                              setErroApi(null);
                              setModal({ tipo: 'ativo', usuario: u });
                            }}
                            data-testid={`usuarios.alternar.${u.id}`}
                          >
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                          )}
                          {podeSenha && acaoDeSenha(u) && (
                            <button
                              type="button"
                              className={`${BOTAO_LINHA} px-4`}
                              onClick={() => {
                                setAviso(null);
                                setErroApi(null);
                                setNovaSenha('');
                                setModal({ tipo: 'senha', usuario: u });
                              }}
                              data-testid={`usuarios.senha.${u.id}`}
                            >
                              {acaoDeSenha(u)?.rotulo}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      <Dialog
        open={modal?.tipo === 'form'}
        title={editando ? 'Editar usuário' : 'Novo usuário'}
        onClose={fechar}
        footer={
          <>
            <Button onClick={fechar} data-testid="usuarios.cancelar">
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={ocupado}
              onClick={() => {
                setTentou(true);
                setErroApi(null);
                if (erros.length === 0) salvar.mutate(editando);
              }}
              data-testid="usuarios.salvar"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Campo rotulo="Nome" erro={erroDe('nome')}>
            <input value={form.nome} onChange={(e) => upd({ nome: e.target.value })} className={CAMPO} data-testid="usuarios.campo-nome" />
          </Campo>
          <Campo rotulo="E-mail (usado no login)" erro={erroDe('email')}>
            <input type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} className={CAMPO} data-testid="usuarios.campo-email" />
          </Campo>
          <div className={opcoesDePerfil.length > 10 ? 'max-h-[280px] overflow-y-auto' : undefined}>
            <SeletorDePerfis
              nome="usuario-perfis"
              legenda={ROTULO_CAMPO_PERFIS}
              ajuda={AJUDA_CAMPO_PERFIS}
              opcoes={opcoesDePerfil.map((p) => ({ valor: p.codigo, rotulo: p.nome, detalhe: p.fabrica ? undefined : `Base: ${ROTULO_PERFIL_BASE[p.base]}`, selo: p.fabrica ? SELO_PADRAO : undefined }))}
              marcados={form.perfis}
              onChange={(valor) => upd({ perfis: alternarMarcado(form.perfis, valor, opcoesDePerfil.map((p) => p.codigo)) })}
              erro={tentou && form.perfis.length === 0 ? ERRO_SEM_PERFIL : null}
              testId="usuarios.campo-perfis"
            />
          </div>
          <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-ground p-3" aria-live="polite" data-testid="usuarios.previa">
            <span className="text-[12px] font-semibold text-ink-2">{TITULO_PREVIA_MODULOS}</span>
            {form.perfis.length === 0 ? (
              <span className="text-[12px] text-ink-2">Marque um perfil para ver onde a pessoa entra.</span>
            ) : (
              <>
                <span className="text-[13px]" data-testid="usuarios.previa.onde-entra">
                  {textoOndeEntra(ondeEntraDosPerfis(opcoesDePerfil.filter((p) => form.perfis.includes(p.codigo))))}
                </span>
                <span className="text-[12px] text-ink-2">{AJUDA_PREVIA_MODULOS}</span>
              </>
            )}
          </div>
          <Campo rotulo="Equipe">
            <select value={form.equipe_id} onChange={(e) => upd({ equipe_id: e.target.value })} className={CAMPO} data-testid="usuarios.campo-equipe">
              <option value="">Sem equipe</option>
              {equipes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </Campo>
          <p className="m-0 text-[12px] text-ink-2" data-testid="usuarios.superior">
            {textoDoSuperiorDaEquipe(equipes, form.equipe_id)}
          </p>
          <Campo rotulo="Código do ERP (opcional)" erro={erroDe('external_id')}>
            <input value={form.external_id} onChange={(e) => upd({ external_id: e.target.value })} className={CAMPO} data-testid="usuarios.campo-external-id" />
          </Campo>
          {!editando && (
            <div className="flex flex-col gap-2">
              <Campo rotulo="Senha inicial" erro={erroDe('senha')}>
                <input
                  type={senhaVisivel ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.senha}
                  onChange={(e) => upd({ senha: e.target.value })}
                  aria-describedby="usuarios-regras-senha"
                  className={CAMPO}
                  data-testid="usuarios.campo-senha"
                />
              </Campo>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BOTAO_LINHA}
                  onClick={() => {
                    upd({ senha: gerarSenhaNoNavegador() });
                    setSenhaVisivel(true);
                  }}
                  data-testid="usuarios.gerar-senha"
                >
                  Gerar senha
                </button>
                <button type="button" className={BOTAO_LINHA} onClick={() => setSenhaVisivel((v) => !v)} aria-pressed={senhaVisivel} data-testid="usuarios.mostrar-senha">
                  {senhaVisivel ? 'Esconder senha' : 'Mostrar senha'}
                </button>
              </div>
              <RegrasDaSenha id="usuarios-regras-senha" faltas={faltasDaSenhaDigitada(form.senha)} destacar={tentou && !!erroDe('senha')} />
              <p className="m-0 text-[12px] text-ink-2" data-testid="usuarios.aviso-email">
                {AJUDA_SENHA_INICIAL}
              </p>
            </div>
          )}
          {erroApi && (
            <Notice tone="danger">
              <span data-testid="usuarios.erro">{erroApi}</span>
            </Notice>
          )}
        </div>
      </Dialog>

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
                ? `${modal.usuario.nome} perde o acesso na próxima requisição e as sessões dele são encerradas. Os dados e o histórico ficam guardados. Fica registrado na auditoria.`
                : `${modal.usuario.nome} volta a poder entrar com a senha atual. Fica registrado na auditoria.`}
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
              <p className="m-0">O Macuxi gera uma senha temporária e manda para {modal.usuario.email}. A pessoa cria a dela no primeiro acesso.</p>
            ) : (
              <>
                <p className="m-0">A pessoa recebe a senha nova por e-mail e cria a dela no próximo acesso. Ela sai do Macuxi agora em todos os aparelhos.</p>
                <Campo rotulo="Senha nova">
                  <input
                    type={senhaVisivel ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    aria-describedby="usuarios-regras-senha-nova"
                    className={CAMPO}
                    data-testid="usuarios.senha-campo"
                  />
                </Campo>
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
                  <button type="button" className={BOTAO_LINHA} onClick={() => setSenhaVisivel((v) => !v)} aria-pressed={senhaVisivel} data-testid="usuarios.senha-mostrar">
                    {senhaVisivel ? 'Esconder senha' : 'Mostrar senha'}
                  </button>
                </div>
                <RegrasDaSenha id="usuarios-regras-senha-nova" faltas={faltasDaSenhaDigitada(novaSenha)} />
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
