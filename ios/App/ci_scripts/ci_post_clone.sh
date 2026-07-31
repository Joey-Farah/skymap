#!/bin/sh
set -e

brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci

# The native app is served from capacitor://localhost, which has no server
# behind it — a relative /api/feedback would post into the void. Without this
# the feedback form can't submit and silently falls back to mailto:, which is
# the bug the form exists to fix. Set it here rather than in the Xcode Cloud
# UI so the value is visible in the repo and survives a workflow rebuild.
export VITE_FEEDBACK_ENDPOINT="https://skymap-alpha.vercel.app/api/feedback"

npm run build
npx cap sync ios
