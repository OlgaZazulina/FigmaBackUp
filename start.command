#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo "Node.js не установлен. Установите с https://nodejs.org"
  read -p "Нажмите Enter для выхода..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Установка зависимостей (первый запуск)..."
  npm install
fi

node start.js

if [ $? -ne 0 ]; then
  echo ""
  read -p "Нажмите Enter для выхода..."
fi
