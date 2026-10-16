# Atom6 monitoring appliance

Atom6 (`192.168.1.16`) runs the collector and local status API. The API binds to
`127.0.0.1:8500`; operators reach it through SSH and start the interactive
terminal dashboard on Atom6. This keeps the status endpoint off the LAN while
making the dashboard available from a remote SSH terminal.

## Fleet inventory

`config/nodes.json` includes Atom1–Atom6 and T60 at the addresses supplied for
the cluster. Atom6 is measured locally. Other machines are collected over SSH.
Edit `sshUser` in that file if a machine uses another account. The checked-in
inventory currently assumes the `atom` SSH account on every peer.

The `UP`/`SSH DOWN` state reports whether the host's SSH metrics collection
works; it cannot prove that a machine is powered off when SSH is unavailable.
The collector reports CPU usage, when two samples are
available; the highest exposed thermal sensor; memory used and available;
mounted filesystem capacity; and IPv4 addresses plus link state for network
interfaces. A USB or SD filesystem appears after it is mounted. A host without
a readable temperature sensor displays `--`. CPU also displays `--` on the
first sample. Application-specific health checks can be added to a node's
`services` array after the real service ports and health endpoints are
confirmed.

## Install and start on antiX 21

The root installer expects Node.js 16 or newer, OpenSSH client, `base64`, `df`,
`awk`, `curl`, SysV init utilities, and an existing `atom` account. With root
access, run from a copy of this repository on Atom6:

```sh
./scripts/deploy.sh
```

The deploy script installs `/opt/metropolis/monitor`, registers the SysV init
service, and checks its local health endpoint. The service runs as `atom` so
that it uses Atom6's SSH keys and known-hosts file. Logs are in
`/opt/metropolis/monitor/data/logs/monitor.log`.

```sh
sudo service metropolis-monitor status
sudo service metropolis-monitor restart
tail -f /opt/metropolis/monitor/data/logs/monitor.log
```

If root access is unavailable, deploy the repository under the `atom` home and
run `scripts/user-service.sh install`. It starts the same restart supervisor
and installs an `@reboot` entry in Atom6's user crontab. This depends on the
cron daemon being enabled at boot. Check it with `scripts/user-service.sh
status`; use `stop`, `start`, or `restart` for control.

## SSH access and dashboard

Before starting the daemon, log in as `atom` on Atom6 and connect to each peer
once. Confirm the host fingerprint through a trusted channel before accepting
it; unattended SSH checks use `BatchMode` and strict host-key checking. Make
sure key-based login works without an interactive prompt and that the key is
available to the `atom` account when the service starts at boot. Do not disable
strict host-key checking.

From a workstation with an interactive terminal:

```sh
ssh -t atom@192.168.1.16 /home/atom/metropolis-monitor/scripts/dashboard.sh
```

Use the arrow keys to move through nodes, Page Up/Page Down to scroll, `r` to
refresh, and `q` to exit. The monitor continues running after the dashboard
exits. The supplied `ssh-monitor-main.zip` is a Rust/Ratatui reference project;
this appliance uses the local Node dashboard instead and does not need Rust or
the ZIP's dependencies.

The selected node's row has **REBOOT** and **SHUTDOWN** controls at its end.
Press Right to move from the node to Reboot, then to Shutdown. Left steps back
from Shutdown to Reboot to the node. Up/Down selects the adjacent node and
returns focus to its default row. Press Enter, then `y`, to confirm; `n` or
Escape cancels. Online machine blocks are green, unavailable blocks are red,
and the selected machine's row and detail lines use the dashboard title's
blue/cyan color; a focused power button has a yellow highlight.
Remote actions run `sudo -n /sbin/reboot` or `sudo -n /sbin/poweroff` over SSH.
Atom6 uses the same commands through local `sudo -n`. The connected Atom1,
Atom4, Atom6, and T60 currently have narrow NOPASSWD sudoers entries for both
commands. Atom2, Atom3, and Atom5 were unreachable during setup, so their
permissions still need verification. Check the command paths on each OS before
adding equivalent narrow sudoers entries with `visudo`; do not grant
passwordless access to a shell to enable these buttons.

## Configuration and recovery

The repository inventory is copied on each deploy, so edit
`config/nodes.json` before deploying changes to the fleet. `.env` values are optional;
the service does not enable automatic restarts of business applications or
external alerts by default. Those actions require service-specific validation
and an operator-approved recovery/notification path.

The SysV service supervises the collector process and restarts it five seconds
after a crash; the dashboard can disconnect without stopping collection. It is not
yet a redundant monitoring system: Atom6, its power/network path, and its
storage remain single points of failure. Confirm backups, UPS behavior, and
the actual antiX init selection on the appliance during commissioning.
