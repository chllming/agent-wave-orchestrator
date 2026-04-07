#!/usr/bin/env python3
"""Bump version, changelog, migration, manifest, recommendations for 0.9.10."""
import json, shutil

# Bump version
with open("package.json", "r") as f:
    pkg = f.read()
pkg = pkg.replace('"version": "0.9.9"', '"version": "0.9.10"')
with open("package.json", "w") as f:
    f.write(pkg)
print("package.json bumped to 0.9.10")

# Update CHANGELOG
with open("CHANGELOG.md", "r") as f:
    cl = f.read()
new_entry = """# Changelog

## 0.9.10 - 2026-04-07

### Fixed
- **Run-state history bloat**: The `run-state.json` history array grew unbounded, reaching 500MB+ in long-running repos. Each reconciliation cycle appended entries with full evidence objects (file hashes, status paths) that were never pruned. Fixed with:
  - History cap: max 200 total entries, max 20 per wave. Older entries are pruned on every write.
  - Evidence stripping: only the most recent history entry per wave retains its full evidence object; older entries have evidence set to null.
  - Improved dedup: the transition dedup check now ignores `completedAt` timestamps in status file evidence, preventing identical reconciliation cycles from creating duplicate entries.

"""
cl = cl.replace("# Changelog\n", new_entry)
with open("CHANGELOG.md", "w") as f:
    f.write(cl)
print("CHANGELOG.md updated")

# Copy recommendations
shutil.copy("docs/guides/recommendations-0.9.9.md", "docs/guides/recommendations-0.9.10.md")
with open("docs/guides/recommendations-0.9.10.md", "r") as f:
    rec = f.read()
rec = rec.replace("0.9.9", "0.9.10")
with open("docs/guides/recommendations-0.9.10.md", "w") as f:
    f.write(rec)
print("recommendations-0.9.10.md created")

# Update docs README
with open("docs/README.md", "r") as f:
    readme = f.read()
readme = readme.replace("recommendations-0.9.9.md", "recommendations-0.9.9.md\n- [0.9.10 Recommendations](guides/recommendations-0.9.10.md)")
with open("docs/README.md", "w") as f:
    f.write(readme)
print("docs/README.md updated")

# Update migration guide
with open("docs/plans/migration.md", "r") as f:
    mig = f.read()
mig = mig.replace("current `0.9.9`", "current `0.9.10`")
mig = mig.replace("Upgrading From `0.9.8` To `0.9.9`",
    "Upgrading From `0.9.9` To `0.9.10`\n\nRun-state history is now capped at 200 entries (20 per wave). Existing bloated run-state files will be automatically pruned on the next write. No config changes needed.\n\n## Upgrading From `0.9.8` To `0.9.9`")
mig = mig.replace("Upgrading From `0.8.3` To `0.9.9`", "Upgrading From `0.8.3` To `0.9.10`")
mig = mig.replace("Upgrading From `0.6.x` Or `0.7.x` To `0.9.9`", "Upgrading From `0.6.x` Or `0.7.x` To `0.9.10`")
with open("docs/plans/migration.md", "w") as f:
    f.write(mig)
print("migration.md updated")

# Update releases manifest
with open("releases/manifest.json", "r") as f:
    m = json.load(f)
m["releases"].insert(0, {
    "version": "0.9.10",
    "date": "2026-04-07",
    "summary": "Fix run-state history bloat that caused 500MB+ JSON files and V8 string length crashes.",
    "features": [
        "Run-state history capped at 200 entries (20 per wave) with automatic pruning.",
        "Evidence objects stripped from older history entries to reduce size.",
        "Improved transition dedup ignores completedAt timestamps in evidence.",
        "planner-agentic bundle placeholder remains available for adopted repos."
    ],
    "manualSteps": [],
    "breaking": False
})
with open("releases/manifest.json", "w") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print("manifest.json updated")

print("\nAll release files updated for 0.9.10")
