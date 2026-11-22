'use client';

/**
 * "Nova empresa" do portal (spec docs/design/telas/portal-config-enxuto.md §4 e §11): CNPJ → dados da Receita → Plano → Adicionais
 * → Ciclo e teste → Administrador → "Criar empresa" com o "Total" ao lado. `POST /v1/plataforma/empresas-com-plano`
 * (`CriarEmpresaComPlanoSchema`, ADR 0047); o CNPJ vem de `POST /v1/plataforma/cnpj` (ADR 0048). Só o CNPJ ativo na Receita libera o
 * "Criar empresa" (decidido em 14/11). Código da licença UF + 4 dígitos sorteado e conferido com `simular` antes de gravar
 * (`lib/portal-nova-empresa.ts`). A API revalida tudo. A senha inicial só vive no estado da tela (nunca em storage, URL ou log) e é
 * limpa depois de gravar. testIDs: empresa.*.
 * Servidor sem planos (`MACUXI_PLANOS` desligado) ou catálogo vazio: a "Nova empresa" usa o passo antigo (`passo-empresa-legado.tsx`).
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type SelectHTMLAttributes } from 'react';
import { UFS_BRASIL, ehUf } from '@macuxi/comum/endereco';
import { faltasNaSenha } from '@macuxi/core/contracts';
import { ConsultaCnpjRespostaSchema, CriarEmpresaComPlanoRespostaSchema, type SituacaoCadastral } from '@macuxi/platform-sdk';
import { Button, CLASSE_CAMPO_ACESSO, cx, IconCheck, IconChevronDown, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';

import { Campo } from '@/components/campo-acesso';
import { chamarPortal, ehRotaAusente, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import {
  CAMPOS_VAZIOS,
  camposDaConsulta,
  cnaeDaConsulta,
  cnpjLiberaCriar,
  estadoDaConsulta,
  estadoDoErroCnpj,
  estadoLocalDoCnpj,
  preencherCampos,
  TEXTOS_CNPJ,
  textoDoEstadoCnpj,
  type CamposDaReceita,
  type EstadoCnpj,
} from '@/lib/portal-cnpj';
import { FUSO_DA_UF, FUSOS_BRASIL, mascararCnpj, rotuloCurtoDoFuso } from '@/lib/portal-formato';
import {
  codigoDaUf,
  codigoLivre,
  corpoDaNovaEmpresa,
  erroDoAdminNaApi,
  errosDaNovaEmpresa,
  guardarEmpresaCriada,
  problemasDoPlano,
  semChaves,
  SORTEIOS_DO_CODIGO,
  TEXTOS_NOVA_EMPRESA,
  type AdminDoForm,
  type FormNovaEmpresa,
} from '@/lib/portal-nova-empresa';
import { principalDesabilitadoCss } from '@/lib/portal-estilos';
import { ESCOLHA_VAZIA, semCatalogoDePlanos, totalDaEscolha, type EscolhaDaTela } from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

import { AdminInicial } from './admin-inicial';
import { PassoEmpresa as PassoEmpresaLegado } from './passo-empresa-legado';
import { SeletorPlano, usePlanos } from './seletor-plano';

/** Lista do portal (UF, Fuso) com a seta do kit (MC-0047) e o erro ligado ao campo. */
function CampoSelecao({ rotulo, erro, testId, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string; erro?: string; testId: string }) {
  const idErro = `${testId}-erro`;
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <span className="relative">
        <select data-testid={testId} aria-invalid={erro ? true : undefined} aria-describedby={erro ? idErro : undefined} className={cx(CLASSE_CAMPO_ACESSO, 'appearance-none pr-9')} {...rest}>
          {children}
        </select>
        <IconChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute top-[13px] right-3 text-ink-2" />
      </span>
      {erro && (
        <span id={idErro} className="text-[12px] text-danger">
          {erro}
        </span>
      )}
    </label>
  );
}

/** Sorteio do número da licença (0 a 9999), no navegador. */
const sortearNumero = (): number => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 10_000;

