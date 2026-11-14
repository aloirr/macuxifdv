'use client';

import { Suspense, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROTULO_PERFIL, type ModuloId } from '@macuxi/platform-sdk';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, Drawer, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, RegrasDaSenha, SelectField, td, th, useToast, rotuloDoPerfil } from '@macuxi/ui/web';
import { CriarUsuarioRespostaSchema, LicencasEstadoSchema, PerfilOpcoesRespostaSchema, RedefinirSenhaRespostaSchema, UsuarioListaRespostaSchema, SENHA_MIN_CARACTERES, mensagemDaSenha, type LicencasEstado, type UsuarioItem } from '../../../contracts';
import { efetivosPelasDependencias } from '../../../domain/licencas';
import {
  acaoDeSenha,
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
  csvDeUsuarios,
  errosDoFormulario,
  FORMULARIO_VAZIO,
  formularioDoUsuario,
  type FormularioUsuario,
  ERRO_SEM_PERFIL,
} from '../../lib/usuarios';
import { modulosExibiveis, removidosDoFormulario } from '../../lib/acesso';
import { efetivosDoUsuario } from '../../lib/licencas';
import { IconeComNome, IconeDoModulo } from '../acesso/icones-modulo';
import { MenuDaLinha } from '../acesso/menu-linha';

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
 * Tela "Usuários" do BKO (RF-CORE-02; T-0067; T-0094; simplificada a pedido do dono do produto, R-20261114-144500): título, "Novo usuário"
 * e a tabela Nome · E-mail · Perfil · Módulos · ⋯ (Editar, Desativar, Redefinir senha). "Novo usuário" e "Editar" abrem numa gaveta com
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
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<FormularioUsuario>(FORMULARIO_VAZIO);
  const [desmarcados, setDesmarcados] = useState<ReadonlySet<string>>(new Set());
  const [tentou, setTentou] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // e-mail que não saiu: a senha aparece UMA vez, da memória da tela, e some ao fechar o aviso ou sair da página
  const [semEmail, setSemEmail] = useState<Extract<ResultadoDoEmail, { tipo: 'sem_email' }> | null>(null);
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
  const situacao = params.get('situacao') ?? '';

  const lista = useQuery({
    queryKey: ['core', 'usuarios', q, perfil, situacao],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (perfil) qs.set('perfil', perfil);
      if (situacao) qs.set('ativo', situacao === 'ativo' ? 'true' : 'false');
      return UsuarioListaRespostaSchema.parse(await api(`/core/usuarios${qs.size ? `?${qs.toString()}` : ''}`)).itens;
    },
  });
  const perfisQ = useQuery({ queryKey: ['core', 'perfis', 'opcoes'], queryFn: async () => PerfilOpcoesRespostaSchema.parse(await api('/core/perfis/opcoes')).itens });
  const opcoesDePerfil = perfisQ.data ?? [];
  // só o admin lê as licenças (`modulo.gerir_licencas`); sem elas a coluna e a lista de módulos não aparecem
  const licencasQ = useQuery({
    queryKey: ['core', 'licencas'],
    queryFn: async () => LicencasEstadoSchema.parse(await api('/core/licencas')),
    retry: false,
  });
  const licencas: LicencasEstado | undefined = licencasQ.data;

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
  const baseEscolhida = opcoesDePerfil.find((p) => p.codigo === form.perfis[0])?.base;
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
        await api(`/core/usuarios/${editando.id}`, { method: 'PUT', body: corpoDeEdicao(corpo) });
        await gravarModulos(editando.id, licencas?.usuarios.find((x) => x.id === editando.id)?.removidos ?? []);
        return null;
      }
      const criado = CriarUsuarioRespostaSchema.parse(await api('/core/usuarios', { method: 'POST', body: corpoDeCriacao(corpo) }));
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
    setForm(u ? formularioDoUsuario(u) : { ...FORMULARIO_VAZIO, perfil: 'vendedor', perfis: [] });
    setDesmarcados(new Set(u ? (licencas?.usuarios.find((x) => x.id === u.id)?.removidos ?? []) : []));
    setModal({ tipo: 'form', usuario: u });
  };
  const editando = modal?.tipo === 'form' ? modal.usuario : null;
  const comSenha = (f: FormularioUsuario): FormularioUsuario => (editando ? f : { ...f, senha: f.senha || gerarSenhaNoNavegador() });
  const erros = modal?.tipo === 'form' ? errosDoFormulario(comSenha(form), editando ? 'editar' : 'criar') : [];
  const erroDe = (campo: string) => (tentou ? erros.find((e) => e.campo === campo)?.mensagem : undefined);
  const ocupado = salvar.isPending || alternar.isPending || redefinir.isPending;
  const upd = (patch: Partial<FormularioUsuario>) => setForm((f) => ({ ...f, ...patch }));

  const itens = lista.data ?? [];
  const rotuloDoPerfilDe = (u: UsuarioItem) => {
    const principal = u.perfis[0] ? rotuloDoPerfil(u.perfis[0].codigo, { nome: u.perfis[0].nome }) : ROTULO_PERFIL[u.perfil];
    return u.perfis.length > 1 ? `${principal} +${u.perfis.length - 1}` : principal;
  };
  const menuDe = (u: UsuarioItem) => [
    ...(podeEditar ? [{ rotulo: 'Editar', onSelecionar: () => abrirForm(u), testId: `usuarios.editar.${u.id}` }] : []),
    ...(podeDesativar
      ? [
          {
            rotulo: u.ativo ? 'Desativar' : 'Reativar',
            perigo: u.ativo,
            testId: `usuarios.alternar.${u.id}`,
            onSelecionar: () => {
              setAviso(null);
              setErroApi(null);
              setModal({ tipo: 'ativo', usuario: u });
            },
          },
        ]
      : []),
    ...(podeSenha && acaoDeSenha(u)
      ? [
          {
            rotulo: acaoDeSenha(u)!.rotulo,
            testId: `usuarios.senha.${u.id}`,
            onSelecionar: () => {
              setAviso(null);
              setErroApi(null);
              setNovaSenha('');
              setModal({ tipo: 'senha', usuario: u });
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="usuarios.tela">
      <PageHeader
        title="Usuários"
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
              {rotuloDoPerfil(p.codigo, { nome: p.nome })}
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
        <Panel label="Usuários">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Nome</th>
                <th className={th}>E-mail</th>
                <th className={th}>Perfil</th>
                <th className={th}>Módulos</th>
                <th className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td className={td} colSpan={5}>
                    Nenhum usuário com esses filtros. Limpe a busca ou os filtros para ver todos.
                  </td>
                </tr>
              )}
              {itens.map((u) => {
                const modulos = licencas ? modulosExibiveis(efetivosDoUsuario(licencas, u.id)) : null;
                return (
                  <tr key={u.id} data-testid={`usuarios.linha.${u.id}`}>
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-2">
                        {u.nome}
                        {!u.ativo && <Badge tone="neutral">Inativo</Badge>}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{u.email}</td>
                    <td className={td} title={u.perfis.map((p) => rotuloDoPerfil(p.codigo, { nome: p.nome })).join(', ')}>
                      {rotuloDoPerfilDe(u)}
                    </td>
                    <td className={td}>
                      {modulos === null ? (
                        '—'
                      ) : (
                        <span className="flex flex-wrap gap-1" data-testid={`usuarios.modulos.${u.id}`}>
                          {modulos.length === 0 ? '—' : modulos.map((m) => <IconeComNome key={m.id} id={m.id} />)}
                        </span>
                      )}
                    </td>
                    <td className={`${td} w-[56px] text-right`}>
                      <MenuDaLinha rotulo={`Ações de ${u.nome}`} itens={menuDe(u)} testId={`usuarios.menu.${u.id}`} />
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
            if (erros.length === 0 && !ocupado) salvar.mutate({ editando, corpo });
          }}
        >
          <Campo rotulo="Nome" erro={erroDe('nome')}>
            <input value={form.nome} onChange={(e) => upd({ nome: e.target.value })} className={CAMPO} data-testid="usuarios.campo-nome" />
          </Campo>
          <Campo rotulo="E-mail" erro={erroDe('email')}>
            <input type="email" value={form.email} onChange={(e) => upd({ email: e.target.value })} className={CAMPO} data-testid="usuarios.campo-email" />
          </Campo>
          <Campo rotulo="Perfil" erro={tentou && form.perfis.length === 0 ? ERRO_SEM_PERFIL : undefined}>
            <select
              value={form.perfis[0] ?? ''}
              onChange={(e) => upd({ perfis: e.target.value ? [e.target.value] : [], perfil: opcoesDePerfil.find((p) => p.codigo === e.target.value)?.base ?? form.perfil })}
              className={CAMPO}
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
          {licencas && (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="usuarios.modulos-campo">
              <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Módulos</legend>
              {modulosDoForm.map((m) => {
                const noPerfil = doPerfil.includes(m.id);
                const marcado = efetivosDoForm.includes(m.id);
                return (
                  <label key={m.id} className={`flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold ${noPerfil ? 'text-ink' : 'text-disabled'}`}>
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#1e3350]"
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
                    <IconeDoModulo id={m.id} />
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
          <div className="sticky bottom-0 -mx-5 mt-auto flex justify-end gap-2 border-t border-line bg-ground px-5 py-3">
            <Button onClick={fechar} data-testid="usuarios.cancelar">
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={ocupado} data-testid="usuarios.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Drawer>

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
