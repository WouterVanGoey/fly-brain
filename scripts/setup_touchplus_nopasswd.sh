#!/bin/bash
# One-time authorization script for Touch+ zero-prompt camera access on macOS.
# Configures setuid root (chmod 4755) on TouchPlusPrepare helper so agents,
# daemons, and fly-brain simulation can access and prepare Touch+ unattended.

set -e

HELPER="/Users/wouter/Code/TouchPlus/build/TouchPlus Workbench.app/Contents/Helpers/TouchPlusPrepare"

if [ ! -f "$HELPER" ]; then
    echo "❌ Error: $HELPER not found. Build TouchPlus first."
    exit 1
fi

echo "=========================================================="
echo "Touch+ Zero-Prompt Unattended Camera Configuration"
echo "=========================================================="
echo "Configuring setuid root permissions on:"
echo "  $HELPER"
echo ""

# Use AppleScript with administrator privileges (triggers standard native Touch ID prompt)
osascript -e "do shell script \"chown root:wheel '$HELPER' && chmod 4755 '$HELPER' && touch /tmp/touchplus-prepared\" with administrator privileges"

echo "✅ Success! TouchPlusPrepare is now setuid root (4755)."
echo "   All agents, background daemons, and simulations can now"
echo "   access the Touch+ stereo stream passwordlessly at any time."
ls -l "$HELPER"
