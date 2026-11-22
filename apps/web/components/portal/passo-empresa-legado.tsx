'use client';

/**
 * LEGADO (spec docs/design/telas/portal-config-enxuto.md §8 e §11: o "Acrescentar módulos" sai da aba Empresa). Fica enquanto
 * o servidor estiver sem planos (passo antigo da Nova empresa e `semPlano` da `tela-empresa`); sai inteiro, com os testes do
 * "passo Empresa" em `lib/portal-telas.test.ts`, quando nenhum dos dois o usar. A "Nova empresa" é a `NovaEmpresa` de `passo-empresa.tsx`.
 * Passo Empresa do portal (T-0087 §2; desenho §5.1): `POST /v1/plataforma/empresas` com `CriarEmpresaSchema` — por baixo, o
 * `tenant:criar` da T-0083 (RN-CORE-31, idempotente pelo código). Os nativos do kit (`MODULOS_NATIVOS`: Catálogo, Core e
 * Integração) entram sempre e não aparecem na lista. A API revalida tudo (dependências entre módulos, RN-CORE-03). testIDs: empresa.*.
 * - Empresa nova (servidor sem planos): Empresa, Administrador (`AdminInicial`, RN-CORE-34), Módulos e licenças, Parâmetros
 *   iniciais, "Conferir sem gravar" (`simular: true`) e "Criar empresa". A senha só vive no estado da tela e é limpa depois de gravar.
 * - Empresa existente sem plano (RD-2613): só as caixas dos módulos ainda não licenciados e "Acrescentar módulos", dentro do cartão
 *   "Módulos licenciados" (o cabeçalho já mostra a empresa e o cartão "Administradores", os administradores). Tudo licenciado: nada.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { faltasNaSenha } from '@macuxi/core/contracts';
import { CriarEmpresaRespostaSchema, CriarEmpresaSchema, MODULOS, type ModuloId } from '@macuxi/platform-sdk';
import { Button, CLASSE_CAMPO_BASE, cx, MODULOS_NATIVOS, modulosContrataveis, nomeDoModulo, Notice, Panel, parseDecimalInput, SelectField } from '@macuxi/ui/web';

import { chamarPortal, mensagemDoErro } from '@/lib/portal-api';
import { FUSOS_BRASIL, mascararCnpj } from '@/lib/portal-formato';
import { erroDoAdminNaApi, errosDoAdmin, semChaves, type AdminDoForm } from '@/lib/portal-nova-empresa';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo } from '@/components/campo-acesso';

import { AdminInicial } from './admin-inicial';

type Resposta = ReturnType<typeof CriarEmpresaRespostaSchema.parse>;
interface EmpresaExistente {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string | null;
  fuso: string;
  modulos: { modulo: ModuloId; licencas: number | null }[];
}

/** Os nativos do kit (Catálogo, Core e Integração): entram sempre e não aparecem em lista. */
const MODULOS_SEMPRE: readonly ModuloId[] = MODULOS.filter((m) => (MODULOS_NATIVOS as readonly string[]).includes(m));

/** Os módulos que aparecem para escolher: os contratáveis do kit (nome e frase de valor), em ordem alfabética. */
const ESCOLHIVEIS = modulosContrataveis(MODULOS);

interface Form {
  codigo: string;
  razao_social: string;
  cnpj: string;
  fuso: string;
  modulos: Partial<Record<ModuloId, { marcado: boolean; licencas: string }>>;
  alcada_vendedor_pct: string;
  alcada_supervisor_pct: string;
  alcada_gerente_pct: string;
  validade_orcamento_dias: string;
  aplicacao_no_orcamento_padrao: boolean;
  /** Administrador inicial (só na empresa nova; RN-CORE-34). */
  admin?: AdminDoForm;
}

