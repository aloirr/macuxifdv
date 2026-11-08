// T-0108 - Demonstracao do cliente da API do Hub (.NET 8). Variaveis de ambiente: MACUXI_HUB_URL, MACUXI_CHAVE (nunca impressa),
// MACUXI_CONECTOR (padrao erp-matriz), MACUXI_CONECTOR_VERSAO (opcional), MACUXI_INTERVALO_MS (padrao 5000).
// Rodar: dotnet run
using System.Text;
using System.Text.Json.Nodes;
using Macuxi.Hub.Exemplos;

Console.OutputEncoding = Encoding.UTF8;

ConfigHub cfg;
try
{
    cfg = ConfigHub.LerDoAmbiente();
}
catch (ArgumentException e)
{
    Console.Error.WriteLine($"Configuracao invalida: {e.Message}");
    return 2;
}

void Log(string s) => Console.WriteLine(s);

void Mostrar(string rotulo, LoteProcessado l)
{
    var c = l.Resultado["contagens"]!;
    Log($"  {rotulo}: {l.Status} (recebidas {c["recebidas"]}, novas {c["novas"]}, atualizadas {c["atualizadas"]}, inalteradas {c["inalteradas"]}, com erro {c["com_erro"]})");
    foreach (var e in l.Reprocessaveis)
        Log($"    reprocessavel   {e.ExternalId} {e.Codigo} em {e.Campo}: o Hub reprocessa sozinho quando o alvo chegar");
    foreach (var e in l.CorrigirNaOrigem)
        Log($"    corrigir no ERP {e.ExternalId} {e.Codigo} em {e.Campo ?? "-"} (origem {e.Origem})");
}

var cliente = new ClienteHub(cfg, log: Log);
var erp = new ErpFicticio();
Log($"Hub: {cfg.Url} | Conector: {cfg.ConectorId}{(cfg.ConectorVersao is null ? "" : " v" + cfg.ConectorVersao)}");

try
{
    // 1) Onde continuar? Cursor nulo = carga inicial completa; com cursor = so o delta.
    Log("\n1) Produtos");
    var cursor = await cliente.ConsultarCursorAsync("produto");
    LoteProcessado? ultimo = null;
    if (cursor is null)
    {
        Log("  cursor nulo: carga completa em partes (na demonstracao, 3 por parte; na vida real, ate 5.000)");
        var partes = await cliente.EnviarCompletoAsync("produto", erp.LerPagina("produto"), tamanhoParte: 3);
        for (var i = 0; i < partes.Count; i++)
            Mostrar($"parte {i + 1} (ultimo={partes[i].Envelope["sessao"]!["ultimo"]})", partes[i]);
        ultimo = partes.LastOrDefault();
    }
    else
    {
        Log($"  cursor em {cursor.AlteradoEm} / {cursor.ExternalId}: so o delta");
        var lotes = await cliente.EnviarDeltaAsync("produto", erp.LerPagina("produto"), cursor, tamanhoPagina: 3);
        for (var i = 0; i < lotes.Count; i++) Mostrar($"pagina {i + 1}", lotes[i]);
        if (lotes.Count == 0) Log("  nada novo desde o cursor: nenhum lote enviado");
        ultimo = lotes.LastOrDefault();
    }

    // 2) Delta de precos com erros por linha.
    Log("\n2) Precos (delta com erros por linha)");
    var cursorPreco = await cliente.ConsultarCursorAsync("preco");
    var lotesPreco = await cliente.EnviarDeltaAsync("preco", erp.LerPagina("preco"), cursorPreco, tamanhoPagina: 10, validar: ErpFicticio.ValidarPreco);
    for (var i = 0; i < lotesPreco.Count; i++) Mostrar($"pagina {i + 1}", lotesPreco[i]);
    if (lotesPreco.Count == 0) Log("  nada novo desde o cursor: nenhum lote enviado");
    ultimo = lotesPreco.LastOrDefault() ?? ultimo;

    // 3) Reenviar o MESMO lote (resposta perdida): mesma Idempotency-Key, mesmo lote_id, repetido=true.
    Log("\n3) Reenvio do mesmo lote");
    if (ultimo is not null)
    {
        var (aceito, chave, repetido) = await cliente.EnviarLoteAsync(ultimo.Envelope);
        var mesmo = aceito["lote_id"]!.GetValue<string>() == ultimo.Aceito["lote_id"]!.GetValue<string>() ? "o mesmo" : "DIFERENTE (inesperado)";
        Log($"  mesma chave ({chave[..12]}...): lote {mesmo}, repetido={repetido}");
    }
    else
    {
        Log("  nenhum lote enviado nesta execucao; nada a reenviar");
    }

    // 4) Recusa de envelope: nenhum lote e criado e a recusa NAO e repetida.
    Log("\n4) Recusa de envelope (lote vazio)");
    try
    {
        await cliente.EnviarLoteAsync(new JsonObject { ["versao_contrato"] = "v1", ["entidade"] = "vendedor", ["modo"] = "delta", ["registros"] = new JsonArray() });
        Log("  inesperado: o Hub aceitou um lote vazio");
    }
    catch (RecusaLoteException e)
    {
        Log($"  RecusaLote {e.Status} {e.Codigo}: {e.Erros[0].Mensagem} (requisicao_id {e.RequisicaoId})");
    }

    // 5) Devolucao de pedidos.
    Log("\n5) Pedidos aprovados");
    var resumo = await cliente.ProcessarPedidosAsync(erp);
    Log($"  rodadas {resumo.Rodadas}, integrados {resumo.Integrados}, rejeitados {resumo.Rejeitados}, repetidos {resumo.Repetidos}");
    foreach (var (uuid, numero) in erp.PedidosGravados) Log($"  pedido {uuid} gravado no ERP como {numero}");
    foreach (var d in resumo.Descartados) Log($"  item descartado: {d}");
    foreach (var d in resumo.Definitivos) Log($"  recusa definitiva (nao reenviar): {d}");
    if (resumo.Rodadas == 0) Log("  nenhum pedido pendente");
    Log("\nConcluido.");
    return 0;
}
catch (ErroHubException e)
{
    // So o resumo (HTTP, codigo do Hub e requisicao_id): nunca a chave nem o corpo enviado.
    Console.Error.WriteLine($"Falhou: {e.Message} (requisicao_id {e.RequisicaoId ?? "-"})");
    return 1;
}

