'use client';

/**
 * Backup, Inativar/Reativar e Excluir na lista de Empresas do portal (R-20261114-195600-alexandre; ADR 0052; spec
 * docs/design/telas/portal-config-enxuto.md §15). Só o time da Macuxi chega aqui (a lista é dele). Contrato e códigos: SDK
 * (`empresa-acoes.ts`); textos e estados puros em `lib/portal-empresa-acoes.ts`.
 * - Backup e Reativar sem confirmação; Inativar e Excluir com diálogo. Sem aviso de sucesso, a não ser no Excluir: o selo da
 *   Situação e a data na coluna Backup já mostram o resultado (uma informação, um lugar).
 * - Backup e exclusão rodam no worker (202): a tela consulta a cada 5 s o pedido que fez aqui (desenho empresa-acoes.md).
 * - A senha do Excluir vai só no corpo do pedido e sai do estado ao fechar o diálogo.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BackupEmpresaSchema,
  CODIGOS_ACOES_EMPRESA,
  ExclusaoEmpresaSchema,
  SituacaoEmpresaRespostaSchema,
  codigoDeConfirmacaoConfere,
  type AcoesDaEmpresa,
  type ExclusaoEmpresa,
} from '@macuxi/platform-sdk';
import { Button, CLASSE_CAMPO, Dialog, ErrorBlock, MenuAcoes, Notice, cx, formatDateTimeFull, type AcaoDoMenu } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import { ACOMPANHAR_ACAO_MS, celulaDoBackup, type EmpresaResumo, erroDoExcluir, estadoDasAcoes, rotaDaAcao, TEXTOS_EMPRESA_ACOES as T, type ErroDoExcluir } from '@/lib/portal-empresa-acoes';

type Empresa = EmpresaResumo & { acoes: AcoesDaEmpresa };
type Aviso = { tom: 'success' | 'danger'; texto: string };

/** Troca uma empresa da lista em cache (o resto da lista fica como está até a próxima consulta). */
function useAtualizarEmpresa(chave: readonly unknown[]) {
  const qc = useQueryClient();
  return {
    trocar: (id: string, f: (e: EmpresaResumo) => EmpresaResumo | null) =>
      qc.setQueryData<EmpresaResumo[]>(chave, (lista) => lista?.flatMap((e) => (e.id === id ? (f(e) ?? []) : [e]))),
    recarregar: () => void qc.invalidateQueries({ queryKey: chave }),
  };
}

