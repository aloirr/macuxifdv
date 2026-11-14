'use client';

/**
 * "Nova empresa" do portal (spec docs/design/telas/portal-config-enxuto.md §4 e §11): CNPJ → dados da Receita → Plano → Adicionais
 * → Ciclo e teste → Administrador → "Criar empresa" com o "Total" ao lado. `POST /v1/plataforma/empresas-com-plano`
 * (`CriarEmpresaComPlanoSchema`, ADR 0047); o CNPJ vem de `POST /v1/plataforma/cnpj` (ADR 0048). Só o CNPJ ativo na Receita libera o
 * "Criar empresa" (decidido em 14/11). A API revalida tudo. A senha inicial só vive no estado da tela (nunca em storage, URL ou
 * log) e é limpa depois de gravar. Regras e textos: `lib/portal-nova-empresa.ts`, `lib/portal-cnpj.ts`, `lib/portal-planos.ts`.
 * testIDs: empresa.*.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UFS_BRASIL, type Uf } from '@macuxi/comum/endereco';
import { faltasNaSenha, mensagemDaSenha, SENHA_MIN_CARACTERES } from '@macuxi/core/contracts';
import { ConsultaCnpjRespostaSchema, CriarEmpresaComPlanoRespostaSchema, ListaPlanosSchema, type SituacaoCadastral } from '@macuxi/platform-sdk';
import { Button, cx, IconCheck, LoadingBlock, Notice, Panel, RegrasDaSenha, SENHA_ATENDE_AS_REGRAS } from '@macuxi/ui/web';

import { chamarPortal, ehRotaAusente, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import {
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
  corpoDaNovaEmpresa,
  erroDoAdminNaApi,
  errosDaNovaEmpresa,
  guardarEmpresaCriada,
  problemasDoPlano,
  TEXTOS_ADMIN,
  TEXTOS_NOVA_EMPRESA,
  type AdminDoForm,
} from '@/lib/portal-nova-empresa';
import { ESCOLHA_VAZIA, totalDaEscolha, type EscolhaDaTela } from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo, campoCss, CampoSelecao, CampoSenha, principalDesabilitadoCss } from './base';
import { SeletorPlano } from './seletor-plano';

const CHAVE_PLANOS = ['portal', 'planos'] as const;

/** Catálogo de planos (`GET ROTA_PORTAL_PLANOS`): o mesmo no Criar empresa e no "Trocar de plano". */
export const usePlanos = () => useQuery({ queryKey: CHAVE_PLANOS, queryFn: () => chamarPortal(ROTAS_PORTAL.planos, { schema: ListaPlanosSchema }).then((r) => r.itens) });

const CAMPOS_VAZIOS: CamposDaReceita = { razao_social: '', nome_fantasia: '', endereco: '', municipio: '', uf: '', telefone: '', email: '' };

/** Cópia de `e` sem as chaves dadas. */
function semChaves(e: Record<string, string>, ...ks: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(e).filter(([c]) => !ks.includes(c)));
}

