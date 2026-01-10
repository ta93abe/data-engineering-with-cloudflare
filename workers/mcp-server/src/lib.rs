use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use worker::*;

// JSON-RPC 2.0 エラーコード定数
const PARSE_ERROR: i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS: i32 = -32602;
const INTERNAL_ERROR: i32 = -32603;

/// JSON-RPC 2.0リクエスト構造体
#[derive(Deserialize, Debug)]
struct MCPRequest {
    jsonrpc: String,
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0レスポンス構造体
#[derive(Serialize, Debug)]
struct MCPResponse {
    jsonrpc: String,
    id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<MCPError>,
}

/// MCPエラー構造体
#[derive(Serialize, Debug)]
struct MCPError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

/// ツール定義
#[derive(Serialize, Debug)]
struct Tool {
    name: String,
    description: String,
    #[serde(rename = "inputSchema")]
    input_schema: serde_json::Value,
}

/// リソース定義
#[derive(Serialize, Debug)]
struct Resource {
    uri: String,
    name: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

/// リソースコンテンツ
#[derive(Serialize, Debug)]
struct ResourceContent {
    uri: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    text: String,
}

#[event(fetch, respond_with_errors)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    // パニック時のログ改善
    console_error_panic_hook::set_once();

    let router = Router::new();

    router
        // ヘルスチェック
        .get("/health", |_, _| Response::ok("MCP Server is running"))

        // MCPエンドポイント（JSON-RPC 2.0）
        .post_async("/mcp", |mut req, ctx| async move {
            handle_mcp_request(&mut req, &ctx).await
        })

        // サーバー情報
        .get("/info", |_, _| {
            Response::from_json(&serde_json::json!({
                "name": "Cloudflare MCP Server",
                "version": "0.1.0",
                "protocol": "MCP/2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {}
                }
            }))
        })

        .run(req, env)
        .await
}

/// MCPリクエストハンドラー
async fn handle_mcp_request(req: &mut Request, ctx: &RouteContext<()>) -> Result<Response> {
    // リクエストボディをパース
    let mcp_req: MCPRequest = match req.json().await {
        Ok(r) => r,
        Err(e) => {
            console_error!("Parse error: {}", e);
            return create_error_response(
                None,
                PARSE_ERROR,
                "Parse error: Invalid JSON".to_string(),
                None,
            );
        }
    };

    console_log!("MCP Request: method={}, id={:?}", mcp_req.method, mcp_req.id);

    // メソッドに応じた処理
    match mcp_req.method.as_str() {
        "initialize" => match handle_initialize(ctx).await {
            Ok(data) => create_success_response(mcp_req.id, data),
            Err(e) => {
                console_error!("Initialize error: {:?}", e);
                create_error_response(mcp_req.id, INTERNAL_ERROR, "Internal server error".to_string(), None)
            }
        },
        "tools/list" => match handle_tools_list(ctx).await {
            Ok(data) => create_success_response(mcp_req.id, data),
            Err(e) => {
                console_error!("Tools list error: {:?}", e);
                create_error_response(mcp_req.id, INTERNAL_ERROR, "Internal server error".to_string(), None)
            }
        },
        "tools/call" => match handle_tools_call(ctx, mcp_req.params).await {
            Ok(data) => create_success_response(mcp_req.id, data),
            Err(e) => {
                let error_msg = format!("{:?}", e);
                console_error!("Tools call error: {}", error_msg);
                // パラメータエラーかどうかを判定
                let (code, msg) = if error_msg.contains("Missing") || error_msg.contains("must be") {
                    (INVALID_PARAMS, error_msg)
                } else {
                    (INTERNAL_ERROR, "Internal server error".to_string())
                };
                create_error_response(mcp_req.id, code, msg, None)
            }
        },
        "resources/list" => match handle_resources_list(ctx).await {
            Ok(data) => create_success_response(mcp_req.id, data),
            Err(e) => {
                console_error!("Resources list error: {:?}", e);
                create_error_response(mcp_req.id, INTERNAL_ERROR, "Internal server error".to_string(), None)
            }
        },
        "resources/read" => match handle_resources_read(ctx, mcp_req.params).await {
            Ok(data) => create_success_response(mcp_req.id, data),
            Err(e) => {
                console_error!("Resources read error: {:?}", e);
                create_error_response(mcp_req.id, INTERNAL_ERROR, "Internal server error".to_string(), None)
            }
        },
        _ => {
            console_log!("Unknown method: {}", mcp_req.method);
            create_error_response(
                mcp_req.id,
                METHOD_NOT_FOUND,
                format!("Method not found: {}", mcp_req.method),
                None,
            )
        }
    }
}

