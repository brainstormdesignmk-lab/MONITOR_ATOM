const { execFile } = require("child_process");
const ssh = require("./ssh");

// Collects on Linux with standard antiX tools; output is a small tab-delimited protocol.
const SCRIPT = String.raw`
printf 'cpu\t'; awk '/^cpu / { for (i=2;i<=NF;i++) printf "%s%s", (i==2?"":" "), $i; print "" }' /proc/stat
awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {printf "memory\t%d\t%d\n",t,a}' /proc/meminfo
for f in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp*_input; do
  [ -r "$f" ] || continue
  v=$(cat "$f" 2>/dev/null) || continue
  case "$v" in *[!0-9]*|'') continue;; esac
  awk -v v="$v" 'BEGIN {printf "temp\t%.1f\n",v/1000}'
done
df -Pk -x tmpfs -x devtmpfs -x squashfs -x proc -x sysfs 2>/dev/null | awk 'NR>1 {m=$NF; for(i=6;i<NF;i++) m=m " " $i; printf "disk\t%s\t%s\t%s\t%s\t%s\n",$(NF-5),$(NF-4),$(NF-3),$(NF-2),m}'
for path in /sys/class/net/*; do
  [ -e "$path" ] || continue
  dev=$(basename "$path")
  [ "$dev" = lo ] && continue
  state=$(cat "$path/operstate" 2>/dev/null || printf unknown)
  carrier=$(cat "$path/carrier" 2>/dev/null || printf 0)
  if [ "$state" = up ] || [ "$carrier" = 1 ]; then state=active; else state=down; fi
  addr=-
  if command -v ip >/dev/null 2>&1; then
    addr=$(ip -o -4 addr show dev "$dev" 2>/dev/null | awk 'NR==1 {split($4,a,"/"); print a[1]}')
  fi
  [ -n "$addr" ] || addr=-
  printf 'iface\t%s\t%s\t%s\n' "$dev" "$addr" "$state"
done
`;

function parse(stdout) {
    const result = { cpuCounters: null, memory: null, temperatures: [], disks: [], interfaces: [] };
    for (const line of stdout.split(/\r?\n/)) {
        const fields = line.split("\t");
        if (fields[0] === "cpu") result.cpuCounters = fields[1].split(/\s+/).map(Number);
        else if (fields[0] === "memory") result.memory = { totalKb: Number(fields[1]), availableKb: Number(fields[2]) };
        else if (fields[0] === "temp") result.temperatures.push(Number(fields[1]));
        else if (fields[0] === "disk" && fields.length >= 6) {
            result.disks.push({ filesystem: fields[1], totalKb: Number(fields[2]), usedKb: Number(fields[3]), availableKb: Number(fields[4]), mount: fields.slice(5).join("\t") });
        } else if (fields[0] === "iface" && fields.length >= 4) {
            result.interfaces.push({ name: fields[1], address: fields[2], state: fields[3] });
        }
    }
    return result;
}

function localSnapshot(timeout) {
    return new Promise(resolve => {
        execFile("sh", ["-c", SCRIPT], { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            resolve(error ? { ok: false, error: error.message } : { ok: true, metrics: parse(stdout) });
        });
    });
}

async function collect(node, timeout) {
    const encoded = Buffer.from(SCRIPT).toString("base64");
    const result = node.local
        ? await localSnapshot(timeout)
        : await ssh.runSSH(node, `printf %s ${encoded} | base64 -d | sh`, timeout);
    if (!result.ok) return result;
    return { ok: true, metrics: node.local ? result.metrics : parse(result.stdout) };
}

module.exports = { collect, parse, SCRIPT };
