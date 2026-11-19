//! Slumbot2019 (ericgjackson/slumbot2019): CFR framework from the 2018 ACPC champion.
//!
//! The repository ships no trained strategy, so `npm run bots:setup` builds the card and betting
//! abstractions and trains an external-sampling MCCFR blueprint for heads-up 100 BB
//! (`native/slumbot/pt100_params`). Upstream's own ACPC client (`run_bot`, unchanged agent and
//! action translation) connects to this gateway, which plays the ACPC dealer: each decision is
//! one MATCHSTATE line, and the reply carries the action.

use super::{timed, track, Backend, BotInfo, Meta, Paths, Status};
use crate::view::{card_str, DecideRequest, Decision, Outcome, View};
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

/// Agents (one ACPC connection each); enough for parallel simulator workers.
const POOL: usize = 8;
/// ACPC chips: big blind 100 (the agent is constructed with big_blind = 100).
const ACPC_BB: f64 = 100.0;

struct Conn {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

pub struct Slumbot {
    paths: Paths,
    meta: Meta,
    conns: Vec<Mutex<Option<Conn>>>,
    batch: Mutex<Option<i64>>,
}

impl Slumbot {
    pub fn new(paths: Paths) -> Self {
        Slumbot { paths, meta: Meta::default(), conns: (0..POOL).map(|_| Mutex::new(None)).collect(), batch: Mutex::new(None) }
    }

    fn dir(&self) -> PathBuf {
        self.paths.home.join("slumbot")
    }

    fn binary(&self) -> PathBuf {
        self.paths.ext("slumbot2019/bin/run_bot")
    }

    /// The ACPC MATCHSTATE line for the hero, plus the scale and hand-level bet-to it used.
    pub fn match_state(v: &View, hand_no: u64) -> Result<(String, f64, f64), String> {
        if v.num_seats != 2 {
            return Err(format!("Slumbot plays heads-up only, not {} players", v.num_seats));
        }
        if v.ante > 0 {
            return Err("Slumbot does not support antes".into());
        }
        let k = ACPC_BB / v.big_blind as f64;
        // Our seat 0 is the button / small blind = ACPC position 1 (acts first preflop).
        let pos = |seat: usize| if seat == 0 { 1 } else { 0 };
        let mut committed = [0i64; 2];
        let mut street_start = [0i64; 2];
        let mut street = 0u8;
        let mut rounds: Vec<String> = vec![String::new()];
        for a in &v.actions {
            if a.kind == "post" {
                committed[a.seat] += a.amount;
                continue;
            }
            while street < a.street {
                street += 1;
                street_start = committed;
                rounds.push(String::new());
            }
            let r = rounds.last_mut().unwrap();
            match a.kind.as_str() {
                "fold" => r.push('f'),
                "check" => r.push('c'),
                "call" => {
                    committed[a.seat] += a.amount;
                    r.push('c');
                }
                "bet" | "raise" => {
                    committed[a.seat] = street_start[a.seat] + a.amount;
                    r.push_str(&format!("r{}", (committed[a.seat] as f64 * k).round() as i64));
                }
                _ => {}
            }
        }
        while street < v.street {
            street += 1;
            rounds.push(String::new());
        }
        let hole: String = v.hole.iter().map(|&c| card_str(c)).collect();
        let me = pos(v.seat);
        let cards_holes = if me == 0 { format!("{hole}|") } else { format!("|{hole}") };
        let mut cards = cards_holes;
        if v.board.len() >= 3 {
            cards.push('/');
            cards.extend(v.board[..3].iter().map(|&c| card_str(c)));
        }
        for &c in v.board.iter().skip(3) {
            cards.push('/');
            cards.push_str(&card_str(c));
        }
        let bet_to = (*v.committed.iter().max().unwrap_or(&0)) as f64 * k;
        Ok((format!("MATCHSTATE:{me}:{hand_no}:{}:{cards}", rounds.join("/")), k, bet_to))
    }

