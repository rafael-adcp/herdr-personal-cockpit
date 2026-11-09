#!/bin/sh
# Copies the mod and the layout into the Herdr home, then switches to it.
#
# A copy, not a symlink. Linking looks better -- the app hot-reloads as you
# edit -- and the JavaScript really does load through it, so the panels come up
# and nothing reports an error. But every svg("mods/personal-cockpit/...") then
# resolves to a path outside the Herdr home and silently draws nothing: the
# refresh, gear, dock and minimise buttons all vanish from the headers.
# Verified by A/B on Windows 0.1.13; assumed to hold here, so copy.
#
#   --no-switch   install without changing the shown layout
#   --no-layout   install the mod only, leaving layouts/cockpit.json alone

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
herdr=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
name=personal-cockpit

switch=1
layout=1
for arg in "$@"; do
  case $arg in
    --no-switch) switch=0 ;;
    --no-layout) layout=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -d "$herdr" ] || { echo "No Herdr home at $herdr -- start the app once first." >&2; exit 1; }

dst=$herdr/mods/$name

# routines.yml, team.yml and jira.config.json belong to the person: they are
# edited in place so that a new routine or a new teammate never means
# reinstalling. The copy below wipes the folder, so they are stashed across it
# and put back.
confs="routines.yml team.yml jira.config.json"
keep=$(mktemp -d)
for c in $confs; do
  [ -f "$dst/$c" ] && cp -- "$dst/$c" "$keep/$c"
done

# A previous symlink install has to go before a copy can land. Removing the
# link itself, never what it points at.
[ -L "$dst" ] && rm -- "$dst"
rm -rf -- "$dst"
mkdir -p -- "$dst"

for f in "$root/mods/$name"/*; do
  case $(basename -- "$f") in
    gpui-kit.d.ts|jsconfig.json) continue ;;   # the app writes these itself
    routines.yml|team.yml|jira.config.json) continue ;;         # the person's, restored below
  esac
  # -R because the mod folder may hold directories. Without it `cp` refuses a
  # directory, exits 1, and `set -e` ends the install at the first one -- so
  # nothing is installed at all. The exclusions above are basenames at the top
  # level, which is where the generated and personal files live; a subfolder is
  # copied whole and none of them can hide inside one.
  cp -R -- "$f" "$dst/"
done
echo "mod      -> $dst"

# Theirs if they had one, the example if they did not: an install never
# overwrites what somebody wrote. The gear in those panels seeds a file deleted
# later, so the two ways in agree.
for c in $confs; do
  if [ -f "$keep/$c" ]; then
    cp -- "$keep/$c" "$dst/$c"
    echo "config   -> kept $dst/$c"
  fi
done
for c in routines team; do
  if [ ! -f "$dst/$c.yml" ] && [ -f "$dst/$c.example.yml" ]; then
    cp -- "$dst/$c.example.yml" "$dst/$c.yml"
    echo "config   -> $dst/$c.yml (from the example)"
  fi
done
rm -rf -- "$keep"

if [ "$layout" -eq 1 ]; then
  # The .json and the .svg its "preview" field points at; the Settings picker
  # draws a blank frame without the second one.
  for ext in json svg; do
    if [ -f "$root/layouts/cockpit.$ext" ]; then
      cp -- "$root/layouts/cockpit.$ext" "$herdr/layouts/cockpit.$ext"
      echo "layout   -> $herdr/layouts/cockpit.$ext"
    fi
  done
fi

command -v herdr-app >/dev/null 2>&1 || { echo "herdr-app not found; switch the layout yourself."; exit 0; }
herdr-app check "$dst"
if [ "$switch" -eq 1 ]; then
  herdr-app do layout.switch --name cockpit >/dev/null
  echo "layout   -> switched to cockpit"
fi