export function NovaEmpresa({ aoGravar }: { aoGravar?: () => void }) {
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
      const daReceita = camposDaConsulta(r);
      setCampos((atuais) => preencherCampos(atuais, daReceita, editados));
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
    if (k === 'uf' && (UFS_BRASIL as readonly string[]).includes(v)) setFuso(FUSO_DA_UF[v as Uf]);
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

  const submeter = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!podeCriar) return;
    const form = { cnpj, razao_social: campos.razao_social, uf: campos.uf, fuso, escolha, admin, pedido_id: pedidoId };
    const e = errosDaNovaEmpresa(form);
    setErros(e);
    setErro(null);
    setErroAdmin(null);
    setProblemasPlano(null);
    setDestacarSenha(admin.senha !== '' && faltasDaSenha.length > 0);
    if (Object.keys(e).length > 0) return setErro(TEXTOS_NOVA_EMPRESA.confira);
    setEnviando(true);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.empresaComPlano, { metodo: 'POST', corpo: corpoDaNovaEmpresa(form), schema: CriarEmpresaComPlanoRespostaSchema });
      setAdminForm((a) => ({ ...a, senha: '' }));
      aoGravar?.();
      if (r.tenant_id) {
        guardarEmpresaCriada(r.tenant_id, r.codigo);
        router.push(`/empresas/${r.tenant_id}#empresa`);
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
          <div className="flex max-w-[calc(50%-8px)] min-w-[260px] flex-col gap-1">
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
                aria-invalid={cnpjComErro || estado === 'receita-fora' ? true : undefined}
                aria-describedby="empresa-cnpj-estado"
                className={cx(campoCss, 'pr-28', estado === 'receita-fora' && 'aria-[invalid=true]:border-warning')}
                onChange={(e) => mudarCnpj(e.target.value)}
                onBlur={(e) => void buscar(e.target.value)}
              />
              <span className="absolute right-3 top-0 flex h-11 items-center gap-2 text-[13px]">
                {estado === 'buscando' && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-field border-t-accent" />}
                {/* ✓ verde sem texto visível; o texto vai no rótulo de acessibilidade (MC-0049 opção A, R-20261114-172200) */}
                {estado === 'encontrado' && <IconCheck size={16} role="img" aria-hidden={undefined} aria-label={TEXTOS_CNPJ.encontrado} data-testid="empresa.cnpj-encontrado" className="text-success" />}
                {estado === 'receita-fora' && (
                  <button type="button" data-testid="empresa.cnpj-tentar" className="font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => void buscar(cnpj)}>
                    {TEXTOS_CNPJ.tentar}
                  </button>
                )}
              </span>
            </div>
            <span id="empresa-cnpj-estado" aria-live="polite" className={cx('text-[13px]', cnpjComErro ? 'font-semibold text-danger' : estado === 'receita-fora' ? 'font-semibold text-warning' : 'font-medium text-ink-2')}>
              {textoCnpj}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Razão social" testId="empresa.razao-social" value={campos.razao_social} erro={erros.razao_social} onChange={(e) => setCampo('razao_social', e.target.value)} />
            <Campo rotulo="Nome fantasia" testId="empresa.nome-fantasia" value={campos.nome_fantasia} onChange={(e) => setCampo('nome_fantasia', e.target.value)} />
          </div>
          <Campo rotulo="Endereço" testId="empresa.endereco" value={campos.endereco} onChange={(e) => setCampo('endereco', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-[1fr_140px_1fr]">
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
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-ink">CNAE</span>
            <input data-testid="empresa.cnae" readOnly tabIndex={-1} value={cnae} className="h-11 w-full rounded-xl bg-line-2 px-3 text-[15px] text-ink outline-none" />
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

      <Panel title={TEXTOS_ADMIN.titulo}>
        <div data-testid="empresa.admin" className="flex flex-col gap-4">
          {erroAdmin && (
            <div data-testid="empresa.admin-erro">
              <Notice tone="danger">{erroAdmin}</Notice>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome" testId="empresa.admin-nome" autoComplete="off" value={admin.nome} erro={erros['admin.nome']} onChange={(e) => setAdmin('nome', e.target.value)} />
            <Campo rotulo="E-mail" testId="empresa.admin-email" type="email" autoComplete="off" spellCheck={false} value={admin.email} erro={erros['admin.email']} onChange={(e) => setAdmin('email', e.target.value)} />
          </div>
          <div className="flex max-w-[calc(50%-8px)] min-w-[260px] flex-col gap-2">
            <CampoSenha
              rotulo="Senha inicial"
              testId="empresa.admin-senha"
              semOlho
              autoComplete="new-password"
              descrito="empresa-admin-senha-regras"
              value={admin.senha}
              erro={erros['admin.senha']}
              onChange={(e) => setAdmin('senha', e.target.value)}
            />
            <RegrasDaSenha
              id="empresa-admin-senha-regras"
              testId="empresa.admin-regras"
              faltas={faltasDaSenha}
              destacar={destacarSenha && admin.senha !== '' && faltasDaSenha.length > 0}
              minimo={SENHA_MIN_CARACTERES}
              resumo={mensagemDaSenha(faltasDaSenha, admin.senha) ?? SENHA_ATENDE_AS_REGRAS}
            />
            <span className="text-[12px] text-ink-2">{TEXTOS_ADMIN.passeASenha}</span>
          </div>
        </div>
      </Panel>

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
          <span data-testid="empresa.total" className="font-display text-[18px] font-bold tabular-nums text-ink">
            {total}
          </span>
        )}
      </div>
    </form>
  );
}
