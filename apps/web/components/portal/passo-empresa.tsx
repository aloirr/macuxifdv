'use client';

/**
 * Passo Empresa do portal (T-0087 §2; desenho §5.1): `POST /v1/plataforma/empresas` com `CriarEmpresaSchema` — por baixo, o
 * `tenant:criar` da T-0083 (RN-CORE-31, idempotente pelo código). "Conferir" = `simular: true` (nada é gravado). Core e
 * Integração entram sempre (marcados e travados). Empresa existente: código, razão social, CNPJ e fuso ficam travados (não mudam) e
 * o passo só acrescenta módulos. A API revalida tudo (dependências entre módulos, RN-CORE-03). testIDs: empresa.*.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CriarEmpresaRespostaSchema, CriarEmpresaSchema, MODULOS, type ModuloId } from '@macuxi/platform-sdk';
import { Badge, Button, Notice, Panel, parseDecimalInput, SelectField } from '@macuxi/ui/web';

import { chamarPortal, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo, campoCss } from './base';

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
  return { codigo: f.codigo.trim(), razao_social: f.razao_social.trim(), cnpj: f.cnpj, fuso: f.fuso, modulos, parametros, simular };
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
    const k = i.path[0] === 'parametros' || i.path[0] === 'modulos' ? `${String(i.path[0])}.${String(i.path.at(-1) ?? '')}` : String(i.path[0]);
    const pt = CODIGOS_GENERICOS.has(i.code) ? MENSAGEM_DO_CAMPO[k] : undefined;
    e[k] ??= pt ?? i.message;
  }
  return e;
}

const ROTULO_RESULTADO: Record<Resposta['resultado'], string> = { criado: 'Empresa criada', atualizado: 'Empresa atualizada', sem_mudanca: 'Nada mudou' };

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
  }));
  const [codigoTocado, setCodigoTocado] = useState(!!existente);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resposta | null>(null);
  const [enviando, setEnviando] = useState<'conferir' | 'gravar' | null>(null);
  const travado = !!existente;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setResultado(null);
  };
  const setModulo = (m: ModuloId, v: Partial<{ marcado: boolean; licencas: string }>) => {
    setF((x) => ({ ...x, modulos: { ...x.modulos, [m]: { marcado: x.modulos[m]?.marcado ?? false, licencas: x.modulos[m]?.licencas ?? '', ...v } } }));
    setResultado(null);
  };

  const enviar = async (simular: boolean) => {
    if (enviando) return;
    const corpo = corpoDaEmpresa(f, simular);
    const e = errosDaEmpresa(corpo);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) return setErro('Confira os campos marcados.');
    setEnviando(simular ? 'conferir' : 'gravar');
    try {
      const r = await chamarPortal(ROTAS_PORTAL.empresas, { metodo: 'POST', corpo, schema: CriarEmpresaRespostaSchema });
      setResultado(r);
      if (!simular) {
        aoGravar?.(r);
        if (!existente && r.tenant_id) router.push(`/empresas/${r.tenant_id}`);
      }
    } catch (x) {
      setErro(mensagemDoErro(x));
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
                    className="mt-1 h-4 w-4 accent-[#c2540a]"
                    checked={sempre || !!v?.marcado}
                    disabled={sempre || ja}
                    onChange={(e) => setModulo(m, { marcado: e.target.checked })}
                  />
                  <span className="flex flex-col">
                    <span className="text-[14px] font-semibold">
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
                      className={`${campoCss} h-9 w-24`}
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
            <label className="flex items-center gap-2.5 self-end pb-2.5 text-[14px] sm:col-span-2">
              <input type="checkbox" data-testid="empresa.aplicacao-orcamento" className="h-4 w-4 accent-[#c2540a]" checked={f.aplicacao_no_orcamento_padrao} onChange={(e) => set('aplicacao_no_orcamento_padrao', e.target.checked)} />
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
      {resultado && <ResultadoEmpresa r={resultado} />}

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

function ResultadoEmpresa({ r }: { r: Resposta }) {
  return (
    <div data-testid="empresa.resultado">
      <Notice tone={r.simulado ? 'info' : 'success'}>
        <span className="flex flex-col gap-1">
          <strong>{r.simulado ? `Conferido, nada gravado: ${ROTULO_RESULTADO[r.resultado].toLowerCase()} ao gravar.` : `${ROTULO_RESULTADO[r.resultado]}.`}</strong>
          {r.modulos_adicionados.length > 0 && <span>Módulos {r.simulado ? 'que entram' : 'que entraram'}: {r.modulos_adicionados.map((m) => ROTULO_MODULO[m].nome).join(', ')}.</span>}
          {r.parametros_gravados.length > 0 && <span>Parâmetros {r.simulado ? 'que serão gravados' : 'gravados'}: {r.parametros_gravados.length}.</span>}
          {r.avisos.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </span>
      </Notice>
    </div>
  );
}
