//! CFR-NLHE (dberweger2017/CFR-NLHE-6max): tabular, linearly weighted, opponent-sampled CFR
//! averages with K50 card buckets and off-menu translation.
//!
//! Routing follows the project's own Open Poker client (docs/openpoker-client.md): by the number
//! of dealt players, then by depth.
//! - 3 players: the v0.6.0 three-player 100 BB blueprint through the upstream native decision
//!   service (`nplayer_serve`), which replays the hand as dealer and plays the policy row.
//! - 2 players: the released heads-up averages through upstream's Python runtime
//!   (`native/pybots/cfr_hu.py`): HU20 v0.4.2 under 35 BB, HU100 v0.5.3 up to 150 BB, HU200 v0.5.5 above.

use super::{timed, Backend, BotInfo, LineProcess, Meta, Paths, Status};
use crate::view::{DecideRequest, Decision, Outcome, View};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

pub const NP3_FILE: &str = "NP3-100BB-v060-seed-2026101935003.bin";
pub const NP3_SHA256: &str = "d835f61f4a5407bd47e8f8a5da849ef82c16ad21fce32f15dce72d5997275189";
/// Chips in the trained game: blinds 50/100.
const NATIVE_BB: i64 = 100;

pub struct Cfr {
    paths: Paths,
    meta: Meta,
    native: Mutex<Option<LineProcess>>,
    hu: Mutex<Option<LineProcess>>,
    routes: Mutex<Vec<String>>,
}

impl Cfr {
    pub fn new(paths: Paths) -> Self {
        Cfr { paths, meta: Meta::default(), native: Mutex::new(None), hu: Mutex::new(None), routes: Mutex::new(Vec::new()) }
    }

    fn dir(&self) -> PathBuf {
        self.paths.home.join("cfr")
    }

    fn binary(&self) -> PathBuf {
        self.paths.ext("cfr-nlhe-6max/native/hu20-trainer/target/release/examples/nplayer_serve")
    }

    /// The dealer's record in native chips: stacks, a full deck consistent with the hero's view
    /// (hidden cards are unused cards in ascending order) and every action after the blinds.
    pub fn native_hand(v: &View) -> Result<Value, String> {
        if v.ante > 0 {
            return Err("CFR-NLHE does not support antes".into());
        }
        if NATIVE_BB % v.big_blind != 0 || v.small_blind * 2 != v.big_blind {
            return Err(format!("blinds {}/{} do not scale to 50/100", v.small_blind, v.big_blind));
        }
        let k = NATIVE_BB / v.big_blind;
        let n = v.num_seats;
        let mut used = v.known_cards();
        let mut spare = (0u8..52).filter(|c| used & (1u64 << c) == 0).collect::<Vec<_>>().into_iter();
        let mut deck = vec![255u8; 52];
        for round in 0..2 {
            for offset in 0..n {
                let seat = (1 + offset) % n;
                deck[round * n + offset] = if seat == v.seat { v.hole[round] } else { spare.next().unwrap() };
            }
        }
        for i in 0..5 {
            deck[2 * n + i] = match v.board.get(i) { Some(&c) => c, None => spare.next().unwrap() };
        }
        for slot in deck.iter_mut().filter(|c| **c == 255) {
            *slot = spare.next().unwrap();
        }
        used = deck.iter().fold(0u64, |m, &c| m | (1u64 << c));
        debug_assert_eq!(used.count_ones(), 52);
        let actions: Vec<Value> = v
            .actions
            .iter()
            .filter_map(|a| match a.kind.as_str() {
                "fold" | "check" | "call" => Some(json!([a.kind, 0])),
                "bet" | "raise" => Some(json!(["raise", a.amount * k])),
                _ => None,
            })
            .collect();
        Ok(json!({
            "stacks": v.start_stacks.iter().map(|s| s * k).collect::<Vec<_>>(),
            "sb": 50, "bb": 100, "button": 0, "deck": deck, "actions": actions,
        }))
    }

