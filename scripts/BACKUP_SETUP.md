# Daily local database backup

`backup.py` saves every table (customers, purchases, loyalty ledger, branches,
logins, profiles) to a dated folder as JSON + CSV. It reads the Supabase URL and
service-role key from a `.env` file next to it — **no secrets are stored in the
script or committed to git.**

## Install (macOS — runs automatically every day)

The live install lives **outside** `~/Documents` (`~/alchemist-backup/`) because
macOS blocks scheduled jobs from reading Documents.

```bash
# 1. Folder + credentials (copy the app's env so no keys are retyped)
mkdir -p ~/alchemist-backup/backups
cp "<app>/.env.local" ~/alchemist-backup/.env
chmod 600 ~/alchemist-backup/.env
cp scripts/backup.py ~/alchemist-backup/backup.py

# 2. Test it
/usr/bin/python3 ~/alchemist-backup/backup.py

# 3. Schedule daily at 2 PM via LaunchAgent
#    (plist: ~/Library/LaunchAgents/com.alchemist.backup.plist — see below)
launchctl load -w ~/Library/LaunchAgents/com.alchemist.backup.plist
```

LaunchAgent plist runs `/usr/bin/python3 ~/alchemist-backup/backup.py` on
`StartCalendarInterval` Hour 14 / Minute 0, logging to
`~/alchemist-backup/backup.log`.

## Notes
- **Retention:** keeps the last 30 days (`KEEP_DAYS`), auto-prunes older.
- **Resilience:** retries transient network errors; catches up on next wake if
  the Mac was asleep at 2 PM.
- **Restore:** the JSON files can be re-imported via the Supabase REST API;
  schema comes from `supabase/migrations/`.
- **⚠ Key rotation:** when the Supabase service-role key is rotated, update
  `~/alchemist-backup/.env` too, or backups will start failing.
- Backup output folders contain customer PII — they are **not** committed to git.
