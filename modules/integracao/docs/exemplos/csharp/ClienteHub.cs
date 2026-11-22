// T-0108 - Cliente da API do Hub (/integracao/v1) em .NET 8 (HttpClient + System.Text.Json), sem pacote externo.
//
// Segue o guia da API (PDF em GET /integracao/v1/guia.pdf):
//   - Idempotency-Key = SHA-256 do conteudo estavel do lote, SEMPRE a mesma ao repetir (rede, 429, 500, 503, com Retry-After);
//   - recusa de envelope (400/409/413/422/426) vira RecusaLoteException e NAO e repetida;
//   - delta paginado por cursor (keyset) e carga completa em partes de uma mesma sessao;
//   - devolucao de pedidos idempotente por pedido_uuid.
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Macuxi.Hub.Exemplos;

/// <summary>Configuracao lida do ambiente (a chave nunca e impressa nem aparece em mensagem).</summary>
public sealed record ConfigHub(string Url, string Chave, string ConectorId, string? ConectorVersao, int IntervaloMs)
{
    public const string UrlPadrao = "https://api.macuxifdv.com.br/integracao/v1";
    private static readonly Regex ReChave = new("^mxc_[A-Za-z0-9_-]{43}$", RegexOptions.Compiled);

    public override string ToString() => $"ConfigHub {{ Url = {Url}, ConectorId = {ConectorId} }}"; // sem a chave

    public static ConfigHub LerDoAmbiente()
    {
        var url = (Environment.GetEnvironmentVariable("MACUXI_HUB_URL") ?? UrlPadrao).TrimEnd('/');
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            throw new ArgumentException("MACUXI_HUB_URL nao e uma URL valida.");
        var local = uri.Host is "localhost" or "127.0.0.1" or "[::1]";
        if (uri.Scheme != "https" && !(local && uri.Scheme == "http"))
            throw new ArgumentException("MACUXI_HUB_URL precisa ser https:// (http so e aceito para localhost/127.0.0.1).");

        var chave = Environment.GetEnvironmentVariable("MACUXI_CHAVE") ?? "";
        if (!ReChave.IsMatch(chave))
            throw new ArgumentException("MACUXI_CHAVE ausente ou fora do formato esperado (mxc_ seguido de 43 caracteres). Peca uma chave ao administrador no BKO.");

        var conector = Environment.GetEnvironmentVariable("MACUXI_CONECTOR");
        var versao = Environment.GetEnvironmentVariable("MACUXI_CONECTOR_VERSAO");
        var intervalo = int.TryParse(Environment.GetEnvironmentVariable("MACUXI_INTERVALO_MS"), NumberStyles.None, CultureInfo.InvariantCulture, out var ms) ? ms : 5000;
        return new ConfigHub(url, chave, string.IsNullOrEmpty(conector) ? "erp-matriz" : conector, string.IsNullOrEmpty(versao) ? null : versao, intervalo);
    }
}

/// <summary>Um erro por linha do resultado do lote.</summary>
public sealed record ErroLinha(int Indice, string? ExternalId, string Codigo, string? Campo, string Mensagem, bool Reprocessavel, string? Origem);

/// <summary>Item de <c>erros[]</c> de uma recusa (codigo, campo, mensagem).</summary>
public sealed record ItemRecusa(string Codigo, string? Campo, string Mensagem);

/// <summary>Cursor do Hub ou do ERP: o maior par (alterado_em, external_id).</summary>
public sealed record Cursor(string AlteradoEm, string ExternalId);

/// <summary>Linha que o ERP nao consegue mandar (vai em <c>linhas_invalidas</c>, sem o valor).</summary>
public sealed record ProblemaLinha(string Codigo, string? Campo, string Mensagem);

/// <summary>Resposta de uma chamada: status, cabecalhos e corpo JSON (ou null).</summary>
public sealed record RespostaHub(int Status, HttpResponseHeaders Cabecalhos, JsonNode? Corpo);

/// <summary>Resultado de um lote enviado e consultado ate o fim.</summary>
public sealed record LoteProcessado(JsonObject Envelope, JsonNode Aceito, string Chave, bool Repetido, JsonNode Resultado)
{
    public string Status => Resultado["status"]!.GetValue<string>();

