#!/bin/sh
# Resumable: re-requests fresh signed URLs on every pass.
cd "$(dirname "$0")"
for i in $(seq 1 40); do
  aria2c -i urls.ordered.txt -x16 -s16 -j3 -k8M --continue=true --auto-file-renaming=false --timeout=30 --max-tries=2 --console-log-level=warn --summary-interval=0 >> aria.log 2>&1
  [ -z "$(find . -name '*.aria2')" ] && echo DOWNLOADED && exit 0
  sleep 3
done
exit 1