    fn from_native(v: &View, action: &Value) -> Result<Decision, String> {
        let k = NATIVE_BB / v.big_blind;
        match action[0].as_str().unwrap_or("") {
            "fold" => Ok(if v.to_call == 0 { Decision::Check } else { Decision::Fold }),
            "check" | "call" => Ok(v.check_or_call()),
            "raise" => Ok(v.raise_to(action[1].as_i64().unwrap_or(0) / k)),
            other => Err(format!("unknown native action {other:?}")),
        }
    }

    fn start_native(&self) -> Result<String, String> {
        let model = self.dir().join("v060").join(NP3_FILE);
        if !model.is_file() {
            return Err("3-player model not assembled".into());
        }
        let mut cmd = Command::new(self.binary());
        cmd.arg("serve").arg("--card-buckets").arg(self.dir().join("k50"));
        cmd.arg("--policy").arg("np3").arg(&model).arg(NP3_SHA256);
        let mut p = LineProcess::spawn(cmd, false)?;
        let ready = p.read_line()?;
        if ready["ok"] != json!(true) {
            return Err(format!("nplayer_serve: {ready}"));
        }
        *self.native.lock().unwrap() = Some(p);
        Ok("3p: v0.6.0 NP3 100 BB".into())
    }

    fn start_hu(&self) -> Result<String, String> {
        let python = self.paths.home.join("cfr/venv/bin/python");
        if !python.is_file() {
            return Err("CFR Python runtime not installed".into());
        }
        let mut cmd = Command::new(python);
        cmd.arg("-u").arg(self.paths.repo.join("native/pybots/cfr_hu.py"));
        cmd.arg("--repo").arg(self.paths.ext("cfr-nlhe-6max")).arg("--models").arg(self.dir());
        cmd.current_dir(self.paths.ext("cfr-nlhe-6max"));
        let mut p = LineProcess::spawn(cmd, false)?;
        let ready = p.read_line()?;
        if ready["ok"] != json!(true) {
            return Err(format!("cfr_hu: {}", ready["error"]));
        }
        let names = ready["models"].as_array().map(|m| m.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        *self.hu.lock().unwrap() = Some(p);
        Ok(format!("HU: {names}"))
    }
}

impl Backend for Cfr {
    fn info(&self) -> BotInfo {
        self.meta.fill(BotInfo {
            id: "cfr-nlhe".into(),
            name: "CFR-NLHE".into(),
            description: "Tabular opponent-sampled CFR averages with K50 buckets and bet translation: HU20/HU100/HU200 heads-up by depth, v0.6.0 blueprint 3-handed.".into(),
            source: "https://github.com/dberweger2017/CFR-NLHE-6max".into(),
            // Only the routes whose models actually loaded.
            seats: match (self.hu.lock().unwrap().is_some(), self.native.lock().unwrap().is_some()) {
                (true, false) => [2, 2],
                (false, true) => [3, 3],
                _ => [2, 3],
            },
            status: Status::Loading(String::new()),
            decisions: 0,
            errors: 0,
            mean_ms: 0.0,
        })
    }

    fn start(&self) {
        if !self.binary().is_file() {
            return self.meta.set(Status::Missing("nplayer_serve is not built (npm run bots:setup)".into()));
        }
        if !self.dir().join("k50/river-k50.bin").is_file() {
            return self.meta.set(Status::Missing("K50 card tables not downloaded (npm run bots:setup)".into()));
        }
        self.meta.set(Status::Loading("loading CFR policies (several minutes on first start)".into()));
        let mut routes = Vec::new();
        let mut problems = Vec::new();
        for r in [self.start_hu(), self.start_native()] {
            match r {
                Ok(s) => routes.push(s),
                Err(e) => problems.push(e),
            }
        }
        *self.routes.lock().unwrap() = routes.clone();
        if routes.is_empty() {
            self.meta.set(Status::Missing(problems.join("; ")));
        } else {
            let mut s = routes.join("; ");
            if !problems.is_empty() {
                s += &format!(" (not loaded: {})", problems.join("; "));
            }
            self.meta.set(Status::Ready(s));
        }
    }

