//! One backend per external bot. Each owns its native process(es) and translates the app's
//! `View` into that project's own request format, unchanged from upstream.

pub mod cfr;
pub mod sharingan;
pub mod slumbot;
pub mod unavailable;

use crate::view::{DecideRequest, Outcome};
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", content = "detail", rename_all = "lowercase")]
pub enum Status {
    /// Assets present, process starting or loading weights.
    Loading(String),
    Ready(String),
    /// Assets or binaries not installed yet (run `npm run bots:setup`).
    Missing(String),
    /// Cannot run on this machine at all.
    Unavailable(String),
    Failed(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct BotInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Upstream repository.
    pub source: String,
    /// Dealt players this bot can play: [min, max].
    pub seats: [usize; 2],
    pub status: Status,
    /// Decisions answered / failed since the gateway started.
    pub decisions: u64,
    pub errors: u64,
    /// Mean answer time in ms.
    pub mean_ms: f64,
}

pub trait Backend: Send + Sync {
    fn info(&self) -> BotInfo;
    /// Start processes / load weights. Called once on a background thread.
    fn start(&self) {}
    fn decide(&self, req: &DecideRequest) -> Result<Outcome, String>;
}

/// Shared status cell + counters for a backend.
#[derive(Default)]
pub struct Meta {
    pub status: RwLock<Option<Status>>,
    pub stats: Mutex<(u64, u64, f64)>,
}

impl Meta {
    pub fn set(&self, s: Status) {
        if let Status::Failed(e) | Status::Missing(e) = &s {
            eprintln!("[gateway] {e}");
        }
        *self.status.write().unwrap() = Some(s);
    }
    pub fn get(&self) -> Status {
        self.status.read().unwrap().clone().unwrap_or(Status::Loading("starting".into()))
    }
    pub fn is_ready(&self) -> bool {
        matches!(self.get(), Status::Ready(_))
    }
    pub fn record(&self, ok: bool, ms: f64) {
        let mut s = self.stats.lock().unwrap();
        if ok {
            s.0 += 1;
            s.2 += (ms - s.2) / s.0 as f64;
        } else {
            s.1 += 1;
        }
    }
    pub fn fill(&self, mut info: BotInfo) -> BotInfo {
        let s = *self.stats.lock().unwrap();
        info.status = self.get();
        info.decisions = s.0;
        info.errors = s.1;
        info.mean_ms = s.2;
        info
    }
}

/// Paths the backends need.
#[derive(Clone)]
pub struct Paths {
    /// Repository root (contains external/ and native/).
    pub repo: PathBuf,
    /// Downloaded weights, trained strategies and the Python venvs (default <repo>/bot-assets).
    pub home: PathBuf,
}

impl Paths {
    pub fn ext(&self, rel: &str) -> PathBuf {
        self.repo.join("external").join(rel)
    }
}

/// Every child process the gateway started, killed on shutdown.
pub static CHILDREN: Mutex<Vec<u32>> = Mutex::new(Vec::new());

pub fn track(child: &Child) {
    CHILDREN.lock().unwrap().push(child.id());
}

pub fn kill_children() {
    for pid in CHILDREN.lock().unwrap().drain(..) {
        unsafe_kill(pid);
    }
}

fn unsafe_kill(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

/// A child process speaking one JSON object per line on stdin/stdout.
pub struct LineProcess {
    /// Kept so the process handle lives as long as the pipes.
    #[allow(dead_code)]
    pub child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl LineProcess {
    pub fn spawn(mut cmd: Command, quiet_stderr: bool) -> Result<Self, String> {
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
        cmd.stderr(if quiet_stderr { Stdio::null() } else { Stdio::inherit() });
        let mut child = cmd.spawn().map_err(|e| format!("spawn {:?}: {e}", cmd.get_program()))?;
        track(&child);
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Ok(LineProcess { child, stdin, stdout })
    }

    pub fn read_line(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        let n = self.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("process exited".into());
        }
        serde_json::from_str(&line).map_err(|e| format!("bad JSON from process: {e}: {}", line.trim()))
    }

    pub fn call(&mut self, request: &Value) -> Result<Value, String> {
        let mut s = serde_json::to_string(request).map_err(|e| e.to_string())?;
        s.push('\n');
        self.stdin.write_all(s.as_bytes()).map_err(|e| format!("write: {e}"))?;
        self.stdin.flush().map_err(|e| e.to_string())?;
        self.read_line()
    }
}

pub fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

pub type Shared = Arc<dyn Backend>;

pub fn timed<T>(meta: &Meta, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let t = std::time::Instant::now();
    let r = f();
    meta.record(r.is_ok(), t.elapsed().as_secs_f64() * 1e3);
    r
}
