'use client';

/**
 * Passo Empresa do portal (T-0087 §2; desenho §5.1): `POST /v1/plataforma/empresas` com `CriarEmpresaSchema` — por baixo, o
 * `tenant:criar` da T-0083 (RN-CORE-31, idempotente pelo código). "Conferir" = `simular: true` (nada é gravado). Core e
 * Integração entram sempre (marcados e travados). Empresa existente: código, razão social, CNPJ e fuso ficam travados (não mudam) e
 * o passo só acrescenta módulos. A API revalida tudo (dependências entre módulos, RN-CORE-03). testIDs: empresa.*.
 * T-0093 (RN-CORE-34; spec docs/design/portal-entrar.md §6): empresa nova leva o administrador inicial (nome, e-mail e senha
 * master, na RN-CORE-32 com a lista das regras ao vivo); empresa existente não troca a senha dele (RN-CORE-31). A senha só vive no
 * estado da tela: nunca vai ao `sessionStorage`, à URL nem a log, e o campo é limpo depois de gravar.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { faltasNaSenha, mensagemDaSenha, SENHA_MIN_CARACTERES, textoDoErroDaSenha } from '@macuxi/core/contracts';
import { AdminInicialEmpresaSchema, CriarEmpresaRespostaSchema, CriarEmpresaSchema, MODULOS, type ModuloId } from '@macuxi/platform-sdk';
import { Badge, Button, CampoSenha, CLASSE_CAMPO_BASE, cx, Notice, Panel, parseDecimalInput, RegrasDaSenha, SelectField, SENHA_ATENDE_AS_REGRAS } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo } from '@/components/campo-acesso';

type Resposta = ReturnType<typeof CriarEmpresaRespostaSchema.parse>;
export interface EmpresaExistente {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string | null;
  fuso: string;
  modulos: { modulo: ModuloId; licencas: number | null }[];
}

export const MODULOS_SEMPRE: readonly ModuloId[] = ['core', 'integracao'];

export const ROTULO_MODULO: Record<ModuloId, { nome: string; ajuda: string }> = {
  core: { nome: 'Core', ajuda: 'Usuários, clientes, produtos e permissões. Sempre entra.' },
  catalogo: { nome: 'Catálogo', ajuda: 'Busca de produtos, aplicação, referências, preço e estoque no app.' },
  vendedor: { nome: 'Vendedor', ajuda: 'Pedidos, orçamentos, alçadas de desconto e rota de visitas.' },
  promotor: { nome: 'Promotor', ajuda: 'Trade marketing: gôndola, share, preço, ruptura e validade.' },
  gestor: { nome: 'Gestor', ajuda: 'App de gestão: equipe, aprovações e indicadores.' },
  pesquisa: { nome: 'Pesquisa', ajuda: 'Questionários aplicados na visita.' },
  treinamento: { nome: 'Treinamento', ajuda: 'Trilhas e conteúdos para a equipe de campo.' },
  integracao: { nome: 'Integração com o ERP', ajuda: 'Hub de carga das bases e Conector. Sempre entra: o portal carrega as bases por ele.' },
};

export const FUSOS_BRASIL = [
  ['America/Manaus', 'Manaus (AM, RR, RO) — UTC−4'],
  ['America/Boa_Vista', 'Boa Vista (RR) — UTC−4'],
  ['America/Porto_Velho', 'Porto Velho (RO) — UTC−4'],
  ['America/Cuiaba', 'Cuiabá (MT) — UTC−4'],
  ['America/Campo_Grande', 'Campo Grande (MS) — UTC−4'],
  ['America/Rio_Branco', 'Rio Branco (AC) — UTC−5'],
  ['America/Sao_Paulo', 'São Paulo, Brasília (SP, RJ, MG, Sul, GO, DF) — UTC−3'],
  ['America/Belem', 'Belém (PA, AP) — UTC−3'],
  ['America/Fortaleza', 'Fortaleza (CE, RN, PB, PI, MA) — UTC−3'],
  ['America/Recife', 'Recife (PE) — UTC−3'],
  ['America/Bahia', 'Salvador (BA) — UTC−3'],
  ['America/Maceio', 'Maceió (AL, SE) — UTC−3'],
  ['America/Araguaina', 'Palmas (TO) — UTC−3'],
  ['America/Noronha', 'Fernando de Noronha — UTC−2'],
] as const;

/** Rótulo do fuso ("Manaus (AM, RR, RO) — UTC−4"); fuso fora da lista aparece como veio. */
export function rotuloDoFuso(fuso: string): string {
  return FUSOS_BRASIL.find(([v]) => v === fuso)?.[1] ?? fuso;
}

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