/// <summary>Um "ERP" em memoria. Troque pelas suas consultas (SQL, API do ERP...).</summary>
internal sealed class ErpFicticio : IErp
{
    private readonly Dictionary<string, List<JsonNode>> _dados;

    /// <summary>pedido_uuid -> numero do pedido no ERP (a "tabela do ERP" que guarda o UUID).</summary>
    public Dictionary<string, string> PedidosGravados { get; } = new();

    public ErpFicticio()
    {
        static string T(int n) => $"2026-11-05T13:4{n}:10Z";

        static JsonNode Produto(int n, string nome, string alterado) => new JsonObject
        {
            ["external_id"] = $"P00000{n}",
            ["alterado_em"] = alterado,
            ["ativo"] = true,
            ["sku"] = $"REF-000{n}",
            ["nome"] = nome,
            ["unidade"] = "UN",
            ["preco_venda_cents"] = 500 + n * 100,
        };

        static JsonNode Preco(string produtoId, int cents, string alterado) => new JsonObject
        {
            ["external_id"] = $"TAB01:{produtoId}",
            ["alterado_em"] = alterado,
            ["ativo"] = true,
            ["tabela_external_id"] = "TAB01",
            ["tabela_nome"] = "Tabela Atacado",
            ["vigencia_inicio"] = "2026-11-01",
            ["produto_external_id"] = produtoId,
            ["preco_cents"] = cents,
            ["unidade"] = "UN",
        };

        _dados = new Dictionary<string, List<JsonNode>>
        {
            ["produto"] = new()
            {
                Produto(1, "Refrigerante Cola 2 L", T(0)), Produto(2, "Suco de Laranja 1 L", T(0)),
                Produto(3, "Agua Mineral 500 mL", T(1)), Produto(4, "Biscoito Recheado", T(1)),
                Produto(5, "Macarrao Espaguete", T(2)), Produto(6, "Arroz Tipo 1 5 kg", T(2)),
                Produto(7, "Feijao Carioca 1 kg", T(3)),
            },
            ["preco"] = new()
            {
                Preco("P000099", 1250, T(0)), // produto ainda nao enviado: o Hub devolve referencia_ausente (reprocessavel)
                Preco("P000098", -50, T(0)),  // negativo: o cliente NAO envia, registra em linhas_invalidas (corrigir na origem)
                Preco("P000001", 790, T(2)), Preco("P000002", 650, T(3)), Preco("P000003", 300, T(3)),
            },
        };
    }

    /// <summary>Leitura por keyset: ordenada por (alterado_em, external_id) e so o que e maior que o cursor.</summary>
    public Func<Cursor?, int, Task<List<JsonNode>>> LerPagina(string entidade) => (cursor, limite) =>
    {
        var linhas = _dados[entidade]
            .Where(r => cursor is null || Util.CompararCursor(Util.CursorDe(r), cursor) > 0)
            .ToList();
        linhas.Sort((a, b) => Util.CompararCursor(Util.CursorDe(a), Util.CursorDe(b)));
        return Task.FromResult(linhas.Take(limite).Select(r => r.DeepClone()).ToList());
    };

    /// <summary>Validacao local de uma linha do ERP antes de enviar (dado que o Hub recusaria de qualquer jeito).</summary>
    public static ProblemaLinha? ValidarPreco(JsonNode r) =>
        r["preco_cents"]!.GetValue<int>() < 0
            ? new ProblemaLinha("valor_fora_da_faixa", "preco_cents", "preco_cents esta negativo no ERP.")
            : null;

    /// <summary>Grava uma unica vez por pedido_uuid: repetir a chamada devolve o mesmo numero (idempotente).</summary>
    public Task<string> GravarPedidoAsync(JsonNode pedido)
    {
        var uuid = pedido["pedido_uuid"]!.GetValue<string>();
        if (!PedidosGravados.ContainsKey(uuid))
            PedidosGravados[uuid] = $"PV-{4500 + PedidosGravados.Count + 12:D6}";
        return Task.FromResult(PedidosGravados[uuid]);
    }
}
