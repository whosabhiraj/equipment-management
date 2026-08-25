#!/bin/bash
# scripts/backup.sh
# D1 Database Backup Automation Script
# Dumps remote Cloudflare D1 database into a local SQLite .db file.

# Exit on any error
set -e

DB_NAME="hostel-booking-prod"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SQL_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql"
DB_FILE="$BACKUP_DIR/backup_$TIMESTAMP.db"

echo "=== Starting D1 Database Backup ==="
echo "Target D1 Database: $DB_NAME"
echo "Timestamp: $TIMESTAMP"

# 1. Create backups folder if not exists
mkdir -p "$BACKUP_DIR"

# 2. Export database schema and content to SQL dump file
echo "Exporting remote D1 to SQL dump..."
wrangler d1 export "$DB_NAME" --remote --output="$SQL_FILE"

# 3. Create a local SQLite database file from the SQL export
if command -v sqlite3 &> /dev/null; then
  echo "Compiling SQL dump into local SQLite file: $DB_FILE"
  sqlite3 "$DB_FILE" < "$SQL_FILE"
  echo "Local SQLite file created successfully."
else
  echo "[WARNING] 'sqlite3' CLI tool not found in PATH."
  echo "Exported SQL file saved at: $SQL_FILE"
  echo "To load it manually: sqlite3 backup.db < $SQL_FILE"
fi

echo "=== Backup Completed Successfully ==="
echo "SQL Dump: $SQL_FILE"
if [ -f "$DB_FILE" ]; then
  echo "SQLite DB: $DB_FILE"
fi
