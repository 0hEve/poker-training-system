//! The app's `BotView` / `Decision` / `HandSummary` (src/bots/types.ts), as JSON.
//!
//! Cards are 0..51: rank = card >> 2 (0 = deuce), suit = card & 3 (0 s, 1 h, 2 d, 3 c).
//! Seat 0 is the button; heads-up the button is also the small blind.
//! The structs mirror the app's full messages; not every backend reads every field.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvent {
    pub seat: usize,
    pub street: u8,
    /// post | fold | check | call | bet | raise
    pub kind: String,
    /// post/call: chips added; bet/raise: new street total; fold/check: 0.
    pub amount: i64,
    #[serde(default)]
    pub all_in: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub hand_id: i64,
    pub num_seats: usize,
    pub seat: usize,
    pub sb_seat: usize,
    pub bb_seat: usize,
    pub small_blind: i64,
    pub big_blind: i64,
    pub ante: i64,
    pub street: u8,
    pub hole: Vec<u8>,
    pub board: Vec<u8>,
    pub stacks: Vec<i64>,
    pub start_stacks: Vec<i64>,
    pub bets: Vec<i64>,
    pub committed: Vec<i64>,
    pub folded: Vec<bool>,
    pub all_in: Vec<bool>,
    pub pot: i64,
    pub current_bet: i64,
    pub to_call: i64,
    pub can_raise: bool,
    pub min_raise_to: i64,
    pub max_raise_to: i64,
    pub actions: Vec<ActionEvent>,
    #[serde(default)]
    pub player_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DecideRequest {
    pub bot: String,
    /// Stable id of one bot instance (one seat at one table); per-instance memory keys on it.
    #[serde(default)]
    pub instance: String,
    #[serde(default)]
    pub seed: u64,
    pub view: View,
    /// `HandSummary` objects for hands finished since this instance's last decision.
    #[serde(default)]
    pub events: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Decision {
    Fold,
    Check,
    Call,
    Raise { to: i64 },
    AllIn,
}

pub struct Outcome {
    pub decision: Decision,
    /// Where the answer came from, e.g. "blueprint", "search", "policy:hu100".
    pub source: String,
    pub detail: Value,
}

impl Outcome {
    pub fn new(decision: Decision, source: impl Into<String>) -> Self {
        Outcome { decision, source: source.into(), detail: Value::Null }
    }
    pub fn with(mut self, detail: Value) -> Self {
        self.detail = detail;
        self
    }
}

pub const RANKS: &[u8] = b"23456789TJQKA";
pub const SUITS: &[u8] = b"shdc";

pub fn card_str(c: u8) -> String {
    let mut s = String::with_capacity(2);
    s.push(RANKS[(c >> 2) as usize] as char);
    s.push(SUITS[(c & 3) as usize] as char);
    s
}

pub fn parse_card(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let r = RANKS.iter().position(|&x| x == b[0].to_ascii_uppercase())?;
    let su = SUITS.iter().position(|&x| x == b[1].to_ascii_lowercase())?;
    Some(((r << 2) | su) as u8)
}

impl View {
    /// Chips each seat put in before the current street.
    pub fn committed_before_street(&self) -> Vec<i64> {
        self.committed.iter().zip(&self.bets).map(|(c, b)| c - b).collect()
    }

    /// Passive fallback: check if free, otherwise fold.
    pub fn passive(&self) -> Decision {
        if self.to_call == 0 { Decision::Check } else { Decision::Fold }
    }

    /// Clamp a "raise to street total" into the legal range; degrade to call/check when raising is illegal.
    pub fn raise_to(&self, to: i64) -> Decision {
        if !self.can_raise {
            return if self.to_call > 0 { Decision::Call } else { Decision::Check };
        }
        let to = to.clamp(self.min_raise_to, self.max_raise_to);
        if to >= self.max_raise_to { Decision::AllIn } else { Decision::Raise { to } }
    }

    pub fn check_or_call(&self) -> Decision {
        if self.to_call > 0 { Decision::Call } else { Decision::Check }
    }

    /// Every card the hero can see.
    pub fn known_cards(&self) -> u64 {
        self.hole.iter().chain(&self.board).fold(0u64, |m, &c| m | (1u64 << c))
    }

    pub fn summary_json(&self) -> Value {
        json!({"seats": self.num_seats, "street": self.street, "toCall": self.to_call})
    }
}
