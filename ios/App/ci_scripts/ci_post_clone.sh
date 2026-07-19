#!/bin/sh
set -e

brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci
npm run build
npx cap sync ios
