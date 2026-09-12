# OMP Conventions

An Oh My Pi extension implementing the name-replacement workaround discussed in
[oh-my-pi#11794](https://github.com/can1357/oh-my-pi/issues/11794).
It preserves the conventions block and its instructions.

Before each provider request, it renames only the complete XML tags
`<system-conventions>`, `</system-conventions>`, `<system_conventions>`, and
`</system_conventions>` to `<conventions>` or `</conventions>` in
`payload.request.systemInstruction.parts[].text`. For example:

```xml
<system-conventions>Keep these instructions.</system-conventions>
```

becomes:

```xml
<conventions>Keep these instructions.</conventions>
```

Plain-text references to the two names, including those inside the conventions
block, are preserved. Incomplete tags and longer tag names are not matched.
User messages, tool definitions, non-text parts, and all
other request fields are preserved. Requests without this Cloud Code Assist
system-instruction shape are ignored. Matching is case-sensitive and repeated
processing is idempotent.

This is a local workaround, not a guarantee that a provider will accept a
request or that every HTTP 429 error will be resolved.

## Install in Oh My Pi

Add the GitHub marketplace, then install the extension with `omp install`:

```bash
omp plugin marketplace add https://github.com/tenfyzhong/agent-plugins-hub
omp install omp-conventions@tenfyzhong-agent-plugins-hub
```

Restart OMP after installation. If the marketplace is already configured,
refresh its catalog before installing:

```bash
omp plugin marketplace update tenfyzhong-agent-plugins-hub
omp install omp-conventions@tenfyzhong-agent-plugins-hub
```

For a project-only installation, add `--scope project` to `omp install`.
Update an installed version with:

```bash
omp plugin upgrade omp-conventions@tenfyzhong-agent-plugins-hub
```

The GitHub installation uses the repository's default branch and becomes
available once this change is merged.

The plugin is registered in the OMP-only `.omp-plugin/marketplace.json`
catalog and declares only `omp.extensions`. It has no Pi extension registration,
Codex or Claude Code manifest, or entry in their catalogs, so those clients do
not activate it. The OMP catalog also retains all existing marketplace plugins.

## Validation

The repository tests execute the actual TypeScript extension through Node.js
and a stub OMP event API. Node.js 22.18+ (or 24+) and Python 3 are required:

```bash
python3 -m unittest tests.test_omp_conventions
python3 -m unittest discover -s tests
```

Tests cover both tag spellings, all system text parts, preserved body text,
incomplete and similar tags, unrelated fields, malformed payloads, idempotence,
and OMP-only registration.
They do not make live provider requests.
