//! Small desktop-only loopback bridge for external reading agents.
//!
//! The HTTP transport deliberately stays here, at the native boundary. The
//! webview owns all book and reader state; requests are forwarded to it as
//! Tauri events and completed through `agent_bridge_respond`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const PROTOCOL_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Default)]
pub struct AgentBridgeState {
    inner: Arc<Inner>,
}

struct Inner {
    running: AtomicBool,
    request_counter: AtomicU64,
    port: Mutex<Option<u16>>,
    pending: Mutex<HashMap<String, mpsc::Sender<String>>>,
    event_subscribers: Mutex<Vec<mpsc::Sender<String>>>,
    pending_event_auth: Mutex<HashMap<String, mpsc::Sender<bool>>>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            request_counter: AtomicU64::new(0),
            port: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            event_subscribers: Mutex::new(Vec::new()),
            pending_event_auth: Mutex::new(HashMap::new()),
        }
    }
}

impl AgentBridgeState {
    pub fn stop_runtime(&self) {
        self.inner.running.store(false, Ordering::SeqCst);
        if let Ok(mut port) = self.inner.port.lock() {
            *port = None;
        }
        let path = discovery_path();
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBridgeInfo {
    pub port: u16,
    pub protocol_version: u32,
    pub discovery_path: String,
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    request_id: String,
    body: String,
    authorization: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HttpRequest {
    method: String,
    path: String,
    body: String,
    authorization: Option<String>,
}

#[tauri::command]
pub fn agent_bridge_start(
    app: AppHandle,
    state: State<'_, AgentBridgeState>,
) -> Result<AgentBridgeInfo, String> {
    if state.inner.running.load(Ordering::SeqCst) {
        let port = *state
            .inner
            .port
            .lock()
            .map_err(|_| "agent bridge state poisoned".to_string())?
            .as_ref()
            .ok_or_else(|| "agent bridge has no port".to_string())?;
        return Ok(AgentBridgeInfo {
            port,
            protocol_version: PROTOCOL_VERSION,
            discovery_path: discovery_path().display().to_string(),
            started_at: now_ms(),
        });
    }

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("failed to configure agent bridge: {err}"))?;
    let port = listener.local_addr().map_err(|err| err.to_string())?.port();
    state.inner.running.store(true, Ordering::SeqCst);
    *state
        .inner
        .port
        .lock()
        .map_err(|_| "agent bridge state poisoned".to_string())? = Some(port);

    let started_at = now_ms();
    let info = AgentBridgeInfo {
        port,
        protocol_version: PROTOCOL_VERSION,
        discovery_path: discovery_path().display().to_string(),
        started_at,
    };
    write_discovery(&info)?;

    let bridge_state = state.inner.clone();
    thread::Builder::new()
        .name("lumen-agent-bridge".to_string())
        .spawn(move || run_server(app, listener, bridge_state))
        .map_err(|err| format!("failed to start agent bridge: {err}"))?;

    Ok(info)
}

#[tauri::command]
pub fn agent_bridge_respond(
    state: State<'_, AgentBridgeState>,
    request_id: String,
    response: String,
) -> Result<(), String> {
    let sender = state
        .inner
        .pending
        .lock()
        .map_err(|_| "agent bridge state poisoned".to_string())?
        .remove(&request_id);
    match sender {
        Some(sender) => sender
            .send(response)
            .map_err(|_| "agent bridge request already closed".to_string()),
        None => Err("agent bridge request not found or expired".to_string()),
    }
}

#[tauri::command]
pub fn agent_bridge_stop(state: State<'_, AgentBridgeState>) -> Result<(), String> {
    state.stop_runtime();
    Ok(())
}

#[tauri::command]
pub fn agent_bridge_authorize_events(
    state: State<'_, AgentBridgeState>,
    request_id: String,
    allowed: bool,
) -> Result<(), String> {
    let sender = state
        .inner
        .pending_event_auth
        .lock()
        .map_err(|_| "agent bridge state poisoned".to_string())?
        .remove(&request_id);
    sender
        .ok_or_else(|| "event subscription not found".to_string())?
        .send(allowed)
        .map_err(|_| "event subscription closed".to_string())
}

#[tauri::command]
pub fn agent_bridge_emit_event(
    state: State<'_, AgentBridgeState>,
    event: String,
) -> Result<(), String> {
    let mut subscribers = state
        .inner
        .event_subscribers
        .lock()
        .map_err(|_| "agent bridge state poisoned".to_string())?;
    subscribers.retain(|sender| sender.send(format!("data: {event}\n\n")).is_ok());
    Ok(())
}

fn run_server(app: AppHandle, listener: TcpListener, state: Arc<Inner>) {
    while state.running.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let app = app.clone();
                let state = state.clone();
                thread::spawn(move || handle_connection(app, stream, state));
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(err) => {
                log::warn!("Lumen Agent Bridge accept failed: {err}");
                break;
            }
        }
    }
}