/**
 * "Nova empresa": com o catálogo de planos, o fluxo novo (CNPJ, Plano, Adicionais, Ciclo, Administrador). Servidor sem planos
 * (`MACUXI_PLANOS` desligado: o catálogo dá 404) ou catálogo vazio: o passo antigo, módulo por módulo, como antes dos planos.
 */
export function NovaEmpresa({ aoGravar }: { aoGravar?: () => void }) {
  const planos = usePlanos();
  if (planos.isPending) return <LoadingBlock label="Buscando os planos…" />;
  if (semCatalogoDePlanos({ erro: planos.error, planos: planos.data })) return <PassoEmpresaLegado aoGravar={aoGravar ? () => aoGravar() : undefined} />;
  return <NovaEmpresaComPlano aoGravar={aoGravar} />;
}

function NovaEmpresaComPlano({ aoGravar }: { aoGravar?: () => void }) {
  const router = useRouter();
  const planos = usePlanos();
  const [cnpj, setCnpj] = useState('');
  const [estado, setEstado] = useState<EstadoCnpj>('vazio');
  const [situacao, setSituacao] = useState<SituacaoCadastral | null>(null);
  const [campos, setCampos] = useState<CamposDaReceita>(CAMPOS_VAZIOS);
  const [editados, setEditados] = useState<ReadonlySet<keyof CamposDaReceita>>(new Set());
  const [cnae, setCnae] = useState('');
  const [fuso, setFuso] = useState('America/Manaus');
  const [escolha, setEscolha] = useState<EscolhaDaTela>(ESCOLHA_VAZIA);
  const [admin, setAdminForm] = useState<AdminDoForm>({ nome: '', email: '', senha: '' });
  const [pedidoId] = useState(() => crypto.randomUUID());
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [erroAdmin, setErroAdmin] = useState<string | null>(null);
  const [problemasPlano, setProblemasPlano] = useState<string[] | null>(null);
  const [destacarSenha, setDestacarSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // a última busca vale; uma resposta atrasada de um CNPJ anterior é ignorada
  const busca = useRef(0);
  const faltasDaSenha = faltasNaSenha(admin.senha);

  const buscar = async (texto: string) => {
    const local = estadoLocalDoCnpj(texto);
    if (local !== 'pronto') return setEstado(local);
    const n = ++busca.current;
    setEstado('buscando');
    try {
      const r = await chamarPortal(ROTAS_PORTAL.cnpj, { metodo: 'POST', corpo: { cnpj: texto }, schema: ConsultaCnpjRespostaSchema });
      if (n !== busca.current) return;
      setCampos((atuais) => preencherCampos(atuais, camposDaConsulta(r), editados));
      setCnae(cnaeDaConsulta(r));
      setSituacao(r.situacao_cadastral);
      if (r.uf && !editados.has('uf')) setFuso(FUSO_DA_UF[r.uf]);
      setErros((e) => semChaves(e, 'cnpj', 'razao_social', 'uf'));
      setEstado(estadoDaConsulta(r));
    } catch (x) {
      if (n !== busca.current) return;
      setEstado(estadoDoErroCnpj(x) ?? 'receita-fora');
    }
  };

  const mudarCnpj = (v: string) => {
    busca.current++;
    setCnpj(mascararCnpj(v));
    setEstado('vazio');
    setSituacao(null);
    setCnae('');
  };
  const setCampo = (k: keyof CamposDaReceita, v: string) => {
    setCampos((c) => ({ ...c, [k]: v }));
    setEditados((s) => new Set([...s, k]));
    setErros((e) => semChaves(e, k));
    if (k === 'uf' && ehUf(v)) setFuso(FUSO_DA_UF[v]);
  };
  const setAdmin = (k: keyof AdminDoForm, v: string) => {
    setAdminForm((a) => ({ ...a, [k]: v }));
    // o erro antigo do campo some ao digitar: a lista das regras segue ao vivo
    setErros((e) => semChaves(e, `admin.${k}`));
  };
  const mudarEscolha = (e: EscolhaDaTela) => {
    setEscolha(e);
    setProblemasPlano(null);
    setErros((x) => semChaves(x, 'plano', 'adicional-promotor', 'adicional-pesquisa', 'adicional-treinamento'));
  };

  const listaPlanos = planos.data ?? [];
  const total = totalDaEscolha(listaPlanos, escolha);
  const podeCriar = cnpjLiberaCriar(estado) && planos.isSuccess && !enviando;

  /** Sorteia o código da UF e confere com `simular` que ele é novo; devolve o código livre (ou `null`, sem sorte). */
  const codigoNovo = async (form: FormNovaEmpresa): Promise<string | null> => {
    for (let i = 0; i < SORTEIOS_DO_CODIGO; i++) {
      const codigo = codigoDaUf(form.uf, sortearNumero());
      const r = await chamarPortal(ROTAS_PORTAL.empresaComPlano, { metodo: 'POST', corpo: corpoDaNovaEmpresa(form, codigo, true), schema: CriarEmpresaComPlanoRespostaSchema });
      if (codigoLivre(r)) return codigo;
    }
    return null;
  };

  const submeter = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!podeCriar) return;
    const form: FormNovaEmpresa = { cnpj, razao_social: campos.razao_social, uf: campos.uf, fuso, escolha, admin, pedido_id: pedidoId };
    const e = errosDaNovaEmpresa(form);
    setErros(e);
    setErro(null);
    setErroAdmin(null);
    setProblemasPlano(null);
    setDestacarSenha(admin.senha !== '' && faltasDaSenha.length > 0);
    if (Object.keys(e).length > 0) return setErro(TEXTOS_NOVA_EMPRESA.confira);
    setEnviando(true);
    try {
      const codigo = await codigoNovo(form);
      if (!codigo) throw new Error('sem código livre');
      const r = await chamarPortal(ROTAS_PORTAL.empresaComPlano, { metodo: 'POST', corpo: corpoDaNovaEmpresa(form, codigo, false), schema: CriarEmpresaComPlanoRespostaSchema });
      setAdminForm((a) => ({ ...a, senha: '' }));
      aoGravar?.();
      if (r.tenant_id) {
        guardarEmpresaCriada(r.tenant_id, r.codigo);
        router.push(`/empresas/${r.tenant_id}`);
      }
    } catch (x) {
      const doCnpj = estadoDoErroCnpj(x);
      const doAdmin = erroDoAdminNaApi(x, admin.senha);
      const doPlano = problemasDoPlano(x);
      if (doCnpj) setEstado(doCnpj);
      else if (doPlano) setProblemasPlano(doPlano);
      else if (doAdmin && 'bloco' in doAdmin) setErroAdmin(doAdmin.bloco);
      else if (doAdmin) {
        setErros((atuais) => ({ ...atuais, 'admin.senha': doAdmin.senha }));
        setDestacarSenha(true);
      }
      setErro(doCnpj || doPlano || doAdmin ? TEXTOS_NOVA_EMPRESA.confira : mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

  const textoCnpj = textoDoEstadoCnpj(estado, situacao);
  const cnpjComErro = estado === 'invalido' || estado === 'nao-encontrado' || estado === 'nao-ativa';

  return (
    <form data-testid="empresa.form" onSubmit={(e) => void submeter(e)} noValidate className="flex flex-col gap-4">
      <Panel title={TEXTOS_NOVA_EMPRESA.empresa}>
        <div className="flex flex-col gap-4">
          <div className="flex w-full flex-col gap-1 sm:max-w-[calc(50%-8px)]">
            <label htmlFor="empresa-cnpj" className="text-[13px] font-semibold text-ink">
              CNPJ
            </label>
            <div className="relative">
              <input
                id="empresa-cnpj"
                data-testid="empresa.cnpj"
                data-estado={estado}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                readOnly={estado === 'buscando'}
                aria-invalid={cnpjComErro ? true : undefined}
                aria-describedby="empresa-cnpj-estado"
                className={cx(CLASSE_CAMPO_ACESSO, 'pr-32', estado === 'receita-fora' && 'border-warning')}
                onChange={(e) => mudarCnpj(e.target.value)}
                onBlur={(e) => void buscar(e.target.value)}
              />
              <span className="absolute top-0 right-3 flex h-11 items-center gap-2 text-[13px]">
                {estado === 'buscando' && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-field border-t-accent" />}
                {/* ✓ verde sem texto visível; o texto vai no rótulo de acessibilidade (MC-0049 opção A, R-20261114-172200) */}
                {estado === 'encontrado' && <IconCheck size={16} role="img" aria-label={TEXTOS_CNPJ.encontrado} data-testid="empresa.cnpj-encontrado" className="text-success" />}
                {estado === 'receita-fora' && (
                  <button type="button" data-testid="empresa.cnpj-tentar" className="font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => void buscar(cnpj)}>
                    {TEXTOS_CNPJ.tentar}
                  </button>
                )}
              </span>
            </div>
            <span id="empresa-cnpj-estado" aria-live="polite" className={cx('text-[13px]', cnpjComErro ? 'font-semibold text-danger' : estado === 'receita-fora' ? 'font-semibold text-warning' : 'text-ink-2')}>
              {textoCnpj}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Razão social" testId="empresa.razao-social" value={campos.razao_social} erro={erros.razao_social} onChange={(e) => setCampo('razao_social', e.target.value)} />
            <Campo rotulo="Nome fantasia" testId="empresa.nome-fantasia" value={campos.nome_fantasia} onChange={(e) => setCampo('nome_fantasia', e.target.value)} />
          </div>
          <Campo rotulo="Endereço" testId="empresa.endereco" value={campos.endereco} onChange={(e) => setCampo('endereco', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
            <Campo rotulo="Município" testId="empresa.municipio" value={campos.municipio} onChange={(e) => setCampo('municipio', e.target.value)} />
            <CampoSelecao rotulo="UF" testId="empresa.uf" value={campos.uf} erro={erros.uf} onChange={(e) => setCampo('uf', e.target.value)}>
              <option value="" disabled />
              {UFS_BRASIL.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </CampoSelecao>
            <CampoSelecao rotulo="Fuso" testId="empresa.fuso" value={fuso} onChange={(e) => setFuso(e.target.value)}>
              {FUSOS_BRASIL.map(([v]) => (
                <option key={v} value={v}>
                  {rotuloCurtoDoFuso(v)}
                </option>
              ))}
            </CampoSelecao>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Telefone" testId="empresa.telefone" inputMode="tel" value={campos.telefone} onChange={(e) => setCampo('telefone', e.target.value)} />
            <Campo rotulo="E-mail" testId="empresa.email" type="email" value={campos.email} onChange={(e) => setCampo('email', e.target.value)} />
          </div>
          {/* CNAE só leitura (fundo cinza, sem borda): vem da Receita e não muda no portal (§11.2) */}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-ink">CNAE</span>
            <input data-testid="empresa.cnae" readOnly tabIndex={-1} value={cnae} className="h-11 w-full rounded-xl bg-neutral-soft px-3 text-[15px] text-ink outline-none" />
          </label>
        </div>
      </Panel>

      {planos.isPending && <LoadingBlock label="Buscando os planos…" />}
      {planos.isError && (
        <Panel title="Plano">
          <span data-testid="empresa.planos-erro" className="text-[13px] text-ink-2">
            {ehRotaAusente(planos.error) ? TEXTO_INDISPONIVEL : mensagemDoErro(planos.error)}
          </span>
        </Panel>
      )}
      {planos.isSuccess && <SeletorPlano planos={listaPlanos} escolha={escolha} aoMudar={mudarEscolha} erros={{ ...erros, plano: erros.plano ?? problemasPlano?.join(' ') }} />}

      <AdminInicial admin={admin} erros={erros} erroAdmin={erroAdmin} destacarSenha={destacarSenha} aoMudar={setAdmin} />

      {erro && (
        <div data-testid="empresa.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-5">
        <Button data-testid="empresa.gravar" type="submit" variant="primary" className={cx('h-[52px] px-6 text-[15px]', principalDesabilitadoCss)} disabled={!podeCriar}>
          {enviando ? TEXTOS_NOVA_EMPRESA.criando : TEXTOS_NOVA_EMPRESA.criar}
        </Button>
        {total && (
          <span data-testid="empresa.total" className="text-[17px] font-bold tabular-nums text-ink">
            {total}
          </span>
        )}
      </div>
    </form>
  );
}