    public IReadOnlyList<ErroLinha> Erros =>
        (Resultado["erros"]?.AsArray() ?? new JsonArray()).Select(e => new ErroLinha(
            e!["indice"]!.GetValue<int>(),
            e["external_id"]?.GetValue<string>(),
            e["codigo"]!.GetValue<string>(),
            e["campo"]?.GetValue<string>(),
            e["mensagem"]!.GetValue<string>(),
            e["reprocessavel"]!.GetValue<bool>(),
            e["origem"]?.GetValue<string>())).ToList();

    /// <summary>O Hub reprocessa sozinho quando o alvo chegar (referencia_ausente, falha_processamento).</summary>
    public IEnumerable<ErroLinha> Reprocessaveis => Erros.Where(e => e.Reprocessavel);

    /// <summary>Dado fora do contrato: corrigir no ERP e reenviar o registro com alterado_em atualizado.</summary>
    public IEnumerable<ErroLinha> CorrigirNaOrigem => Erros.Where(e => !e.Reprocessavel);
}

/// <summary>Erro devolvido pelo Hub: corpo { codigo, mensagem, detalhes?, requisicao_id }.</summary>
public class ErroHubException : Exception
{
    public int Status { get; }
    public string Codigo { get; }
    public string? RequisicaoId { get; }
    public IReadOnlyList<ItemRecusa> Erros { get; }

    public ErroHubException(int status, string codigo, string mensagem, string? requisicaoId = null, IReadOnlyList<ItemRecusa>? erros = null)
        : base($"{status} {codigo}: {mensagem}")
    {
        Status = status;
        Codigo = codigo;
        RequisicaoId = requisicaoId;
        Erros = erros ?? Array.Empty<ItemRecusa>();
    }
}

/// <summary>Recusa de envelope em POST /lotes (nenhum lote foi criado): corrija o envelope; repetir igual da o mesmo erro.</summary>
public sealed class RecusaLoteException : ErroHubException
{
    public RecusaLoteException(int status, string codigo, string mensagem, string? requisicaoId, IReadOnlyList<ItemRecusa> erros)
        : base(status, codigo, mensagem, requisicaoId, erros) { }
}

/// <summary>O ERP recusou o pedido de forma definitiva (vira o retorno rejeitado_erp).</summary>
public sealed class RejeicaoErpException : Exception
{
    public RejeicaoErpException(string mensagem) : base(mensagem) { }
}

/// <summary>Seu acesso ao ERP: troque pela implementacao real (SQL, API do ERP...).</summary>
public interface IErp
{
    /// <summary>Grava o pedido UMA vez por pedido_uuid (guarde o UUID na tabela do ERP) e devolve o numero do pedido no ERP.</summary>
    Task<string> GravarPedidoAsync(JsonNode pedido);
}

/// <summary>Resumo da devolucao de pedidos.</summary>
public sealed record ResumoPedidos(int Rodadas, int Integrados, int Rejeitados, int Repetidos, IReadOnlyList<string> Definitivos, IReadOnlyList<string> Descartados);

