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
      "enabled": false,
      "mcp": true,
      "legacyCursorrules": false
    },
    "t3code": {
      "enabled": false,
      "skills": true
    },
    "opencode": {
      "enabled": false,
      "mcp": true
    },
    "pi": {
      "enabled": false,
      "skills": true
    },
    "hermes": {
      "enabled": false,
      "skills": true
    },
    "openclaw": {
      "enabled": false,
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
      "cursor": false,
      "pi": false,
      "hermes": false,
      "openclaw": false
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
