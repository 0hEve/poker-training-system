//! bot-gateway: one local HTTP endpoint for every external bot.
//!
//!   GET  /v1/health   -> {"ok":true}
//!   GET  /v1/bots     -> [{id, name, description, source, seats, status, decisions, errors, mean_ms}]
//!   POST /v1/decide   {bot, instance, seed, view, events} -> {ok, decision, source, ms} | {ok:false, error}
//!
//! Bodies are sent as text/plain so browsers make a simple CORS request (no preflight).
//! Usage: bot-gateway [--repo DIR] [--home DIR (default <repo>/bot-assets)] [--port 7878] [--only id,id]

mod backends;
mod view;

use backends::{Paths, Shared};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tiny_http::{Header, Method, Response, Server};
use view::DecideRequest;

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn reply(body: Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(serde_json::to_vec(&body).unwrap())
        .with_status_code(status)
        .with_header(header("Content-Type", "application/json"))
        .with_header(header("Access-Control-Allow-Origin", "*"))
        .with_header(header("Access-Control-Allow-Headers", "content-type"))
        .with_header(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
        .with_header(header("Access-Control-Max-Age", "86400"))
        // Chromium Private Network Access: lets file:// (packaged Electron) pages reach loopback.
        .with_header(header("Access-Control-Allow-Private-Network", "true"))
}

fn main() {
    let exe_repo = std::env::current_exe()
        .ok()
        .and_then(|p| p.ancestors().find(|a| a.join("external").is_dir() && a.join("package.json").is_file()).map(PathBuf::from));
    let repo = arg("--repo").map(PathBuf::from).or(exe_repo).unwrap_or_else(|| PathBuf::from("."));
    let repo = repo.canonicalize().unwrap_or(repo);
    // Weights, trained strategies and Python envs: <repo>/bot-assets (git-ignored) unless overridden.
    let home = arg("--home")
        .or_else(|| std::env::var("POKER_BOTS_HOME").ok())
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("bot-assets"));
    let port: u16 = arg("--port").and_then(|p| p.parse().ok()).unwrap_or(7878);
    let only: Option<Vec<String>> = arg("--only").map(|s| s.split(',').map(String::from).collect());
    let paths = Paths { repo, home };

    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("[gateway] cannot listen on 127.0.0.1:{port}: {e}");
            std::process::exit(3);
        }
    };

    let all: Vec<Shared> = vec![
        Arc::new(backends::sharingan::Sharingan::new(paths.clone(), false)),
        Arc::new(backends::sharingan::Sharingan::new(paths.clone(), true)),
        Arc::new(backends::cfr::Cfr::new(paths.clone())),
        Arc::new(backends::slumbot::Slumbot::new(paths.clone())),
        Arc::new(backends::unavailable::DecisionHoldem::new()),
    ];
    let bots: Arc<BTreeMap<String, Shared>> = Arc::new(
        all.into_iter()
            .filter(|b| only.as_ref().map_or(true, |o| o.contains(&b.info().id)))
            .map(|b| (b.info().id, b))
            .collect(),
    );

    ctrlc::set_handler(|| {
        backends::kill_children();
        std::process::exit(0);
    })
    .ok();

    // Load every backend in the background; requests answer "not ready" until then.
    for b in bots.values() {
        let b = b.clone();
        std::thread::spawn(move || b.start());
    }
    eprintln!("[gateway] listening on http://127.0.0.1:{port} (repo {}, assets {})", paths.repo.display(), paths.home.display());

    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8).max(8) * 2;
    let handles: Vec<_> = (0..workers)
        .map(|_| {
            let server = server.clone();
            let bots = bots.clone();
            std::thread::spawn(move || loop {
                let Ok(mut rq) = server.recv() else { break };
                let path = rq.url().split('?').next().unwrap_or("").to_string();
                let resp = match (rq.method(), path.as_str()) {
                    (Method::Options, _) => reply(json!({}), 204),
                    (Method::Get, "/v1/health") => reply(json!({"ok": true, "bots": bots.len()}), 200),
                    (Method::Get, "/v1/bots") => reply(json!(bots.values().map(|b| b.info()).collect::<Vec<_>>()), 200),
                    (Method::Post, "/v1/decide") => {
                        let mut body = String::new();
                        let _ = rq.as_reader().read_to_string(&mut body);
                        reply(decide(&bots, &body), 200)
                    }
                    _ => reply(json!({"ok": false, "error": "not found"}), 404),
                };
                let _ = rq.respond(resp);
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    backends::kill_children();
}

fn decide(bots: &BTreeMap<String, Shared>, body: &str) -> Value {
    let t = Instant::now();
    let req: DecideRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": format!("bad request: {e}")}),
    };
    let Some(bot) = bots.get(&req.bot) else {
        return json!({"ok": false, "error": format!("unknown bot {}", req.bot)});
    };
    let ms = || t.elapsed().as_secs_f64() * 1e3;
    match bot.decide(&req) {
        Ok(o) => json!({"ok": true, "decision": o.decision, "source": o.source, "detail": o.detail, "ms": ms()}),
        Err(e) => json!({"ok": false, "error": e, "ms": ms()}),
    }
}
