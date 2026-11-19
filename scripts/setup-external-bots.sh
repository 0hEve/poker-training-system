#!/bin/sh
# Installs everything the external bots need. Idempotent: rerun it any time; finished steps are skipped
# and downloads resume. See docs/external-bots.md.
#
#   npm run bots:setup              build + Python envs + start downloads/training in the background
#   npm run bots:setup -- assemble  verify and assemble finished downloads (run when they are done)
#   npm run bots:setup -- status    show what is installed
#
# Assets go to $POKER_BOTS_HOME (default <repo>/bot-assets, git-ignored). Needs: git, Rust (rustup), uv, aria2c, a C++
# compiler (Xcode command line tools). About 80 GB of disk for everything below.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOME_DIR=${POKER_BOTS_HOME:-$ROOT/bot-assets}
EXT="$ROOT/external"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
mkdir -p "$HOME_DIR"/sharingan "$HOME_DIR"/cfr/k50 "$HOME_DIR"/cfr/v042 "$HOME_DIR"/cfr/v053 "$HOME_DIR"/cfr/v055 "$HOME_DIR"/cfr/v060 "$HOME_DIR"/slumbot
say() { printf '\n== %s\n' "$*"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

status() {
  for f in sharingan/B-local-2e10.plcp sharingan/buckets-200 cfr/k50/river-k50.bin cfr/v042/O10B-HU20-opponent-sampled-average-seed-2026100601.jsonl.gz \
           cfr/v060/NP3-100BB-v060-seed-2026101935003.bin slumbot/latest_batch venv/bin/python cfr/venv/bin/python; do
    if [ -e "$HOME_DIR/$f" ] && ! ls "$HOME_DIR/$f".aria2 >/dev/null 2>&1; then echo "  ok      $f"; else echo "  missing $f"; fi
  done
  [ -f "$HOME_DIR/slumbot/latest_batch" ] && echo "  slumbot blueprint: $(( ($(cat "$HOME_DIR/slumbot/latest_batch") + 1) * 10 ))M iterations"
  return 0
}

assemble() {
  say "Sharingan B-local blueprint"
  S="$HOME_DIR/sharingan"
  if [ ! -f "$S/B-local-2e10.plcp" ] && [ -f "$S/B-local-2e10.plcp.part-01" ] && [ ! -f "$S/B-local-2e10.plcp.part-00.aria2" ]; then
    (cd "$S" && grep 'B-local' SHA256SUMS.parts | shasum -a 256 -c -) && cat "$S/B-local-2e10.plcp.part-00" "$S/B-local-2e10.plcp.part-01" > "$S/B-local-2e10.plcp.tmp" \
      && [ "$(sha "$S/B-local-2e10.plcp.tmp")" = "$(grep 'B-local-2e10.plcp$' "$S/SHA256SUMS.models" | cut -d' ' -f1)" ] \
      && mv "$S/B-local-2e10.plcp.tmp" "$S/B-local-2e10.plcp" && rm -f "$S"/B-local-2e10.plcp.part-0? && echo "assembled"
  else echo "skipped (done or still downloading)"; fi
  [ -d "$S/buckets-200" ] || { [ -f "$S/buckets-200.tar" ] && tar xf "$S/buckets-200.tar" -C "$S" && echo "buckets extracted"; }

  say "CFR-NLHE 3-player v0.6.0 model"
  V="$HOME_DIR/cfr/v060"; M="$V/NP3-100BB-v060-seed-2026101935003.bin"
  if [ ! -f "$M" ] && ! ls "$V"/*.aria2 >/dev/null 2>&1 && [ -f "$V/NP3-100BB-v060-seed-2026101935003.bin.part-014" ]; then
    cat "$V"/NP3-100BB-v060-seed-2026101935003.bin.part-* > "$M.tmp"
    if [ "$(sha "$M.tmp")" = d835f61f4a5407bd47e8f8a5da849ef82c16ad21fce32f15dce72d5997275189 ]; then mv "$M.tmp" "$M" && rm -f "$V"/*.part-* && echo assembled
    else rm -f "$M.tmp"; echo "checksum mismatch: delete the parts and rerun setup"; fi
  else echo "skipped (done or still downloading)"; fi

  say "CFR-NLHE K50 card tables into the HU bundles"
  if ! ls "$HOME_DIR"/cfr/k50/*.aria2 >/dev/null 2>&1 && [ -f "$HOME_DIR/cfr/k50/river-k50.bin" ]; then
    for d in v053 v055; do for k in flop turn river; do
      [ -e "$HOME_DIR/cfr/$d/$k-k50.bin" ] || ln "$HOME_DIR/cfr/k50/$k-k50.bin" "$HOME_DIR/cfr/$d/$k-k50.bin"
    done; done; echo linked
  else echo "skipped (K50 tables still downloading)"; fi
  echo; echo "Restart the gateway (npm run gateway, or restart npm run dev) to load new models."
}

case "${1:-all}" in
  status) status; exit 0 ;;
  assemble) assemble; exit 0 ;;
esac

say "Upstream repositories (git submodules)"
git -C "$ROOT" submodule update --init --depth 1
git -C "$EXT/cfr-nlhe-6max" apply --check "$ROOT/native/patches/cfr-nlhe-6max-variance-probe.patch" 2>/dev/null && git -C "$EXT/cfr-nlhe-6max" apply "$ROOT/native/patches/cfr-nlhe-6max-variance-probe.patch" || true
git -C "$EXT/slumbot2019" apply --check "$ROOT/native/patches/slumbot2019-single-successor.patch" 2>/dev/null && git -C "$EXT/slumbot2019" apply "$ROOT/native/patches/slumbot2019-single-successor.patch" || true

say "Native builds"
cargo build --release --manifest-path "$ROOT/native/bot-gateway/Cargo.toml"
(cd "$EXT/poker-sharingan" && RUSTFLAGS="-C target-cpu=native" cargo build --release -p sharingan-serve --config 'profile.release.panic="unwind"')
(cd "$EXT/cfr-nlhe-6max" && RUSTFLAGS="-C target-cpu=native" cargo build --release --locked --manifest-path native/hu20-trainer/Cargo.toml --example nplayer_serve)
(cd "$EXT/slumbot2019" && make -j8 CFLAGS="-std=c++17 -O3 -mcpu=native -ffast-math -w -include '$ROOT/native/compat/drand48_r.h'" LIBRARIES="-pthread -lstdc++" \
  bin/build_hand_value_tree bin/build_betting_tree bin/build_null_buckets bin/build_rollout_features bin/build_unique_buckets bin/run_ecfr bin/run_bot)

say "Python environments (CFR-NLHE heads-up runtime; the 3.12 venv only regenerates port parity fixtures)"
[ -x "$HOME_DIR/venv/bin/python" ] || uv venv -q --python 3.12 "$HOME_DIR/venv"
uv pip install -q --python "$HOME_DIR/venv/bin/python" eval7 numpy -e "$EXT/poker-sequoia/kit/sdk/agent-protocol" -e "$EXT/poker-sequoia/kit/sdk/engine" -e "$EXT/poker-sequoia/kit/sdk/agent-sdk"
[ -x "$HOME_DIR/cfr/venv/bin/python" ] || uv venv -q --python 3.11 "$HOME_DIR/cfr/venv"
uv pip install -q --python "$HOME_DIR/cfr/venv/bin/python" -r "$EXT/cfr-nlhe-6max/requirements-play.txt"

say "Slumbot abstraction and blueprint training"
SB="$HOME_DIR/slumbot"; BIN="$EXT/slumbot2019/bin"
cp "$ROOT"/native/slumbot/*_params "$SB/"
cp "$ROOT/native/slumbot/train.sh" "$SB/train.sh"
(cd "$SB" && [ -f hand_value_tree.holdem.13.4.7 ] || "$BIN/build_hand_value_tree" holdem_params)
(cd "$SB" && "$BIN/build_betting_tree" holdem_params pt100_params >/dev/null)
(cd "$SB" && [ -f buckets.holdem.13.4.3.hs.3 ] || { "$BIN/build_null_buckets" holdem_params 0 && "$BIN/build_null_buckets" holdem_params 1 \
  && "$BIN/build_rollout_features" holdem_params 2 hs 1.0 wmls 0.5 && "$BIN/build_rollout_features" holdem_params 3 hs 1.0 wmls 0.5 \
  && "$BIN/build_unique_buckets" holdem_params 2 hs hs && "$BIN/build_unique_buckets" holdem_params 3 hs hs; })
if ! pgrep -f run_ecfr >/dev/null; then
  next=$(( $(cat "$SB/latest_batch" 2>/dev/null || echo -1) + 1 ))
  if [ $next -le 11 ]; then nohup "$SB/train.sh" "$BIN" $next 11 > "$SB/train.out" 2>&1 & echo "training batches $next..11 in the background ($SB/train.log)"; fi
fi

say "Downloads (resumable, in the background)"
cp "$ROOT/native/downloads/sharingan-fetch.sh" "$HOME_DIR/sharingan/fetch.sh"
cp "$ROOT/native/downloads/cfr-fetch.sh" "$HOME_DIR/cfr/fetch.sh"
cp "$ROOT/native/downloads/cfr-urls.txt" "$HOME_DIR/cfr/urls.ordered.txt"
sed -i '' "s|@HOME@|$HOME_DIR|g" "$HOME_DIR/cfr/urls.ordered.txt" 2>/dev/null || sed -i "s|@HOME@|$HOME_DIR|g" "$HOME_DIR/cfr/urls.ordered.txt"
for f in SHA256SUMS.parts SHA256SUMS.models; do
  [ -f "$HOME_DIR/sharingan/$f" ] || curl -sfL "https://huggingface.co/markokraemer/sharingan-1/resolve/main/$f" -o "$HOME_DIR/sharingan/$f"
done
[ -f "$HOME_DIR/sharingan/buckets-200.tar" ] || curl -fL "https://huggingface.co/markokraemer/sharingan-1/resolve/main/buckets-200.tar" -o "$HOME_DIR/sharingan/buckets-200.tar"
pgrep -f "sharingan/fetch.sh" >/dev/null || nohup "$HOME_DIR/sharingan/fetch.sh" > "$HOME_DIR/sharingan/fetch.out" 2>&1 &
pgrep -f "cfr/fetch.sh" >/dev/null || nohup "$HOME_DIR/cfr/fetch.sh" > "$HOME_DIR/cfr/fetch.out" 2>&1 &

assemble
say "Status"; status
