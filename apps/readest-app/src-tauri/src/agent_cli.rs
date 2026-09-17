//! Native `lumen` command-line mode and desktop installation helpers.
//!
//! The desktop binary doubles as the stdio MCP adapter when invoked with
//! `lumen mcp`. This keeps the installed command self-contained: users do not
//! need Node.js, npm, or a separately managed CLI runtime.

use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const DEFAULT_DISCOVERY_FILE: &str = "lumen-agent-bridge.json";

#[derive(Debug)]
struct RpcError {
    code: String,
    message: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliStatus {
    pub installed: bool,
    pub path: String,
}

fn discovery_path() -> PathBuf {
    std::env::var_os("LUMEN_BRIDGE_DISCOVERY")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join(DEFAULT_DISCOVERY_FILE))
}

fn credential_path() -> PathBuf {
    if let Some(path) = std::env::var_os("LUMEN_CREDENTIALS") {
        return PathBuf::from(path);
    }
    let root = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"))
    } else if cfg!(target_os = "macos") {
        home_dir().join("Library").join("Application Support")
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".config"))
    };
    root.join("lumen").join("credentials.json")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn cli_install_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData").join("Local"))
            .join("Lumen")
            .join("bin")
            .join("lumen.exe")
    } else {
        home_dir().join(".local").join("bin").join("lumen")
    }
}

fn read_token() -> Option<String> {
    if let Some(token) = std::env::var_os("LUMEN_AGENT_TOKEN") {
        return token.into_string().ok().filter(|value| !value.is_empty());
    }
    let text = fs::read_to_string(credential_path()).ok()?;
    serde_json::from_str::<Value>(&text)
        .ok()?
        .get("token")?
        .as_str()
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

fn save_token(result: &Value) -> Result<(), String> {
    let token = result
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "Lumen did not return a credential".to_string())?;
    let path = credential_path();
    let parent = path
        .parent()
        .ok_or_else(|| "invalid Lumen credential path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_vec_pretty(&json!({
        "token": token,
        "agentId": result.get("agent").and_then(|agent| agent.get("agentId")),
        "displayName": result.get("agent").and_then(|agent| agent.get("displayName")),
    }))
    .map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn bridge_port() -> Result<u16, RpcError> {
    let text = fs::read_to_string(discovery_path()).map_err(|error| RpcError {
        code: "BRIDGE_UNAVAILABLE".to_string(),
        message: format!("Lumen is not running: {error}"),
    })?;
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get("port").and_then(Value::as_u64))
        .and_then(|port| u16::try_from(port).ok())
        .ok_or_else(|| RpcError {
            code: "BRIDGE_UNAVAILABLE".to_string(),
            message: "Lumen discovery information is invalid".to_string(),
        })
}

fn http_request(
    method: &str,
    path: &str,
    body: Option<&Value>,
    token: Option<&str>,
) -> Result<Value, RpcError> {
    let port = bridge_port()?;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|error| RpcError {
        code: "BRIDGE_UNAVAILABLE".to_string(),
        message: format!("Cannot connect to Lumen: {error}"),
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(125)))
        .map_err(|error| RpcError {
            code: "BRIDGE_UNAVAILABLE".to_string(),
            message: error.to_string(),
        })?;
    let payload = body.map(|value| value.to_string()).unwrap_or_default();
    let mut request =
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    if !payload.is_empty() {
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    }
    if let Some(token) = token {
        request.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(&payload);
    stream
        .write_all(request.as_bytes())
        .map_err(|error| RpcError {
            code: "BRIDGE_UNAVAILABLE".to_string(),
            message: error.to_string(),
        })?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| RpcError {
            code: "BRIDGE_UNAVAILABLE".to_string(),
            message: error.to_string(),
        })?;
    let response = String::from_utf8_lossy(&response);
    let (header, body) = response.split_once("\r\n\r\n").ok_or_else(|| RpcError {
        code: "BRIDGE_UNAVAILABLE".to_string(),
        message: "Lumen returned an invalid HTTP response".to_string(),
    })?;
    let status = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(500);
    let value = serde_json::from_str::<Value>(body).map_err(|error| RpcError {
        code: "BRIDGE_UNAVAILABLE".to_string(),
        message: format!("Lumen returned invalid JSON: {error}"),
    })?;
    if status >= 400 {
        return Err(rpc_error(&value, status));
    }
    if let Some(error) = value.get("error") {
        return Err(RpcError {
            code: error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("INTERNAL_ERROR")
                .to_string(),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Lumen request failed")
                .to_string(),
        });
    }
    Ok(value.get("result").cloned().unwrap_or(value))
}