    /// Turn the agent's reply token into a decision. `r<n>` is the raise size in ACPC chips
    /// above the current bet-to (what `Agent::ProcessMatchState` returns as `bet_size`).
    pub fn parse_reply(v: &View, token: &str, k: f64, bet_to: f64) -> Result<Decision, String> {
        match token.as_bytes().first() {
            Some(b'c') => Ok(v.check_or_call()),
            Some(b'f') => Ok(if v.to_call == 0 { Decision::Check } else { Decision::Fold }),
            Some(b'r') => {
                let inc: f64 = token[1..].parse().map_err(|_| format!("bad raise {token}"))?;
                let hand_total = (bet_to + inc) / k;
                let before = v.committed[v.seat] - v.bets[v.seat];
                Ok(v.raise_to(hand_total.round() as i64 - before))
            }
            _ => Err(format!("unexpected reply {token:?}")),
        }
    }
}

impl Backend for Slumbot {
    fn info(&self) -> BotInfo {
        let batch = *self.batch.lock().unwrap();
        self.meta.fill(BotInfo {
            id: "slumbot".into(),
            name: "Slumbot 2019".into(),
            description: format!(
                "Eric Jackson's ACPC-champion CFR framework: locally trained external-sampling MCCFR blueprint (heads-up 100 BB{}), upstream agent and bet translation.",
                batch.map(|b| format!(", {}M iterations", (b + 1) * 10)).unwrap_or_default()
            ),
            source: "https://github.com/ericgjackson/slumbot2019".into(),
            seats: [2, 2],
            status: Status::Loading(String::new()),
            decisions: 0,
            errors: 0,
            mean_ms: 0.0,
        })
    }

