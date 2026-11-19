#!/bin/sh
# Slumbot2019 ECFR blueprint in 10M-iteration batches. Each batch resumes the previous one;
# the bot always plays the newest finished batch. Usage: train.sh <first batch> <last batch>
cd "$(dirname "$0")"
BIN="$1"; shift
first=${1:-0}; last=${2:-9}
b=$first
while [ $b -le $last ]; do
  "$BIN/run_ecfr" holdem_params nhs2_params pt100_params ecfr_params 12 $b $((b+1)) 10000000 1 >> train.log 2>&1 || exit 1
  echo $b > latest_batch
  # keep only the newest checkpoint's regrets (sumprobs of older batches are not needed either)
  prev=$((b-3)); [ $prev -ge 0 ] && rm -f holdem.*.nhs2.*.pt100.ecfr/*.x.0.0.[0-3].$prev.p* 2>/dev/null
  b=$((b+1))
done
echo TRAINED