/** Sugestão de código a partir da razão social: minúsculas, sem acento, hífens, até 40. */
export function sugerirCodigo(razao: string): string {
  return razao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

const num = (s: string): number | undefined => {
  const n = parseDecimalInput(s);
  return n === null ? undefined : n;
};

/** Monta o corpo do `POST /plataforma/empresas` a partir do formulário (vazio = padrão do schema). */
export function corpoDaEmpresa(f: Form, simular: boolean): unknown {
  const modulos = MODULOS.filter((m) => MODULOS_SEMPRE.includes(m) || f.modulos[m]?.marcado).map((m) => {
    const l = f.modulos[m]?.licencas.trim() ?? '';
    return { modulo: m, licencas: l === '' ? null : Number(l) };
  });
  const parametros = Object.fromEntries(
    Object.entries({
      alcada_vendedor_pct: num(f.alcada_vendedor_pct),
      alcada_supervisor_pct: num(f.alcada_supervisor_pct),
      alcada_gerente_pct: num(f.alcada_gerente_pct),
      validade_orcamento_dias: f.validade_orcamento_dias.trim() === '' ? undefined : Number(f.validade_orcamento_dias),
      aplicacao_no_orcamento_padrao: f.aplicacao_no_orcamento_padrao,
    }).filter(([, v]) => v !== undefined),
  );
  // sem `trim` na senha (RN-CORE-32); o e-mail o contrato normaliza
  const admin = f.admin ? { admin: { nome: f.admin.nome.trim(), email: f.admin.email.trim(), senha: f.admin.senha } } : {};
  return { codigo: f.codigo.trim(), razao_social: f.razao_social.trim(), cnpj: f.cnpj, fuso: f.fuso, modulos, parametros, ...admin, simular };
}

/**
 * Mensagens em pt-BR por campo para as falhas genéricas do Zod (tamanho, faixa, tipo), que viriam em inglês
 * ("Number must be less than or equal to 100"). Regex e refine do schema já trazem a mensagem em português e ficam.
 */
const MENSAGEM_DO_CAMPO: Record<string, string> = {
  codigo: 'Use de 2 a 40 letras minúsculas, dígitos ou hífen.',
  razao_social: 'Informe a razão social, de 2 a 200 caracteres.',
  cnpj: 'O CNPJ tem 14 dígitos.',
  fuso: 'Escolha o fuso da empresa.',
  'modulos.modulos': 'Escolha ao menos um módulo.',
  'modulos.licencas': 'Licenças: número inteiro, 0 ou mais (vazio = sem limite).',
  'parametros.alcada_vendedor_pct': 'Informe um percentual de 0 a 100.',
  'parametros.alcada_supervisor_pct': 'Informe um percentual de 0 a 100.',
  'parametros.alcada_gerente_pct': 'Informe um percentual de 0 a 100.',
  'parametros.validade_orcamento_dias': 'Informe de 1 a 90 dias.',
};
const CODIGOS_GENERICOS = new Set(['too_small', 'too_big', 'invalid_type', 'not_finite', 'not_multiple_of']);

/** Erros do schema por campo do formulário (mensagens em pt-BR). */
export function errosDaEmpresa(corpo: unknown): Record<string, string> {
  const p = CriarEmpresaSchema.safeParse(corpo);
  if (p.success) return {};
  const e: Record<string, string> = {};
  for (const i of p.error.issues) {
    // o administrador tem mensagens próprias (`errosDoAdmin`)
    if (i.path[0] === 'admin') continue;
    const k = i.path[0] === 'parametros' || i.path[0] === 'modulos' ? `${String(i.path[0])}.${String(i.path.at(-1) ?? '')}` : String(i.path[0]);
    const pt = CODIGOS_GENERICOS.has(i.code) ? MENSAGEM_DO_CAMPO[k] : undefined;
    e[k] ??= pt ?? i.message;
  }
  return e;
}

const ROTULO_RESULTADO: Record<Resposta['resultado'], string> = { criado: 'Empresa criada', atualizado: 'Empresa atualizada', sem_mudanca: 'Nada mudou' };

/** Linha do administrador no resultado (spec §6). `null` quando ele não veio no pedido. */
export function textoDoAdminNoResultado(r: Pick<Resposta, 'admin' | 'simulado'>, email: string | null): string | null {
  // no Conferir nada foi gravado: "não muda"; depois de gravar, "não mudou" (spec §6; R-20261107-174216 🟡 6)
  if (r.admin === 'existente') return r.simulado ? 'Administrador mantido: a senha não muda.' : 'Administrador mantido: a senha não mudou.';
  if (r.admin === 'criado') return r.simulado ? `Administrador que será criado: ${email ?? ''}.` : `Administrador criado: ${email ?? ''}.`;
  return null;
}

export type { AdminDoForm };

export function PassoEmpresa({ existente, aoGravar }: { existente?: EmpresaExistente; aoGravar?: (r: Resposta) => void }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => ({
    codigo: existente?.codigo ?? '',
    razao_social: existente?.razao_social ?? '',
    cnpj: existente?.cnpj ? mascararCnpj(existente.cnpj) : '',
    fuso: existente?.fuso ?? 'America/Manaus',
    modulos: Object.fromEntries(
      MODULOS.map((m) => {
        const atual = existente?.modulos.find((x) => x.modulo === m);
        return [m, { marcado: MODULOS_SEMPRE.includes(m) || !!atual, licencas: atual?.licencas != null ? String(atual.licencas) : '' }];
      }),
    ),
    alcada_vendedor_pct: '5',
    alcada_supervisor_pct: '10',
    alcada_gerente_pct: '15',
    validade_orcamento_dias: '7',
    aplicacao_no_orcamento_padrao: true,
    ...(existente ? {} : { admin: { nome: '', email: '', senha: '' } }),
  }));
  const [codigoTocado, setCodigoTocado] = useState(!!existente);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resposta | null>(null);
  const [enviando, setEnviando] = useState<'conferir' | 'gravar' | null>(null);
  // tentou conferir ou gravar com a senha fora da RN-CORE-32: a lista pinta as faltas de vermelho
  const [destacarSenha, setDestacarSenha] = useState(false);
  const [erroAdmin, setErroAdmin] = useState<string | null>(null);
  // e-mail do administrador do último envio (o resultado diz "Administrador criado: <e-mail>.")
  const [emailEnviado, setEmailEnviado] = useState<string | null>(null);
  const faltasDaSenha = f.admin ? faltasNaSenha(f.admin.senha) : [];

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setResultado(null);
  };
  const setAdmin = (k: keyof AdminDoForm, v: string) => {
    setF((x) => (x.admin ? { ...x, admin: { ...x.admin, [k]: v } } : x));
    // o erro antigo do campo some ao digitar: a lista das regras segue ao vivo (spec §6; R-20261107-174216 🟡 5)
    setErros((e) => (`admin.${k}` in e ? semChaves(e, `admin.${k}`) : e));
    setResultado(null);
  };
  const setModulo = (m: ModuloId, v: Partial<{ marcado: boolean; licencas: string }>) => {
    setF((x) => ({ ...x, modulos: { ...x.modulos, [m]: { marcado: x.modulos[m]?.marcado ?? false, licencas: x.modulos[m]?.licencas ?? '', ...v } } }));
    setResultado(null);
  };

  const enviar = async (simular: boolean) => {
    if (enviando) return;
    const corpo = corpoDaEmpresa(f, simular);
    const e = { ...errosDaEmpresa(corpo), ...(f.admin ? errosDoAdmin(f.admin) : {}) };
    setErros(e);
    setErro(null);
    setErroAdmin(null);
    setDestacarSenha(faltasDaSenha.length > 0);
    if (Object.keys(e).length > 0) return setErro('Confira os campos marcados.');
    setEnviando(simular ? 'conferir' : 'gravar');
    setEmailEnviado(f.admin ? f.admin.email.trim().toLowerCase() : null);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.empresas, { metodo: 'POST', corpo, schema: CriarEmpresaRespostaSchema });
      setResultado(r);
      if (!simular) {
        // a senha master não fica na tela depois de gravar
        setF((x) => (x.admin ? { ...x, admin: { ...x.admin, senha: '' } } : x));
        aoGravar?.(r);
        if (!existente && r.tenant_id) router.push(`/empresas/${r.tenant_id}`);
      }
    } catch (x) {
      const doAdmin = erroDoAdminNaApi(x, f.admin?.senha ?? '');
      if (doAdmin && 'bloco' in doAdmin) {
        setErroAdmin(doAdmin.bloco);
        setErro('Confira os campos marcados.');
      } else if (doAdmin) {
        setErros((atuais) => ({ ...atuais, 'admin.senha': doAdmin.senha }));
        setDestacarSenha(true);
        setErro('Confira os campos marcados.');
      } else setErro(mensagemDoErro(x));
    } finally {
      setEnviando(null);
    }
  };

  const submeter = (ev: FormEvent) => {
    ev.preventDefault();
    void enviar(false);
  };

  const caixas = (lista: typeof ESCOLHIVEIS) => (
    <div className="flex flex-col divide-y divide-line-2">
      {lista.map(({ id: m, nome, valor }) => {
        const v = f.modulos[m];
        return (
          <div key={m} className="flex flex-wrap items-center gap-3 py-2.5">
            <label className="flex min-w-[240px] flex-1 items-start gap-2.5">
              <input type="checkbox" data-testid={`empresa.modulo-${m}`} className="mt-1 h-4 w-4 accent-accent" checked={!!v?.marcado} onChange={(e) => setModulo(m, { marcado: e.target.checked })} />
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold">{nome}</span>
                {valor && <span className="text-[12px] text-ink-2">{valor}</span>}
              </span>
            </label>
            {v?.marcado && (
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                Licenças
                <input
                  data-testid={`empresa.licencas-${m}`}
                  inputMode="numeric"
                  className={cx(CLASSE_CAMPO_BASE, 'h-9 w-24 px-2.5 aria-[invalid=true]:border-danger')}
                  placeholder="sem limite"
                  value={v.licencas}
                  onChange={(e) => setModulo(m, { licencas: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                />
              </label>
            )}
          </div>
        );
      })}
      {erros['modulos.modulos'] && <span className="pt-2 text-[12px] text-danger">{erros['modulos.modulos']}</span>}
    </div>
  );
  const avisos = (
    <>
      {erro && (
        <div data-testid="empresa.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      {resultado && <ResultadoEmpresa r={resultado} emailAdmin={emailEnviado} />}
    </>
  );

  if (existente) {
    // RD-2613: dentro do cartão "Módulos licenciados", só o que ainda falta licenciar e o "Acrescentar módulos"
    const faltam = ESCOLHIVEIS.filter((m) => !existente.modulos.some((x) => x.modulo === m.id));
    if (faltam.length === 0 && !resultado) return null;
    return (
      <form data-testid="empresa.form" onSubmit={submeter} noValidate className="flex flex-col gap-3 border-t border-line-2 pt-3">
        {faltam.length > 0 && caixas(faltam)}
        {avisos}
        {faltam.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button data-testid="empresa.gravar" type="submit" variant="primary" disabled={enviando !== null}>
              {enviando === 'gravar' ? 'Gravando…' : 'Acrescentar módulos'}
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form data-testid="empresa.form" onSubmit={submeter} noValidate className="flex flex-col gap-4">
      <Panel title="Empresa">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Razão social"
            testId="empresa.razao-social"
            value={f.razao_social}
            erro={erros.razao_social}
            onChange={(e) => {
              const v = e.target.value;
              setF((x) => ({ ...x, razao_social: v, codigo: codigoTocado ? x.codigo : sugerirCodigo(v) }));
              setResultado(null);
            }}
          />
          <Campo rotulo="CNPJ" testId="empresa.cnpj" inputMode="numeric" value={f.cnpj} erro={erros.cnpj} onChange={(e) => set('cnpj', mascararCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
          <Campo
            rotulo="Código da empresa"
            testId="empresa.codigo"
            value={f.codigo}
            erro={erros.codigo}
            ajuda="Usado no login do BKO e do app. Letras minúsculas, números e hífen; não muda depois."
            spellCheck={false}
            onChange={(e) => {
              setCodigoTocado(true);
              set('codigo', e.target.value.toLowerCase());
            }}
          />
          <div className="flex flex-col gap-1">
            <SelectField label="Fuso" data-testid="empresa.fuso" value={f.fuso} onChange={(e) => set('fuso', e.target.value)}>
              {FUSOS_BRASIL.map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </SelectField>
            <span className="text-[12px] text-ink-2">Datas e horários do app e do BKO aparecem neste fuso.</span>
          </div>
        </div>
      </Panel>

      {f.admin && <AdminInicial admin={f.admin} erros={erros} erroAdmin={erroAdmin} destacarSenha={destacarSenha} aoMudar={setAdmin} />}

      <Panel title="Módulos e licenças">{caixas(ESCOLHIVEIS)}</Panel>

      <Panel title="Parâmetros iniciais">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Alçada do vendedor (%)" testId="empresa.alcada-vendedor" inputMode="decimal" value={f.alcada_vendedor_pct} onChange={(e) => set('alcada_vendedor_pct', e.target.value)} erro={erros['parametros.alcada_vendedor_pct']} ajuda="Desconto que o vendedor dá sem aprovação." />
          <Campo rotulo="Alçada do supervisor (%)" testId="empresa.alcada-supervisor" inputMode="decimal" value={f.alcada_supervisor_pct} onChange={(e) => set('alcada_supervisor_pct', e.target.value)} erro={erros['parametros.alcada_supervisor_pct']} />
          <Campo rotulo="Alçada do gerente (%)" testId="empresa.alcada-gerente" inputMode="decimal" value={f.alcada_gerente_pct} onChange={(e) => set('alcada_gerente_pct', e.target.value)} erro={erros['parametros.alcada_gerente_pct']} />
          <Campo rotulo="Validade do orçamento (dias)" testId="empresa.validade-orcamento" inputMode="numeric" value={f.validade_orcamento_dias} onChange={(e) => set('validade_orcamento_dias', e.target.value.replace(/\D/g, '').slice(0, 2))} erro={erros['parametros.validade_orcamento_dias']} />
          <label className="flex items-center gap-2.5 self-end pb-2.5 text-[15px] sm:col-span-2">
            <input type="checkbox" data-testid="empresa.aplicacao-orcamento" className="h-4 w-4 accent-accent" checked={f.aplicacao_no_orcamento_padrao} onChange={(e) => set('aplicacao_no_orcamento_padrao', e.target.checked)} />
            Mostrar a aplicação do produto no orçamento (padrão)
          </label>
        </div>
      </Panel>

      {avisos}

      <div className="flex flex-wrap gap-2">
        <Button data-testid="empresa.conferir" onClick={() => void enviar(true)} disabled={enviando !== null}>
          {enviando === 'conferir' ? 'Conferindo…' : 'Conferir sem gravar'}
        </Button>
        <Button data-testid="empresa.gravar" type="submit" variant="primary" disabled={enviando !== null}>
          {enviando === 'gravar' ? 'Gravando…' : 'Criar empresa'}
        </Button>
      </div>
    </form>
  );
}

function ResultadoEmpresa({ r, emailAdmin }: { r: Resposta; emailAdmin: string | null }) {
  const admin = textoDoAdminNoResultado(r, emailAdmin);
  // os nativos entram em toda empresa e não aparecem em lista (kit `MODULOS_NATIVOS`)
  const adicionados = r.modulos_adicionados.filter((m) => !MODULOS_SEMPRE.includes(m));
  return (
    <div data-testid="empresa.resultado">
      <Notice tone={r.simulado ? 'info' : 'success'}>
        <span className="flex flex-col gap-1">
          <strong>{r.simulado ? `Conferido, nada gravado: ${ROTULO_RESULTADO[r.resultado].toLowerCase()} ao gravar.` : `${ROTULO_RESULTADO[r.resultado]}.`}</strong>
          {adicionados.length > 0 && <span>Módulos {r.simulado ? 'que entram' : 'que entraram'}: {adicionados.map(nomeDoModulo).join(', ')}.</span>}
          {r.parametros_gravados.length > 0 && <span>Parâmetros {r.simulado ? 'que serão gravados' : 'gravados'}: {r.parametros_gravados.length}.</span>}
          {admin && <span data-testid="empresa.resultado-admin">{admin}</span>}
          {r.avisos.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </span>
      </Notice>
    </div>
  );
}
