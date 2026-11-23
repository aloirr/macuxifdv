/**
 * v1.0.30 (antes v1.0.28/v1.0.29) — pré-cadastro de cliente no Campo (RN-CORE-16, RN-CORE-78 e RN-CORE-79; ADR 0069), sem banco.
 * Cadeia real do aparelho: parâmetro e clientes pelo pull → `obrigatoriosDasLinhas` → `salvarPreCadastro` → MOTOR DE SYNC REAL do
 * SDK (armazenamento em memória, entidade `cliente_pre_cadastro` registrada por `entidadesCliente`) → transporte que faz o papel da
 * API pelo contrato (push idempotente pelo UUID; pull de `cliente` com `status_cadastro`/`motivo_recusa`/`revisao_cadastro`/
 * `external_id`) → lista (`sobreporPreCadastros` + `listarClientesLocais` + `situacaoDoCliente`/`situacaoNaLinha` + `seloDoPreCadastro`,
 * a mesma composição de `usar-clientes-locais.ts` e de `LinhaCliente` em `telas/clientes.tsx`) → correção (`correcaoDoCliente`, a
 * mesma chamada de `telas/novo-cliente.tsx`).
 * O servidor segue a regra REAL de `modules/core/api/pre-cadastro-receber.ts` pelas funções puras do domain (a rota e a gravação têm os
 * testes de banco do Core): sem `revisao_base` = criação (id vivo repetido = `ja_existia`, sem regravar; revalida a lista única
 * `cliente.campos_obrigatorios`; id novo com o CPF/CNPJ de um recusado = substitui e herda a revisão, `decidirDocumentoDuplicado`;
 * de um pendente/aprovado = 409); com `revisao_base` = correção do recusado no MESMO cliente (`decidirReenvioPreCadastro`: revisão nova,
 * repetição idempotente, 409 REVISAO_DESATUALIZADA). Matriz: offline → reconexão; reenvio duplicado; 422 da API → "Corrigir e reenviar"
 * com o mesmo id (`alterar`); recusado pelo ERP → correção com o MESMO id e revisão nova (ADR 0069); resposta perdida na correção;
 * dois corretores; APK v1.0.28 (id novo); código do ERP; lista única de obrigatórios com e sem linha; CNPJ com dígito errado; perfil;
 * valor × regra do selo em cada status.
 */
import { manifest as manifestCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoEmMemoria,
  criarClienteHttp,
  criarMotorSync,
  criarRegistroSync,
  ErroSemConexao,
  type ItemPush,
  type LinhaSync,
  type ResultadoItemPush,
} from '@macuxi/platform-sdk';
import {
  ACAO_CORRIGIR_E_REENVIAR,
  ROTULO_AGUARDANDO_ERP,
  ROTULO_PRE_CADASTRO_NAO_ENVIADO,
  ROTULO_RECUSADO_ERP,
  seloDoPreCadastro,
} from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import {
  MENSAGENS_CAMPO_FALTANTE,
  MENSAGENS_ERRO_PRE_CADASTRO,
  PARAMETRO_CAMPOS_OBRIGATORIOS,
  PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
  PreCadastroClienteSchema,
  type ClienteSync,
  type ParametroSync,
  type PreCadastroCliente,
} from '../../modules/core/contracts';
import {
  camposExigidos,
  canonicalPreCadastro,
  decidirDocumentoDuplicado,
  decidirReenvioPreCadastro,
  FALTA_OBRIGATORIO_PRE_CADASTRO,
  motivoSoDeCamposFaltantes,
  podePreCadastrarCliente,
  situacaoDoCliente,
  situacaoDoPreCadastro,
  situacaoNaLinha,
  validarPreCadastro,
} from '../../modules/core/domain';
import { listarClientesLocais } from '../../modules/core/app/lib/cliente360-local';
import { entidadesCliente } from '../../modules/core/app/lib/entidades-cliente';
import { entidadesRota } from '../../modules/core/app/lib/entidades-rota';
import {
  clienteComDocumento,
  correcaoDoCliente,
  ENTIDADE_PRE_CADASTRO,
  obrigatoriosDasLinhas,
  salvarPreCadastro,
  sobreporPreCadastros,
  type BaseDaCorrecao,
} from '../../modules/core/app/lib/pre-cadastro-local';
import type { ValoresPreCadastro } from '../../modules/core/app/lib/pre-cadastro-formulario';