/// 初期化ハンドラー
async fn handle_initialize(_ctx: &RouteContext<()>) -> Result<serde_json::Value> {
    Ok(serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {},
            "resources": {}
        },
        "serverInfo": {
            "name": "cloudflare-mcp-server",
            "version": "0.1.0"
        }
    }))
}

/// ツール一覧ハンドラー
async fn handle_tools_list(_ctx: &RouteContext<()>) -> Result<serde_json::Value> {
    let tools = vec![
        Tool {
            name: "kv-get".to_string(),
            description: "Workers KVストアから値を取得".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "取得するキー"
                    }
                },
                "required": ["key"]
            }),
        },
        Tool {
            name: "kv-put".to_string(),
            description: "Workers KVストアに値を保存".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "保存するキー"
                    },
                    "value": {
                        "type": "string",
                        "description": "保存する値"
                    },
                    "expirationTtl": {
                        "type": "number",
                        "description": "有効期限（秒、60〜31536000）"
                    }
                },
                "required": ["key", "value"]
            }),
        },
        Tool {
            name: "d1-query".to_string(),
            description: "D1データベースにSELECTクエリを実行（読み取り専用）".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "実行するSELECTクエリ（SELECT文のみ許可）"
                    },
                    "params": {
                        "type": "array",
                        "description": "SQLパラメータ（プレースホルダー用）",
                        "items": {
                            "type": ["string", "number", "boolean", "null"]
                        }
                    }
                },
                "required": ["sql"]
            }),
        },
        Tool {
            name: "r2-get".to_string(),
            description: "R2バケットからオブジェクトを取得（バイナリはBase64エンコード）".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "取得するオブジェクトのキー"
                    }
                },
                "required": ["key"]
            }),
        },
        Tool {
            name: "r2-put".to_string(),
            description: "R2バケットにオブジェクトを保存".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "保存するオブジェクトのキー"
                    },
                    "data": {
                        "type": "string",
                        "description": "保存するデータ（テキストまたはBase64エンコード）"
                    },
                    "contentType": {
                        "type": "string",
                        "description": "コンテンツタイプ"
                    },
                    "isBase64": {
                        "type": "boolean",
                        "description": "dataがBase64エンコードされているかどうか"
                    }
                },
                "required": ["key", "data"]
            }),
        },
        Tool {
            name: "r2-list".to_string(),
            description: "R2バケット内のオブジェクト一覧を取得".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prefix": {
                        "type": "string",
                        "description": "フィルタするプレフィックス"
                    },
                    "limit": {
                        "type": "number",
                        "description": "最大取得件数（1〜1000、デフォルト100）"
                    }
                }
            }),
        },
    ];

    Ok(serde_json::json!({
        "tools": tools
    }))
}

/// ツール実行ハンドラー
async fn handle_tools_call(
    ctx: &RouteContext<()>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    let params = params.ok_or(Error::RustError("Missing params".to_string()))?;
    let name = params["name"]
        .as_str()
        .ok_or(Error::RustError("Missing tool name".to_string()))?;
    let arguments = params.get("arguments").unwrap_or(&serde_json::json!({}));

    // arguments がオブジェクトであることを検証
    if !arguments.is_object() {
        return Err(Error::RustError("'arguments' parameter must be an object".to_string()));
    }

    console_log!("Calling tool: {} with args: {:?}", name, arguments);

    match name {
        "kv-get" => tool_kv_get(ctx, arguments).await,
        "kv-put" => tool_kv_put(ctx, arguments).await,
        "d1-query" => tool_d1_query(ctx, arguments).await,
        "r2-get" => tool_r2_get(ctx, arguments).await,
        "r2-put" => tool_r2_put(ctx, arguments).await,
        "r2-list" => tool_r2_list(ctx, arguments).await,
        _ => Err(Error::RustError(format!("Unknown tool: {}", name))),
    }
}

/// KV取得ツール
async fn tool_kv_get(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let key = args["key"]
        .as_str()
        .ok_or(Error::RustError("Missing 'key' parameter".to_string()))?;

    let kv = ctx.kv("DATA")?;
    let value = kv.get(key).text().await?;

    match value {
        Some(v) => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": v
            }],
            "found": true
        })),
        None => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": format!("Key '{}' not found", key)
            }],
            "found": false
        })),
    }
}