/** Estado das ações da lista: pedidos no ar, avisos do topo e o diálogo aberto. */
export function useAcoesDasEmpresas(chave: readonly unknown[]) {
  const { trocar, recarregar } = useAtualizarEmpresa(chave);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoBackup, setPedindoBackup] = useState<ReadonlySet<string>>(new Set());
  const [reativando, setReativando] = useState<ReadonlySet<string>>(new Set());
  const [backups, setBackups] = useState<Readonly<Record<string, { tenant: string; nome: string }>>>({});
  const [exclusoes, setExclusoes] = useState<Readonly<Record<string, { nome: string }>>>({});
  const [dialogo, setDialogo] = useState<{ tipo: 'inativar' | 'excluir'; empresa: Empresa } | null>(null);

  const com = (s: ReadonlySet<string>, id: string) => new Set([...s, id]);
  const sem = (s: ReadonlySet<string>, id: string) => new Set([...s].filter((x) => x !== id));
  const comAcoes = (id: string, f: (a: AcoesDaEmpresa, e: EmpresaResumo) => Partial<EmpresaResumo>) =>
    trocar(id, (e) => (e.acoes ? { ...e, ...f(e.acoes, e) } : e));

  async function pedirBackup(e: Empresa) {
    setErro(null);
    setPedindoBackup((s) => com(s, e.id));
    try {
      const b = await chamarPortal(rotaDaAcao('backups', e.id), { metodo: 'POST', corpo: { id: crypto.randomUUID() }, schema: BackupEmpresaSchema });
      comAcoes(e.id, (a) => ({ acoes: { ...a, ultimo_backup: b } }));
      if (b.situacao === 'em_andamento') setBackups((x) => ({ ...x, [b.id]: { tenant: e.id, nome: e.razao_social } }));
      else recarregar();
    } catch (err) {
      // outro backup já roda (outra aba, outra pessoa): a lista mostra "Em andamento"
      if (err instanceof ErroPortal && err.codigo === CODIGOS_ACOES_EMPRESA.backupEmAndamento) recarregar();
      else setErro(mensagemDoErro(err));
    } finally {
      setPedindoBackup((s) => sem(s, e.id));
    }
  }

  async function reativar(e: Empresa) {
    setErro(null);
    setReativando((s) => com(s, e.id));
    try {
      const r = await chamarPortal(rotaDaAcao('reativar', e.id), { metodo: 'POST', corpo: {}, schema: SituacaoEmpresaRespostaSchema });
      comAcoes(e.id, (a) => ({ status: r.status, acoes: { ...a, inativada_em: r.inativada_em, motivo_inativacao: r.motivo } }));
      recarregar();
    } catch (err) {
      setErro(mensagemDoErro(err));
    } finally {
      setReativando((s) => sem(s, e.id));
    }
  }

  function fimDoBackup(id: string, situacao: string) {
    const b = backups[id];
    setBackups((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== id)));
    if (b && situacao === 'falhou') setAviso({ tom: 'danger', texto: T.backupNaoTerminou(b.nome) });
    recarregar();
  }

  function concluirExclusao(tenant: string, nome: string, situacao: string) {
    setExclusoes((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== tenant)));
    if (situacao === 'concluida') {
      trocar(tenant, () => null);
      setAviso({ tom: 'success', texto: T.excluida(nome) });
    } else setAviso({ tom: 'danger', texto: T.exclusaoNaoTerminou(nome) });
    recarregar();
  }
  const fimDaExclusao = (tenant: string, situacao: string) => concluirExclusao(tenant, exclusoes[tenant]?.nome ?? '', situacao);

  /** Itens do menu "⋯" da linha (ordem do §15.1; o Excluir, de perigo, vai por último). */
  function menu(e: Empresa): AcaoDoMenu[] {
    const ocupada = reativando.has(e.id) || !!exclusoes[e.id];
    const est = estadoDasAcoes(e.status, e.acoes, { pedindoBackup: pedindoBackup.has(e.id), ocupada });
    const itens: AcaoDoMenu[] = [{ id: 'backup', rotulo: T.backup, desligada: !est.backupLigado, aoEscolher: () => void pedirBackup(e), testId: `empresas.backup-${e.codigo}` }];
    if (est.situacao === 'inativar')
      itens.push({ id: 'inativar', rotulo: T.inativar, desligada: !est.situacaoLigada, aoEscolher: () => setDialogo({ tipo: 'inativar', empresa: e }), testId: `empresas.inativar-${e.codigo}` });
    if (est.situacao === 'reativar')
      itens.push({
        id: 'reativar',
        rotulo: reativando.has(e.id) ? T.reativando : T.reativar,
        desligada: !est.situacaoLigada,
        aoEscolher: () => void reativar(e),
        testId: `empresas.reativar-${e.codigo}`,
      });
    itens.push({ id: 'excluir', rotulo: T.excluir, perigo: true, desligada: !est.excluirLigado, aoEscolher: () => setDialogo({ tipo: 'excluir', empresa: e }), testId: `empresas.excluir-${e.codigo}` });
    return itens;
  }

  const topo: ReactNode = (
    <>
      {aviso && (
        <div data-testid={aviso.tom === 'success' ? 'empresas.aviso' : 'empresas.aviso-erro'}>
          <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
            {aviso.texto}
          </Notice>
        </div>
      )}
      {erro && <ErrorBlock message={erro} />}
    </>
  );

  const fundo: ReactNode = (
    <>
      {Object.entries(backups).map(([id, b]) => (
        <AcompanharBackup key={id} tenant={b.tenant} id={id} aoTerminar={fimDoBackup} />
      ))}
      {Object.keys(exclusoes).map((tenant) => (
        <AcompanharExclusao key={tenant} tenant={tenant} aoTerminar={fimDaExclusao} />
      ))}
      {dialogo?.tipo === 'inativar' && (
        <DialogoInativar
          empresa={dialogo.empresa}
          aoFechar={() => setDialogo(null)}
          aoInativar={(r) => {
            comAcoes(dialogo.empresa.id, (a) => ({ status: r.status, acoes: { ...a, inativada_em: r.inativada_em, motivo_inativacao: r.motivo } }));
            setDialogo(null);
            recarregar();
          }}
        />
      )}
      {dialogo?.tipo === 'excluir' && (
        <DialogoExcluir
          empresa={dialogo.empresa}
          aoFechar={() => setDialogo(null)}
          aoPedir={(x) => {
            const e = dialogo.empresa;
            comAcoes(e.id, (a) => ({ status: 'encerrado', acoes: { ...a, exclusao: x } }));
            setDialogo(null);
            if (x.situacao === 'em_andamento') setExclusoes((s) => ({ ...s, [e.id]: { nome: e.razao_social } }));
            else concluirExclusao(e.id, e.razao_social, x.situacao);
          }}
        />
      )}
    </>
  );

  return { menu, topo, fundo, pedindoBackup };
}