export interface AdminDoForm {
  nome: string;
  email: string;
  senha: string;
}

/** Textos do bloco "Administrador da empresa" (spec §6), sem variação. */
export const TEXTOS_ADMIN = Object.freeze({
  titulo: 'Administrador da empresa',
  ajuda: 'É o primeiro acesso da empresa. Ele cria os outros usuários no BKO.',
  passeASenha: 'Passe esta senha ao administrador. No primeiro acesso ao backoffice, ele cria a dele.',
  existente: 'Esta empresa já tem administrador. A senha dele não muda aqui.',
  faltaAdmin: 'Informe o administrador da empresa.',
  nomeVazio: 'Informe o nome.',
  emailVazio: 'Informe o e-mail.',
  senhaVazia: 'Informe a senha inicial.',
  nomeCurto: 'Informe o nome, de 2 a 120 caracteres.',
  emailInvalido: 'Informe um e-mail válido, como nome@empresa.com.br.',
});

/**
 * Erros do administrador inicial por campo (`admin.nome`, `admin.email`, `admin.senha`): vazio, formato do contrato
 * (`AdminInicialEmpresaSchema`) e a RN-CORE-32 pela regra do Core (`faltasNaSenha`/`mensagemDaSenha`); a API revalida.
 */
export function errosDoAdmin(a: AdminDoForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.nome.trim()) e['admin.nome'] = TEXTOS_ADMIN.nomeVazio;
  if (!a.email.trim()) e['admin.email'] = TEXTOS_ADMIN.emailVazio;
  if (!a.senha) e['admin.senha'] = TEXTOS_ADMIN.senhaVazia;
  else {
    const m = mensagemDaSenha(faltasNaSenha(a.senha), a.senha);
    if (m) e['admin.senha'] = m;
  }
  const p = AdminInicialEmpresaSchema.safeParse({ nome: a.nome, email: a.email, senha: a.senha });
  if (!p.success) {
    for (const i of p.error.issues) {
      const campo = String(i.path[0] ?? '');
      if (campo === 'nome') e['admin.nome'] ??= TEXTOS_ADMIN.nomeCurto;
      else if (campo === 'email') e['admin.email'] ??= TEXTOS_ADMIN.emailInvalido;
    }
  }
  return e;
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

/** Máscara do CNPJ enquanto digita (14 posições; a API confere os dígitos). */
export function mascararCnpj(v: string): string {
  const d = v.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14);
  return d.replace(/^(\w{2})(\w)/, '$1.$2').replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3').replace(/\.(\w{3})(\w)/, '.$1/$2').replace(/(\w{4})(\w)/, '$1-$2');
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

/**
 * Erro 422 da API no administrador (desenho T-0093 §6): `RN-CORE-34` = falta o administrador (aviso no topo do bloco);
 * `RN-CORE-32` = a senha não serve (texto da fonte única do Core, `textoDoErroDaSenha`, embaixo do campo). Outro erro: `null`.
 */
export function erroDoAdminNaApi(x: unknown, senha: string): { bloco: string } | { senha: string } | null {
  if (!(x instanceof ErroPortal) || x.status !== 422) return null;
  if (x.codigo === 'RN-CORE-34') return { bloco: TEXTOS_ADMIN.faltaAdmin };
  if (x.codigo === 'RN-CORE-32') return { senha: textoDoErroDaSenha(x, senha) };
  return null;
}

