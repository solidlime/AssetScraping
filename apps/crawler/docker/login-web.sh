#!/bin/sh
# noVNC ログイン環境を起動する。
# Xvfb (仮想ディスプレイ :99) + x11vnc (VNC サーバー) + websockify (noVNC 配信 :6080)
# + Chromium ランチャー (login-web.ts) を起動する。
set -e
export DISPLAY=:99

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
x11vnc -display :99 -forever -nopw -quiet -rfbport 5900 &
websockify --web /usr/share/novnc 6080 localhost:5900 &

cd /app/apps/crawler
exec node_modules/.bin/tsx src/login-web.ts
