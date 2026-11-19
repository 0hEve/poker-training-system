//! Poker Sharingan (markokraemer/poker-sharingan): open Pluribus reproduction for 2–6 players.
//! Runs the project's own `sharingan-serve` (Rust, memory-mapped blueprint, optional turn/river
//! search) on a private loopback port and forwards each decision as a TABLE_API request.
//!
//! Two bots share that one server: `sharingan` plays the blueprint alone (the configuration of
//! the project's public benchmark track, ~1-2 ms a decision) and `sharingan-search` adds the
//! turn/river real-time search (full strength, often seconds per search).

use super::{timed, track, Backend, BotInfo, Meta, Paths, Status};
use crate::view::{card_str, DecideRequest, Decision, Outcome, View};
use serde_json::{json, Value};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub struct Sharingan {
    paths: Paths,
    meta: Meta,
    search: bool,
    agent: ureq::Agent,
}

/// The one shared `sharingan-serve`: (url, description) once healthy, or why it isn't running.
static SERVER: OnceLock<Result<(String, String), Status>> = OnceLock::new();

/// Which released blueprint to load: the newest file present wins.
const MODELS: &[(&str, &str)] = &[
    ("sharingan-2.plcp", "medium"),
    ("sharingan-1.plcp", "medium"),
    ("B-local-2e10.plcp", "local"),
];