const U = (n: number) => `0c030000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = '2026-11-23T14:00:00.000Z';
const HOJE = '2026-11-23';
const ID = U(1);
const ID_NOVO = U(2);
const CNPJ_OK = '11.222.333/0001-81';
const VALORES: ValoresPreCadastro = {
  documento: CNPJ_OK,
  razao_social: 'Mercado Boa Vista',
  telefone: '(92) 99999-0000',
};
/** Lista única de Parâmetros › Clientes só com os fixos (RN-CORE-16): o tenant exige só razão social e CPF/CNPJ. */
const SO_FIXOS = ['razao_social', 'documento'];
/** Padrão da RN-CORE-16 sem linha do parâmetro, recortado para o pré-cadastro (sem complemento nem geolocalização). */
const PADRAO_PRE_CADASTRO = [
  'razao_social',
  'documento',
  'inscricao_estadual',
  'logradouro',
  'numero',
  'bairro',
  'cidade',
  'uf',
  'cep',
];

type Decisao = { status: 'pendente' | 'aprovado' | 'recusado'; motivo?: string; codigo?: string };
/** O `codigo_fdv` só existe no contrato para a API recusar com 422 (ADR 0069 item 10); fora do canônico, como na API. */
const canonicoDoContrato = ({ codigo_fdv: _ignorado, ...dados }: PreCadastroCliente): string =>
  canonicalPreCadastro(dados);
/** Cliente gravado no "servidor": dados da revisão atual e o canônico de cada revisão (o hash real é o sha256 dele). */
type Gravado = { p: PreCadastroCliente; revisao: number; canonicos: Map<number, string> };

/**
 * Aparelho do vendedor (motor real) + o "servidor" do contrato. `parametro` = valor da linha `cliente.campos_obrigatorios`
 * (no pull e na revalidação da API); `null` = sem linha (vale o padrão da RN-CORE-16).
 */
function montar(parametro: unknown = SO_FIXOS) {
  let sinal = false;
  let ativado = false;
  let relogio = Date.parse(AGORA);
  const instante = () => new Date((relogio += 1000)).toISOString();
  const servidor = {
    parametro,
    recebidos: new Map<string, Gravado>(),
    excluidos: new Map<string, string>(), // id → deleted_at (o recusado substituído pelo id novo do APK v1.0.28)
    recebimentos: 0,
    jaExistia: 0,
    repetidos: 0,
    decisao: new Map<string, Decisao>(),
    recusa422: new Map<string, string>(),
    /** processa o push e perde a resposta (sem sinal no meio do envio): o aparelho reenvia o mesmo item */
    perderResposta: 0,
  };
  const vivos = () => [...servidor.recebidos.values()].filter((g) => !servidor.excluidos.has(g.p.id));
  const registro = criarRegistroSync([manifestCore]);
  for (const e of [...entidadesCliente, ...entidadesRota])
    if (!registro.entidade(e.nome)) registro.registrar(e);
  const linhaCliente = (g: Gravado, d: Decisao | undefined): ClienteSync => {
    const p = g.p;
    return {
      id: p.id,
      updated_at: instante(),
      deleted_at: servidor.excluidos.get(p.id) ?? null,
      external_id: d?.codigo ?? null,
      documento: p.documento,
      razao_social: p.razao_social,
      nome_fantasia: p.nome_fantasia ?? null,
      segmento: null,
      telefone: p.telefone ?? null,
      email: p.email ?? null,
      logradouro: p.logradouro ?? null,
      numero: p.numero ?? null,
      bairro: p.bairro ?? null,
      cidade: p.cidade ?? null,
      uf: p.uf ?? null,
      cep: p.cep ?? null,
      latitude: null,
      longitude: null,
      ativo: true,
      status_cadastro: d?.status ?? 'pendente',
      motivo_recusa: d?.status === 'recusado' ? (d.motivo ?? null) : null,
      revisao_cadastro: g.revisao,
      erros_recusa: null,
    };
  };
  const rejeitar = (id: string, codigo: keyof typeof MENSAGENS_ERRO_PRE_CADASTRO): ResultadoItemPush => ({
    id,
    status: 'rejeitado',
    codigo,
    mensagem: MENSAGENS_ERRO_PRE_CADASTRO[codigo],
  });

  /** `pre-cadastro-receber.ts`, pelas mesmas funções puras do domain. */
  const receber = (i: ItemPush): ResultadoItemPush => {
    servidor.recebimentos += 1;
    const p = PreCadastroClienteSchema.parse(i.payload); // o servidor recebe o contrato estrito
    // revalidação da API (422 de formato): uma vez por id; o item fica `falhou` no aparelho
    const recusa = servidor.recusa422.get(p.id);
    if (recusa) {
      servidor.recusa422.delete(p.id);
      return { id: i.id, status: 'rejeitado', codigo: 'VALIDACAO', mensagem: recusa };
    }
    // RN-CORE-79: revalida pela lista única do tenant, com os textos "Preencha ..." do contrato
    const exigirObrigatorios = (): ResultadoItemPush | null => {
      const r = validarPreCadastro(p, camposExigidos(servidor.parametro));
      if (r.ok) return null;
      const textos = Object.entries(r.erros).map(([c, e]) =>
        e === FALTA_OBRIGATORIO_PRE_CADASTRO
          ? ((MENSAGENS_CAMPO_FALTANTE as Record<string, string>)[c] ?? MENSAGENS_CAMPO_FALTANTE.endereco)
          : `${e}.`,
      );
      return {
        id: i.id,
        status: 'rejeitado',
        codigo: 'CAMPOS_OBRIGATORIOS',
        mensagem: [...new Set(textos)].join(' '),
      };
    };
    const canonico = canonicoDoContrato(p);
    if (p.revisao_base == null) {
      // criação: id vivo já gravado = `ja_existia: true`, SEM regravar (nem a correção, nem o status)
      if (servidor.recebidos.has(p.id) && !servidor.excluidos.has(p.id)) {
        servidor.jaExistia += 1;
        return { id: i.id, status: 'aceito', em: instante() };
      }
      const falta = exigirObrigatorios();
      if (falta) return falta;
      // RN-CORE-78 (`decidirDocumentoDuplicado`): recusado do mesmo CPF/CNPJ sai com deleted_at e o novo herda a revisão; pendente/aprovado = 409
      const iguais = vivos()
        .filter((g) => g.p.documento === p.documento)
        .map((g) => ({
          id: g.p.id,
          status_cadastro: servidor.decisao.get(g.p.id)?.status ?? ('pendente' as const),
          revisao_cadastro: g.revisao,
        }));
      const dup = decidirDocumentoDuplicado(iguais);
      if (dup.bloqueia) return rejeitar(i.id, 'DOCUMENTO_JA_CADASTRADO');
      for (const r of dup.remover) servidor.excluidos.set(r, instante());
      const revisao = dup.substituir ? dup.substituir.revisao + 1 : 1;
      servidor.recebidos.set(p.id, { p, revisao, canonicos: new Map([[revisao, canonico]]) });
      return { id: i.id, status: 'aceito', em: instante() };
    }
    // correção do recusado no MESMO cliente (ADR 0069)
    const atual = servidor.excluidos.has(p.id) ? undefined : servidor.recebidos.get(p.id);
    const d = decidirReenvioPreCadastro(
      atual
        ? {
            status_cadastro: servidor.decisao.get(p.id)?.status ?? 'pendente',
            revisao_cadastro: atual.revisao,
            hash_atual: atual.canonicos.get(atual.revisao) ?? null,
          }
        : null,
      { revisao_base: p.revisao_base, hash: canonico },
    );
    if (d.acao === 'recusar') return rejeitar(i.id, d.codigo);
    if (d.acao === 'repetido') {
      servidor.repetidos += 1;
      return { id: i.id, status: 'aceito', em: instante() };
    }
    const falta = exigirObrigatorios();
    if (falta) return falta;
    if (vivos().some((g) => g.p.id !== p.id && g.p.documento === p.documento))
      return rejeitar(i.id, 'DOCUMENTO_JA_CADASTRADO');
    atual!.p = p;
    atual!.revisao = d.revisao;
    atual!.canonicos.set(d.revisao, canonico);
    servidor.decisao.delete(p.id); // volta a pendente, sem motivo
    return { id: i.id, status: 'aceito', em: instante() };
  };

  const motor = criarMotorSync({
    registro,
    armazenamento: criarArmazenamentoEmMemoria(),
    agora: () => new Date(relogio),
    online: () => sinal,
    ambiente: {
      http: criarClienteHttp(async () => {
        throw new ErroSemConexao('sem http no teste');
      }),
      online: () => sinal,
      novoId: () => U(900),
      usuario: () => ({ id: U(9), nome: 'Lucas', perfil: 'vendedor', fuso: 'America/Manaus' }),
    },
    transporte: {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        const r = itens.map(receber);
        if (servidor.perderResposta > 0) {
          servidor.perderResposta -= 1;
          throw new ErroSemConexao('resposta perdida');
        }
        return r;
      },
      async pull(entidade: string) {
        const itens: LinhaSync[] =
          entidade === 'cliente'
            ? [...servidor.recebidos.values()].map(
                (g) => linhaCliente(g, servidor.decisao.get(g.p.id)) as unknown as LinhaSync,
              )
            : entidade === 'parametro' && servidor.parametro !== null
              ? [
                  {
                    id: U(50),
                    updated_at: AGORA,
                    deleted_at: null,
                    external_id: null,
                    modulo: 'core',
                    chave: PARAMETRO_CAMPOS_OBRIGATORIOS,
                    valor: servidor.parametro,
                  } satisfies ParametroSync as unknown as LinhaSync,
                ]
              : [];
        return { itens, proximo_cursor: null, horizonte: instante() };
      },
    },
  });

  /** O que a lista mostra: linhas do pull + a fila sobreposta, com o selo da `LinhaCliente`. */
  const lista = async () => {
    const pull = await motor.linhas<ClienteSync & LinhaSync>('cliente');
    const clientes = sobreporPreCadastros(pull, motor.sobreposicao([ENTIDADE_PRE_CADASTRO]), AGORA);
    return listarClientesLocais({ clientes, financeiros: [], titulos: [], historico: [] }, HOJE).map((c) => {
      const situacao = situacaoNaLinha(situacaoDoCliente(c), []);
      const pre = situacaoDoPreCadastro(c);
      const selo = situacao === 'pre_cadastro' ? seloDoPreCadastro(pre.situacao) : null;
      return {
        id: c.id,
        nome: c.nome_fantasia ?? c.razao_social,
        situacao,
        selo: selo?.texto ?? null,
        motivo: pre.motivo,
        status: c.status_cadastro ?? null,
      };
    });
  };
  /** "Corrigir e reenviar": o que `novo-cliente.tsx` abre para o cliente `id` (linhas do pull + fila). */
  const correcao = async (id = ID) =>
    correcaoDoCliente(
      await motor.linhas<ClienteSync & LinhaSync>('cliente'),
      motor.sobreposicao([ENTIDADE_PRE_CADASTRO]),
      id,
    );
  const obrigatorios = async () =>
    obrigatoriosDasLinhas(await motor.linhas<ParametroSync & LinhaSync>('parametro'));
  const salvar = async (valores: ValoresPreCadastro, id = ID, base?: BaseDaCorrecao | null) =>
    salvarPreCadastro(motor, { id, valores, obrigatorios: await obrigatorios(), online: false, base });
  const sincronizar = async () => {
    if (!ativado) {
      await motor.aplicarModulosAtivos(['core']);
      ativado = true;
    }
    sinal = true;
    const ok = await motor.sincronizar();
    sinal = false;
    return ok;
  };
  /** Cria o pré-cadastro, envia e o ERP recusa com o motivo; o aparelho já puxou a linha recusada. */
  const recusadoPeloErp = async (motivo = 'CNPJ com situação inapta na Receita') => {
    await sincronizar();
    await salvar(VALORES);
    await sincronizar();
    servidor.decisao.set(ID, { status: 'recusado', motivo });
    await sincronizar();
  };
  return { motor, servidor, vivos, lista, correcao, obrigatorios, salvar, sincronizar, recusadoPeloErp };
}

describe('v1.0.30 pré-cadastro no Campo: perfil (critério 1)', () => {
  it('RN-CORE-78 e RN-PRO-01: só o vendedor pré-cadastra; promotor, gestão e sem perfil não', () => {
    // a página `novo-cliente` (perfis: ['vendedor']) e o botão das duas listas usam esta checagem: novo-cliente.layout.test.ts
    expect(podePreCadastrarCliente('vendedor')).toBe(true);
    for (const p of ['promotor', 'supervisor', 'gerente', 'admin'] as const)
      expect(podePreCadastrarCliente(p), p).toBe(false);
  });
});

describe('v1.0.30 pré-cadastro no Campo: lista única de obrigatórios (RN-CORE-16 + RN-CORE-79)', () => {
  it('sem linha do parâmetro vale o padrão da RN-CORE-16 (sem complemento nem geolocalização); com a linha, os dela mais razão social e CPF/CNPJ', async () => {
    const sem = montar(null);
    await sem.sincronizar();
    expect(await sem.obrigatorios()).toEqual(PADRAO_PRE_CADASTRO);
    // o padrão barra o salvar sem endereço e sem IE (CNPJ), sem mexer na fila
    const r = await sem.salvar(VALORES);
    expect(r).toEqual({
      ok: false,
      erros: expect.objectContaining({
        inscricao_estadual: FALTA_OBRIGATORIO_PRE_CADASTRO,
        logradouro: FALTA_OBRIGATORIO_PRE_CADASTRO,
        cep: FALTA_OBRIGATORIO_PRE_CADASTRO,
      }),
    });
    expect(sem.motor.estado().fila).toEqual([]);

    // o tenant tira razão social e CPF/CNPJ da lista: voltam sempre (fixos), na ordem canônica
    const com = montar(['telefone', 'cidade', 'complemento', 'geolocalizacao']);
    await com.sincronizar();
    expect(await com.obrigatorios()).toEqual(['razao_social', 'documento', 'cidade', 'telefone']);
    const r2 = await com.salvar({
      documento: CNPJ_OK,
      razao_social: 'Mercado Boa Vista',
      telefone: '(92) 99999-0000',
    });
    expect(r2).toEqual({ ok: false, erros: { cidade: FALTA_OBRIGATORIO_PRE_CADASTRO } });
    expect(com.motor.estado().fila).toEqual([]);
    expect(await com.salvar({ ...VALORES, cidade: 'Manaus' })).toEqual({ ok: true, id: ID });
  });

  it('a chave antiga `cliente.pre_cadastro.obrigatorios` (espelho do APK v1.0.28) não vale mais no aparelho: só a lista única', () => {
    const linhas = [
      {
        modulo: 'core',
        chave: PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
        valor: ['telefone', 'email'],
        deleted_at: null,
      },
      { modulo: 'core', chave: PARAMETRO_CAMPOS_OBRIGATORIOS, valor: SO_FIXOS, deleted_at: null },
    ];
    expect(obrigatoriosDasLinhas(linhas)).toEqual(['razao_social', 'documento']);
    // linha apagada da lista única = padrão
    expect(obrigatoriosDasLinhas([{ ...linhas[1]!, deleted_at: AGORA }])).toEqual(PADRAO_PRE_CADASTRO);
  });

  it('a API revalida pela mesma lista: o tenant passou a exigir telefone depois do salvar offline → 422 "Não enviado" só com o "Preencha ..." do contrato', async () => {
    const t = montar();
    await t.sincronizar();
    expect(await t.salvar({ documento: CNPJ_OK, razao_social: 'Mercado Boa Vista' })).toEqual({
      ok: true,
      id: ID,
    });
    t.servidor.parametro = ['telefone'];
    await t.sincronizar();
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[ID, 'falhou']]);
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista',
        situacao: 'pre_cadastro',
        selo: ROTULO_PRE_CADASTRO_NAO_ENVIADO,
        motivo: MENSAGENS_CAMPO_FALTANTE.telefone,
        status: 'pendente',
      },
    ]);
    // com o campo marcado na tela, a linha do topo sai (RD-2655): o motivo é só de campos faltantes
    expect(motivoSoDeCamposFaltantes(MENSAGENS_CAMPO_FALTANTE.telefone)).toBe(true);
    // o pull já trouxe a lista nova: a correção do item parado pede o telefone e, preenchido, segue com o mesmo id
    expect(await t.obrigatorios()).toEqual(['razao_social', 'documento', 'telefone']);
    const c = (await t.correcao())!;
    expect(c.base.revisao_base).toBeNull();
    expect((await t.salvar(c.valores, ID, c.base)).ok).toBe(false);
    expect(await t.salvar({ ...c.valores, telefone: '(92) 99999-0000' }, ID, c.base)).toEqual({
      ok: true,
      id: ID,
    });
    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.vivos().map((g) => [g.p.id, g.p.telefone, g.revisao])).toEqual([[ID, '92999990000', 1]]);
  });
});

describe('v1.0.30 pré-cadastro no Campo: offline → fila → ERP (motor real)', () => {
  it('RN-CORE-79: CNPJ com dígito verificador errado não entra na fila; CPF válido entra', async () => {
    const t = montar();
    await t.sincronizar();
    const r = await t.salvar({ ...VALORES, documento: '11.222.333/0001-82' });
    expect(r).toEqual({ ok: false, erros: expect.objectContaining({ documento: 'CNPJ inválido' }) });
    expect(t.motor.estado().fila).toEqual([]);
    expect((await t.salvar({ ...VALORES, documento: '529.982.247-25' }, U(2))).ok).toBe(true);
  });

  it('RN-CORE-78: sem sinal o cliente aparece na hora com "Aguardando ERP"; o reenvio do mesmo id não duplica; na reconexão o servidor recebe um só', async () => {
    const t = montar();
    await t.sincronizar();
    expect(await t.salvar(VALORES)).toEqual({ ok: true, id: ID });
    expect(await t.salvar(VALORES)).toEqual({ ok: true, id: ID });
    expect(t.motor.estado().fila.map((i) => [i.id, i.entidade])).toEqual([[ID, ENTIDADE_PRE_CADASTRO]]);
    expect(t.servidor.recebimentos).toBe(0);
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);

    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.servidor.recebimentos).toBe(1);
    expect(t.vivos().map((g) => [g.p.id, g.p.origem, g.p.documento, g.p.telefone, g.revisao])).toEqual([
      [ID, 'campo', '11222333000181', '92999990000', 1],
    ]);
    expect(t.motor.estado().fila).toEqual([]);
    // o pull trouxe a linha pendente: segue um cliente só, com o mesmo selo
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);
  });

  it('RN-CORE-78 (ADR 0069): recusado mostra o motivo; "Corrigir e reenviar" corrige o MESMO cliente (mesmo id) como revisão nova; nada é apagado', async () => {
    const t = montar();
    await t.recusadoPeloErp();
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista',
        situacao: 'pre_cadastro',
        selo: ROTULO_RECUSADO_ERP,
        motivo: 'CNPJ com situação inapta na Receita',
        status: 'recusado',
      },
    ]);

    // a correção abre o formulário preenchido a partir da linha recusada, com a revisão que o vendedor viu (como em novo-cliente.tsx)
    const c = (await t.correcao())!;
    expect(c.valores).toEqual(
      expect.objectContaining({
        documento: '11222333000181',
        razao_social: 'Mercado Boa Vista',
        telefone: '92999990000',
      }),
    );
    expect(c.base.revisao_base).toBe(1);
    // o aviso "Já é cliente" não acusa o próprio recusado que está sendo corrigido
    const linhas = await t.motor.linhas<ClienteSync & LinhaSync>('cliente');
    expect(clienteComDocumento(linhas, CNPJ_OK, ID)).toBeNull();
    expect(await t.salvar({ ...c.valores, razao_social: 'Mercado Boa Vista Ltda' }, ID, c.base)).toEqual({
      ok: true,
      id: ID,
    });
    const fila = t.motor.estado().fila;
    expect(fila.map((i) => [i.id, (i.payload as PreCadastroCliente).revisao_base])).toEqual([[ID, 1]]);
    // offline, a correção substitui a linha recusada: uma linha só, já corrigida e "Aguardando ERP"
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista Ltda',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);

    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.servidor.jaExistia).toBe(0);
    // servidor: o mesmo cliente, revisão 2, pendente de novo; nenhum cliente apagado
    expect(t.servidor.excluidos.size).toBe(0);
    expect(t.vivos().map((g) => [g.p.id, g.p.razao_social, g.p.documento, g.revisao])).toEqual([
      [ID, 'Mercado Boa Vista Ltda', '11222333000181', 2],
    ]);
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista Ltda',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);
    expect((await t.correcao())!.base.revisao_base).toBe(2);
  });

  it('RN-CORE-78: resposta perdida na correção → o aparelho reenvia a mesma revisão e o servidor a reconhece (repetição idempotente, sem revisão 3)', async () => {
    const t = montar();
    await t.recusadoPeloErp();
    const c = (await t.correcao())!;
    await t.salvar({ ...c.valores, razao_social: 'Mercado Boa Vista Ltda' }, ID, c.base);
    t.servidor.perderResposta = 1;
    await t.sincronizar();
    expect(t.motor.estado().fila.map((i) => i.id)).toEqual([ID]);
    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.servidor.repetidos).toBe(1);
    expect(t.vivos().map((g) => [g.p.id, g.revisao, [...g.canonicos.keys()]])).toEqual([[ID, 2, [1, 2]]]);
  });

  it('RN-CORE-78: o escritório corrigiu antes (revisão 2) → a correção do aparelho na revisão 1 é 409 REVISAO_DESATUALIZADA, "Não enviado", e a próxima correção abre a revisão do servidor', async () => {
    const t = montar();
    await t.recusadoPeloErp();
    const c = (await t.correcao())!;
    await t.salvar({ ...c.valores, razao_social: 'Mercado Boa Vista Ltda' }, ID, c.base);
    // BKO "Editar e reenviar" (mesma regra), e o ERP recusa a revisão 2
    const g = t.servidor.recebidos.get(ID)!;
    const doBko = PreCadastroClienteSchema.parse({
      ...g.p,
      origem: 'bko',
      nome_fantasia: 'Boa Vista',
      revisao_base: 1,
    });
    g.p = doBko;
    g.revisao = 2;
    g.canonicos.set(2, canonicoDoContrato(doBko));
    t.servidor.decisao.set(ID, { status: 'recusado', motivo: 'Inscrição estadual ausente' });

    await t.sincronizar();
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[ID, 'falhou']]);
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista Ltda',
        situacao: 'pre_cadastro',
        selo: ROTULO_PRE_CADASTRO_NAO_ENVIADO,
        motivo: MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA,
        status: 'pendente',
      },
    ]);
    expect(t.vivos().map((x) => [x.p.razao_social, x.revisao])).toEqual([['Mercado Boa Vista', 2]]);
    // o servidor tem revisão mais nova: a correção abre os dados dele, na revisão 2
    const de = (await t.correcao())!;
    expect(de.base.revisao_base).toBe(2);
    expect(de.valores.nome_fantasia).toBe('Boa Vista');
    expect(await t.salvar({ ...de.valores, inscricao_estadual: 'ISENTO' }, ID, de.base)).toEqual({
      ok: true,
      id: ID,
    });
    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.vivos().map((x) => [x.p.id, x.p.inscricao_estadual, x.revisao])).toEqual([[ID, 'ISENTO', 3]]);
  });

  it('RN-CORE-78: reenviar o recusado com o MESMO id SEM `revisao_base` é criação repetida (`ja_existia`) e não grava a correção', async () => {
    const t = montar();
    await t.recusadoPeloErp();
    await t.salvar({ ...VALORES, razao_social: 'Mercado Boa Vista Ltda' }, ID);
    await t.sincronizar();
    expect(t.servidor.jaExistia).toBe(1);
    expect(t.servidor.recebidos.get(ID)?.p.razao_social).toBe('Mercado Boa Vista');
    expect((await t.lista()).map((c) => [c.id, c.status])).toEqual([[ID, 'recusado']]);
  });

  it('RN-CORE-78 (ADR 0069 §4, compatibilidade com o APK v1.0.28): id NOVO com o CPF/CNPJ do recusado substitui o recusado e herda a revisão seguinte', async () => {
    const t = montar();
    await t.recusadoPeloErp();
    await t.salvar({ ...VALORES, razao_social: 'Mercado Boa Vista Ltda' }, ID_NOVO);
    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.servidor.excluidos.has(ID)).toBe(true);
    expect(t.vivos().map((g) => [g.p.id, g.p.razao_social, g.revisao])).toEqual([
      [ID_NOVO, 'Mercado Boa Vista Ltda', 2],
    ]);
    // o pull trouxe o recusado com deleted_at: a lista não o mostra duplicado
    expect(await t.lista()).toEqual([
      {
        id: ID_NOVO,
        nome: 'Mercado Boa Vista Ltda',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);
  });

  it('RN-CORE-78: id novo com o CPF/CNPJ de um cliente pendente é 409 (não substitui) e fica "Não enviado" com o texto do contrato', async () => {
    const t = montar();
    await t.sincronizar();
    await t.salvar(VALORES);
    await t.sincronizar();
    await t.salvar(VALORES, ID_NOVO);
    await t.sincronizar();
    expect(t.vivos().map((g) => g.p.id)).toEqual([ID]);
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[ID_NOVO, 'falhou']]);
    expect((await t.lista()).find((c) => c.id === ID_NOVO)?.motivo).toBe(
      MENSAGENS_ERRO_PRE_CADASTRO.DOCUMENTO_JA_CADASTRADO,
    );
  });

  it('RN-CORE-78: com o código do ERP o selo some (Em dia), e o rótulo nunca diz "Aguardando" para aprovado', async () => {
    const t = montar();
    await t.sincronizar();
    await t.salvar(VALORES);
    await t.sincronizar();
    t.servidor.decisao.set(ID, { status: 'aprovado', codigo: 'ERP-000123' });
    await t.sincronizar();
    expect(await t.lista()).toEqual([
      { id: ID, nome: 'Mercado Boa Vista', situacao: 'em_dia', selo: null, motivo: null, status: 'aprovado' },
    ]);
  });
});

describe('v1.0.30 pré-cadastro no Campo: 422 e módulo inativo da API → "Não enviado" (critério 7)', () => {
  it('RN-CORE-78: o item que a API recusou (422) é "Não enviado" com a mensagem, nunca "Recusado pelo ERP"; a correção SUBSTITUI o item da fila (mesmo id, sem revisão) e o reenvio é aceito', async () => {
    const t = montar();
    await t.sincronizar();
    await t.salvar(VALORES);
    t.servidor.recusa422.set(ID, 'Inscrição estadual inválida para AM');
    await t.sincronizar();
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[ID, 'falhou']]);
    const [linha] = await t.lista();
    // o cadastro não chegou ao ERP: status do contrato continua pendente, o selo diz "Não enviado" e o motivo é o do servidor
    expect(linha).toEqual({
      id: ID,
      nome: 'Mercado Boa Vista',
      situacao: 'pre_cadastro',
      selo: ROTULO_PRE_CADASTRO_NAO_ENVIADO,
      motivo: 'Inscrição estadual inválida para AM',
      status: 'pendente',
    });
    expect(ACAO_CORRIGIR_E_REENVIAR).toBe('Corrigir e reenviar');

    // "Corrigir e reenviar" do "Não enviado" (nunca chegou ao servidor): abre o payload da fila, sem revisão; o `alterar` devolve a pendente
    const c = (await t.correcao())!;
    expect(c.base.revisao_base).toBeNull();
    expect(c.valores.razao_social).toBe('Mercado Boa Vista');
    expect(await t.salvar({ ...c.valores, razao_social: 'Mercado Boa Vista Ltda' }, ID, c.base)).toEqual({
      ok: true,
      id: ID,
    });
    expect(
      t.motor
        .estado()
        .fila.map((i) => [
          i.id,
          i.situacao,
          (i.payload as PreCadastroCliente).razao_social,
          (i.payload as PreCadastroCliente).revisao_base,
        ]),
    ).toEqual([[ID, 'pendente', 'Mercado Boa Vista Ltda', undefined]]);
    expect(await t.lista()).toEqual([
      {
        id: ID,
        nome: 'Mercado Boa Vista Ltda',
        situacao: 'pre_cadastro',
        selo: ROTULO_AGUARDANDO_ERP,
        motivo: null,
        status: 'pendente',
      },
    ]);

    await t.sincronizar();
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.vivos().map((g) => [g.p.id, g.p.razao_social, g.p.documento, g.revisao])).toEqual([
      [ID, 'Mercado Boa Vista Ltda', '11222333000181', 1],
    ]);
  });

  it('RN-CORE-78 e RN-CORE-02: item `modulo_inativo` da fila também é "Não enviado" com o motivo, nunca "Recusado pelo ERP"', async () => {
    // O core é sempre ativo (RN-CORE-01), então a API não devolve MODULO_INATIVO ao pré-cadastro hoje, e
    // `motor.sobreposicao()` só sobrepõe `pendente`/`falhou`: o caso fica coberto aqui na sobreposição do Core.
    const t = montar();
    await t.sincronizar();
    await t.salvar(VALORES);
    const [item] = t.motor.sobreposicao([ENTIDADE_PRE_CADASTRO]);
    const [c] = sobreporPreCadastros(
      [],
      [{ ...item!, situacao: 'modulo_inativo', ultimo_erro: 'Módulo desativado' }],
      AGORA,
    );
    expect(seloDoPreCadastro(situacaoDoPreCadastro(c!).situacao)?.texto).toBe(
      ROTULO_PRE_CADASTRO_NAO_ENVIADO,
    );
    expect(situacaoDoPreCadastro(c!).motivo).toBe('Módulo desativado');
    expect(c?.status_cadastro).toBe('pendente');
  });
});

describe('v1.0.30 valor × regra do selo (critério 7)', () => {
  it('RN-CORE-78: cada status do contrato tem um só rótulo, e o rótulo diz o status', () => {
    const casos = [
      [{ status_cadastro: 'pendente', external_id: null }, 'Aguardando ERP'],
      [{ status_cadastro: undefined, external_id: null }, 'Aguardando ERP'],
      [{ status_cadastro: 'recusado', external_id: null, motivo_recusa: 'x' }, 'Recusado pelo ERP'],
      [{ status_cadastro: 'pendente', external_id: null, motivo_recusa: 'x' }, 'Não enviado'],
      [{ status_cadastro: 'aprovado', external_id: 'ERP-1' }, null],
    ] as const;
    for (const [c, rotulo] of casos)
      expect(seloDoPreCadastro(situacaoDoPreCadastro(c).situacao)?.texto ?? null, JSON.stringify(c)).toBe(
        rotulo,
      );
  });
});
