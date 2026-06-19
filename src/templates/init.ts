export const DEFAULT_POKO_CONFIG = `{
  "schemaVersion": 1,
  "project": {
    "id": "",
    "createdAt": ""
  },
  "adapters": {
    "claude": {
      "enabled": true,
      "mcp": true,
      "skills": true
    },
    "cursor": {
      "enabled": true,
      "mcp": true,
      "legacyCursorrules": false
    },
    "t3code": {
      "enabled": true,
      "skills": true
    },
    "opencode": {
      "enabled": true,
      "mcp": true
    },
    "pi": {
      "enabled": true,
      "skills": true
    },
    "hermes": {
      "enabled": true,
      "skills": true
    },
    "openclaw": {
      "enabled": true,
      "skills": true
    },
    "codex": {
      "enabled": true,
      "mcp": true
    }
  },
  "history": {
    "defaultStore": "local",
    "captureRaw": true,
    "includePreviousProjectIncarnations": false,
    "syncOnProjectSync": true,
    "agents": {
      "codex": true,
      "claude": true,
      "cursor": true,
      "pi": true,
      "hermes": true,
      "openclaw": true
    }
  },
  "pro": {
    "enabledFeatures": []
  }
}
`;

export const INIT_TEMPLATES = [
  { path: ".poko/poko.json", content: DEFAULT_POKO_CONFIG },
] as const;
