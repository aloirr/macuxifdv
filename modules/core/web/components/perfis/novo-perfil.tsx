'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, PageHeader, useToast } from '@macuxi/ui/web';
import { LicencasEstadoSchema, MENSAGEM_NOME_OBRIGATORIO, MENSAGEM_PERFIL_REPETIDO, CODIGO_REPETIDO, PerfilDetalheSchema, PerfilListaRespostaSchema, type PerfilDetalhe } from '../../../contracts';
import {
  alternarLinha,
  alternarModulo,
  baseDoNovoPerfil,
  edicaoDaGrade,
  linhasPorModulo,
  marcacaoDoModulo,
  modulosDaGrade,
  rotuloMarcarTodos,
  type LinhaDeAcesso,
} from '../../lib/acesso';
import { corpoDoPerfil, edicaoInicial, frasesDaRecusa } from '../../lib/perfis';
import { IconeDoModulo } from '../acesso/icones-modulo';

const CAMPO = 'h-[44px] w-full max-w-[420px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink';

function CaixaDoCabecalho({ nome, estado, onChange }: { nome: string; estado: 'todas' | 'nenhuma' | 'parte'; onChange: (marcar: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = estado === 'parte';
  }, [estado]);
  return <input ref={ref} type="checkbox" aria-label={rotuloMarcarTodos(nome)} checked={estado === 'todas'} onChange={() => onChange(estado !== 'todas')} className="h-5 w-5 accent-white" />;
}

/** Uma tabela vertical de um módulo: cabeçalho em Azul noite (ícone, nome e "marcar todos") e uma linha por acesso. */
export function TabelaDoModulo({ id, nome, linhas, marcadas, onChange }: { id: string; nome: string; linhas: readonly LinhaDeAcesso[]; marcadas: ReadonlySet<string>; onChange: (m: Set<string>) => void }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-2xl border border-line bg-surface text-[14px]" data-testid={`perfil.modulo.${id}`}>
      <thead>
        <tr className="bg-accent text-white">
          <th scope="col" className="px-4 py-3 text-left font-display text-[15px] font-bold">
            <span className="flex items-center gap-3">
              <CaixaDoCabecalho nome={nome} estado={marcacaoDoModulo(linhas, marcadas)} onChange={(marcar) => onChange(alternarModulo(linhas, marcadas, marcar))} />
              <IconeDoModulo id={id} />
              {nome}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.rotulo} className="border-t border-line-2">
            <td className="p-0">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-4 text-ink">
                <input type="checkbox" className="h-5 w-5 accent-[#1e3350]" checked={l.chaves.every((c) => marcadas.has(c))} onChange={() => onChange(alternarLinha(l, marcadas))} />
                {l.rotulo}
              </label>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "Novo perfil" (pedido do dono do produto, R-20261114-144500): o Nome e uma tabela por módulo licenciado (Geral primeiro). A base do perfil
 * sai das caixas marcadas (`baseDoNovoPerfil`); os limites de cada base (RN-CORE-33, RN-PRO-01) e o escopo de dados vêm da API, que revalida.
 */
export function NovoPerfil() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string[]>([]);
  const [criado, setCriado] = useState<PerfilDetalhe | null>(null);

  const lista = useQuery({ queryKey: ['core', 'perfis'], queryFn: async () => PerfilListaRespostaSchema.parse(await api('/core/perfis')).itens });
  const modelo = lista.data?.find((p) => p.fabrica)?.codigo;
  const catalogo = useQuery({ queryKey: ['core', 'perfis', modelo], enabled: !!modelo, queryFn: async () => PerfilDetalheSchema.parse(await api(`/core/perfis/${modelo}`)) });
  const licencas = useQuery({ queryKey: ['core', 'licencas'], queryFn: async () => LicencasEstadoSchema.parse(await api('/core/licencas')), retry: false });

  const chaves = catalogo.data?.chaves ?? [];
  const licenciados = licencas.data ? licencas.data.modulos.filter((m) => licencas.data.tenant[m] === true) : [...new Set(chaves.map((c) => c.modulo))];
  const modulos = modulosDaGrade(licenciados);
  const linhas = linhasPorModulo(chaves, modulos.map((m) => m.id));
  const daGrade = Object.values(linhas).flatMap((ls) => ls.flatMap((l) => l.chaves));

  const voltar = () => router.push(pathname);
  const salvar = useMutation({
    mutationFn: async () => {
      const base = baseDoNovoPerfil(marcadas);
      const d = criado ?? PerfilDetalheSchema.parse(await api('/core/perfis', { method: 'POST', body: { nome: nome.trim(), base } }));
      setCriado(d);
      const edicao = edicaoDaGrade(edicaoInicial(d), daGrade, marcadas);
      await api(`/core/perfis/${d.perfil.codigo}`, { method: 'PUT', body: corpoDoPerfil(edicao, { nome: nome.trim(), descricao: '', ativo: true }, false) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['core', 'perfis'] });
      toast('success', 'Perfil criado.');
      voltar();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === CODIGO_REPETIDO) setErro([MENSAGEM_PERFIL_REPETIDO]);
      else if (e instanceof ApiRequestError && e.status === 422) setErro(frasesDaRecusa(e.details, e.message));
      else setErro(['Não foi possível salvar agora. Tente de novo.']);
    },
  });

  const enviar = () => {
    setTentou(true);
    setErro([]);
    if (nome.trim() === '') return;
    salvar.mutate();
  };

  if (lista.isPending || catalogo.isPending) return <LoadingBlock label="Carregando as permissões…" />;
  if (lista.isError || catalogo.isError) return <ErrorBlock message="Não foi possível carregar as permissões. Confira a internet e tente de novo." onRetry={() => void lista.refetch()} />;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="perfil.novo">
      <PageHeader
        title="Novo perfil de acesso"
        actions={
          <>
            <Button onClick={voltar} data-testid="perfil.novo.cancelar">
              Cancelar
            </Button>
            <Button variant="primary" onClick={enviar} disabled={salvar.isPending} data-testid="perfil.novo.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      />
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        Nome
        <input className={CAMPO} value={nome} maxLength={40} autoFocus onChange={(e) => setNome(e.target.value)} aria-invalid={tentou && nome.trim() === ''} data-testid="perfil.novo.nome" />
        {tentou && nome.trim() === '' && <span className="text-[12px] font-medium text-danger">{MENSAGEM_NOME_OBRIGATORIO}</span>}
      </label>
      {erro.length > 0 && (
        <Notice tone="danger">
          <span data-testid="perfil.novo.erro">{erro.join(' ')}</span>
        </Notice>
      )}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="perfil.novo.grade">
        {modulos
          .filter((m) => (linhas[m.id]?.length ?? 0) > 0)
          .map((m) => (
            <TabelaDoModulo key={m.id} id={m.id} nome={m.nome} linhas={linhas[m.id]!} marcadas={marcadas} onChange={(novo) => setMarcadas(novo)} />
          ))}
      </div>
    </div>
  );
}