fn rpc_error(value: &Value, status: u16) -> RpcError {
    RpcError {
        code: value
            .get("error")
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str)
            .unwrap_or("BRIDGE_UNAVAILABLE")
            .to_string(),
        message: value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Lumen returned HTTP {status}")),
    }
}

fn rpc(method: &str, params: Value, token: Option<&str>) -> Result<Value, RpcError> {
    http_request(
        "POST",
        "/rpc",
        Some(&json!({
            "jsonrpc": "2.0",
            "id": "lumen-cli",
            "method": method,
            "params": params,
        })),
        token,
    )
}

fn tools() -> Value {
    json!([
        {"name":"lumen_system_health","description":"Check Lumen Agent Bridge health","method":"system.health"},
        {"name":"lumen_system_capabilities","description":"Discover Lumen read-only capabilities","method":"system.capabilities"},
        {"name":"lumen_reader_get_context","description":"Get the current reader context","method":"reader.get_context"},
        {"name":"lumen_reader_list_chapters","description":"List chapters in the authorized book","method":"reader.list_chapters"},
        {"name":"lumen_reader_search","description":"Search authorized reader text and return citable sources","method":"reader.search"},
        {"name":"lumen_reader_get_source","description":"Get source text for a CFI","method":"reader.get_source"},
        {"name":"lumen_annotations_list","description":"List existing annotations","method":"annotations.list"}
    ])
}

fn mcp_response(id: &Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}

fn mcp_error(id: &Value, error: RpcError) -> Value {
    json!({
        "jsonrpc":"2.0",
        "id":id,
        "error":{"code":error.code,"message":error.message,"retryable":false}
    })
}

fn mcp_tool_call(name: &str, params: Value) -> Result<Value, RpcError> {
    let tool_list = tools();
    let method = tool_list
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("name").and_then(Value::as_str) == Some(name))
        })
        .and_then(|item| item.get("method"))
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code: "INVALID_REQUEST".to_string(),
            message: "Unknown MCP tool".to_string(),
        })?;
    let token = read_token();
    match rpc(method, params.clone(), token.as_deref()) {
        Ok(result) => Ok(result),
        Err(error) if error.code == "AUTH_REQUIRED" || error.code == "AUTH_REVOKED" => {
            let pairing = rpc(
                "system.request_pairing",
                json!({
                    "displayName": std::env::var("LUMEN_AGENT_NAME").unwrap_or_else(|_| "Codex".to_string()),
                    "clientType": "mcp"
                }),
                None,
            )?;
            save_token(&pairing).map_err(|message| RpcError {
                code: "INTERNAL_ERROR".to_string(),
                message,
            })?;
            rpc(method, params, read_token().as_deref())
        }
        Err(error) => Err(error),
    }
}

pub fn run() {
    let mut args = std::env::args().skip(1);
    let command = args.next();
    let raw_args: Vec<String> = args.collect();
    let pretty = raw_args.iter().any(|arg| arg == "--pretty");
    let args: Vec<String> = raw_args
        .into_iter()
        .filter(|arg| arg != "--pretty")
        .collect();
    match command.as_deref() {
        Some("mcp") => run_mcp(),
        Some("status") => print_result(http_request("GET", "/health", None, None), pretty),
        Some("capabilities") => print_result(
            rpc("system.capabilities", json!({}), read_token().as_deref()),
            pretty,
        ),
        Some("connect") => run_connect(args),
        Some("disconnect") => {
            let result = rpc("system.disconnect", json!({}), read_token().as_deref());
            let _ = fs::remove_file(credential_path());
            print_result(result.map(|_| json!({"disconnected": true})), pretty);
        }
        Some("context") => run_reader_command(
            "reader.get_context",
            json!({"scope": option_value(&args, "--scope").unwrap_or("current_page")}),
            pretty,
        ),
        Some("chapters") => run_reader_command("reader.list_chapters", json!({}), pretty),
        Some("search") => run_reader_command(
            "reader.search",
            json!({
                "query": option_value(&args, "--query").unwrap_or_default(),
                "scope": option_value(&args, "--scope").unwrap_or("current_page"),
            }),
            pretty,
        ),
        Some("source") => run_reader_command(
            "reader.get_source",
            json!({"cfi": option_value(&args, "--cfi").unwrap_or_default()}),
            pretty,
        ),
        Some("annotations") if args.first().map(String::as_str) == Some("list") => {
            run_reader_command("annotations.list", json!({}), pretty)
        }
        _ => {
            eprintln!("Usage: lumen mcp|connect|disconnect|status|capabilities|context|chapters|search|source|annotations list");
            std::process::exit(2);
        }
    }
}

