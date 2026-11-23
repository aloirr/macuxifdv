/**
 * v1.0.30 (ADR 0069; RN-CORE-16, RN-CORE-78, RN-CORE-79; specs bko-pre-cadastros-recusados.md, pre-cadastro-campos.md e
 * codigos-do-cliente.md) — a cadeia inteira do pré-cadastro recusado pela API REAL (Fastify + Postgres de teste, migração 0098):
 * vendedor cria → ERP recusa → BKO lista, abre a gaveta, edita e reenvia (revisão nova do MESMO id) → 409 da base velha → vendedor
 * corrige pelo push do sync → ERP aceita. Em cada passo, o que a tela do BKO mostra é montado pelas MESMAS funções da tela
 * (`web/lib/pre-cadastro.ts`, `app/lib/pre-cadastro-formulario.ts`, `codigos-cliente.tsx`) e comparado com o esperado pela regra
 * (valor × regra: contador da aba, situação × selo, data no fuso do tenant, códigos ERP/FDV).
 * Parâmetros › Clientes: GET|PUT /v1/core/parametros/campos-obrigatorios e o efeito no formulário do app (pull) e do BKO.
 * Perfil errado (403) e outro tenant (RLS: não vê, 404).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMPOS_CADASTRO_FIXOS,
  HistoricoPreCadastroSchema,
  PARAMETRO_CAMPOS_OBRIGATORIOS,
  ParametroCamposObrigatoriosClienteSchema,
  PreCadastroAtualSchema,
  PreCadastroClienteSaidaSchema,
  RecusadosSaidaSchema,
  type ClienteSync,
  type ParametroSync,
  type RecusadosSaida,
  type TentativaPreCadastro,
} from '../../../modules/core/contracts';
import {
  mascararDocumentoDoFarol,
  obrigatoriosDoPreCadastro,
  situacaoDoRecusado,
} from '../../../modules/core/domain';
import { listarClientesLocais } from '../../../modules/core/app/lib/cliente360-local';
import {
  colunaExigida,
  errosDaRecusaPorColuna,
  primeiraColunaMarcada,
  valoresDosDados,
} from '../../../modules/core/app/lib/pre-cadastro-formulario';
import { correcaoDoCliente, obrigatoriosDasLinhas } from '../../../modules/core/app/lib/pre-cadastro-local';
import {
  alternarLinhaObrigatoria,
  buscaParaApi,
  contadorDaAba,
  corpoDaCorrecao,
  erroDoReenvio,
  linhaMarcada,
  LINHAS_CAMPOS_OBRIGATORIOS,
  ORDEM_DA_GRADE,
  seloDaSituacao,
  situacaoDaGaveta,
  situacaoDoHistorico,
  tentativasEmOrdem,
  textoDeQuemCorrigiuAntes,
  textoDeQuemEnviou,
  textoDoResultado,
} from '../../../modules/core/web/lib/pre-cadastro';
import { textoDosCodigosDoCliente } from '../../../modules/core/web/components/codigos-cliente';
import { A, B, puxarTudo, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const FUSO = 'America/Manaus';
const U = (n: number) => `0c030b00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = U(1);
const ID_CAMPO = U(2);
const CNPJ = '11222333000181';
const CNPJ_2 = '45723174000110';
const MOTIVO = 'CNPJ com cadastro bloqueado no ERP.';
const ERROS = [
  { campo: 'inscricao_estadual', codigo: 'IE_INVALIDA', mensagem: 'IE não confere.' },
  { campo: 'telefone', codigo: 'FONE', mensagem: 'Telefone sem DDD.' },
  { campo: 'campo_que_o_formulario_nao_tem', codigo: 'X', mensagem: 'Só no histórico.' },
];
const ENDERECO = {
  inscricao_estadual: 'ISENTO',
  logradouro: 'Rua A',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69000000',
};
const R = '/v1/core/clientes/pre-cadastro/recusados';

describe('v1.0.30 pré-cadastro — funções da tela, sem banco (valor × regra)', () => {
  it('RN-CORE-78: situação × selo: cada status do cliente tem uma situação e o selo diz exatamente ela', () => {
    expect(
      seloDaSituacao(situacaoDoRecusado({ status_cadastro: 'recusado', revisao_cadastro: 1 })!),
    ).toMatchObject({ texto: 'Recusado', tom: 'danger' });
    expect(
      seloDaSituacao(situacaoDoRecusado({ status_cadastro: 'pendente', revisao_cadastro: 2 })!),
    ).toMatchObject({ texto: 'Reenviado', tom: 'warning' });
    expect(
      seloDaSituacao(situacaoDoRecusado({ status_cadastro: 'aprovado', revisao_cadastro: 3 })!),
    ).toMatchObject({ texto: 'Aceito', tom: 'success' });
    // pendente da 1ª revisão nunca foi recusado: não entra na aba
    expect(situacaoDoRecusado({ status_cadastro: 'pendente', revisao_cadastro: 1 })).toBeNull();
  });

  it('data no fuso do tenant (UTC no banco): virada de mês e de dia em Manaus (UTC−4)', () => {
    const t = (enviado_em: string, respondido_em: string | null) =>
      ({
        revisao: 2,
        hash: null,
        origem: 'bko',
        corrigido_por: { id: U(9), nome: 'Ana', perfil: 'analista' },
        enviado_em,
        campos_alterados: [],
        resultado: 'recusado',
        respondido_em,
        motivo: null,
        erros: [],
        cliente_id_original: null,
      }) satisfies TentativaPreCadastro;
    // 01/12 02:30 UTC = 30/11 22:30 em Manaus
    expect(textoDeQuemEnviou(t('2026-12-01T02:30:00.000Z', null), FUSO)).toBe(
      'Corrigida por Ana, no BKO, em 30/11/2026 22:30',
    );
    expect(textoDoResultado(t('2026-12-01T02:30:00.000Z', '2026-12-01T04:05:00.000Z'), FUSO)).toBe(
      'Recusada pelo ERP em 01/12/2026 00:05',
    );
  });
});

describe.skipIf(semBanco())(
  'v1.0.30 pré-cadastro recusado pela API real: Campo → ERP → BKO → Campo (ADR 0069)',
  () => {
    let api: ApiDeTeste;
    const tk = { vendedor: '', analista: '', admin: '', supervisor: '', promotor: '', adminB: '' };
    let codigoFdv = '';
    let codigoFdvCampo = '';

    const get = (token: string, url: string) => api.chamar(token, { method: 'GET', url });
    const lista = async (token: string, qs = ''): Promise<RecusadosSaida> => {
      const r = await get(token, `${R}${qs}`);
      expect(r.statusCode, r.body).toBe(200);
      return RecusadosSaidaSchema.parse(r.json());
    };
    /** O que o consumidor do retorno do ERP faz na recusa (como `recusar` do apoio dos testes de banco do Core). */
    const recusar = async (id: string) => {
      await api.admin.query(
        "update core.cliente set status_cadastro = 'recusado', motivo_recusa = $2, erros_recusa = $3::jsonb where id = $1",
        [id, MOTIVO, JSON.stringify(ERROS)],
      );
      await api.admin.query(
        // hora-fixa-ok: o now() só preenche respondido_em, nunca comparado com instante fixo
        `update core.cliente_pre_cadastro_tentativa set resultado = 'recusado', respondido_em = now(), motivo = $2, erros = $3::jsonb
        where cliente_id = $1 and revisao = (select revisao_cadastro from core.cliente where id = $1)`,
        [id, MOTIVO, JSON.stringify(ERROS)],
      );
    };
    const criar = async (id: string, documento: string, razao: string) => {
      const r = await api.chamar(tk.vendedor, {
        method: 'POST',
        url: '/v1/core/clientes/pre-cadastro',
        payload: {
          id,
          origem: 'campo',
          documento,
          razao_social: razao,
          telefone: '92999990000',
          ...ENDERECO,
        },
      });
      expect(r.statusCode, r.body).toBeLessThan(300);
      return PreCadastroClienteSaidaSchema.parse(r.json());
    };

    beforeAll(async () => {
      api = await subirApi();
      tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
      tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
      tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
      tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
      tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
      tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    });
    afterAll(async () => {
      await api?.fechar();
    });

    it('Parâmetros › Clientes (RN-CORE-16/79): GET analista; PUT só admin, com os fixos acrescentados; a lista vale no app (pull) e no BKO', async () => {
      const g = await get(tk.analista, '/v1/core/parametros/campos-obrigatorios');
      expect(g.statusCode, g.body).toBe(200);
      expect(ParametroCamposObrigatoriosClienteSchema.parse(g.json()).obrigatorios).toEqual(
        expect.arrayContaining([...CAMPOS_CADASTRO_FIXOS]),
      );
      expect(
        (
          await api.chamar(tk.analista, {
            method: 'PUT',
            url: '/v1/core/parametros/campos-obrigatorios',
            payload: { obrigatorios: ['telefone'] },
          })
        ).statusCode,
      ).toBe(403);
      expect((await get(tk.vendedor, '/v1/core/parametros/campos-obrigatorios')).statusCode).toBe(403);

      // o painel marca Telefone e Endereço (linhas inteiras) a partir de só os fixos; a tela manda a lista que montou
      const tel = LINHAS_CAMPOS_OBRIGATORIOS.find((l) => l.campos.includes('telefone'))!;
      const end = LINHAS_CAMPOS_OBRIGATORIOS.find((l) => l.campos.includes('logradouro'))!;
      const enviada = alternarLinhaObrigatoria(
        alternarLinhaObrigatoria([...CAMPOS_CADASTRO_FIXOS], tel, true),
        end,
        true,
      );
      const p = await api.chamar(tk.admin, {
        method: 'PUT',
        url: '/v1/core/parametros/campos-obrigatorios',
        payload: { obrigatorios: enviada.filter((c) => !CAMPOS_CADASTRO_FIXOS.includes(c as never)) },
      });
      expect(p.statusCode, p.body).toBe(200);
      const gravada = ParametroCamposObrigatoriosClienteSchema.parse(p.json()).obrigatorios;
      expect(gravada).toEqual(enviada);
      expect(
        ParametroCamposObrigatoriosClienteSchema.parse(
          (await get(tk.analista, '/v1/core/parametros/campos-obrigatorios')).json(),
        ).obrigatorios,
      ).toEqual(gravada);
      for (const l of LINHAS_CAMPOS_OBRIGATORIOS)
        expect(linhaMarcada(gravada, l), l.rotulo).toBe(l.sempre || l === tel || l === end);

      // app: o parâmetro chega pelo pull e o formulário exige o telefone; BKO: o "Editar e reenviar" exige o mesmo
      await esperarHorizonte();
      const linhas = await puxarTudo<ParametroSync>(api, tk.vendedor, 'parametro');
      expect(linhas.some((l) => l.chave === PARAMETRO_CAMPOS_OBRIGATORIOS)).toBe(true);
      const doApp = obrigatoriosDasLinhas(linhas);
      const doBko = obrigatoriosDoPreCadastro(gravada);
      expect(doApp).toEqual(doBko);
      const valores = valoresDosDados({ documento: CNPJ, razao_social: 'X' });
      expect(colunaExigida(valores, doApp, 'telefone')).toBe(true);
      expect(colunaExigida(valores, doBko, 'telefone')).toBe(true);
      expect(colunaExigida(valores, doApp, 'email')).toBe(false);
      // a API revalida pela mesma lista: sem telefone, 422 CAMPOS_OBRIGATORIOS
      const sem = await api.chamar(tk.vendedor, {
        method: 'POST',
        url: '/v1/core/clientes/pre-cadastro',
        payload: {
          id: U(90),
          origem: 'campo',
          documento: '52998224725',
          razao_social: 'Sem fone',
          ...ENDERECO,
        },
      });
      expect(sem.statusCode, sem.body).toBe(422);
      expect(sem.json()).toMatchObject({ codigo: 'CAMPOS_OBRIGATORIOS' });
    });

    it('Código FDV desde a criação; Código ERP vazio até o ERP aprovar; a busca da Carteira do app acha pelo FDV', async () => {
      const r = await criar(ID, CNPJ, 'Mercado Boa Vista');
      expect(r).toMatchObject({ id: ID, status_cadastro: 'pendente', revisao: 1, ja_existia: false });
      codigoFdv = r.codigo_fdv!;
      expect(codigoFdv).toMatch(/^\d{5,}$/);
      await esperarHorizonte();
      const pull = (await puxarTudo<ClienteSync>(api, tk.vendedor, 'cliente')).filter(
        (c) => c.deleted_at === null,
      );
      const meu = pull.find((c) => c.id === ID)!;
      expect(meu).toMatchObject({ codigo_fdv: codigoFdv, external_id: null });
      expect(textoDosCodigosDoCliente(meu)).toBe(`FDV ${codigoFdv}`);
      const achados = listarClientesLocais(
        { clientes: pull, financeiros: [], titulos: [], historico: [] },
        '2026-11-23',
        { q: codigoFdv },
      ).map((c) => c.id);
      expect(achados).toEqual([ID]);
    });

    it('ERP recusa → aba do BKO: documento mascarado, razão social, vendedor, Recusado em, motivo, situação; contador = linhas de Recusado', async () => {
      await recusar(ID);
      const l = await lista(tk.analista);
      const item = l.itens.find((i) => i.cliente_id === ID)!;
      expect(item).toMatchObject({
        revisao: 1,
        razao_social: 'Mercado Boa Vista',
        vendedor: { nome: 'Vendedor Um' },
        motivo: MOTIVO,
        situacao: 'recusado',
        codigo_fdv: codigoFdv,
      });
      expect(item.documento_mascarado).toBe(mascararDocumentoDoFarol(CNPJ));
      expect(item.documento_mascarado).not.toContain(CNPJ.slice(8));
      // contador da aba (a página pede situacao=recusado, limite 200) = itens com o selo "Recusado"
      const contador = await lista(tk.analista, '?situacao=recusado&limite=200');
      expect(contador.itens.every((i) => seloDaSituacao(i.situacao).texto === 'Recusado')).toBe(true);
      expect(contadorDaAba(contador)).toBe(contador.itens.length);
      expect(contadorDaAba(contador)).toBeGreaterThanOrEqual(1);
      // busca: razão social (contém) e dígitos do CPF/CNPJ (com máscara, a tela manda só os dígitos)
      expect(
        (await lista(tk.analista, `?busca=${encodeURIComponent('boa vista')}`)).itens.map(
          (i) => i.cliente_id,
        ),
      ).toContain(ID);
      expect(
        (await lista(tk.analista, `?busca=${buscaParaApi('11.222.333')}`)).itens.map((i) => i.cliente_id),
      ).toContain(ID);
      expect((await lista(tk.analista, '?busca=Inexistente')).itens).toEqual([]);
      expect((await lista(tk.analista, '?situacao=reenviado')).itens.map((i) => i.cliente_id)).not.toContain(
        ID,
      );
    });

    it('gaveta: histórico com revisão, motivo, erros, quem e quando; "Editar e reenviar" marca os campos do erro e reenvia revisão nova do MESMO id', async () => {
      const h = HistoricoPreCadastroSchema.parse(
        (await get(tk.analista, `/v1/core/clientes/${ID}/pre-cadastro/historico`)).json(),
      );
      expect(h.revisao_atual).toBe(1);
      const [t1] = tentativasEmOrdem(h);
      expect(t1).toMatchObject({
        revisao: 1,
        origem: 'campo',
        resultado: 'recusado',
        motivo: MOTIVO,
        corrigido_por: { nome: 'Vendedor Um' },
      });
      expect(t1!.erros.map((e) => e.campo)).toEqual(ERROS.map((e) => e.campo));
      expect(textoDeQuemEnviou(t1!, FUSO)).toMatch(
        /^Enviada por Vendedor Um, no Campo, em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
      );
      expect(textoDoResultado(t1!, FUSO)).toMatch(/^Recusada pelo ERP em /);
      expect(situacaoDaGaveta('recusado', h)).toBe('recusado');

      const atual = PreCadastroAtualSchema.parse(
        (await get(tk.analista, `/v1/core/clientes/${ID}/pre-cadastro`)).json(),
      );
      expect(atual).toMatchObject({
        id: ID,
        revisao: 1,
        status_cadastro: 'recusado',
        documento: CNPJ,
        codigo_fdv: codigoFdv,
        external_id: null,
      });
      // campos do erro marcados no próprio campo; o que o formulário não tem fica só no histórico; rola até o 1º da grade
      const marcas = errosDaRecusaPorColuna(atual.erros);
      expect(marcas).toEqual({ inscricao_estadual: 'IE não confere.', telefone: 'Telefone sem DDD.' });
      expect(primeiraColunaMarcada(marcas, ORDEM_DA_GRADE)).toBe('inscricao_estadual');

      const valores = {
        ...valoresDosDados(atual),
        inscricao_estadual: '041234567',
        telefone: '(92) 3232-1010',
        documento: '11.222.333/0001-81',
      };
      const corpo = corpoDaCorrecao(atual, valores);
      expect(corpo).toMatchObject({ revisao_base: 1, documento: CNPJ, telefone: '9232321010' });
      const put = await api.chamar(tk.analista, {
        method: 'PUT',
        url: `/v1/core/clientes/${ID}/pre-cadastro`,
        payload: corpo,
      });
      expect(put.statusCode, put.body).toBe(200);
      expect(PreCadastroClienteSaidaSchema.parse(put.json())).toMatchObject({
        id: ID,
        status_cadastro: 'pendente',
        revisao: 2,
        codigo_fdv: codigoFdv,
      });

      // a linha sai de "Recusado" e vai para "Reenviado" com o selo certo; o contador cai junto
      expect((await lista(tk.analista)).itens.map((i) => i.cliente_id)).not.toContain(ID);
      const reenv = (await lista(tk.analista, '?situacao=reenviado')).itens.find((i) => i.cliente_id === ID)!;
      expect(reenv).toMatchObject({ situacao: 'reenviado', revisao: 2 });
      expect(seloDaSituacao(reenv.situacao).texto).toBe('Reenviado');
      const h2 = HistoricoPreCadastroSchema.parse(
        (await get(tk.analista, `/v1/core/clientes/${ID}/pre-cadastro/historico`)).json(),
      );
      const [nova] = tentativasEmOrdem(h2);
      expect(nova).toMatchObject({
        revisao: 2,
        origem: 'bko',
        resultado: 'aguardando',
        corrigido_por: { nome: 'Analista Alfa' },
      });
      expect(nova!.campos_alterados).toEqual(expect.arrayContaining(['inscricao_estadual', 'telefone']));
      expect(textoDeQuemEnviou(nova!, FUSO)).toMatch(/^Corrigida por Analista Alfa, no BKO, em /);
      expect(textoDoResultado(nova!, FUSO)).toBe('Aguardando ERP');
      expect(situacaoDoHistorico(h2)).toBe('reenviado');
      // a gaveta aberta da lista antiga (linha "recusado") mostra a situação do histórico
      expect(situacaoDaGaveta('recusado', h2)).toBe('reenviado');

      // o mesmo corpo de novo (resposta perdida) é repetição idempotente: 200 ja_existia, sem revisão 3
      const rep = await api.chamar(tk.analista, {
        method: 'PUT',
        url: `/v1/core/clientes/${ID}/pre-cadastro`,
        payload: corpo,
      });
      expect(rep.statusCode, rep.body).toBe(200);
      expect(rep.json()).toMatchObject({ revisao: 2, ja_existia: true });
      // 409 REVISAO_DESATUALIZADA: outra pessoa, com a gaveta aberta na revisão 1, reenvia OUTRO conteúdo (base velha)
      const velho = await api.chamar(tk.admin, {
        method: 'PUT',
        url: `/v1/core/clientes/${ID}/pre-cadastro`,
        payload: { ...corpo, numero: '99' },
      });
      expect(velho.statusCode, velho.body).toBe(409);
      const e = velho.json() as { codigo: string; mensagem?: string; message?: string };
      expect(e.codigo).toBe('REVISAO_DESATUALIZADA');
      expect(erroDoReenvio(new ApiRequestError(409, e.codigo, 'x'))).toEqual({
        revisaoDesatualizada: true,
        erros: {},
      });
      expect(textoDeQuemCorrigiuAntes(h2, FUSO)).toMatch(
        /^Analista Alfa já corrigiu este pré-cadastro em \d{2}\/\d{2} \d{2}:\d{2}\.$/,
      );
    });

    it('Campo: "Corrigir e reenviar" offline sobe pelo push com revisao_base; MESMO id, revisão 2, motivo e erros do ERP no próprio campo', async () => {
      const r = await criar(ID_CAMPO, CNPJ_2, 'Padaria Rio Branco');
      codigoFdvCampo = r.codigo_fdv!;
      await recusar(ID_CAMPO);
      await esperarHorizonte();
      const pull = await puxarTudo<ClienteSync>(api, tk.vendedor, 'cliente');
      const linha = pull.find((c) => c.id === ID_CAMPO)!;
      expect(linha).toMatchObject({
        status_cadastro: 'recusado',
        motivo_recusa: MOTIVO,
        revisao_cadastro: 1,
        codigo_fdv: codigoFdvCampo,
      });
      const correcao = correcaoDoCliente(pull, [], ID_CAMPO)!;
      expect(correcao.base.revisao_base).toBe(1);
      expect(correcao.erros).toEqual({
        inscricao_estadual: 'IE não confere.',
        telefone: 'Telefone sem DDD.',
      });
      // o aparelho guarda o item na fila (offline) e o motor sobe no próximo sync: o mesmo item duas vezes (reenvio) não abre revisão 3
      const payload = {
        id: ID_CAMPO,
        origem: 'campo',
        ...correcao.valores,
        documento: CNPJ_2,
        inscricao_estadual: '041234567',
        telefone: '9232321010',
        revisao_base: 1,
      };
      const item = { entidade: 'cliente_pre_cadastro', id: ID_CAMPO, operacao: 'upsert', payload };
      for (let i = 0; i < 2; i += 1) {
        const p = await api.chamar(tk.vendedor, {
          method: 'POST',
          url: '/v1/sync/push',
          payload: { itens: [item] },
        });
        expect(p.statusCode, p.body).toBe(200);
        expect((p.json() as { resultados: Array<{ status: string }> }).resultados[0]!.status).toMatch(
          /^(aplicado|ja_aplicado|ok|aceito)$/,
        );
      }
      await esperarHorizonte();
      const depois = (await puxarTudo<ClienteSync>(api, tk.vendedor, 'cliente')).filter(
        (c) => c.deleted_at === null && c.documento === CNPJ_2,
      );
      expect(depois.map((c) => [c.id, c.status_cadastro, c.revisao_cadastro])).toEqual([
        [ID_CAMPO, 'pendente', 2],
      ]);
      const h = HistoricoPreCadastroSchema.parse(
        (await get(tk.analista, `/v1/core/clientes/${ID_CAMPO}/pre-cadastro/historico`)).json(),
      );
      expect(tentativasEmOrdem(h).map((t) => [t.revisao, t.origem])).toEqual([
        [2, 'campo'],
        [1, 'campo'],
      ]);
    });

    it('ERP aceita → situação Aceito, e o Código ERP aparece antes do FDV (ERP C5007 · FDV nnnnn)', async () => {
      await api.admin.query(
        "update core.cliente set status_cadastro = 'aprovado', external_id = 'C5007', motivo_recusa = null, erros_recusa = null where id = $1",
        [ID],
      );
      await api.admin.query(
        // hora-fixa-ok: o now() só preenche respondido_em, nunca comparado com instante fixo
        "update core.cliente_pre_cadastro_tentativa set resultado = 'aceito', respondido_em = now() where cliente_id = $1 and revisao = 2",
        [ID],
      );
      const aceito = (await lista(tk.analista, '?situacao=aceito')).itens.find((i) => i.cliente_id === ID)!;
      expect(seloDaSituacao(aceito.situacao).texto).toBe('Aceito');
      const ficha = await get(tk.admin, `/v1/core/clientes/${ID}`);
      expect(ficha.statusCode, ficha.body).toBe(200);
      const c = (ficha.json() as { cliente: { external_id: string | null; codigo_fdv: string | null } })
        .cliente;
      expect(textoDosCodigosDoCliente(c)).toBe(`ERP C5007 · FDV ${codigoFdv}`);
    });

    it('perfil errado: vendedor, supervisor e promotor não listam nem corrigem (403)', async () => {
      for (const [quem, token] of [
        ['vendedor', tk.vendedor],
        ['supervisor', tk.supervisor],
        ['promotor', tk.promotor],
      ] as const) {
        expect((await get(token, R)).statusCode, quem).toBe(403);
        expect(
          (await get(token, `/v1/core/clientes/${ID_CAMPO}/pre-cadastro/historico`)).statusCode,
          quem,
        ).toBe(403);
        expect(
          (
            await api.chamar(token, {
              method: 'PUT',
              url: `/v1/core/clientes/${ID_CAMPO}/pre-cadastro`,
              payload: { razao_social: 'x', documento: CNPJ_2, revisao_base: 2 },
            })
          ).statusCode,
          quem,
        ).toBe(403);
      }
    });

    it('tenant errado: o admin do tenant B não vê o recusado do A na lista nem pelo id (404), nem corrige', async () => {
      const lb = await lista(tk.adminB, '?situacao=reenviado');
      expect(lb.itens.map((i) => i.cliente_id)).not.toContain(ID_CAMPO);
      expect((await lista(tk.adminB)).itens.map((i) => i.cliente_id)).not.toContain(ID_CAMPO);
      expect((await get(tk.adminB, `/v1/core/clientes/${ID_CAMPO}/pre-cadastro`)).statusCode).toBe(404);
      expect((await get(tk.adminB, `/v1/core/clientes/${ID_CAMPO}/pre-cadastro/historico`)).statusCode).toBe(
        404,
      );
      const put = await api.chamar(tk.adminB, {
        method: 'PUT',
        url: `/v1/core/clientes/${ID_CAMPO}/pre-cadastro`,
        payload: { razao_social: 'x', documento: CNPJ_2, revisao_base: 2 },
      });
      expect(put.statusCode).toBe(404);
      expect(A.tenantId).not.toBe(B.tenantId);
    });

    it('a Carteira do BKO recebe o Código FDV de cada cliente', async () => {
      const r = await get(tk.admin, `/v1/core/usuarios/${A.usuarios.vendedor1}/clientes`);
      const c = (r.json() as { itens: Array<{ id: string; codigo_fdv?: string | null }> }).itens.find(
        (i) => i.id === ID_CAMPO,
      );
      expect(c?.codigo_fdv).toBe(codigoFdvCampo);
    });
  },
);
