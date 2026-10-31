#!/usr/bin/env bash
# One-time Odoo Community setup inside WSL Ubuntu.
# Run from Windows:  wsl -d Ubuntu-22.04 -u root bash scripts/wsl/odoo-setup.sh
# Installs PostgreSQL and Odoo, creates the "mcl" database with the Purchase app and no demo data.
set -euo pipefail

ODOO_VERSION="${ODOO_VERSION:-18.0}"
DB="${ODOO_DB:-mcl}"
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing PostgreSQL"
apt-get update -q
apt-get install -y -q postgresql wget gnupg ca-certificates
systemctl enable --now postgresql

echo "==> Adding the Odoo $ODOO_VERSION apt repository"
wget -qO - https://nightly.odoo.com/odoo.key | gpg --dearmor --yes -o /usr/share/keyrings/odoo-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/odoo-archive-keyring.gpg] https://nightly.odoo.com/$ODOO_VERSION/nightly/deb/ ./" \
  > /etc/apt/sources.list.d/odoo.list
apt-get update -q

echo "==> Installing Odoo (this takes a few minutes)"
apt-get install -y -q odoo

# The package normally creates this role; make sure it exists.
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='odoo'\"" | grep -q 1 \
  || su - postgres -c "createuser -s odoo"

echo "==> Configuring Odoo for one local database"
CONF=/etc/odoo/odoo.conf
MASTER="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
cat > "$CONF" <<EOF
[options]
db_host = False
db_port = False
db_user = odoo
db_password = False
admin_passwd = $MASTER
dbfilter = ^$DB\$
list_db = False
http_port = 8069
addons_path = /usr/lib/python3/dist-packages/odoo/addons
EOF
chown odoo:odoo "$CONF"
chmod 640 "$CONF"

systemctl stop odoo || true

if su - postgres -c "psql -lqt" | cut -d'|' -f1 | grep -qw "$DB"; then
  echo "==> Database $DB already exists, skipping creation"
else
  echo "==> Creating database $DB with the Purchase app (no demo data)"
  su odoo -s /bin/bash -c "odoo -c $CONF -d $DB -i purchase --without-demo=all --stop-after-init --log-level=warn"
fi

systemctl enable --now odoo
echo "==> Waiting for Odoo on port 8069"
for _ in $(seq 1 60); do
  if wget -qO /dev/null "http://localhost:8069/web/login"; then
    echo "==> Odoo is up: http://localhost:8069  (user: admin, password: admin)"
    exit 0
  fi
  sleep 2
done
echo "Odoo did not answer on 8069. Check: journalctl -u odoo -n 50" >&2
exit 1