fn option_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
}

fn run_reader_command(method: &str, params: Value, pretty: bool) {
    print_result(rpc(method, params, read_token().as_deref()), pretty);
}

fn run_mcp() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Invalid MCP request: {error}");
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let response = match request.get("method").and_then(Value::as_str) {
            Some("initialize") => mcp_response(
                &id,
                json!({
                    "protocolVersion":"2024-11-05",
                    "capabilities":{"tools":{}},
                    "serverInfo":{"name":"lumen","version":"1.0.0"}
                }),
            ),
            Some("notifications/initialized") => continue,
            Some("tools/list") => mcp_response(
                &id,
                json!({
                    "tools": tools().as_array().unwrap_or(&Vec::new()).iter().map(|tool| json!({
                        "name":tool["name"],"description":tool["description"],
                        "inputSchema":{"type":"object","additionalProperties":true}
                    })).collect::<Vec<_>>()
                }),
            ),
            Some("tools/call") => {
                let name = request
                    .get("params")
                    .and_then(|params| params.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let params = request
                    .get("params")
                    .and_then(|params| params.get("arguments"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match mcp_tool_call(name, params) {
                    Ok(result) => mcp_response(
                        &id,
                        json!({"content":[{"type":"text","text":result.to_string()}]}),
                    ),
                    Err(error) => mcp_error(&id, error),
                }
            }
            Some(_) | None => mcp_response(&id, json!({})),
        };
        println!("{}", response);
        let _ = io::stdout().flush();
    }
}

fn run_connect(args: Vec<String>) {
    let code = args
        .windows(2)
        .find(|pair| pair[0] == "--code")
        .map(|pair| pair[1].clone())
        .unwrap_or_else(|| {
            eprint!("Pairing code from Lumen: ");
            let _ = io::stderr().flush();
            let mut code = String::new();
            let _ = io::stdin().read_line(&mut code);
            code.trim().to_string()
        });
    let result = rpc(
        "system.pair",
        json!({"pairingCode":code,"displayName":"lumen","clientType":"mcp"}),
        None,
    )
    .and_then(|result| {
        save_token(&result)
            .map(|_| result)
            .map_err(|message| RpcError {
                code: "INTERNAL_ERROR".to_string(),
                message,
            })
    });
    print_result(result, false);
}

fn print_result(result: Result<Value, RpcError>, pretty: bool) {
    match result {
        Ok(value) if pretty => match serde_json::to_string_pretty(&value) {
            Ok(value) => println!("{value}"),
            Err(error) => {
                eprintln!("INTERNAL_ERROR: {error}");
                std::process::exit(1);
            }
        },
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            std::process::exit(1);
        }
    }
}

#[tauri::command]
pub fn agent_cli_status() -> AgentCliStatus {
    let path = cli_install_path();
    AgentCliStatus {
        installed: path.is_file(),
        path: path.display().to_string(),
    }
}

#[tauri::command]
pub fn agent_cli_install() -> Result<AgentCliStatus, String> {
    let source = std::env::current_exe().map_err(|error| error.to_string())?;
    let target = cli_install_path();
    if source != target {
        let parent = target
            .parent()
            .ok_or_else(|| "invalid CLI install path".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::copy(source, &target).map_err(|error| error.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }
    Ok(agent_cli_status())
}

#[tauri::command]
pub fn agent_cli_connect_codex() -> Result<String, String> {
    let path = cli_install_path();
    if !path.is_file() {
        return Err("Install the Lumen CLI before connecting Codex".to_string());
    }
    let output = Command::new("codex")
        .args([
            "mcp",
            "add",
            "lumen",
            "--",
            &path.display().to_string(),
            "mcp",
        ])
        .output()
        .map_err(|error| format!("Codex CLI was not found: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn cli_install_path_is_named_lumen() {
        assert!(super::cli_install_path()
            .file_name()
            .is_some_and(|name| name == "lumen" || name == "lumen.exe"));
    }
}
