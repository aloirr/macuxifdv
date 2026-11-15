'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, LoadingBlock, Notice, PageHeader, rotuloComContagem, SeloSituacao, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { CAMPOS_FISCAIS_FILIAL, FilialCriarSchema, FilialEditarSchema, FiliaisListaSchema, type FilialListaItem } from '../../../contracts';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { cnpjValido, formatarDocumento } from '@macuxi/comum/documento';
import { cepValido, formatarCep } from '@macuxi/comum/endereco';
import { faltasNoCadastroDaFilial } from '../../../domain';
import { fraseDoVazio, QuadroDaLista } from '../../lib/lista-bko';
import { novoId } from '../../lib/visitas';

interface Rascunho {
  id: string;
  existente: boolean;
  codigo: string;
  nome: string;
  cidade: string;
  uf: string;
  cnpj: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  telefone: string;
  ativo: boolean;
  doErp: boolean;
}

const vazio = (): Rascunho => ({ id: novoId(), existente: false, codigo: '', nome: '', cidade: '', uf: '', cnpj: '', logradouro: '', numero: '', complemento: '', bairro: '', cep: '', telefone: '', ativo: true, doErp: false });

const dadosFiscais = (r: Rascunho) => Object.fromEntries(CAMPOS_FISCAIS_FILIAL.map((k) => [k, r[k]]));
/** RN-CORE-39 (T-0159): CNPJ válido e endereço completo (complemento e telefone são opcionais). */
const cadastroCompleto = (r: Rascunho) => faltasNoCadastroDaFilial(r).length === 0 && cnpjValido(r.cnpj) && cepValido(r.cep);

/**
 * Cadastro de filiais (RN-CORE-39; T-0149): a unidade de onde saem as entregas. A empresa nasce com a filial padrão (sem cidade
 * e UF até o admin completar). Só analista e admin editam (`filial.editar`); os demais perfis consultam. A API revalida e audita.
 * Com a carga `filial` do ERP ligada, o ERP manda código e nome (a filial com chave do ERP fica com esses dois campos só leitura).
 */