/** Consulta o backup pedido aqui até ele sair de "em andamento". */
function AcompanharBackup({ tenant, id, aoTerminar }: { tenant: string; id: string; aoTerminar: (id: string, situacao: string) => void }) {
  const q = useQuery({
    queryKey: ['portal', 'empresa-backup', id],
    queryFn: () => chamarPortal(rotaDaAcao('backup', tenant, id), { schema: BackupEmpresaSchema }),
    // timer-permitido: acompanha backup/exclusão em andamento; para quando termina
    refetchInterval: ACOMPANHAR_ACAO_MS,
    retry: false,
  });
  const situacao = q.data?.situacao;
  useEffect(() => {
    if (situacao && situacao !== 'em_andamento') aoTerminar(id, situacao);
    // aoTerminar muda a cada render; só a situação decide
  }, [situacao, id]);
  return null;
}

/** Consulta a exclusão pedida aqui até ela terminar (a linha some ao concluir). */
function AcompanharExclusao({ tenant, aoTerminar }: { tenant: string; aoTerminar: (tenant: string, situacao: string) => void }) {
  const q = useQuery({
    queryKey: ['portal', 'empresa-exclusao', tenant],
    queryFn: () => chamarPortal(rotaDaAcao('exclusao', tenant), { schema: ExclusaoEmpresaSchema }),
    // timer-permitido: acompanha backup/exclusão em andamento; para quando termina
    refetchInterval: ACOMPANHAR_ACAO_MS,
    retry: false,
  });
  const situacao = q.data?.situacao;
  useEffect(() => {
    if (situacao && situacao !== 'em_andamento') aoTerminar(tenant, situacao);
  }, [situacao, tenant]);
  return null;
}

/** Coluna Backup (§15.1): data (ou "Em andamento"/"Nenhum") e, embaixo, o motivo do Excluir desabilitado. */
export function CelulaBackup({ empresa, pedindo }: { empresa: Empresa; pedindo: boolean }) {
  const c = celulaDoBackup(empresa.acoes, empresa.fuso, pedindo);
  return (
    <div className="flex flex-col gap-0.5">
      <span data-testid={`empresas.backup-data-${empresa.codigo}`} className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
        {c.andamento && <span aria-hidden className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />}
        {c.texto}
      </span>
      {c.motivo && (
        <span id={`empresas.backup-motivo-${empresa.codigo}`} data-testid={`empresas.backup-motivo-${empresa.codigo}`} className="text-[12px] whitespace-nowrap text-ink-2">
          {c.motivo}
        </span>
      )}
    </div>
  );
}

export function MenuDaEmpresa({ acoes, empresa }: { acoes: AcaoDoMenu[]; empresa: Empresa }) {
  return <MenuAcoes acoes={acoes} rotulo={`Ações de ${empresa.razao_social}`} testId={`empresas.acoes-${empresa.codigo}`} />;
}

