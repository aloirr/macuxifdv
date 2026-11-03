'use client';

import { Suspense, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, SelectField, td, th, TableScroll } from '@macuxi/ui/web';
import { EquipeListaRespostaSchema, UsuarioListaRespostaSchema, type UsuarioItem } from '../../../contracts';
import {
  corpoDeCriacao,
  corpoDeEdicao,
  csvDeUsuarios,
  errosDoFormulario,
  FORMULARIO_VAZIO,
  formularioDoUsuario,
  PERFIS_DO_FORMULARIO,
  ROTULO_PERFIL,
  textoDoSuperiorDaEquipe,
  type FormularioUsuario,
} from '../../lib/usuarios';

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
 * Tela "Usuários" do BKO (RF-CORE-02; T-0067): lista com busca e filtros na URL, exportar CSV e, só para o admin
 * (`usuario.gerir`), criar, editar, ativar/desativar e redefinir senha. Supervisor e gerente consultam a própria equipe
 * (a API recorta pelo escopo, RN-CORE-04). O superior imediato deriva da equipe. Nunca apaga usuário. testIDs: docs/modulos/core/test-ids.md.
 */
function UsuariosConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('usuario.gerir');
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<FormularioUsuario>(FORMULARIO_VAZIO);
  const [tentou, setTentou] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');

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

  const fechar = () => {
    setModal(null);
    setErroApi(null);
    setTentou(false);
    setNovaSenha('');
  };
  const concluir = async (msg: string) => {
    fechar();
    setAviso(msg);
    await qc.invalidateQueries({ queryKey: ['core', 'usuarios'] });
    await qc.invalidateQueries({ queryKey: ['core', 'equipes'] });
  };

  const salvar = useMutation({
    mutationFn: async (editando: UsuarioItem | null) =>
      editando ? api(`/core/usuarios/${editando.id}`, { method: 'PUT', body: corpoDeEdicao(form) }) : api('/core/usuarios', { method: 'POST', body: corpoDeCriacao(form) }),
    onSuccess: (_r, editando) => concluir(editando ? 'Usuário atualizado.' : 'Usuário criado. Passe a senha inicial a ele por um canal seguro.'),
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: async (u: UsuarioItem) => api(`/core/usuarios/${u.id}/ativo`, { method: 'PUT', body: { ativo: !u.ativo } }),
    onSuccess: (_r, u) => concluir(u.ativo ? 'Usuário desativado. Ele perde o acesso na próxima requisição e as sessões foram encerradas.' : 'Usuário reativado. Ele já pode entrar com a senha atual.'),
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const redefinir = useMutation({
    mutationFn: async (u: UsuarioItem) => api(`/core/usuarios/${u.id}/senha`, { method: 'PUT', body: { senha: novaSenha } }),
    onSuccess: () => concluir('Senha redefinida e sessões encerradas. Passe a nova senha ao usuário por um canal seguro.'),
    onError: (e) => setErroApi(errorMessage(e)),
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
            {pode && (
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
      {!pode && <Notice tone="info">Só o administrador cria e altera usuários. Você consulta a sua equipe.</Notice>}
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
          {PERFIS_DO_FORMULARIO.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PERFIL[p]}
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
                  <th className={th}>Perfil</th>
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
                    <td className={td}>{ROTULO_PERFIL[u.perfil]}</td>
                    <td className={td}>{u.equipe_nome ?? '—'}</td>
                    <td className={td}>{u.superior_nome ?? '—'}</td>
                    <td className={td}>{u.external_id ?? '—'}</td>
                    <td className={td}>
                      <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                    </td>
                    {pode && (
                      <td className={td}>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={BOTAO_LINHA} onClick={() => abrirForm(u)} data-testid={`usuarios.editar.${u.id}`}>
                            Editar
                          </button>
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
                          <button
                            type="button"
                            className={BOTAO_LINHA}
                            onClick={() => {
                              setAviso(null);
                              setErroApi(null);
                              setNovaSenha('');
                              setModal({ tipo: 'senha', usuario: u });
                            }}
                            data-testid={`usuarios.senha.${u.id}`}
                          >
                            Senha
                          </button>
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
          <Campo rotulo="Perfil" erro={erroDe('perfil')}>
            <select value={form.perfil} onChange={(e) => upd({ perfil: e.target.value as FormularioUsuario['perfil'] })} className={CAMPO} data-testid="usuarios.campo-perfil">
              {PERFIS_DO_FORMULARIO.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PERFIL[p]}
                </option>
              ))}
            </select>
          </Campo>
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
            <Campo rotulo="Senha inicial (8+ caracteres, com letras e números)" erro={erroDe('senha')}>
              <input type="password" autoComplete="new-password" value={form.senha} onChange={(e) => upd({ senha: e.target.value })} className={CAMPO} data-testid="usuarios.campo-senha" />
            </Campo>
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
        title="Redefinir senha"
        onClose={fechar}
        footer={
          <>
            <Button onClick={fechar} data-testid="usuarios.senha-cancelar">
              Cancelar
            </Button>
            <Button variant="primary" disabled={ocupado || novaSenha.length === 0} onClick={() => modal?.tipo === 'senha' && redefinir.mutate(modal.usuario)} data-testid="usuarios.senha-confirmar">
              {redefinir.isPending ? 'Salvando…' : 'Redefinir'}
            </Button>
          </>
        }
      >
        {modal?.tipo === 'senha' && (
          <div className="flex flex-col gap-3">
            <p className="m-0">Defina uma nova senha para {modal.usuario.nome}. As sessões abertas dele são encerradas. Passe a senha por um canal seguro.</p>
            <Campo rotulo="Nova senha (8+ caracteres, com letras e números)">
              <input type="password" autoComplete="new-password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className={CAMPO} data-testid="usuarios.senha-campo" />
            </Campo>
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
