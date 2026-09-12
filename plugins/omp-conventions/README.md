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

From a local checkout of this repository:

```bash
omp plugin link ./plugins/omp-conventions
```

Restart OMP after linking. Keep the checkout at the linked location. To enable
it only for the current project, copy the standalone extension into that
project's native OMP extension directory instead:

```bash
mkdir -p .omp/extensions
cp /absolute/path/to/agent-plugins-hub/plugins/omp-conventions/extensions/omp-conventions.ts .omp/extensions/
```

For a single OMP invocation, load the extension directly instead:

```bash
omp --extension ./plugins/omp-conventions/extensions/omp-conventions.ts
```

The plugin declares only `omp.extensions`. It has no Pi extension registration,
Codex or Claude Code manifest, or shared marketplace entry, so installing this
repository through those clients does not activate it.

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