/** Inativar (§15.2): título com o nome, uma linha de corpo, "Inativar" em perigo. Corpo `{}` (a tela não pede motivo). */
export function DialogoInativar({
  empresa,
  aoFechar,
  aoInativar,
}: {
  empresa: Empresa;
  aoFechar: () => void;
  aoInativar: (r: { status: 'ativo' | 'suspenso'; inativada_em: string | null; motivo: AcoesDaEmpresa['motivo_inativacao'] }) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inativar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      aoInativar(await chamarPortal(rotaDaAcao('inativar', empresa.id), { metodo: 'POST', corpo: {}, schema: SituacaoEmpresaRespostaSchema }));
    } catch (err) {
      setErro(mensagemDoErro(err));
      setEnviando(false);
    }
  };
  return (
    <Dialog
      open
      title={T.tituloInativar(empresa.razao_social)}
      onClose={() => !enviando && aoFechar()}
      footer={
        <>
          <Button data-testid="empresa-acao.cancelar" disabled={enviando} onClick={aoFechar}>
              {T.cancelar}
            </Button>
          <Button variant="danger" data-testid="empresa-acao.confirmar" disabled={enviando} onClick={() => void inativar()}>
              {enviando ? T.inativando : T.inativar}
            </Button>
        </>
      }
    >
      <div data-testid="empresa-acao.dialogo" className="flex flex-col gap-3">
        <p className="m-0">{T.corpoInativar}</p>
        {erro && (
          <div data-testid="empresa-acao.erro">
            <ErrorBlock message={erro} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Excluir (§15.2): backup usado, "Não dá para desfazer.", o código da empresa digitado e a senha de quem pede. "Excluir empresa"
 * só com o código conferindo (`codigoDeConfirmacaoConfere` do SDK) e a senha preenchida. Recusa da API: uma linha curta; senha
 * errada esvazia o campo, marca a borda e devolve o foco.
 */
export function DialogoExcluir({
  empresa,
  aoFechar,
  aoPedir,
  inicial,
}: {
  empresa: Empresa;
  aoFechar: () => void;
  aoPedir: (x: ExclusaoEmpresa) => void;
  /** Só para o teste: estado inicial dos campos e do erro. */
  inicial?: { codigo?: string; senha?: string; erro?: ErroDoExcluir; mensagem?: string };
}) {
  const id = useId();
  const pedido = useRef(crypto.randomUUID());
  const senhaRef = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [senha, setSenha] = useState(inicial?.senha ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroDoExcluir | null>(inicial?.erro ?? null);
  const [mensagem, setMensagem] = useState(inicial?.mensagem ?? '');
  const backup = empresa.acoes.ultimo_backup;
  const confere = codigoDeConfirmacaoConfere(codigo, empresa.codigo);
  const senhaErrada = erro?.tipo === 'linha' && erro.senha;

  const excluir = async () => {
    if (!backup) return;
    setEnviando(true);
    setErro(null);
    try {
      const x = await chamarPortal(rotaDaAcao('exclusao', empresa.id), {
        metodo: 'POST',
        corpo: { id: pedido.current, backup_id: backup.id, codigo_confirmacao: codigo.trim(), senha },
        schema: ExclusaoEmpresaSchema,
      });
      setSenha('');
      aoPedir(x);
    } catch (err) {
      const e = erroDoExcluir(err);
      setErro(e);
      setMensagem(mensagemDoErro(err));
      setEnviando(false);
      if (e.tipo === 'linha' && e.senha) {
        setSenha('');
        queueMicrotask(() => senhaRef.current?.focus());
      }
    }
  };
  const fechar = () => {
    if (enviando) return;
    setSenha('');
    aoFechar();
  };

  return (
    <Dialog
      open
      title={T.tituloExcluir(empresa.razao_social)}
      onClose={fechar}
      footer={
        <>
          <Button data-testid="empresa-acao.cancelar" disabled={enviando} onClick={fechar}>
              {T.cancelar}
            </Button>
          <Button variant="danger" data-testid="empresa-acao.confirmar" disabled={enviando || !confere || !senha || !backup} onClick={() => void excluir()}>
              {enviando ? T.excluindo : T.excluirEmpresa}
            </Button>
        </>
      }
    >
      <div data-testid="empresa-acao.dialogo" className="flex flex-col gap-3">
        <p className="m-0">
          {T.backupUsado} <strong className="tabular-nums">{backup?.concluido_em ? formatDateTimeFull(backup.concluido_em, empresa.fuso) : T.nenhum}</strong>
        </p>
        <p className="m-0">{T.semVolta}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-codigo`} className="text-[13px] font-semibold text-ink">
            Digite <span className="font-mono font-medium">{empresa.codigo}</span> {T.sufixoCodigo}
          </label>
          <input
            id={`${id}-codigo`}
            type="text"
            value={codigo}
            onChange={(ev) => setCodigo(ev.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={enviando}
            data-testid="empresa-excluir.codigo"
            className={cx(CLASSE_CAMPO, 'font-mono tracking-[1px]')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-senha`} className="text-[13px] font-semibold text-ink">
            {T.senha}
          </label>
          <input
            id={`${id}-senha`}
            ref={senhaRef}
            type="password"
            value={senha}
            onChange={(ev) => {
              setSenha(ev.target.value);
              if (senhaErrada) setErro(null);
            }}
            autoComplete="current-password"
            disabled={enviando}
            aria-invalid={senhaErrada || undefined}
            aria-describedby={erro?.tipo === 'linha' ? `${id}-erro` : undefined}
            data-testid="empresa-excluir.senha"
            className={CLASSE_CAMPO}
          />
        </div>
        {erro?.tipo === 'linha' && (
          <p id={`${id}-erro`} role="alert" data-testid="empresa-acao.erro" className="m-0 text-[13px] text-danger">
            {erro.texto}
          </p>
        )}
        {erro?.tipo === 'bloco' && (
          <div data-testid="empresa-acao.erro">
            <ErrorBlock message={mensagem} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