/// KV保存ツール
async fn tool_kv_put(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let key = args["key"]
        .as_str()
        .ok_or(Error::RustError("Missing 'key' parameter".to_string()))?;
    let value = args["value"]
        .as_str()
        .ok_or(Error::RustError("Missing 'value' parameter".to_string()))?;

    let kv = ctx.kv("DATA")?;
    let mut put_builder = kv.put(key, value)?;

    // TTLが指定されている場合（60秒〜31536000秒の範囲でバリデーション）
    if let Some(ttl) = args.get("expirationTtl").and_then(|v| v.as_u64()) {
        if ttl < 60 || ttl > 31536000 {
            return Err(Error::RustError("expirationTtl must be between 60 and 31536000 seconds".to_string()));
        }
        put_builder = put_builder.expiration_ttl(ttl);
    }

    put_builder.execute().await?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": format!("Successfully stored key: {}", key)
        }]
    }))
}

/// D1クエリツール（SELECTのみ許可）
async fn tool_d1_query(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let sql = args["sql"]
        .as_str()
        .ok_or(Error::RustError("Missing 'sql' parameter".to_string()))?;

    // セキュリティ対策: SELECT文のみを許可
    let sql_trimmed = sql.trim();
    if !sql_trimmed.to_uppercase().starts_with("SELECT") {
        return Err(Error::RustError(
            "Security: Only SELECT queries are allowed. Use D1 dashboard for write operations.".to_string()
        ));
    }

    let d1 = ctx.env.d1("DB")?;
    let mut stmt = d1.prepare(sql);

    // パラメータがある場合はバインド
    if let Some(params) = args.get("params").and_then(|v| v.as_array()) {
        let bindings: Vec<JsValue> = params
            .iter()
            .map(|p| match p {
                serde_json::Value::String(s) => JsValue::from_str(s),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        JsValue::from_f64(i as f64)
                    } else if let Some(f) = n.as_f64() {
                        JsValue::from_f64(f)
                    } else {
                        JsValue::null()
                    }
                }
                serde_json::Value::Bool(b) => JsValue::from_bool(*b),
                _ => JsValue::null(),
            })
            .collect();
        stmt = stmt.bind(&bindings)?;
    }

    let result = stmt.all().await?;
    let rows: Vec<serde_json::Value> = result.results()?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&rows)?
        }],
        "rowCount": rows.len()
    }))
}

/// R2取得ツール（バイナリはBase64エンコード）
async fn tool_r2_get(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let key = args["key"]
        .as_str()
        .ok_or(Error::RustError("Missing 'key' parameter".to_string()))?;

    let bucket = ctx.bucket("STORAGE")?;

    match bucket.get(key).execute().await? {
        Some(object) => {
            let body = object.body().ok_or(Error::RustError("No body".to_string()))?;
            let content_type = object
                .http_metadata()
                .content_type
                .as_deref()
                .unwrap_or("application/octet-stream");

            // テキスト系のContent-Typeかどうかを判定
            let is_text = content_type.starts_with("text/")
                || content_type == "application/json"
                || content_type == "application/xml"
                || content_type.ends_with("+json")
                || content_type.ends_with("+xml");

            if is_text {
                let text = body.text().await?;
                Ok(serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": text
                    }],
                    "mimeType": content_type,
                    "size": object.size(),
                    "isBase64": false
                }))
            } else {
                // バイナリデータはBase64エンコード
                let bytes = body.bytes().await?;
                let encoded = BASE64.encode(&bytes);
                Ok(serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": encoded
                    }],
                    "mimeType": content_type,
                    "size": object.size(),
                    "isBase64": true
                }))
            }
        }
        None => Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": format!("Object '{}' not found", key)
            }],
            "found": false
        })),
    }
}