    fn decide(&self, req: &DecideRequest) -> Result<Outcome, String> {
        let v = &req.view;
        if !self.meta.is_ready() {
            return Err("CFR-NLHE is not ready".into());
        }
        match v.num_seats {
            2 => timed(&self.meta, || {
                let mut g = self.hu.lock().unwrap();
                let p = g.as_mut().ok_or("no heads-up CFR model loaded")?;
                let r = p.call(&json!({"op": "decide", "view": v_json(req), "seed": req.seed}));
                let r = match r {
                    Ok(r) => r,
                    Err(e) => {
                        *g = None;
                        return Err(e);
                    }
                };
                if r["ok"] != json!(true) {
                    return Err(r["error"].as_str().unwrap_or("cfr_hu failed").to_string());
                }
                let d = match r["action"][0].as_str().unwrap_or("") {
                    "fold" => if v.to_call == 0 { Decision::Check } else { Decision::Fold },
                    "check" | "call" => v.check_or_call(),
                    "raise" => v.raise_to(r["action"][1].as_i64().unwrap_or(0)),
                    other => return Err(format!("unknown action {other}")),
                };
                Ok(Outcome::new(d, format!("policy:{}", r["model"].as_str().unwrap_or("hu"))))
            }),
            3 => timed(&self.meta, || {
                let hand = Self::native_hand(v)?;
                let mut g = self.native.lock().unwrap();
                let p = g.as_mut().ok_or("3-player model not loaded")?;
                let r = p.call(&json!({"op": "decide", "seat": v.seat, "agent": "policy:np3", "seed": req.seed, "view": "native", "hand": hand}));
                let r = match r {
                    Ok(r) => r,
                    Err(e) => {
                        *g = None;
                        return Err(e);
                    }
                };
                if r["ok"] != json!(true) {
                    return Err(r["error"].as_str().unwrap_or("nplayer_serve failed").to_string());
                }
                let d = Self::from_native(v, &r["action"])?;
                Ok(Outcome::new(d, "policy:np3").with(json!({"trained": r["trained"]})))
            }),
            n => Err(format!("CFR-NLHE plays 2–3 players, not {n}")),
        }
    }
}

fn v_json(req: &DecideRequest) -> Value {
    let v = &req.view;
    json!({
        "seat": v.seat, "sb": v.small_blind, "bb": v.big_blind, "hole": v.hole, "board": v.board,
        "startStacks": v.start_stacks, "street": v.street,
        "actions": v.actions.iter().map(|a| json!({"seat": a.seat, "street": a.street, "kind": a.kind, "amount": a.amount})).collect::<Vec<_>>(),
        "toCall": v.to_call, "minRaiseTo": v.min_raise_to, "maxRaiseTo": v.max_raise_to,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::{ActionEvent, View};

    #[test]
    fn native_deck_places_hero_cards_and_board_and_is_a_permutation() {
        let v = View {
            hand_id: 1, num_seats: 3, seat: 2, sb_seat: 1, bb_seat: 2, small_blind: 5, big_blind: 10, ante: 0, street: 1,
            hole: vec![50, 51], board: vec![0, 1, 2], stacks: vec![1000; 3], start_stacks: vec![1000, 1000, 1000],
            bets: vec![0; 3], committed: vec![20; 3], folded: vec![false; 3], all_in: vec![false; 3], pot: 60,
            current_bet: 0, to_call: 0, can_raise: true, min_raise_to: 10, max_raise_to: 980, player_ids: vec![],
            actions: vec![ActionEvent { seat: 0, street: 0, kind: "raise".into(), amount: 20, all_in: false }],
        };
        let h = Cfr::native_hand(&v).unwrap();
        let deck: Vec<u64> = h["deck"].as_array().unwrap().iter().map(|c| c.as_u64().unwrap()).collect();
        let mut sorted = deck.clone();
        sorted.sort();
        assert_eq!(sorted, (0..52).collect::<Vec<_>>());
        // Seat 2 is the second dealt (offset 1 from the button): cards at 1 and 1 + n.
        assert_eq!((deck[1], deck[4]), (50, 51));
        assert_eq!(&deck[6..9], &[0, 1, 2]);
        assert_eq!(h["stacks"], serde_json::json!([10000, 10000, 10000]));
        assert_eq!(h["actions"], serde_json::json!([["raise", 200]]));
    }
}