impl Sharingan {
    pub fn new(paths: Paths, search: bool) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(30))
            // Keep a connection per concurrent caller: the default of 1 idle connection per host made
            // parallel simulator workers open a new socket per decision until ports ran out.
            .max_idle_connections(256)
            .max_idle_connections_per_host(256)
            .build();
        Sharingan { paths, meta: Meta::default(), search, agent }
    }

    fn url(&self) -> Option<String> {
        match SERVER.get() {
            Some(Ok((url, _))) => Some(url.clone()),
            _ => None,
        }
    }

    fn binary(&self) -> PathBuf {
        self.paths.ext("poker-sharingan/target/release/sharingan-serve")
    }

    fn model(&self) -> Option<(PathBuf, &'static str, &'static str)> {
        let dir = self.paths.home.join("sharingan");
        MODELS.iter().map(|(f, s)| (dir.join(f), *f, *s)).find(|(p, _, _)| p.is_file())
    }

    fn start_server(&self) -> Result<(String, String), Status> {
        if !self.binary().is_file() {
            return Err(Status::Missing("sharingan-serve is not built (npm run bots:setup)".into()));
        }
        let Some((model, file, sizing)) = self.model() else {
            return Err(Status::Missing("no Sharingan blueprint in bot-assets/sharingan (npm run bots:setup)".into()));
        };
        let buckets = self.paths.home.join("sharingan/buckets-200");
        if !buckets.is_dir() {
            return Err(Status::Missing("Sharingan buckets-200 not extracted".into()));
        }
        let port = free_port();
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8).min(12);
        let child = Command::new(self.binary())
            .arg("--blueprint").arg(&model)
            .arg("--buckets").arg(&buckets)
            .arg("--sizing").arg(sizing)
            .arg("--bind").arg(format!("127.0.0.1:{port}"))
            .arg("--search-threads").arg(threads.to_string())
            .arg("--budget-ms").arg("3000")
            .arg("--max-inflight").arg("1024")
            .arg("--rate-rps").arg("1000000").arg("--rate-burst").arg("1000000")
            .arg("--model-id").arg(file.trim_end_matches(".plcp"))
            .arg("--no-auth")
            .env("SHARINGAN_LOG", "off")
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn();
        let child = match child {
            Ok(c) => c,
            Err(e) => return Err(Status::Failed(format!("spawn sharingan-serve: {e}"))),
        };
        track(&child);
        let url = format!("http://127.0.0.1:{port}");
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(600) {
            if self.agent.get(&format!("{url}/v1/health")).call().is_ok() {
                return Ok((url, format!("{file}, sizing {sizing}")));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(Status::Failed("sharingan-serve did not become healthy".into()))
    }

    fn request(v: &View, seed: u64, search: bool) -> Value {
        let before = v.committed_before_street();
        let _ = before;
        let mut history = Vec::new();
        for a in &v.actions {
            let street = ["preflop", "flop", "turn", "river"][a.street.min(3) as usize];
            let item = match a.kind.as_str() {
                "post" => continue, // blinds are derived from stack_start
                "fold" => json!({"seat": a.seat, "type": "fold", "street": street}),
                "check" => json!({"seat": a.seat, "type": "check", "street": street}),
                "call" => json!({"seat": a.seat, "type": "call", "street": street}),
                "bet" | "raise" => json!({"seat": a.seat, "type": a.kind, "to": a.amount, "street": street}),
                _ => continue,
            };
            history.push(item);
        }
        json!({
            "hand_id": v.hand_id.to_string(),
            "small_blind": v.small_blind,
            "big_blind": v.big_blind,
            "button_seat": 0,
            "hero_seat": v.seat,
            "hole_cards": v.hole.iter().map(|&c| card_str(c)).collect::<Vec<_>>(),
            "board": v.board.iter().map(|&c| card_str(c)).collect::<Vec<_>>(),
            "players": (0..v.num_seats).map(|i| json!({"seat": i, "stack_start": v.start_stacks[i]})).collect::<Vec<_>>(),
            "history": history,
            "options": {"seed": seed, "include_probs": false, "search": search},
        })
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(18080)
}

impl Backend for Sharingan {
    fn info(&self) -> BotInfo {
        let model = self.model().map(|(_, f, _)| f).unwrap_or("no weights");
        let (id, name, how) = if self.search {
            ("sharingan-search", "Sharingan + search", "with turn/river real-time search (full strength, slow)")
        } else {
            ("sharingan", "Sharingan", "blueprint only, as on its public benchmark track (fast)")
        };
        self.meta.fill(BotInfo {
            id: id.into(),
            name: name.into(),
            description: format!("Open Pluribus reproduction: MCCFR blueprint ({model}), {how}, 2–6 players."),
            source: "https://github.com/markokraemer/poker-sharingan".into(),
            seats: [2, 6],
            status: Status::Loading(String::new()),
            decisions: 0,
            errors: 0,
            mean_ms: 0.0,
        })
    }

    fn start(&self) {
        self.meta.set(Status::Loading("starting sharingan-serve".into()));
        match SERVER.get_or_init(|| self.start_server()) {
            Ok((_, detail)) => self.meta.set(Status::Ready(format!("{detail}, {}", if self.search { "turn/river search on" } else { "blueprint only" }))),
            Err(status) => self.meta.set(status.clone()),
        }
    }

    fn decide(&self, req: &DecideRequest) -> Result<Outcome, String> {
        let v = &req.view;
        if !(2..=6).contains(&v.num_seats) {
            return Err(format!("Sharingan plays 2–6 players, not {}", v.num_seats));
        }
        if v.ante > 0 {
            return Err("Sharingan does not support antes".into());
        }
        let url = self.url().ok_or("Sharingan is not ready")?;
        timed(&self.meta, || {
            let body = Self::request(v, req.seed, self.search);
            let resp: Value = match self.agent.post(&format!("{url}/v1/act")).send_json(body) {
                Ok(r) => r.into_json().map_err(|e| e.to_string())?,
                Err(ureq::Error::Status(code, r)) => {
                    return Err(format!("sharingan-serve {code}: {}", r.into_string().unwrap_or_default()))
                }
                Err(e) => return Err(e.to_string()),
            };
            let a = &resp["action"];
            let decision = match a["type"].as_str().unwrap_or("") {
                "fold" => Decision::Fold,
                "check" => Decision::Check,
                "call" => Decision::Call,
                "raise" => v.raise_to(a["to"].as_i64().unwrap_or(v.min_raise_to)),
                other => return Err(format!("unknown action {other}")),
            };
            let source = resp["source"].as_str().unwrap_or("blueprint").to_string();
            Ok(Outcome::new(decision, source).with(json!({"fallback_reason": resp["fallback_reason"], "ms": resp["timing"]["total_ms"]})))
        })
    }
}