/// R2保存ツール（Base64デコード対応）
async fn tool_r2_put(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let key = args["key"]
        .as_str()
        .ok_or(Error::RustError("Missing 'key' parameter".to_string()))?;
    let data = args["data"]
        .as_str()
        .ok_or(Error::RustError("Missing 'data' parameter".to_string()))?;

    // データサイズ制限（25MB）
    const MAX_SIZE: usize = 25 * 1024 * 1024;
    if data.len() > MAX_SIZE {
        return Err(Error::RustError(format!(
            "Data size exceeds maximum allowed size of {} bytes",
            MAX_SIZE
        )));
    }

    let bucket = ctx.bucket("STORAGE")?;

    // Base64フラグがtrueの場合はデコード
    let is_base64 = args.get("isBase64").and_then(|v| v.as_bool()).unwrap_or(false);
    let data_bytes = if is_base64 {
        BASE64.decode(data).map_err(|e| {
            Error::RustError(format!("Invalid Base64 data: {}", e))
        })?
    } else {
        data.as_bytes().to_vec()
    };

    let mut put_builder = bucket.put(key, data_bytes);

    // Content-Typeが指定されている場合
    if let Some(content_type) = args.get("contentType").and_then(|v| v.as_str()) {
        put_builder = put_builder.http_metadata(HttpMetadata {
            content_type: Some(content_type.to_string()),
            ..Default::default()
        });
    }

    put_builder.execute().await?;

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": format!("Successfully stored object: {}", key)
        }]
    }))
}

/// R2一覧ツール
async fn tool_r2_list(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    let bucket = ctx.bucket("STORAGE")?;
    let mut list_builder = bucket.list();

    // プレフィックスフィルタ
    if let Some(prefix) = args.get("prefix").and_then(|v| v.as_str()) {
        list_builder = list_builder.prefix(prefix);
    }

    // 件数制限（1〜1000、デフォルト100）
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100);
    let limit = limit.clamp(1, 1000) as usize;
    list_builder = list_builder.limit(limit);

    let objects = list_builder.execute().await?;
    let object_list: Vec<serde_json::Value> = objects
        .objects()
        .iter()
        .map(|obj| {
            serde_json::json!({
                "key": obj.key(),
                "size": obj.size(),
                "uploaded": obj.uploaded().to_string()
            })
        })
        .collect();

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&object_list)?
        }],
        "count": object_list.len()
    }))
}

/// リソース一覧ハンドラー
async fn handle_resources_list(_ctx: &RouteContext<()>) -> Result<serde_json::Value> {
    let resources = vec![
        Resource {
            uri: "config://server".to_string(),
            name: "Server Configuration".to_string(),
            mime_type: "application/json".to_string(),
            description: Some("MCPサーバーの設定情報".to_string()),
        },
        Resource {
            uri: "stats://kv".to_string(),
            name: "KV Statistics".to_string(),
            mime_type: "application/json".to_string(),
            description: Some("Workers KVの統計情報".to_string()),
        },
    ];

    Ok(serde_json::json!({
        "resources": resources
    }))
}

/// リソース読み取りハンドラー
async fn handle_resources_read(
    ctx: &RouteContext<()>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    let params = params.ok_or(Error::RustError("Missing params".to_string()))?;
    let uri = params["uri"]
        .as_str()
        .ok_or(Error::RustError("Missing URI".to_string()))?;

    match uri {
        "config://server" => {
            let config = serde_json::json!({
                "name": "cloudflare-mcp-server",
                "version": "0.1.0",
                "bindings": ["DATA", "DB", "STORAGE"],
                "tools": 6,
                "resources": 2
            });

            Ok(serde_json::json!({
                "contents": [ResourceContent {
                    uri: uri.to_string(),
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&config)?
                }]
            }))
        }
        "stats://kv" => {
            // KVの統計情報を取得（簡易版）
            let kv = ctx.kv("DATA")?;
            let list = kv.list().limit(1).execute().await?;

            let stats = serde_json::json!({
                "namespace": "DATA",
                "has_keys": !list.keys.is_empty(),
                "cursor": list.cursor
            });

            Ok(serde_json::json!({
                "contents": [ResourceContent {
                    uri: uri.to_string(),
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&stats)?
                }]
            }))
        }
        _ => Err(Error::RustError(format!("Unknown resource: {}", uri))),
    }
}

/// 成功レスポンス生成
fn create_success_response(
    id: Option<serde_json::Value>,
    result: serde_json::Value,
) -> Result<Response> {
    let response = MCPResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: Some(result),
        error: None,
    };
    Response::from_json(&response)
}

/// エラーレスポンス生成
fn create_error_response(
    id: Option<serde_json::Value>,
    code: i32,
    message: String,
    data: Option<serde_json::Value>,
) -> Result<Response> {
    let response = MCPResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: None,
        error: Some(MCPError {
            code,
            message,
            data,
        }),
    };
    Response::from_json(&response)
}