fn handle_connection(app: AppHandle, mut stream: TcpStream, state: Arc<Inner>) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(err) => {
            write_response(&mut stream, 400, &json_error("INVALID_REQUEST", &err));
            return;
        }
    };

    if request.method == "GET" && request.path == "/health" {
        let body = format!(
            "{{\"ok\":true,\"protocolVersion\":{PROTOCOL_VERSION},\"port\":{}}}",
            state
                .port
                .lock()
                .ok()
                .and_then(|port| *port)
                .unwrap_or_default()
        );
        write_response(&mut stream, 200, &body);
        return;
    }

    if request.method == "GET" && request.path == "/events" {
        let request_id = format!(
            "events-{}",
            state.request_counter.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut pending) = state.pending_event_auth.lock() {
            pending.insert(request_id.clone(), sender);
        } else {
            write_response(
                &mut stream,
                500,
                &json_error("INTERNAL_ERROR", "agent bridge state poisoned"),
            );
            return;
        }
        if app
            .emit(
                "agent-bridge-event-subscribe",
                BridgeRequest {
                    request_id: request_id.clone(),
                    body: String::new(),
                    authorization: request.authorization,
                },
            )
            .is_err()
        {
            return;
        }
        if receiver.recv_timeout(Duration::from_secs(5)).ok() != Some(true) {
            write_response(
                &mut stream,
                403,
                &json_error("PERMISSION_DENIED", "event subscription denied"),
            );
            return;
        }
        let (event_sender, event_receiver) = mpsc::channel();
        if let Ok(mut subscribers) = state.event_subscribers.lock() {
            subscribers.push(event_sender);
        } else {
            return;
        }
        let header = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: null\r\n\r\n";
        if stream.write_all(header.as_bytes()).is_err() {
            return;
        }
        while state.running.load(Ordering::SeqCst) {
            match event_receiver.recv_timeout(Duration::from_secs(15)) {
                Ok(event) => {
                    if stream.write_all(event.as_bytes()).is_err() {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if stream.write_all(b": keep-alive\n\n").is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        return;
    }

    if request.method != "POST" || request.path != "/rpc" {
        write_response(
            &mut stream,
            404,
            &json_error("NOT_FOUND", "unknown Agent Bridge endpoint"),
        );
        return;
    }

    let request_id = format!(
        "bridge-{}",
        state.request_counter.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = mpsc::channel();
    if let Ok(mut pending) = state.pending.lock() {
        pending.insert(request_id.clone(), sender);
    } else {
        write_response(
            &mut stream,
            500,
            &json_error("INTERNAL_ERROR", "agent bridge state poisoned"),
        );
        return;
    }

    if app
        .emit(
            "agent-bridge-request",
            BridgeRequest {
                request_id: request_id.clone(),
                body: request.body,
                authorization: request.authorization,
            },
        )
        .is_err()
    {
        remove_pending(&state, &request_id);
        write_response(
            &mut stream,
            503,
            &json_error("BRIDGE_UNAVAILABLE", "Lumen webview is not ready"),
        );
        return;
    }

    match receiver.recv_timeout(REQUEST_TIMEOUT) {
        Ok(response) => write_response(&mut stream, 200, &response),
        Err(_) => {
            remove_pending(&state, &request_id);
            write_response(
                &mut stream,
                504,
                &json_error(
                    "REQUEST_TIMEOUT",
                    "Lumen did not complete the request in time",
                ),
            );
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::with_capacity(4096);
    let header_end;
    loop {
        let mut chunk = [0_u8; 4096];
        let read = stream.read(&mut chunk).map_err(|err| err.to_string())?;
        if read == 0 {
            return Err("connection closed before request headers".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request exceeds maximum size".to_string());
        }
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }

    let headers = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| "request headers are not UTF-8".to_string())?;
    let mut lines = headers.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "missing HTTP method".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "missing HTTP path".to_string())?
        .to_string();
    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            (name.eq_ignore_ascii_case("content-length"))
                .then(|| value.trim().parse::<usize>().ok())
        })
        .flatten()
        .unwrap_or(0);
    let authorization = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("authorization")
            .then(|| value.trim().to_string())
    });
    if content_length > MAX_REQUEST_BYTES {
        return Err("request body exceeds maximum size".to_string());
    }

    while buffer.len() < header_end + content_length {
        let mut chunk = [0_u8; 4096];
        let read = stream.read(&mut chunk).map_err(|err| err.to_string())?;
        if read == 0 {
            return Err("connection closed before request body".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8(buffer[header_end..header_end + content_length].to_vec())
        .map_err(|_| "request body is not UTF-8".to_string())?;
    Ok(HttpRequest {
        method,
        path,
        body,
        authorization,
    })
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: null\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn json_error(code: &str, message: &str) -> String {
    format!(
        "{{\"jsonrpc\":\"2.0\",\"error\":{{\"code\":\"{code}\",\"message\":{}}}}}",
        serde_json::to_string(message).unwrap_or_else(|_| "\"unknown error\"".to_string())
    )
}

fn remove_pending(state: &Inner, request_id: &str) {
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(request_id);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn discovery_path() -> PathBuf {
    std::env::temp_dir().join("lumen-agent-bridge.json")
}

fn write_discovery(info: &AgentBridgeInfo) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(info).map_err(|err| err.to_string())?;
    fs::write(discovery_path(), content).map_err(|err| err.to_string())
}
