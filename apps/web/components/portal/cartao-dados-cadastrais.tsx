'use client';

/**
 * Cartão "Dados da empresa" da aba Empresa do portal (ADR 0075; R-20261124-090942 item 04), no topo da coluna da direita.
 * - Só leitura no cartão: CNPJ, inscrição estadual, razão social, nome fantasia, endereço (numa linha só), telefone e e-mail; o
 *   que não está preenchido fica em branco. "Editar" (time da Macuxi e admin do cliente da própria empresa) abre a gaveta do kit.
 * - Gaveta: CNPJ só leitura; as 11 chaves do `GravarDadosCadastraisEmpresaSchema`, conferidas antes de enviar; o nome fantasia
 *   (uma informação, um lugar: só neste cartão) editável só para o time da Macuxi e gravado à parte, pela rota da marca (T-0182,
 *   `PUT .../marca`), só quando mudou; para o admin do cliente, só leitura; "Trazer dados da Receita Federal" consulta o CNPJ da empresa
 *   e preenche SÓ os campos vazios (`preencherVazios`); nada grava sem o "Salvar". 422 com o erro embaixo de cada campo; outro erro
 *   no aviso do topo, que recebe o foco (e a rolagem).
 * Regras e textos em `lib/portal-cadastro.ts`. testIDs: empresa-cadastro.*.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { ConsultaCnpjRespostaSchema, DadosCadastraisEmpresaSchema, MarcaEmpresaSchema, MAX_NOME_FANTASIA, type DadosCadastraisEmpresa } from '@macuxi/platform-sdk';
import { Button, CampoFormulario, CLASSE_CAMPO, cx, Drawer, ErrorBlock, LoadingBlock, Notice, Panel, useToast, type NoticeTone } from '@macuxi/ui/web';

import { chamarPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import {
  cadastroIndisponivel,
  CAMPOS_LARGOS,
  corpoDoCadastro,
  errosDaApi,
  formularioDoCadastro,
  formularioMudou,
  linhasDaLeitura,
  linhasDoCadastro,
  preencherVazios,
  ROTULOS_CADASTRO,
  TEXTOS_CADASTRO as T,
  type CampoCadastro,
  type ErrosDoCadastro,
  type FormularioCadastro,
} from '@/lib/portal-cadastro';
import { estadoDoErroCnpj, textoDoEstadoCnpj } from '@/lib/portal-cnpj';
import { erroDaGravacao, nomeMudou } from '@/lib/portal-logo';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

import { chaveMarca } from './cartao-logo';
import { CHAVE_EMPRESAS } from './tela-empresas';

export const chaveDoCadastro = (tenant: string) => ['portal', tenant, 'cadastro'] as const;

/** Limite de caracteres por campo de texto (o schema do SDK confere; aqui só segura a digitação). */
const MAXIMO: Partial<Record<CampoCadastro, number>> = { razao_social: 200, logradouro: 200, numero: 20, complemento: 100, bairro: 100, municipio: 100, cep: 9, telefone: 16, email: 254, inscricao_estadual: 20 };
const TIPO: Partial<Record<CampoCadastro, string>> = { email: 'email', telefone: 'tel' };
const MODO: Partial<Record<CampoCadastro, 'numeric' | 'tel' | 'email'>> = { cep: 'numeric', telefone: 'tel', email: 'email' };

/** `podeEditarNomeFantasia`: só o time da Macuxi grava o nome fantasia (T-0182, RN-CORE-33); o admin do cliente o vê só leitura. */
export function CartaoDadosCadastrais({ tenant, podeEditarNomeFantasia }: { tenant: string; podeEditarNomeFantasia: boolean }) {
  const q = useQuery({
    queryKey: chaveDoCadastro(tenant),
    queryFn: () => chamarPortal(ROTAS_PORTAL.cadastroDaEmpresa(tenant), { schema: DadosCadastraisEmpresaSchema }),
    retry: (n, e) => !cadastroIndisponivel(e) && n < 2,
  });
  const [editando, setEditando] = useState(false);
  return (
    <Panel
      title={T.titulo}
      label={T.titulo}
      aside={
        q.data && (
          <Button size="sm" data-testid="empresa-cadastro.editar" onClick={() => setEditando(true)}>
            {T.editar}
          </Button>
        )
      }
    >
      <div data-testid="empresa-cadastro" className="flex flex-col">
        {q.isPending && <LoadingBlock label={T.buscandoDados} />}
        {q.isError &&
          (cadastroIndisponivel(q.error) ? (
            <span data-testid="empresa-cadastro.indisponivel" className="text-[14px] text-ink-2">
              {TEXTO_INDISPONIVEL}
            </span>
          ) : (
            <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
          ))}
        {q.data && <LeituraDoCadastro dados={q.data} />}
      </div>
      {/* monta a cada abertura: o formulário começa do que foi lido */}
      {q.data && editando && <GavetaDoCadastro tenant={tenant} dados={q.data} podeEditarNomeFantasia={podeEditarNomeFantasia} onFechar={() => setEditando(false)} />}
    </Panel>
  );
}