export function FiliaisPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const pode = usePode('filial.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'filiais'],
    queryFn: async () => FiliaisListaSchema.parse(await api<unknown>('/core/filiais')).itens,
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['core', 'filiais'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api(`/core/filiais/${r.id}`, { method: 'PUT', body: FilialEditarSchema.parse({ codigo: r.codigo, nome: r.nome, cidade: r.cidade, uf: r.uf, ...dadosFiscais(r), ativo: r.ativo }) })
        : api('/core/filiais', { method: 'POST', body: FilialCriarSchema.parse({ id: r.id, codigo: r.codigo, nome: r.nome, cidade: r.cidade, uf: r.uf, ...dadosFiscais(r) }) }),
    onSuccess: async () => {
      setRascunho(null);
      toast('success', 'Filial salva.');
      await atualizar();
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const tornarPadrao = useMutation({
    mutationFn: (id: string) => api(`/core/filiais/${id}`, { method: 'PUT', body: { padrao: true } }),
    onSuccess: async () => {
      toast('success', 'Filial padrão trocada.');
      await atualizar();
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/core/filiais/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('success', 'Filial apagada.');
      await atualizar();
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const abrir = (r: Rascunho) => {
    setErroApi(null);
    setRascunho(r);
  };
  const editar = (f: FilialListaItem) =>
    abrir({ id: f.id, existente: true, codigo: f.codigo, nome: f.nome, cidade: f.cidade ?? '', uf: f.uf ?? '', cnpj: f.cnpj ?? '', logradouro: f.logradouro ?? '', numero: f.numero ?? '', complemento: f.complemento ?? '', bairro: f.bairro ?? '', cep: f.cep ?? '', telefone: f.telefone ?? '', ativo: f.ativo, doErp: Boolean(f.external_id) });

  const colunas: ReadonlyArray<ColunaDaTabela<FilialListaItem>> = [
    {
      id: 'nome',
      titulo: 'Nome',
      largura: '28%',
      texto: (f) => f.nome,
      celula: (f) => (
        <>
          {f.nome}
          {f.external_id ? <span className="block truncate text-[12px] font-normal text-ink-2">do ERP</span> : null}
        </>
      ),
    },
    { id: 'codigo', titulo: 'Código', prioridade: 2, largura: '90px', texto: (f) => f.codigo, celula: (f) => <span className="font-mono">{f.codigo}</span> },
    { id: 'cidade', titulo: 'Cidade/UF', prioridade: 2, largura: '17%', celula: (f) => (f.cidade ? `${f.cidade}/${f.uf ?? ''}` : '—'), texto: (f) => (f.cidade ? `${f.cidade}/${f.uf ?? ''}` : '') },
    { id: 'cnpj', titulo: 'CNPJ', prioridade: 3, largura: '150px', celula: (f) => <span className="font-mono">{f.cnpj ? formatarDocumento(f.cnpj) : '—'}</span>, texto: (f) => (f.cnpj ? formatarDocumento(f.cnpj) : '') },
    { id: 'clientes', titulo: 'Clientes', numero: true, prioridade: 2, largura: '90px', celula: (f) => f.clientes_ativos, texto: (f) => String(f.clientes_ativos) },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '120px',
      // um selo só, o mais importante para agir: incompleta, inativa, padrão, ativa
      celula: (f) => (
        <SeloSituacao
          selos={[
            f.incompleta ? { tom: 'warning', texto: 'Incompleta' } : null,
            f.ativo ? null : { tom: 'neutral', texto: 'Inativa' },
            f.padrao ? { tom: 'success', texto: 'Padrão' } : null,
            { tom: 'neutral', texto: 'Ativa' },
          ]}
        />
      ),
    },
  ];
  const criar = pode ? (
    <Button variant="primary" onClick={() => abrir(vazio())} data-testid="filiais.nova">
      Nova filial
    </Button>
  ) : undefined;
  const cnpjInvalido = (r: Rascunho) => r.cnpj.trim() !== '' && !cnpjValido(r.cnpj);

  return (
    <div className="flex w-full max-w-[1040px] flex-col gap-5" data-testid="filiais.tela">
      <PageHeader title={rotuloComContagem('Filiais', itens.length)} actions={criar} />
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as filiais…" />}
      {lista.data && (
        <QuadroDaLista vazia={itens.length === 0} vazio={<EstadoVazio titulo={fraseDoVazio('filial', true, false)} acao={criar} />}>
          <TabelaDados
            rotulo="Filiais"
            colunas={colunas}
            linhas={itens}
            chave={(f) => f.id}
            linhaTestId={(f) => `filiais.linha.${f.codigo}`}
            esmaecida={(f) => !f.ativo}
            aoAbrir={pode ? editar : undefined}
            acoes={(f) =>
              pode
                ? [
                    { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(f), testId: `filiais.editar.${f.codigo}` },
                    ...(!f.padrao && f.ativo ? [{ id: 'padrao', rotulo: 'Tornar padrão', desligada: tornarPadrao.isPending, aoEscolher: () => tornarPadrao.mutate(f.id), testId: `filiais.padrao.${f.codigo}` }] : []),
                    ...(!f.padrao ? [{ id: 'apagar', rotulo: 'Apagar', perigo: true, desligada: apagar.isPending, aoEscolher: () => apagar.mutate(f.id), testId: `filiais.apagar.${f.codigo}` }] : []),
                  ]
                : []
            }
          />
        </QuadroDaLista>
      )}
      <Drawer
        open={rascunho !== null}
        title={rascunho?.existente ? 'Editar filial' : 'Nova filial'}
        onClose={() => setRascunho(null)}
        rodape={
          rascunho && (
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={salvar.isPending || !rascunho.codigo.trim() || !rascunho.nome.trim() || !rascunho.cidade.trim() || rascunho.uf.length !== 2 || !cadastroCompleto(rascunho)}
                onClick={() => salvar.mutate(rascunho)}
                data-testid="filiais.salvar"
              >
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )
        }
      >
        {rascunho && (
          <div className="flex flex-col gap-4">
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Código">
              <input value={rascunho.codigo} maxLength={20} disabled={rascunho.doErp} onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })} data-testid="filiais.codigo" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <CampoFormulario rotulo="Nome">
              <input value={rascunho.nome} maxLength={80} disabled={rascunho.doErp} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} data-testid="filiais.nome" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <CampoFormulario rotulo="Cidade">
                <input value={rascunho.cidade} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, cidade: e.target.value })} data-testid="filiais.cidade" className={CLASSE_CAMPO} />
              </CampoFormulario>
              <CampoFormulario rotulo="UF">
                <select value={rascunho.uf} onChange={(e) => setRascunho({ ...rascunho, uf: e.target.value })} data-testid="filiais.uf" className={CLASSE_CAMPO}>
                  <option value="">Escolha</option>
                  {UFS_BRASIL.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </CampoFormulario>
            </div>
            <CampoFormulario rotulo="CNPJ" erro={cnpjInvalido(rascunho) ? 'CNPJ inválido: confira os 14 dígitos.' : undefined}>
              <input
                value={rascunho.cnpj}
                inputMode="numeric"
                maxLength={18}
                aria-invalid={cnpjInvalido(rascunho)}
                onChange={(e) => setRascunho({ ...rascunho, cnpj: e.target.value })}
                onBlur={() => setRascunho((r) => (r && cnpjValido(r.cnpj) ? { ...r, cnpj: formatarDocumento(r.cnpj) } : r))}
                data-testid="filiais.cnpj"
                className={CLASSE_CAMPO}
              />
            </CampoFormulario>
            <CampoFormulario rotulo="Logradouro">
              <input value={rascunho.logradouro} maxLength={160} onChange={(e) => setRascunho({ ...rascunho, logradouro: e.target.value })} data-testid="filiais.logradouro" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <CampoFormulario rotulo="Número">
                <input value={rascunho.numero} maxLength={20} onChange={(e) => setRascunho({ ...rascunho, numero: e.target.value })} data-testid="filiais.numero" className={CLASSE_CAMPO} />
              </CampoFormulario>
              <CampoFormulario rotulo="Complemento" opcional>
                <input value={rascunho.complemento} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, complemento: e.target.value })} data-testid="filiais.complemento" className={CLASSE_CAMPO} />
              </CampoFormulario>
            </div>
            <CampoFormulario rotulo="Bairro">
              <input value={rascunho.bairro} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, bairro: e.target.value })} data-testid="filiais.bairro" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <div className="grid grid-cols-2 gap-3">
              <CampoFormulario rotulo="CEP">
                <input
                  value={rascunho.cep}
                  inputMode="numeric"
                  maxLength={9}
                  onChange={(e) => setRascunho({ ...rascunho, cep: e.target.value })}
                  onBlur={() => setRascunho((r) => (r && cepValido(r.cep) ? { ...r, cep: formatarCep(r.cep) } : r))}
                  data-testid="filiais.cep"
                  className={CLASSE_CAMPO}
                />
              </CampoFormulario>
              <CampoFormulario rotulo="Telefone" opcional>
                <input value={rascunho.telefone} inputMode="tel" maxLength={30} onChange={(e) => setRascunho({ ...rascunho, telefone: e.target.value })} data-testid="filiais.telefone" className={CLASSE_CAMPO} />
              </CampoFormulario>
            </div>
            {rascunho.existente ? (
              <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
                <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="filiais.ativo" />
                Ativa
              </label>
            ) : null}
          </div>
        )}
      </Drawer>
    </div>
  );
}
