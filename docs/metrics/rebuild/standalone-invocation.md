# Standalone infrastructure authentication

An isolated build of the exact merged Metrics source with only the web package's
locked dependencies failed before any paid container build: the shared report
client imported `google-auth-library` from a path outside that package. A full
repository install hid the resolution problem by supplying the root dependency.

The shared client now accepts an explicit structural invocation-auth driver and
has no package dependency or ambient SDK fallback. The Next.js executable loads
GoogleAuth from its own exact locked package; the retained gateway loads it from
its existing root package, lazily after routing/admission checks. Both reuse the
same bounded audience-specific identity helper. No dependency, lock, Dockerfile,
CI/CD policy, credential scope or source/provider authority changes.

The runtime import guard enforces package ownership and still rejects every
provider/collector path from the web graph. Negative isolated-build and guard
receipts are retained. Validation requires an isolated web-only install/build,
the production browser path, root checks and exact-head hosted qualification;
normal repository builds alone do not certify the standalone context.

This fixes packaging, not live source counts or serving acceptance. The prepared
old-source image build was not submitted; source generation, native image and
candidate qualification must bind the repaired commit before release.