/** Pares de rótulo e valor; vazio = em branco (sem traço nem "não informado"); o endereço numa linha só. */
function LeituraDoCadastro({ dados }: { dados: DadosCadastraisEmpresa }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
      {linhasDaLeitura(dados).map((l) => (
        <div key={l.campo} className={cx('flex min-w-0 flex-col gap-0.5', CAMPOS_LARGOS.has(l.campo) && 'col-span-2')}>
          <dt className="text-[13px] font-semibold text-ink-2">{l.rotulo}</dt>
          <dd data-testid={`empresa-cadastro.${l.campo}`} className="m-0 min-h-5 text-[15px] break-words text-ink">
            {l.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Aviso = { texto: string; tom: NoticeTone } | null;

/** Gaveta "Dados da empresa" (montada só enquanto aberta: começa do que foi lido). */
export function GavetaDoCadastro({
  tenant,
  dados,
  podeEditarNomeFantasia,
  onFechar,
}: {
  tenant: string;
  dados: DadosCadastraisEmpresa;
  podeEditarNomeFantasia: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const lido = formularioDoCadastro(dados);
  const [form, setForm] = useState<FormularioCadastro>(lido);
  const [erros, setErros] = useState<ErrosDoCadastro>({});
  const [nome, setNome] = useState(dados.nome_fantasia ?? '');
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // erro do Salvar: o aviso fica no topo da gaveta; o foco (e a rolagem) vai até ele
  const refAviso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aviso?.tom !== 'danger') return;
    refAviso.current?.scrollIntoView({ block: 'nearest' });
    refAviso.current?.focus({ preventScroll: true });
  }, [aviso]);

  const mudar = (c: CampoCadastro, v: string) => {
    setForm((f) => ({ ...f, [c]: v }));
    setErros((x) => ({ ...x, [c]: undefined }));
  };

  const trazerDaReceita = async () => {
    if (buscando || !dados.cnpj) return;
    setBuscando(true);
    setAviso(null);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.cnpj, { metodo: 'POST', corpo: { cnpj: dados.cnpj }, schema: ConsultaCnpjRespostaSchema });
      const p = preencherVazios(form, r);
      setForm(p.formulario);
      setAviso(p.preenchidos.length > 0 ? { texto: T.preenchidos(p.preenchidos.length), tom: 'success' } : { texto: T.nadaVazio, tom: 'info' });
    } catch (x) {
      const estado = estadoDoErroCnpj(x);
      setAviso({ texto: (estado && textoDoEstadoCnpj(estado, null)) || mensagemDoErro(x), tom: 'warning' });
    } finally {
      setBuscando(false);
    }
  };

  const salvar = async () => {
    if (salvando) return;
    setAviso(null);
    const c = corpoDoCadastro(form);
    if (!c.ok) {
      setErros(c.erros);
      return;
    }
    setSalvando(true);
    // duas rotas: o cadastro (11 chaves) e, só quando mudou, o nome fantasia (rota da marca, T-0182)
    let etapa: 'cadastro' | 'nome' = 'cadastro';
    try {
      if (formularioMudou(form, lido)) {
        const novo = await chamarPortal(ROTAS_PORTAL.cadastroDaEmpresa(tenant), { metodo: 'PUT', corpo: c.corpo, schema: DadosCadastraisEmpresaSchema });
        qc.setQueryData(chaveDoCadastro(tenant), novo);
        // a razão social é o título da página da empresa
        if (novo.razao_social !== dados.razao_social) void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS });
      }
      if (mudouNome) {
        etapa = 'nome';
        const m = await chamarPortal(ROTAS_PORTAL.marcaDaEmpresa(tenant), { metodo: 'PUT', corpo: { nome_fantasia: nome }, schema: MarcaEmpresaSchema });
        qc.setQueryData(chaveMarca(tenant), m);
        qc.setQueryData<DadosCadastraisEmpresa>(chaveDoCadastro(tenant), (d) => (d ? { ...d, nome_fantasia: m.nome_fantasia } : d));
      }
      toast('success', T.salvos);
      onFechar();
    } catch (x) {
      if (etapa === 'nome') {
        setErroNome(erroDaGravacao(x).mensagem);
        return;
      }
      const porCampo = errosDaApi(x);
      if (porCampo) setErros(porCampo);
      else setAviso({ texto: mensagemDoErro(x), tom: 'danger' });
    } finally {
      setSalvando(false);
    }
  };

  const mudouNome = podeEditarNomeFantasia && nomeMudou(nome, dados.nome_fantasia);
  const rodape = (
    <>
      <Button data-testid="empresa-cadastro.cancelar" onClick={onFechar}>
        {T.cancelar}
      </Button>
      <Button variant="primary" data-testid="empresa-cadastro.salvar" disabled={salvando || (!formularioMudou(form, lido) && !mudouNome)} onClick={() => void salvar()}>
        {salvando ? T.salvando : T.salvar}
      </Button>
    </>
  );

  return (
    <Drawer open title={T.titulo} onClose={onFechar} rodape={rodape}>
      <form
        data-testid="empresa-cadastro.formulario"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        {dados.cnpj && (
          <Button size="sm" className="self-start" data-testid="empresa-cadastro.receita" data-salvar="false" disabled={buscando} onClick={() => void trazerDaReceita()}>
            {buscando ? T.buscando : T.receita}
          </Button>
        )}
        {aviso && (
          <div ref={refAviso} tabIndex={-1} data-testid="empresa-cadastro.aviso" aria-live="polite">
            <Notice tone={aviso.tom}>{aviso.texto}</Notice>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          {linhasDoCadastro(dados).map((l) => {
            const largo = CAMPOS_LARGOS.has(l.campo);
            if (l.campo === 'nome_fantasia' && podeEditarNomeFantasia) {
              return (
                <CampoFormulario key={l.campo} rotulo={l.rotulo} opcional erro={erroNome ?? undefined} className={cx(largo && 'col-span-2')}>
                  <input
                    data-testid="empresa-cadastro.campo-nome_fantasia"
                    className={CLASSE_CAMPO}
                    maxLength={MAX_NOME_FANTASIA}
                    aria-invalid={erroNome ? true : undefined}
                    value={nome}
                    onChange={(e) => {
                      setNome(e.target.value);
                      setErroNome(null);
                    }}
                  />
                </CampoFormulario>
              );
            }
            if (l.campo === 'cnpj' || l.campo === 'nome_fantasia') {
              return (
                <CampoFormulario key={l.campo} rotulo={l.rotulo} className={cx(largo && 'col-span-2')}>
                  <input data-testid={`empresa-cadastro.campo-${l.campo}`} className={CLASSE_CAMPO} value={l.valor} disabled readOnly />
                </CampoFormulario>
              );
            }
            const c = l.campo;
            return (
              <CampoFormulario key={c} rotulo={ROTULOS_CADASTRO[c]} opcional={c !== 'razao_social'} erro={erros[c]} className={cx(largo && 'col-span-2')}>
                {c === 'uf' ? (
                  <select data-testid="empresa-cadastro.campo-uf" className={CLASSE_CAMPO} value={form.uf} aria-invalid={erros.uf ? true : undefined} onChange={(e) => mudar('uf', e.target.value)}>
                    <option value="" />
                    {UFS_BRASIL.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    data-testid={`empresa-cadastro.campo-${c}`}
                    className={CLASSE_CAMPO}
                    type={TIPO[c] ?? 'text'}
                    inputMode={MODO[c]}
                    maxLength={MAXIMO[c]}
                    required={c === 'razao_social'}
                    aria-invalid={erros[c] ? true : undefined}
                    value={form[c]}
                    onChange={(e) => mudar(c, e.target.value)}
                  />
                )}
              </CampoFormulario>
            );
          })}
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}