public static class Util
{
    /// <summary>Ordem do cursor: alterado_em por instante e, no empate, external_id em ordem de bytes (nao por idioma).</summary>
    public static int CompararCursor(Cursor a, Cursor b)
    {
        var ta = DateTimeOffset.Parse(a.AlteradoEm, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
        var tb = DateTimeOffset.Parse(b.AlteradoEm, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
        var c = ta.CompareTo(tb);
        if (c != 0) return Math.Sign(c);
        return Math.Sign(Encoding.UTF8.GetBytes(a.ExternalId).AsSpan().SequenceCompareTo(Encoding.UTF8.GetBytes(b.ExternalId)));
    }

    public static Cursor CursorDe(JsonNode registro) =>
        new(registro["alterado_em"]!.GetValue<string>(), registro["external_id"]!.GetValue<string>());

    public static Cursor? MaiorCursor(IEnumerable<JsonNode> registros)
    {
        Cursor? maior = null;
        foreach (var r in registros)
        {
            var par = CursorDe(r);
            if (maior is null || CompararCursor(par, maior) > 0) maior = par;
        }
        return maior;
    }

    public static string Agora() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    /// <summary>JSON canonico (chaves em ordem ordinal) para o hash de idempotencia.</summary>
    public static string Canonico(JsonNode? no)
    {
        switch (no)
        {
            case null:
                return "null";
            case JsonObject o:
                return "{" + string.Join(",", o
                    .OrderBy(p => p.Key, StringComparer.Ordinal)
                    .Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonico(p.Value))) + "}";
            case JsonArray a:
                return "[" + string.Join(",", a.Select(Canonico)) + "]";
            default:
                return no.ToJsonString();
        }
    }

    /// <summary>
    /// Idempotency-Key do lote: SHA-256 hexadecimal das partes estaveis do envelope. enviado_em, cursor, conector_id e
    /// versao_conector ficam de fora, como no Hub: remontar o lote depois nao gera conflito (409).
    /// </summary>
    public static string ChaveIdempotencia(JsonObject envelope)
    {
        var estavel = new JsonObject
        {
            ["versao_contrato"] = envelope["versao_contrato"]?.DeepClone(),
            ["entidade"] = envelope["entidade"]?.DeepClone(),
            ["modo"] = envelope["modo"]?.DeepClone(),
            ["sessao"] = envelope["sessao"]?.DeepClone(),
            ["registros"] = envelope["registros"]?.DeepClone(),
            ["linhas_invalidas"] = envelope["linhas_invalidas"]?.DeepClone() ?? new JsonArray(),
            ["linhas_invalidas_omitidas"] = envelope["linhas_invalidas_omitidas"]?.DeepClone() ?? JsonValue.Create(0),
        };
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(Canonico(estavel)));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

public sealed class ClienteHub
{
    private const int LimiteLote = 5000;
    private static readonly int[] StatusRecusaLote = { 400, 409, 413, 422, 426 };
    private static readonly string[] StatusFinais = { "concluido", "concluido_com_erros", "falhou" };

    private readonly HttpClient _http;
    private readonly string _url;
    private readonly string _chave; // nunca e impressa
    private readonly string _conectorId;
    private readonly string? _conectorVersao;
    private readonly TimeSpan _intervalo;
    private readonly int _maxTentativas;
    private readonly Func<TimeSpan, Task> _esperar;
    private readonly Action<string> _log;

    public ClienteHub(ConfigHub cfg, HttpClient? http = null, int maxTentativas = 5, Func<TimeSpan, Task>? esperar = null, Action<string>? log = null)
    {
        _url = cfg.Url.TrimEnd('/');
        _chave = cfg.Chave;
        _conectorId = cfg.ConectorId;
        _conectorVersao = cfg.ConectorVersao;
        _intervalo = TimeSpan.FromMilliseconds(cfg.IntervaloMs);
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _maxTentativas = maxTentativas;
        _esperar = esperar ?? (d => Task.Delay(d));
        _log = log ?? (_ => { });
    }

    public override string ToString() => $"ClienteHub {{ Url = {_url}, ConectorId = {_conectorId} }}"; // sem a chave

    private HttpRequestMessage Montar(HttpMethod metodo, string caminho, JsonNode? corpo, string? chaveIdempotencia)
    {
        var req = new HttpRequestMessage(metodo, _url + caminho);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _chave);
        req.Headers.Add("X-Macuxi-Conector-Id", _conectorId);
        // Opcional: sem versao informada o cabecalho nao vai (uma versao antiga leva 426).
        if (_conectorVersao is not null) req.Headers.Add("X-Macuxi-Conector-Versao", _conectorVersao);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (chaveIdempotencia is not null) req.Headers.Add("Idempotency-Key", chaveIdempotencia);
        if (corpo is not null) req.Content = new StringContent(corpo.ToJsonString(), new UTF8Encoding(false), "application/json");
        return req;
    }

    /// <summary>
    /// Uma chamada com repeticao em erro de rede, 429, 500 e 503 (Retry-After), SEMPRE com o mesmo conteudo e a mesma
    /// Idempotency-Key. Qualquer outra resposta volta como esta.
    /// </summary>
    public async Task<RespostaHub> RequisitarAsync(HttpMethod metodo, string caminho, JsonNode? corpo = null, string? chaveIdempotencia = null)
    {
        ErroHubException? ultima = null;
        for (var tentativa = 1; tentativa <= _maxTentativas; tentativa++)
        {
            HttpResponseMessage resp;
            try
            {
                using var req = Montar(metodo, caminho, corpo, chaveIdempotencia);
                resp = await _http.SendAsync(req);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
            {
                ultima = new ErroHubException(0, "rede", $"Falha de rede ({e.GetType().Name}). Verifique a conexao e o endereco do Hub.");
                if (tentativa < _maxTentativas) await AguardarRepeticaoAsync(tentativa, null, "falha de rede");
                continue;
            }

            using (resp)
            {
                var texto = await resp.Content.ReadAsStringAsync();
                JsonNode? lido = null;
                if (!string.IsNullOrWhiteSpace(texto))
                {
                    try { lido = JsonNode.Parse(texto); } catch (JsonException) { lido = null; }
                }

                var status = (int)resp.StatusCode;
                if (status is 429 or 500 or 503)
                {
                    ultima = new ErroHubException(status, lido?["codigo"]?.GetValue<string>() ?? "erro_transitorio",
                        lido?["mensagem"]?.GetValue<string>() ?? "Hub indisponivel no momento.", lido?["requisicao_id"]?.GetValue<string>());
                    if (tentativa < _maxTentativas) await AguardarRepeticaoAsync(tentativa, resp.Headers.RetryAfter, $"HTTP {status}");
                    continue;
                }
                return new RespostaHub(status, resp.Headers, lido);
            }
        }
        throw ultima!;
    }

    private async Task AguardarRepeticaoAsync(int tentativa, RetryConditionHeaderValue? retryAfter, string motivo)
    {
        var espera = TimeSpan.FromSeconds(Math.Pow(2, tentativa - 1)); // espera crescente quando nao ha Retry-After
        if (retryAfter?.Delta is { } delta) espera = delta;
        else if (retryAfter?.Date is { } data) espera = data - DateTimeOffset.UtcNow;
        if (espera < TimeSpan.Zero) espera = TimeSpan.Zero;
        if (espera > TimeSpan.FromMinutes(1)) espera = TimeSpan.FromMinutes(1);
        _log($"  repetindo em {(int)espera.TotalMilliseconds} ms ({motivo}; tentativa {tentativa} de {_maxTentativas}), mesma requisicao");
        await _esperar(espera);
    }

    private static ErroHubException ParaErro(RespostaHub r, bool recusaLote = false)
    {
        var c = r.Corpo;
        var codigo = c?["codigo"]?.GetValue<string>() ?? "erro_http";
        var mensagem = c?["mensagem"]?.GetValue<string>() ?? $"Resposta inesperada do Hub (HTTP {r.Status}).";
        var reqId = c?["requisicao_id"]?.GetValue<string>();
        var erros = (c?["erros"]?.AsArray() ?? new JsonArray())
            .Select(e => new ItemRecusa(e!["codigo"]!.GetValue<string>(), e["campo"]?.GetValue<string>(), e["mensagem"]!.GetValue<string>()))
            .ToList();
        if (erros.Count == 0) erros.Add(new ItemRecusa(codigo, null, mensagem));
        return recusaLote ? new RecusaLoteException(r.Status, codigo, mensagem, reqId, erros) : new ErroHubException(r.Status, codigo, mensagem, reqId, erros);
    }

    private static JsonNode ExigirSucesso(RespostaHub r)
    {
        if (r.Status == 200 && r.Corpo is not null) return r.Corpo;
        throw ParaErro(r);
    }

    /// <summary>GET /cursores/{entidade}: o cursor e nulo antes da primeira carga (carga inicial completa).</summary>
    public async Task<Cursor?> ConsultarCursorAsync(string entidade)
    {
        var corpo = ExigirSucesso(await RequisitarAsync(HttpMethod.Get, $"/cursores/{Uri.EscapeDataString(entidade)}"));
        var c = corpo["cursor"];
        return c is null ? null : new Cursor(c["alterado_em"]!.GetValue<string>(), c["external_id"]!.GetValue<string>());
    }

    /// <summary>POST /lotes com a Idempotency-Key do conteudo. Recusas de envelope viram RecusaLoteException, sem repetir.</summary>
    public async Task<(JsonNode Aceito, string Chave, bool Repetido)> EnviarLoteAsync(JsonObject envelope)
    {
        var chave = Util.ChaveIdempotencia(envelope);
        var r = await RequisitarAsync(HttpMethod.Post, "/lotes", envelope, chave);
        if (r.Status == 202 && r.Corpo is not null)
        {
            var repetido = r.Corpo["repetido"]?.GetValue<bool>() == true
                || (r.Cabecalhos.TryGetValues("Idempotent-Replay", out var v) && v.Contains("true"));
            return (r.Corpo, chave, repetido);
        }
        throw ParaErro(r, recusaLote: Array.IndexOf(StatusRecusaLote, r.Status) >= 0);
    }

    /// <summary>GET /lotes/{id} ate o status final, esperando o intervalo configurado entre as consultas.</summary>
    public async Task<JsonNode> AguardarLoteAsync(string loteId, int limiteErros = 1000, int maxConsultas = 1000)
    {
        for (var i = 0; i < maxConsultas; i++)
        {
            var resultado = ExigirSucesso(await RequisitarAsync(HttpMethod.Get, $"/lotes/{loteId}?limite_erros={limiteErros}"));
            if (Array.IndexOf(StatusFinais, resultado["status"]!.GetValue<string>()) >= 0) return resultado;
            await _esperar(_intervalo);
        }
        throw new InvalidOperationException($"O lote {loteId} nao terminou depois de {maxConsultas} consultas.");
    }

    private JsonObject MontarEnvelope(string entidade, string modo, List<JsonNode> registros, JsonObject? sessao = null, List<JsonObject>? linhasInvalidas = null)
    {
        var envelope = new JsonObject { ["versao_contrato"] = "v1", ["entidade"] = entidade, ["modo"] = modo };
        if (sessao is not null) envelope["sessao"] = sessao;
        var cursor = Util.MaiorCursor(registros);
        if (cursor is not null) envelope["cursor"] = new JsonObject { ["alterado_em"] = cursor.AlteradoEm, ["external_id"] = cursor.ExternalId };
        envelope["enviado_em"] = Util.Agora();
        envelope["conector_id"] = _conectorId;
        if (_conectorVersao is not null) envelope["versao_conector"] = _conectorVersao;
        envelope["registros"] = new JsonArray(registros.ToArray());
        if (linhasInvalidas is { Count: > 0 }) envelope["linhas_invalidas"] = new JsonArray(linhasInvalidas.Cast<JsonNode?>().ToArray());
        return envelope;
    }

    public async Task<LoteProcessado> EnviarEAguardarAsync(JsonObject envelope)
    {
        var (aceito, chave, repetido) = await EnviarLoteAsync(envelope);
        var resultado = await AguardarLoteAsync(aceito["lote_id"]!.GetValue<string>());
        if (resultado["status"]!.GetValue<string>() == "falhou")
            throw new InvalidOperationException($"O lote {resultado["lote_id"]} falhou no Hub. Reenvie o mesmo lote (mesma Idempotency-Key) ou informe o suporte.");
        return new LoteProcessado(envelope, aceito, chave, repetido, resultado);
    }

    /// <summary>
    /// Delta paginado por cursor (keyset). lerPagina(cursor, limite) le do ERP, ORDENADO, so o que e maior que o cursor
    /// (alterado_em, external_id); validar(registro) devolve null ou o problema (vai em linhas_invalidas, sem o valor).
    /// Um lote por pagina, ate 5.000 registros.
    /// </summary>
    public async Task<List<LoteProcessado>> EnviarDeltaAsync(string entidade, Func<Cursor?, int, Task<List<JsonNode>>> lerPagina,
        Cursor? cursor = null, int tamanhoPagina = LimiteLote, Func<JsonNode, ProblemaLinha?>? validar = null)
    {
        if (tamanhoPagina is < 1 or > LimiteLote) throw new ArgumentOutOfRangeException(nameof(tamanhoPagina), $"Use de 1 a {LimiteLote}.");
        var lotes = new List<LoteProcessado>();
        var atual = cursor;
        while (true)
        {
            var pagina = await lerPagina(atual, tamanhoPagina);
            if (pagina.Count == 0) break;
            var validos = new List<JsonNode>();
            var invalidas = new List<JsonObject>();
            foreach (var r in pagina)
            {
                var problema = validar?.Invoke(r);
                if (problema is null) { validos.Add(r); continue; }
                var linha = new JsonObject { ["external_id"] = r["external_id"]?.GetValue<string>(), ["codigo"] = problema.Codigo };
                if (problema.Campo is not null) linha["campo"] = problema.Campo;
                linha["mensagem"] = problema.Mensagem;
                invalidas.Add(linha);
            }
            lotes.Add(await EnviarEAguardarAsync(MontarEnvelope(entidade, "delta", validos, linhasInvalidas: invalidas)));
            // O cursor local anda com a pagina inteira; o do Hub so avanca com o que ele aceitou.
            atual = Util.MaiorCursor(pagina);
            if (pagina.Count < tamanhoPagina) break;
        }
        return lotes;
    }

    /// <summary>
    /// Carga completa em partes de uma mesma sessao (id UUID, parte 1..n, ultimo=true so na ultima). Olha a pagina seguinte antes
    /// de enviar a atual para saber qual e a ultima.
    /// </summary>
    public async Task<List<LoteProcessado>> EnviarCompletoAsync(string entidade, Func<Cursor?, int, Task<List<JsonNode>>> lerPagina, int tamanhoParte = LimiteLote)
    {
        if (tamanhoParte is < 1 or > LimiteLote) throw new ArgumentOutOfRangeException(nameof(tamanhoParte), $"Use de 1 a {LimiteLote}.");
        var sessaoId = Guid.NewGuid().ToString();
        var partes = new List<LoteProcessado>();
        var atual = await lerPagina(null, tamanhoParte);
        for (var numero = 1; atual.Count > 0; numero++)
        {
            var proxima = atual.Count == tamanhoParte ? await lerPagina(Util.MaiorCursor(atual), tamanhoParte) : new List<JsonNode>();
            var sessao = new JsonObject { ["id"] = sessaoId, ["parte"] = numero, ["ultimo"] = proxima.Count == 0 };
            partes.Add(await EnviarEAguardarAsync(MontarEnvelope(entidade, "completo", atual, sessao)));
            atual = proxima;
        }
        return partes;
    }

    /// <summary>GET /pedidos/pendentes: o Hub ja marca os pedidos como enviados (tentativa + 1).</summary>
    public async Task<List<JsonNode>> BuscarPendentesAsync(int limite = 50)
    {
        var corpo = ExigirSucesso(await RequisitarAsync(HttpMethod.Get, $"/pedidos/pendentes?limite={limite}"));
        return corpo["pedidos"]!.AsArray().Select(p => p!).ToList();
    }

    /// <summary>POST /pedidos/{uuid}/retorno. 400/422 sao definitivos (ErroHubException); nao reenvie igual.</summary>
    public async Task<JsonNode> DevolverRetornoAsync(string pedidoUuid, JsonObject retorno) =>
        ExigirSucesso(await RequisitarAsync(HttpMethod.Post, $"/pedidos/{pedidoUuid}/retorno", retorno));

    /// <summary>
    /// Busca ate a lista vir vazia; para cada pedido grava no ERP (idempotente por pedido_uuid) e devolve o retorno
    /// integrado com o numero_erp. RejeicaoErpException vira rejeitado_erp; 422 do Hub e definitivo e nao e reenviado.
    /// </summary>
    public async Task<ResumoPedidos> ProcessarPedidosAsync(IErp erp, int limite = 50, int maxRodadas = 1000)
    {
        int rodadas = 0, integrados = 0, rejeitados = 0, repetidos = 0;
        var definitivos = new List<string>();
        var descartados = new List<string>();
        for (var i = 0; i < maxRodadas; i++)
        {
            var pedidos = await BuscarPendentesAsync(limite);
            if (pedidos.Count == 0) break;
            rodadas++;
            foreach (var pedido in pedidos)
            {
                var uuid = pedido["pedido_uuid"]!.GetValue<string>();
                var retorno = new JsonObject { ["versao_contrato"] = "v1", ["pedido_uuid"] = uuid };
                try
                {
                    retorno["status"] = "integrado";
                    retorno["numero_erp"] = await erp.GravarPedidoAsync(pedido);
                }
                catch (RejeicaoErpException e)
                {
                    retorno = new JsonObject { ["versao_contrato"] = "v1", ["pedido_uuid"] = uuid, ["status"] = "rejeitado_erp", ["motivo"] = e.Message.Length > 300 ? e.Message[..300] : e.Message };
                }
                retorno["ocorrido_em"] = Util.Agora();

                try
                {
                    var aceito = await DevolverRetornoAsync(uuid, retorno);
                    if (aceito["repetido"]?.GetValue<bool>() == true) repetidos++;
                    else if (retorno["status"]!.GetValue<string>() == "integrado") integrados++;
                    else rejeitados++;
                    foreach (var d in aceito["itens_descartados"]?.AsArray() ?? new JsonArray())
                        descartados.Add($"{uuid}: {d!["codigo"]} em {d["campo"]}");
                }
                catch (ErroHubException e) when (e.Status == 422)
                {
                    // 422 e definitivo (pedido_desconhecido, pedido_nao_entregue, transicao_invalida, numero_erp_divergente).
                    definitivos.Add($"{uuid}: {e.Codigo}");
                }
            }
        }
        return new ResumoPedidos(rodadas, integrados, rejeitados, repetidos, definitivos, descartados);
    }
}