    fn start(&self) {
        if !self.binary().is_file() {
            return self.meta.set(Status::Missing("slumbot2019 is not built (npm run bots:setup)".into()));
        }
        let batch = std::fs::read_to_string(self.dir().join("latest_batch")).ok().and_then(|s| s.trim().parse::<i64>().ok());
        let Some(batch) = batch else {
            return self.meta.set(Status::Missing("no trained Slumbot blueprint yet (training runs in npm run bots:setup)".into()));
        };
        *self.batch.lock().unwrap() = Some(batch);
        self.meta.set(Status::Loading(format!("starting {POOL} agents on batch {batch}")));
        let listener = match TcpListener::bind("127.0.0.1:0") {
            Ok(l) => l,
            Err(e) => return self.meta.set(Status::Failed(format!("listen: {e}"))),
        };
        let port = listener.local_addr().unwrap().port();
        let _ = listener.set_nonblocking(true);
        let mut children = Vec::new();
        for i in 0..POOL {
            let child = Command::new(self.binary())
                .current_dir(self.dir())
                .args(["holdem_params", "nhs2_params", "pt100_params", "ecfr_params"])
                .arg(batch.to_string())
                .arg((i + 1).to_string())
                .arg("127.0.0.1")
                .arg(port.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(c) => {
                    track(&c);
                    children.push(c);
                }
                Err(e) => return self.meta.set(Status::Failed(format!("spawn run_bot: {e}"))),
            }
        }
        // Agents load the abstraction and strategy files, then connect in any order.
        let deadline = std::time::Instant::now() + Duration::from_secs(600);
        for i in 0..POOL {
            let stream = loop {
                match listener.accept() {
                    Ok((s, _)) => break s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        let alive = children.iter_mut().filter_map(|c| c.try_wait().ok()).filter(|s| s.is_none()).count();
                        if alive + i < POOL || std::time::Instant::now() > deadline {
                            return self.meta.set(Status::Failed(format!(
                                "run_bot exited before connecting ({alive} of {POOL} alive); is batch {batch} complete?"
                            )));
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => return self.meta.set(Status::Failed(format!("accept: {e}"))),
                }
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_nodelay(true);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut version = String::new();
            if reader.read_line(&mut version).is_err() || !version.starts_with("VERSION:") {
                return self.meta.set(Status::Failed(format!("run_bot handshake: {version:?}")));
            }
            *self.conns[i].lock().unwrap() = Some(Conn { reader, writer: stream });
        }
        self.meta.set(Status::Ready(format!("blueprint batch {batch} ({}M iterations), {POOL} agents", (batch + 1) * 10)));
    }

    fn decide(&self, req: &DecideRequest) -> Result<Outcome, String> {
        let v = &req.view;
        let hand_no = (req.seed ^ (v.hand_id as u64).wrapping_mul(0x9E3779B1)) % 1_000_000_000;
        let (line, k, bet_to) = Self::match_state(v, hand_no)?;
        if !self.meta.is_ready() {
            return Err("Slumbot is not ready".into());
        }
        timed(&self.meta, || {
            let i = (super::fnv(&req.instance) as usize) % POOL;
            let mut guard = self.conns[i].lock().unwrap();
            let conn = guard.as_mut().ok_or("Slumbot agent connection is closed")?;
            let sent = conn.writer.write_all(format!("{line}\r\n").as_bytes());
            let mut reply = String::new();
            let read = sent.map_err(|e| e.to_string()).and_then(|_| conn.reader.read_line(&mut reply).map_err(|e| e.to_string()));
            if read.is_err() || reply.is_empty() {
                *guard = None;
                return Err(format!("Slumbot agent stopped: {read:?}"));
            }
            let token = reply.trim_end().rsplit(':').next().unwrap_or("");
            let d = Self::parse_reply(v, token, k, bet_to)?;
            Ok(Outcome::new(d, "blueprint").with(json!({"acpc": line, "reply": token})))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::{ActionEvent, View};

    fn ev(seat: usize, street: u8, kind: &str, amount: i64) -> ActionEvent {
        ActionEvent { seat, street, kind: kind.into(), amount, all_in: false }
    }

    fn hu_view(seat: usize, street: u8, board: Vec<u8>, actions: Vec<ActionEvent>, committed: Vec<i64>, bets: Vec<i64>) -> View {
        View {
            hand_id: 1, num_seats: 2, seat, sb_seat: 0, bb_seat: 1, small_blind: 5, big_blind: 10, ante: 0, street,
            hole: vec![48, 49], board, stacks: vec![900, 900], start_stacks: vec![1000, 1000], bets, committed: committed.clone(),
            folded: vec![false, false], all_in: vec![false, false], pot: committed.iter().sum(), current_bet: 0, to_call: 0,
            can_raise: true, min_raise_to: 10, max_raise_to: 900, actions, player_ids: vec![],
        }
    }

    #[test]
    fn acpc_line_uses_hand_totals_positions_and_street_separators() {
        // Button (seat 0, ACPC position 1) raises to 30, BB calls; flop dealt, BB to act.
        let acts = vec![ev(0, 0, "post", 5), ev(1, 0, "post", 10), ev(0, 0, "raise", 30), ev(1, 0, "call", 20)];
        let v = hu_view(1, 1, vec![0, 5, 10], acts.clone(), vec![30, 30], vec![0, 0]);
        let (line, k, bet_to) = Slumbot::match_state(&v, 7).unwrap();
        assert_eq!(k, 10.0);
        assert_eq!(bet_to, 300.0);
        assert_eq!(line, "MATCHSTATE:0:7:r300c/:AsAh|/2s3h4d");
        // The same spot from the button's side.
        let v = hu_view(0, 1, vec![0, 5, 10], acts, vec![30, 30], vec![0, 0]);
        assert!(Slumbot::match_state(&v, 7).unwrap().0.starts_with("MATCHSTATE:1:7:r300c/:|AsAh"));
    }

    #[test]
    fn flop_bet_is_a_hand_total() {
        let acts = vec![ev(0, 0, "post", 5), ev(1, 0, "post", 10), ev(0, 0, "call", 5), ev(1, 0, "check", 0), ev(1, 1, "bet", 20)];
        let v = hu_view(0, 1, vec![0, 5, 10], acts, vec![10, 30], vec![0, 20]);
        assert_eq!(Slumbot::match_state(&v, 1).unwrap().0, "MATCHSTATE:1:1:cc/r300:|AsAh/2s3h4d");
    }

    #[test]
    fn reply_raise_is_an_increment_over_the_current_bet() {
        let mut v = hu_view(1, 1, vec![0, 5, 10], vec![], vec![30, 30], vec![0, 0]);
        v.min_raise_to = 10;
        // Pot-size bet: 600 ACPC chips above a hand bet-to of 300 -> 90 total -> 60 on this street.
        assert_eq!(Slumbot::parse_reply(&v, "r600", 10.0, 300.0).unwrap(), Decision::Raise { to: 60 });
        assert_eq!(Slumbot::parse_reply(&v, "c", 10.0, 300.0).unwrap(), Decision::Check);
        assert_eq!(Slumbot::parse_reply(&v, "f", 10.0, 300.0).unwrap(), Decision::Check);
    }
}