/** Cópia de `e` sem a chave `k`. */
function semChave(e: Record<string, string>, k: string): Record<string, string> {
  return Object.fromEntries(Object.entries(e).filter(([c]) => c !== k));
}

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
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [erroAdmin, setErroAdmin] = useState<string | null>(null);
  // e-mail do administrador do último envio (o resultado diz "Administrador criado: <e-mail>.")
  const [emailEnviado, setEmailEnviado] = useState<string | null>(null);
  const travado = !!existente;
  const faltasDaSenha = f.admin ? faltasNaSenha(f.admin.senha) : [];

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setResultado(null);
  };
  const setAdmin = (k: keyof AdminDoForm, v: string) => {
    setF((x) => (x.admin ? { ...x, admin: { ...x.admin, [k]: v } } : x));
    // o erro antigo do campo some ao digitar: a lista das regras segue ao vivo (spec §6; R-20261107-174216 🟡 5)
    setErros((e) => (`admin.${k}` in e ? semChave(e, `admin.${k}`) : e));
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

  return (
    <form data-testid="empresa.form" onSubmit={submeter} noValidate className="flex flex-col gap-4">
      <Panel title="Empresa">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Razão social"
            testId="empresa.razao-social"
            value={f.razao_social}
            disabled={travado}
            erro={erros.razao_social}
            onChange={(e) => {
              const v = e.target.value;
              setF((x) => ({ ...x, razao_social: v, codigo: codigoTocado ? x.codigo : sugerirCodigo(v) }));
              setResultado(null);
            }}
          />
          <Campo rotulo="CNPJ" testId="empresa.cnpj" inputMode="numeric" value={f.cnpj} disabled={travado} erro={erros.cnpj} onChange={(e) => set('cnpj', mascararCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
          <Campo
            rotulo="Código da empresa"
            testId="empresa.codigo"
            value={f.codigo}
            disabled={travado}
            erro={erros.codigo}
            ajuda="Usado no login do BKO e do app. Letras minúsculas, números e hífen; não muda depois."
            spellCheck={false}
            onChange={(e) => {
              setCodigoTocado(true);
              set('codigo', e.target.value.toLowerCase());
            }}
          />
          <div className="flex flex-col gap-1">
            <SelectField label="Fuso" data-testid="empresa.fuso" value={f.fuso} disabled={travado} onChange={(e) => set('fuso', e.target.value)}>
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

      {f.admin ? (
        <Panel title={TEXTOS_ADMIN.titulo}>
          <div data-testid="empresa.admin" className="flex flex-col gap-4">
            <span className="text-[13px] text-ink-2">{TEXTOS_ADMIN.ajuda}</span>
            {erroAdmin && (
              <div data-testid="empresa.admin-erro">
                <Notice tone="danger">{erroAdmin}</Notice>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome" testId="empresa.admin-nome" autoComplete="off" value={f.admin.nome} erro={erros['admin.nome']} onChange={(e) => setAdmin('nome', e.target.value)} />
              <Campo
                rotulo="E-mail"
                testId="empresa.admin-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={f.admin.email}
                erro={erros['admin.email']}
                onChange={(e) => setAdmin('email', e.target.value)}
              />
            </div>
            <div className="flex max-w-[420px] flex-col gap-2">
              <CampoSenha
                id="empresa-admin-senha"
                rotulo="Senha inicial"
                testId="empresa.admin-senha"
                finalidade="criacao"
                visivel={senhaVisivel}
                onAlternar={() => setSenhaVisivel((v) => !v)}
                descrito="empresa-admin-senha-regras"
                value={f.admin.senha}
                erro={erros['admin.senha']}
                onChange={(e) => setAdmin('senha', e.target.value)}
              />
              <RegrasDaSenha
                id="empresa-admin-senha-regras"
                testId="empresa.admin-regras"
                faltas={faltasDaSenha}
                destacar={destacarSenha && faltasDaSenha.length > 0}
                minimo={SENHA_MIN_CARACTERES}
                resumo={mensagemDaSenha(faltasDaSenha, f.admin.senha) ?? SENHA_ATENDE_AS_REGRAS}
              />
              <span className="text-[12px] text-ink-2">{TEXTOS_ADMIN.passeASenha}</span>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title={TEXTOS_ADMIN.titulo}>
          <span data-testid="empresa.admin-existente" className="text-[13px] text-ink-2">
            {TEXTOS_ADMIN.existente}
          </span>
        </Panel>
      )}

      <Panel title="Módulos e licenças">
        <div className="flex flex-col divide-y divide-line-2">
          {MODULOS.map((m) => {
            const sempre = MODULOS_SEMPRE.includes(m);
            const v = f.modulos[m];
            const ja = existente?.modulos.some((x) => x.modulo === m) ?? false;
            return (
              <div key={m} className="flex flex-wrap items-center gap-3 py-2.5">
                <label className="flex min-w-[260px] flex-1 items-start gap-2.5">
                  <input
                    type="checkbox"
                    data-testid={`empresa.modulo-${m}`}
                    className="mt-1 h-4 w-4 accent-accent"
                    checked={sempre || !!v?.marcado}
                    disabled={sempre || ja}
                    onChange={(e) => setModulo(m, { marcado: e.target.checked })}
                  />
                  <span className="flex flex-col">
                    <span className="text-[15px] font-semibold">
                      {ROTULO_MODULO[m].nome} {sempre && <Badge tone="neutral">sempre</Badge>} {ja && !sempre && <Badge tone="success">licenciado</Badge>}
                    </span>
                    <span className="text-[12px] text-ink-2">{ROTULO_MODULO[m].ajuda}</span>
                  </span>
                </label>
                {(sempre || v?.marcado) && m !== 'core' && m !== 'integracao' && (
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    Licenças
                    <input
                      data-testid={`empresa.licencas-${m}`}
                      inputMode="numeric"
                      className={cx(CLASSE_CAMPO_BASE, 'h-9 w-24 px-2.5 aria-[invalid=true]:border-danger')}
                      placeholder="sem limite"
                      value={v?.licencas ?? ''}
                      disabled={ja}
                      onChange={(e) => setModulo(m, { licencas: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        {erros['modulos.modulos'] && <span className="text-[12px] text-danger">{erros['modulos.modulos']}</span>}
      </Panel>

      {!existente && (
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
      )}

      {erro && (
        <div data-testid="empresa.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      {resultado && <ResultadoEmpresa r={resultado} emailAdmin={emailEnviado} />}

      <div className="flex flex-wrap gap-2">
        <Button data-testid="empresa.conferir" onClick={() => void enviar(true)} disabled={enviando !== null}>
          {enviando === 'conferir' ? 'Conferindo…' : 'Conferir sem gravar'}
        </Button>
        <Button data-testid="empresa.gravar" type="submit" variant="primary" disabled={enviando !== null}>
          {enviando === 'gravar' ? 'Gravando…' : existente ? 'Acrescentar módulos' : 'Criar empresa'}
        </Button>
      </div>
    </form>
  );
}

function ResultadoEmpresa({ r, emailAdmin }: { r: Resposta; emailAdmin: string | null }) {
  const admin = textoDoAdminNoResultado(r, emailAdmin);
  return (
    <div data-testid="empresa.resultado">
      <Notice tone={r.simulado ? 'info' : 'success'}>
        <span className="flex flex-col gap-1">
          <strong>{r.simulado ? `Conferido, nada gravado: ${ROTULO_RESULTADO[r.resultado].toLowerCase()} ao gravar.` : `${ROTULO_RESULTADO[r.resultado]}.`}</strong>
          {r.modulos_adicionados.length > 0 && <span>Módulos {r.simulado ? 'que entram' : 'que entraram'}: {r.modulos_adicionados.map((m) => ROTULO_MODULO[m].nome).join(', ')}.</span>}
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
