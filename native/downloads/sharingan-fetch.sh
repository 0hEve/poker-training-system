#!/bin/sh
# Resumable Sharingan B-local download; each pass fetches a fresh signed URL.
cd "$(dirname "$0")"
for p in 00 01; do
  for i in $(seq 1 60); do
    [ -f B-local-2e10.plcp.part-$p ] && [ ! -f B-local-2e10.plcp.part-$p.aria2 ] && break
    aria2c -x16 -s16 -k16M --continue=true --auto-file-renaming=false --timeout=30 --max-tries=3 --lowest-speed-limit=50K \
      --console-log-level=warn --summary-interval=60 -o B-local-2e10.plcp.part-$p \
      "https://huggingface.co/markokraemer/sharingan-1/resolve/main/B-local-2e10.plcp.part-$p" >> aria2.log 2>&1
    sleep 3
  done
done
[ ! -f B-local-2e10.plcp.part-00.aria2 ] && echo DOWNLOADED
