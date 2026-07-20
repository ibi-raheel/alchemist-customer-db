#!/usr/bin/env python3
"""Daily local backup of the Alchemist customer database.

Reads .env (Supabase URL + service-role key) from its own folder and saves
every table to a dated subfolder of ./backups as JSON (for restore) + CSV
(for Excel). Retries transient network errors; prunes backups older than
KEEP_DAYS. See BACKUP_SETUP.md for the scheduled-daily install.

Run manually:  python3 scripts/backup.py
"""
import os, sys, csv, json, time, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(HERE, ".env")
BACKUP_ROOT = os.path.join(HERE, "backups")
KEEP_DAYS = 30
TABLES = ["branches", "profiles", "branch_logins", "customers", "purchases", "loyalty_ledger"]


def read_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def fetch_all(url, key, table):
    rows, offset = [], 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/{table}?select=*&limit=1000&offset={offset}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        for attempt in range(5):  # retry transient network errors
            try:
                batch = json.loads(urllib.request.urlopen(req, timeout=30).read())
                break
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(2)
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def prune(root, keep_days):
    if not os.path.isdir(root):
        return
    from datetime import date, timedelta
    import shutil
    cutoff = date.today() - timedelta(days=keep_days)
    for name in os.listdir(root):
        try:
            d = datetime.strptime(name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if d < cutoff:
            shutil.rmtree(os.path.join(root, name), ignore_errors=True)


def main():
    if not os.path.exists(ENV_FILE):
        sys.exit(f"Missing {ENV_FILE} — copy the app's .env.local here (URL + service key).")
    env = read_env(ENV_FILE)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")

    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    out_dir = os.path.join(BACKUP_ROOT, stamp)
    os.makedirs(out_dir, exist_ok=True)
    print(f"[{datetime.now().isoformat(timespec='seconds')}] backing up to {out_dir}")

    manifest = {"backed_up_at": datetime.now(timezone.utc).astimezone().isoformat(), "tables": {}}
    for table in TABLES:
        try:
            rows = fetch_all(url, key, table)
        except Exception as e:
            print(f"  ! {table}: FAILED ({e})")
            manifest["tables"][table] = "error"
            continue
        with open(os.path.join(out_dir, f"{table}.json"), "w") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
        if rows:
            fields = list({k for r in rows for k in r.keys()})
            with open(os.path.join(out_dir, f"{table}.csv"), "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)
        manifest["tables"][table] = len(rows)
        print(f"  OK {table}: {len(rows)} rows")

    with open(os.path.join(out_dir, "_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    prune(BACKUP_ROOT, KEEP_DAYS)
    print("  done")


if __name__ == "__main__":
    main()
