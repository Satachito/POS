#!/bin/sh
#	Close of business. Run on the Pi.
#
#	Compaction has to happen with the server stopped -- a write that lands in the log between
#	the read and the truncate would be lost, and that write is somebody's order.
set -e

cd "$(dirname "$0")/.."

node tools/compact.js || { sudo systemctl stop pos; node tools/compact.js; }

#	The data is plain text, so git is the backup: a full history with readable diffs, and
#	"put it back to how it was at 18:00" is a checkout.
git add data/pos
git commit -m "close $(date +%F)" || echo "nothing changed today"

rsync -a data/pos/ /mnt/backup/pos/

sudo systemctl start pos
echo "open for tomorrow"
