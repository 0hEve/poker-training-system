//! DecisionHoldem (AI-Decision/DecisionHoldem). Listed so it can be found, but it cannot run here:
//! - real-time search and blueprint play ship only as closed-source Linux x86-64 shared objects
//!   (`AlascasiaHoldem.so`, `blueprint.so`);
//! - the blueprint and every card-cluster table are distributed only through Baidu Netdisk;
//! - the engine loads its river clusters into RAM twice (2 x 2652 x 2,118,760 entries, ~34 GB) plus
//!   the blueprint tree, and was built for a 512 GB workstation.
//! If those files and a large Linux x86 machine are available, `external/decisionholdem` holds the
//! upstream code and interface to wire up.

use super::{Backend, BotInfo, Meta, Status};
use crate::view::{DecideRequest, Outcome};

pub struct DecisionHoldem {
    meta: Meta,
}

pub const REASON: &str = "Needs closed-source Linux x86 libraries, blueprint/cluster files that exist only on Baidu Netdisk, and ~100 GB RAM (river clusters alone are ~34 GB, loaded twice).";

impl DecisionHoldem {
    pub fn new() -> Self {
        let meta = Meta::default();
        meta.set(Status::Unavailable(REASON.into()));
        DecisionHoldem { meta }
    }
}

impl Backend for DecisionHoldem {
    fn info(&self) -> BotInfo {
        self.meta.fill(BotInfo {
            id: "decisionholdem".into(),
            name: "DecisionHoldem".into(),
            description: "Heads-up blueprint + safe depth-limited search (beat Slumbot by 730 mbb/h). Not runnable on this machine.".into(),
            source: "https://github.com/AI-Decision/DecisionHoldem".into(),
            seats: [2, 2],
            status: Status::Unavailable(String::new()),
            decisions: 0,
            errors: 0,
            mean_ms: 0.0,
        })
    }

    fn decide(&self, _req: &DecideRequest) -> Result<Outcome, String> {
        Err(REASON.into())
    }
}
