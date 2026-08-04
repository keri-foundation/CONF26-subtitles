#!/usr/bin/env bash

# Upload fixed subtitles to YouTube videos in a playlist

set -e

PLAYLIST_URL="$1"
FIXED_DIR="subtitles"
SINGLE_FILE=""
FORCE_UPLOAD="false"
FORCE_REAUTH="false"

shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      SINGLE_FILE="$2"
      if [ -z "$SINGLE_FILE" ]; then
        echo "Error: --file requires a subtitle file path or name"
        exit 1
      fi
      shift 2
      ;;
    --force)
      FORCE_UPLOAD="true"
      shift
      ;;
    --reauth)
      FORCE_REAUTH="true"
      shift
      ;;
    *)
      FIXED_DIR="$1"
      shift
      ;;
  esac
done

if [ -z "$PLAYLIST_URL" ]; then
  echo "Usage:"
  echo "npm run upload -- 'https://www.youtube.com/playlist?list=PLAYLIST_ID'"
  echo "npm run upload -- 'https://www.youtube.com/playlist?list=PLAYLIST_ID' --file 'Video Title.fixed.srt'"
  echo "npm run upload -- 'https://www.youtube.com/playlist?list=PLAYLIST_ID' --force"
  echo "npm run upload -- 'https://www.youtube.com/playlist?list=PLAYLIST_ID' --reauth"
  exit 1
fi

UPLOAD_ARGS=("$PLAYLIST_URL" "$FIXED_DIR")

if [ -n "$SINGLE_FILE" ]; then
  UPLOAD_ARGS+=(--file "$SINGLE_FILE")
fi

if [ "$FORCE_UPLOAD" = "true" ]; then
  UPLOAD_ARGS+=(--force)
fi

if [ "$FORCE_REAUTH" = "true" ]; then
  UPLOAD_ARGS+=(--reauth)
fi

node src/youtube-uploader.js "${UPLOAD_ARGS[@]}"
