#!/usr/bin/env bash
# Run by the agent in hello.yml's agent-env job. Reports which secrets the agent's shell
# can reach, and where, without printing any value: every candidate is compared by its
# sha256 against the hashes a shell step wrote before the agent started.
# Usage: agent-env-probe.sh <secret-hashes> <report>
set -u
hashes=$1 report=$2
: > "$report"
say() { echo "$*" >> "$report"; }

sha() { printf %s "$1" | sha256sum | cut -c1-64; }
match() { grep -m1 "^$(sha "$1") " "$hashes" | cut -d' ' -f2; }
check() { # <where> <value>
  local name; name=$(match "$2")
  if [ -n "$name" ]; then say "FOUND $name in $1"; fi
}
tokens() { grep -aoE '(ghp_|ghs_|gho_|ghu_|github_pat_|sk-ant-)[A-Za-z0-9_-]{10,}' "$@" 2>/dev/null | sort -u; }

say "== env names in the agent's shell that look like credentials"
env | cut -d= -f1 | grep -E 'TOKEN|SECRET|KEY|^PAT$|_PAT$|AUTH|PASSW' | sort | sed 's/^/  /' >> "$report"

say "== matches"
# 1. The agent's own environment, whole values.
while IFS= read -r -d '' line; do check "own env (${line%%=*})" "${line#*=}"; done < <(env -0)

# 2. Other processes' environments this user can read (the action's own Node process, the runner).
for f in /proc/[0-9]*/environ; do
  [ -r "$f" ] || continue
  pid=${f#/proc/}; pid=${pid%/environ}; cmd=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | head -n1); cmd=${cmd##*/}  # program name only: arguments can hold secrets
  while IFS= read -r -d '' line; do check "pid $pid [$cmd] env (${line%%=*})" "${line#*=}"; done < "$f"
done

# 3. Git credentials: checkout's extraheader is base64 of x-access-token:<token>.
for cfg in "${GITHUB_WORKSPACE:-.}/.git/config" "$HOME/.gitconfig"; do
  [ -r "$cfg" ] || continue
  grep -i 'extraheader' "$cfg" | grep -oE '[A-Za-z0-9+/=]{20,}' | while read -r b; do
    t=$(printf %s "$b" | base64 -d 2>/dev/null | cut -d: -f2-)
    check "$cfg extraheader" "$t"
  done
done
while read -r t; do check "git credential helper" "$t"; done < <(printf 'protocol=https\nhost=github.com\n\n' | timeout 5 git credential fill 2>/dev/null | sed -n 's/^password=//p')

# 4. Token-shaped strings in files the agent can read.
for dir in "$HOME" "${RUNNER_TEMP:-/nonexistent}" "${GITHUB_WORKSPACE:-.}/.git" /tmp; do
  [ -d "$dir" ] || continue
  while read -r t; do check "a file under $dir" "$t"; done < <(find "$dir" -type f -size -2M -readable -print0 2>/dev/null | xargs -0 -r grep -laE '(ghp_|ghs_|gho_|ghu_|github_pat_|sk-ant-)' 2>/dev/null | xargs -r -d '\n' cat 2>/dev/null | tokens -)
done

say "== summary: $(grep -c '^FOUND' "$report") match(es)"
cut -d' ' -f2 "$hashes" | while read -r name; do
  if grep -q "^FOUND $name " "$report"; then say "  $name: reachable"; else say "  $name: not found"; fi
done
