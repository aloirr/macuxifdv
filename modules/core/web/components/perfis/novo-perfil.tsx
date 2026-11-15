'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, IconeModulo, LoadingBlock, Notice, PageHeader, useToast, type IdDoModulo } from '@macuxi/ui/web';
import { LicencasEstadoSchema, MENSAGEM_NOME_OBRIGATORIO, MENSAGEM_PERFIL_REPETIDO, CODIGO_REPETIDO, PerfilDetalheSchema, PerfilListaRespostaSchema, type PerfilDetalhe } from '../../../contracts';
import {
  alternarLinha,
  alternarModulo,
  baseDoNovoPerfil,
  edicaoDaGrade,
  gruposDoGeral,
  linhasPorModulo,
  marcacaoDoModulo,
  modulosDaGrade,
  rotuloMarcarTodos,
  type LinhaDeAcesso,
  type Marcacao,
} from '../../lib/acesso';
import { CARGOS, type Cargo } from '@macuxi/platform-sdk';
import { MENSAGEM_CARGO_OBRIGATORIO, ROTULO_CARGO } from '../../../contracts/cargos';
import { corpoDoPerfil, edicaoInicial, frasesDaRecusa } from '../../lib/perfis';

const CAMPO = 'h-[44px] w-full max-w-[420px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink';

/**
 * Caixa "marcar todos" do cabeçalho em Azul noite (MC-0026): caixa própria (`appearance-none`) com fundo branco, o ✓ e o traço do
 * estado "parte" em `text-accent`; desmarcada, só a caixa branca. O `indeterminate` continua no input para o leitor de tela.
 */
function CaixaDoCabecalho({ nome, estado, onChange }: { nome: string; estado: Marcacao; onChange: (marcar: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = estado === 'parte';
  }, [estado]);
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0">
      <input
        ref={ref}
        type="checkbox"
        aria-label={rotuloMarcarTodos(nome)}
        checked={estado === 'todas'}
        onChange={() => onChange(estado !== 'todas')}
        className="h-5 w-5 cursor-pointer appearance-none rounded-[4px] border border-white bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      />
      {estado !== 'nenhuma' && (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute inset-0 h-5 w-5 text-accent">
          {estado === 'todas' ? <path d="M5 10.5l3.2 3.2L15 6.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M5.5 10h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
        </svg>
      )}
    </span>
  );
}

function LinhaDaCaixa({ linha, marcadas, onChange }: { linha: LinhaDeAcesso; marcadas: ReadonlySet<string>; onChange: (m: Set<string>) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-ink">
      <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={linha.chaves.every((c) => marcadas.has(c))} onChange={() => onChange(alternarLinha(linha, marcadas))} />
      {linha.rotulo}
    </label>
  );
}

/**
 * Uma tabela de um módulo: cabeçalho em Azul noite (caixa "marcar todos", ícone e nome) e uma linha por acesso. A coluna Geral
 * (`agrupada`) vai na largura total, com as linhas sob subtítulos (RD-0266) em até 3 colunas.
 */
function TabelaDoModulo({ id, nome, linhas, marcadas, onChange, agrupada = false }: { id: IdDoModulo; nome: string; linhas: readonly LinhaDeAcesso[]; marcadas: ReadonlySet<string>; onChange: (m: Set<string>) => void; agrupada?: boolean }) {
  return (
    <table className="w-full border-collapse overflow-hidden rounded-2xl border border-line bg-surface text-[15px]" data-testid={`perfil.modulo.${id}`}>
      <thead>
        <tr className="bg-accent text-white">
          <th scope="col" className="px-4 py-3 text-left font-display text-[15px] font-bold">
            <span className="flex items-center gap-3">
              <CaixaDoCabecalho nome={nome} estado={marcacaoDoModulo(linhas, marcadas)} onChange={(marcar) => onChange(alternarModulo(linhas, marcadas, marcar))} />
              <IconeModulo id={id} size={18} />
              {nome}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {agrupada ? (
          <tr>
            <td className="px-4 pb-2 pt-1">
              <div className="gap-x-8 sm:columns-2 lg:columns-3">
                {gruposDoGeral(linhas).map((g) => (
                  <section key={g.titulo} className="break-inside-avoid pt-3" data-testid={`perfil.grupo.${g.titulo}`}>
                    <h3 className="m-0 border-b border-line-2 pb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-ink-2">{g.titulo}</h3>
                    {g.linhas.map((l) => (
                      <LinhaDaCaixa key={l.rotulo} linha={l} marcadas={marcadas} onChange={onChange} />
                    ))}
                  </section>
                ))}
              </div>
            </td>
          </tr>
        ) : (
          linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-line-2">
              <td className="px-4 py-0">
                <LinhaDaCaixa linha={l} marcadas={marcadas} onChange={onChange} />
              </td>
            </tr>
          ))
        )}
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
  const [cargo, setCargo] = useState<Cargo | ''>('');
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
      const d = criado ?? PerfilDetalheSchema.parse(await api('/core/perfis', { method: 'POST', body: { nome: nome.trim(), base, cargo } }));
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
    if (nome.trim() === '' || cargo === '') return;
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
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        Cargo
        <select className={CAMPO} value={cargo} onChange={(e) => setCargo(e.target.value as Cargo | '')} aria-invalid={tentou && cargo === ''} data-testid="perfil.novo.cargo">
          <option value="">Escolha…</option>
          {CARGOS.map((c) => (
            <option key={c} value={c}>
              {ROTULO_CARGO[c]}
            </option>
          ))}
        </select>
        {tentou && cargo === '' && <span className="text-[12px] font-medium text-danger">{MENSAGEM_CARGO_OBRIGATORIO}</span>}
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
            <div key={m.id} className={m.id === 'core' ? 'md:col-span-2 xl:col-span-3' : undefined}>
              <TabelaDoModulo id={m.id} nome={m.nome} linhas={linhas[m.id]!} marcadas={marcadas} onChange={(novo) => setMarcadas(novo)} agrupada={m.id === 'core'} />
            </div>
          ))}
      </div>
    </div>
  );
}
