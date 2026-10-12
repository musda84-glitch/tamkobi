# shellcheck shell=sh
# Frontend release build + atomic symlink (sourced after common.sh).

frontend_prev_release_dir() {
  if [ -L "$FRONTEND_CURRENT" ]; then
    readlink -f "$FRONTEND_CURRENT" 2>/dev/null || readlink "$FRONTEND_CURRENT"
  elif [ -d "$FRONTEND_CURRENT" ]; then
    echo "$FRONTEND_CURRENT"
  else
    echo ""
  fi
}

frontend_copy_prev_static() {
  # Keep hashed assets from previous release so open tabs keep working.
  _new=$1
  _prev=$(frontend_prev_release_dir)
  [ -n "$_prev" ] || return 0
  [ -d "$_prev/static" ] || return 0
  [ "$_prev" = "$_new" ] && return 0
  for sub in js css; do
    if [ -d "$_prev/static/$sub" ]; then
      mkdir -p "$_new/static/$sub"
      # Do not overwrite files already produced by the new build.
      # shellcheck disable=SC2039
      cp -n "$_prev/static/$sub/"* "$_new/static/$sub/" 2>/dev/null || true
    fi
  done
}

frontend_prune_releases() {
  # Keep last KEEP_FRONTEND_RELEASES; never delete current or previous.
  _cur=""
  _prev=""
  if [ -L "$FRONTEND_CURRENT" ]; then
    _cur=$(basename "$(readlink -f "$FRONTEND_CURRENT" 2>/dev/null || readlink "$FRONTEND_CURRENT")")
  fi
  # previous = second-newest by mtime among releases
  # shellcheck disable=SC2012
  _list=$(ls -1dt "$FRONTEND_RELEASES"/*/ 2>/dev/null | sed 's:/*$::' || true)
  _n=0
  for d in $_list; do
    _base=$(basename "$d")
    _n=$((_n + 1))
    if [ "$_n" -eq 2 ]; then
      _prev=$_base
    fi
  done
  _n=0
  for d in $_list; do
    _base=$(basename "$d")
    _n=$((_n + 1))
    if [ "$_n" -le "$KEEP_FRONTEND_RELEASES" ]; then
      continue
    fi
    if [ "$_base" = "$_cur" ] || [ "$_base" = "$_prev" ]; then
      continue
    fi
    info "Eski frontend release siliniyor: $_base"
    rm -rf "$d"
  done
}

frontend_build_release() {
  # frontend_build_release <sha>
  _sha=$1
  _dest="$FRONTEND_RELEASES/$_sha"
  mkdir -p "$FRONTEND_RELEASES"
  if [ -d "$_dest" ] && [ -f "$_dest/index.html" ] && [ -d "$_dest/static" ]; then
    info "Frontend release zaten var: $_dest"
    return 0
  fi
  rm -rf "$_dest"
  mkdir -p "$_dest"

  _src="$ROOT/frontend"
  [ -d "$_src" ] || die "frontend kaynağı yok: $_src"

  load_nvm_if_present
  info "Frontend üretim derlemesi → $_dest"
  cd "$_src" || die "frontend dizinine girilemedi: $_src"

  # Private visual-edits tarball is optional
  python3 -c '
import json
from pathlib import Path
p = Path("package.json")
data = json.loads(p.read_text())
deps = data.get("devDependencies") or {}
if "@emergentbase/visual-edits" in deps:
    del deps["@emergentbase/visual-edits"]
    data["devDependencies"] = deps
    p.write_text(json.dumps(data, indent=2) + "\n")
'

  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
  export GENERATE_SOURCEMAP=false
  export CI=false
  export DISABLE_ESLINT_PLUGIN=true
  export REACT_APP_GIT_SHA="$GIT_SHA"
  export REACT_APP_GIT_BRANCH="$GIT_BRANCH"
  export REACT_APP_GIT_MESSAGE="$GIT_MESSAGE"
  export REACT_APP_BUILD_TIME="$BUILD_TIME"
  export REACT_APP_VERSION="$APP_VERSION"
  # Build into a staging dir under frontend-releases (not live frontend/build).
  # CRA BUILD_PATH is relative to the frontend/ package root.
  _stage_name=".build-staging-$$"
  _stage="${FRONTEND_RELEASES}/${_stage_name}"
  rm -rf "$_stage"
  mkdir -p "$_stage"
  export BUILD_PATH="../frontend-releases/${_stage_name}"

  if command -v yarn >/dev/null 2>&1; then
    rm -f package-lock.json
    yarn install --network-timeout 600000 --check-files
    if ! yarn build; then
      rm -rf "$_stage" "$_dest"
      die "Frontend yarn build başarısız; canlıya dokunulmadı"
    fi
  elif command -v npm >/dev/null 2>&1; then
    npm install
    if ! npm run build; then
      rm -rf "$_stage" "$_dest"
      die "Frontend npm build başarısız; canlıya dokunulmadı"
    fi
  else
    die "yarn veya npm bulunamadı"
  fi

  # restore dirty tracked files from prebuild side-effects
  git -C "$ROOT" checkout -- frontend/package.json frontend/public/downloads/tamkobi-browser-extension.zip 2>/dev/null || true

  # CRA may ignore absolute BUILD_PATH and write frontend/build — accept either
  _built=""
  if [ -f "$_stage/index.html" ] && [ -d "$_stage/static" ]; then
    _built=$_stage
  elif [ -f "$_src/build/index.html" ] && [ -d "$_src/build/static" ]; then
    _built="$_src/build"
  fi
  if [ -z "$_built" ]; then
    rm -rf "$_stage" "$_dest"
    die "Frontend build başarısız (index.html/static yok); canlıya dokunulmadı"
  fi
  mkdir -p "$_dest"
  rsync -a --delete "$_built/" "$_dest/"
  rm -rf "$_stage"

  if [ ! -f "$_dest/index.html" ] || [ ! -d "$_dest/static" ]; then
    rm -rf "$_dest"
    die "Frontend release kopyası eksik; canlıya dokunulmadı"
  fi

  frontend_copy_prev_static "$_dest"
  chown -R www-data:www-data "$_dest" 2>/dev/null || true
}

frontend_activate() {
  _sha=$1
  _dest="$FRONTEND_RELEASES/$_sha"
  [ -f "$_dest/index.html" ] || die "activate: $_dest/index.html yok"
  [ -d "$_dest/static" ] || die "activate: $_dest/static yok"
  atomic_symlink "$_dest" "$FRONTEND_CURRENT"
  frontend_prune_releases
  info "frontend-current → $_dest"
}
